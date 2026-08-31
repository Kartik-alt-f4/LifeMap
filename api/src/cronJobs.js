// cronJobs.js — morning, EOD, reminder, cleanup handlers
// Called by Supabase pg_cron via authenticated POST endpoints (functions.sql's
// "SUPABASE-NATIVE CRON SCHEDULER" section) — see CLAUDE.md's "Cron" notes.

import { supabase }       from './supabaseClient.js'
import { postToDiscord }  from './discordBot.js'
import {
  getPushToken, savePushToken, getPlayerState,
  getPendingTasksForDate, skipTask, carryTaskForward, applyTaskPenalty
} from './dbAgent.js'
import { getGame, getServer } from './configLoader.js'
import { computeStreakMultiplier, computeTaskRewards, computeLevelPenalty, getRank } from './rpgEngine.js'
import { addDays } from './dateUtils.js'

// ── Push notification helper ──────────────────────────────────────────────────
async function sendPush(title, body) {
  const tokenData = await getPushToken()
  if (!tokenData?.token) return

  try {
    await fetch('https://exp.host/--/api/v2/push/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ to: tokenData.token, title, body, sound: 'default' })
    })
  } catch (err) {
    console.error('Push notification failed:', err.message)
  }
}

// ── MORNING ───────────────────────────────────────────────────────────────────
export async function runMorning() {
  const { data: state } = await supabase
    .from('daily_state').select('morning_ran, date').eq('id', 1).single()

  if (state.morning_ran) return { skipped: true }

  // Trust daily_state.date as "today" rather than re-deriving it from the live
  // clock — runEod() is what advances this date (via roll_daily_state, passed
  // explicitly), so morning and EOD always agree on what day it is, even if
  // cron fell behind and daily_state.date lags the real calendar date.
  const today = state.date

  // 1. Spawn task instances from templates — today plus the next 6 days, so
  // the coming week is already visible/navigable instead of materializing
  // one day at a time as each morning arrives. spawn_template_instances()
  // skips a template+date pair that already has an instance, so re-running
  // it for days already spawned on a previous morning is a safe no-op —
  // this only ever adds the one new day rolling off the end of the window.
  let spawned = 0
  for (let i = 0; i < 7; i++) {
    const { data: n } = await supabase.rpc('spawn_template_instances', { p_date: addDays(today, i) })
    spawned += n ?? 0
  }

  // 2. Passive energy regen
  const { passive_morning_regen } = getGame().energy
  await supabase.rpc('regen_energy', { p_amount: passive_morning_regen })

  // 3. Reset day_off for new day, reset eod_ran
  await supabase.from('daily_state').update({
    morning_ran:         true,
    eod_ran:             false,
    day_off_granted:     false,
    date:                today,
    last_morning_run_at: new Date().toISOString()
  }).eq('id', 1)

  // Carryover is no longer morning's job — it happens at EOD, the moment a day
  // closes, so tasks that carry are already sitting here as normal pending rows
  // by the time this briefing runs. See runEod() for the per-type carry/penalty
  // logic (this used to live here, querying yesterday's still-'pending' tasks —
  // but EOD always runs first and had already flipped those to 'skipped' or
  // moved them itself, so this step almost never found anything to carry).

  // 4. Build briefing
  const player = await getPlayerState()
  const { data: tasksToday } = await supabase
    .from('task')
    .select('title, task_type, time_block, priority')
    .eq('scheduled_for', today)
    .eq('status', 'pending')
    .order('scheduled_at', { ascending: true, nullsFirst: false })
    .limit(8)

  const taskLines = (tasksToday || [])
    .map(t => `• ${t.title} [${t.task_type}${t.time_block ? ', ' + t.time_block : ''}]`)
    .join('\n')

  const briefing = [
    `☀️ **${today}** — Lv${player.level} ${getRank(player.level)}`,
    `⚡ ${player.energy.current}/${player.energy.max}  🔥 ${player.streak} day streak  ◆ ${player.available_gold}g`,
    tasksToday?.length ? `\n**Today (${tasksToday.length}):**\n${taskLines}` : 'No tasks scheduled.',
    '\nSystem ready.'
  ].filter(Boolean).join('\n')

  if (getServer().notifications.morning_briefing) {
    await postToDiscord(briefing)
    await sendPush('Morning briefing', `${tasksToday?.length ?? 0} tasks today. Streak: ${player.streak}`)
  }

  return { ok: true, spawned }
}

// ── EOD ───────────────────────────────────────────────────────────────────────
export async function runEod() {
  const { data: state } = await supabase
    .from('daily_state')
    .select('morning_ran, eod_ran, mandatory_met, day_streak, date')
    .eq('id', 1).single()

  if (!state.morning_ran) return { skipped: true, reason: 'morning_not_run' }
  if (state.eod_ran)      return { skipped: true, reason: 'already_ran' }

  const today    = state.date
  const tomorrow = addDays(today, 1)

  // 1. Close out today's still-pending tasks, by type:
  //    - routine:  skipped, no carry, no penalty (a fresh instance spawns
  //                tomorrow anyway if it's templated)
  //    - anchor / mandatory: skipped AND penalized once, terminal — both are
  //                "sure shot" cases (an anchor's slot is just gone once the
  //                day passes; a missed mandatory means you're already behind
  //                and would have to redo it anyway, so auto-carrying it
  //                forward doesn't actually help). Neither carries forward.
  //    - project / habit / bonus: carry forward, no penalty
  let runningPlayer = await getPlayerState()
  let penalizedCount = 0
  let carriedCount   = 0

  const pending = await getPendingTasksForDate(today)
  for (const task of pending) {
    if (task.task_type === 'routine') {
      await skipTask(task.id)
      continue
    }

    if (task.task_type === 'anchor' || task.task_type === 'mandatory') {
      const { xp, gold }  = computeTaskRewards(task)
      const levelPenalty  = computeLevelPenalty(runningPlayer.level, runningPlayer.current_xp, xp)
      await applyTaskPenalty(task.id, xp, gold, levelPenalty)
      runningPlayer = { ...runningPlayer, level: levelPenalty.newLevel, current_xp: levelPenalty.newXp }
      penalizedCount++
      await skipTask(task.id)
      continue
    }

    // project / habit / bonus — carry forward, no penalty
    await carryTaskForward(task, tomorrow, false)
    carriedCount++
  }

  // 2. Update streak
  const newStreak = state.mandatory_met ? state.day_streak + 1 : state.day_streak - 1
  const streakMult = newStreak > 0 ? computeStreakMultiplier(newStreak) : 0

  // 3. Skill + stat streak updates
  const { data: skills } = await supabase.from('skill').select('id, current_streak')
  const { data: stats }  = await supabase.from('stat').select('id, current_streak')
  const { data: todayXp } = await supabase.from('xp_ledger')
    .select('target_type, target_id')
    .in('target_type', ['skill', 'stat'])
    .gte('timestamp', `${today}T00:00:00`)

  const hitSkills = new Set((todayXp || []).filter(x => x.target_type === 'skill').map(x => x.target_id))
  const hitStats  = new Set((todayXp || []).filter(x => x.target_type === 'stat').map(x => x.target_id))

  for (const sk of skills || []) {
    const newStrk = hitSkills.has(sk.id)
      ? (sk.current_streak < 0 ? 1 : sk.current_streak + 1)
      : sk.current_streak - 1
    await supabase.from('skill').update({ current_streak: newStrk }).eq('id', sk.id)
  }
  for (const st of stats || []) {
    const newStrk = hitStats.has(st.id)
      ? (st.current_streak < 0 ? 1 : st.current_streak + 1)
      : st.current_streak - 1
    await supabase.from('stat').update({ current_streak: newStrk }).eq('id', st.id)
  }

  // 4. Write daily snapshot
  const player   = await getPlayerState()
  const { count: completed } = await supabase.from('task')
    .select('id', { count: 'exact', head: true })
    .eq('scheduled_for', today).eq('status', 'completed')
  const { count: skipped } = await supabase.from('task')
    .select('id', { count: 'exact', head: true })
    .eq('scheduled_for', today).eq('status', 'skipped')

  // Summarise today's leisure usage for snapshot
  const { data: leisureLogs } = await supabase
    .from('leisure_log')
    .select('quantity, unit, shop_item(name, tracking_unit)')
    .gte('logged_at', `${today}T00:00:00`)

  const leisureSummary = {}
  for (const log of leisureLogs || []) {
    const name = log.shop_item?.name ?? 'Unknown'
    if (!leisureSummary[name]) leisureSummary[name] = { quantity: 0, unit: log.unit }
    leisureSummary[name].quantity += log.quantity
  }

  await supabase.from('daily_snapshot').insert({
    date:            today,
    level:           player.level,
    current_xp:      player.current_xp,
    total_gold:      player.total_gold,
    available_gold:  player.available_gold,
    day_streak:      newStreak,
    energy:          player.energy.current,
    mandatory_met:   state.mandatory_met,
    tasks_completed: completed ?? 0,
    tasks_skipped:   skipped   ?? 0,
    leisure_summary: Object.keys(leisureSummary).length ? leisureSummary : null
  })

  // 5. Roll daily state — pass tomorrow explicitly so it matches exactly what
  // carried tasks (step 1) were scheduled for, instead of the RPC independently
  // deriving CURRENT_DATE + 1 (which disagrees with `tomorrow` whenever
  // daily_state.date has drifted behind the real clock).
  await supabase.rpc('roll_daily_state', {
    p_new_streak:  newStreak,
    p_streak_mult: streakMult,
    p_new_date:    tomorrow
  })
  await supabase.from('daily_state')
    .update({ last_eod_run_at: new Date().toISOString() }).eq('id', 1)

  // 6. EOD summary
  const streakMsg   = state.mandatory_met ? `🔥 Streak: ${newStreak}` : `💀 Streak broken (${newStreak})`
  const summary = [
    `🌙 **EOD ${today}**`,
    streakMsg,
    `✅ ${completed ?? 0} completed  ⏭ ${skipped ?? 0} skipped`,
    penalizedCount ? `⚠ ${penalizedCount} penalized (missed anchor/mandatory)` : '',
    carriedCount   ? `↪ ${carriedCount} carried to tomorrow` : '',
    `Lv${player.level}  ⚡${player.energy.current}/${player.energy.max}  ◆${player.available_gold}g`,
    'Day logged.'
  ].filter(Boolean).join('\n')

  if (getServer().notifications.eod_summary) {
    await postToDiscord(summary)
    await sendPush('Day complete', `${completed ?? 0} done. ${streakMsg}`)
  }

  return { ok: true, newStreak, mandatory_met: state.mandatory_met, penalized: penalizedCount, carried: carriedCount }
}

// ── REMIND ────────────────────────────────────────────────────────────────────
// Sends any pending task's reminder(s) whose scheduled_at falls inside a given
// [windowStartMin, windowEndMin) minutes-from-now band, once per task per
// flagColumn — used for both the close reminder and the anchor/mandatory
// long-lead heads-up below, which run independently of each other.
const REMIND_ICONS = { anchor: '⚓', mandatory: '⚔', habit: '🔄' }

async function sendWindowReminders({ windowStartMin, windowEndMin, taskTypes, flagColumn, formatMessage, pushTitle }) {
  const now        = new Date()
  const nowIso     = now.toISOString()
  const rangeStart = new Date(now.getTime() + windowStartMin * 60 * 1000).toISOString()
  const rangeEnd   = new Date(now.getTime() + windowEndMin   * 60 * 1000).toISOString()

  const { data: upcoming } = await supabase
    .from('task')
    .select('id, title, task_type, priority, scheduled_at')
    .eq('status', 'pending')
    .in('task_type', taskTypes)
    .not('scheduled_at', 'is', null)
    .gte('scheduled_at', rangeStart)
    .lte('scheduled_at', rangeEnd)
    .is(flagColumn, null)

  for (const task of upcoming || []) {
    const minsAway = Math.round((new Date(task.scheduled_at) - now) / 60000)
    const msg       = formatMessage(task, minsAway)
    const pushWhen  = minsAway <= 0 ? 'now' : `in ${minsAway} min`

    await postToDiscord(msg)
    await sendPush(pushTitle, `${task.title} ${pushWhen}`)
    await supabase.from('task').update({ [flagColumn]: nowIso }).eq('id', task.id)
  }

  return (upcoming || []).length
}

export async function runRemind() {
  const cfg = getServer().notifications

  // windowStartMin is negative — a run that fires late (cron drift, a dropped
  // trigger) can still catch a task whose ideal reminder moment already
  // passed by up to remind_lookback_min, instead of silently losing it
  // forever. Before this, the window was forward-only ([0, remind_minutes_
  // before]), so any gap between runs bigger than remind_minutes_before could
  // permanently drop reminders that fell entirely inside the gap.
  const notified = await sendWindowReminders({
    windowStartMin: -cfg.remind_lookback_min,
    windowEndMin:   cfg.remind_minutes_before,
    taskTypes:      ['anchor', 'mandatory', 'habit'],
    flagColumn:     'reminded_at',
    pushTitle:      'Upcoming task',
    formatMessage:  (task, minsAway) =>
      `${REMIND_ICONS[task.task_type] ?? '📌'} **${task.title}** — ${minsAway <= 0 ? 'now' : `in ${minsAway} min`}`
  })

  // Long-lead heads-up for anchor/mandatory specifically — fires once, roughly
  // early_remind_window_start_min to early_remind_window_end_min minutes out
  // (default ~90 to ~60), independent of the close reminder above.
  const earlyNotified = await sendWindowReminders({
    windowStartMin: cfg.early_remind_window_end_min,
    windowEndMin:   cfg.early_remind_window_start_min,
    taskTypes:      cfg.early_remind_task_types,
    flagColumn:     'early_reminded_at',
    pushTitle:      'Heads up',
    formatMessage:  (task, minsAway) =>
      `⏰ Heads up: ${REMIND_ICONS[task.task_type] ?? '📌'} **${task.title}** — in ${Math.round(minsAway / 6) / 10}h`
  })

  return { notified, earlyNotified }
}

// ── CLEANUP ───────────────────────────────────────────────────────────────────
export async function runCleanup() {
  const { ttl_days } = getServer().session
  const cutoff = new Date(Date.now() - ttl_days * 86400000).toISOString()
  const { data } = await supabase
    .from('conversation_session').delete().lt('updated_at', cutoff).select('id')
  return { sessions_deleted: data?.length ?? 0 }
}

// ── CRON WATCHDOG ────────────────────────────────────────────────────────────
// Called from GET /health, which fires reliably every ~10-14 min via an
// external ping service (cron-job.org) — the one trigger in this system NOT
// subject to GitHub Actions' own scheduling unreliability. Warns on Discord
// once per missed day if morning/EOD haven't run by an hour past their
// expected UTC window. Uses last_morning_run_at/last_eod_run_at (set only on
// a real execution, never on an idempotency-skip) rather than
// daily_state.morning_ran/eod_ran, which flip meaning across the day
// boundary and aren't safe to compare against real clock time — see
// supabase/.migrations/009_cron_watchdog.sql.
const MORNING_EXPECTED_UTC_HOUR = 11
const EOD_EXPECTED_UTC_HOUR     = 3
const WATCHDOG_GRACE_HOURS      = 1

export async function checkCronWatchdog() {
  try {
    const now      = new Date()
    const todayUtc = now.toISOString().slice(0, 10)

    const { data: state } = await supabase
      .from('daily_state')
      .select('last_morning_run_at, last_eod_run_at, morning_alert_sent_on, eod_alert_sent_on')
      .eq('id', 1).single()
    if (!state) return

    await checkOneCron({
      label: 'Morning', expectedHour: MORNING_EXPECTED_UTC_HOUR,
      lastRunAt: state.last_morning_run_at, alertSentOn: state.morning_alert_sent_on,
      alertColumn: 'morning_alert_sent_on', now, todayUtc
    })
    await checkOneCron({
      label: 'EOD', expectedHour: EOD_EXPECTED_UTC_HOUR,
      lastRunAt: state.last_eod_run_at, alertSentOn: state.eod_alert_sent_on,
      alertColumn: 'eod_alert_sent_on', now, todayUtc
    })
  } catch (err) {
    console.error('[watchdog] check failed:', err.message)
  }
}

async function checkOneCron({ label, expectedHour, lastRunAt, alertSentOn, alertColumn, now, todayUtc }) {
  const cutoff = new Date(`${todayUtc}T${String(expectedHour).padStart(2, '0')}:00:00Z`)
  cutoff.setUTCHours(cutoff.getUTCHours() + WATCHDOG_GRACE_HOURS)
  if (now < cutoff) return // window hasn't opened yet today

  const ranToday = lastRunAt && new Date(lastRunAt).toISOString().slice(0, 10) === todayUtc
  if (ranToday) return

  if (alertSentOn === todayUtc) return // already warned today — re-arms itself tomorrow

  await postToDiscord(
    `⚠️ ${label} cron hasn't run today (expected ~${expectedHour}:00 UTC, now ${now.toISOString().slice(11, 16)} UTC). Check GitHub Actions.`
  )
  await supabase.from('daily_state').update({ [alertColumn]: todayUtc }).eq('id', 1)
}

// ── STREAK WARNING ─────────────────────────────────────────────────────────────
export async function checkStreakWarning() {
  const cfg = getServer().notifications
  if (!cfg.streak_warning) return

  const estHour = parseInt(
    new Date().toLocaleString('en-US', {
      timeZone: 'America/New_York', hour: 'numeric', hour12: false
    }).replace('24', '0'), 10
  )
  if (estHour < cfg.streak_warning_hour_est) return

  const { data: state } = await supabase
    .from('daily_state').select('mandatory_met, day_streak').eq('id', 1).single()

  if (!state.mandatory_met && state.day_streak > 0) {
    const msg = `⚠️ Mandatory task not done. Current streak: 🔥${state.day_streak}. Get it done.`
    await postToDiscord(msg)
    await sendPush('Streak warning', `Mandatory not done — ${state.day_streak} day streak at risk`)
  }
}
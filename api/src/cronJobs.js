// cronJobs.js — morning, EOD, reminder, cleanup handlers
// Called by GitHub Actions via authenticated POST endpoints.

import { supabase }       from './supabaseClient.js'
import { postToDiscord }  from './discordBot.js'
import { getPushToken, savePushToken, getPlayerState } from './dbAgent.js'
import { getGame, getServer, getRank } from './configLoader.js'
import { computeStreakMultiplier }   from './rpgEngine.js'

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

  const today = new Date().toISOString().split('T')[0]

  // 1. Spawn today's task instances from templates
  const { data: spawned } = await supabase.rpc('spawn_template_instances', { p_date: today })

  // 2. Passive energy regen
  const { passive_morning_regen } = getGame().energy
  await supabase.rpc('regen_energy', { p_amount: passive_morning_regen })

  // 3. Reset day_off for new day, reset eod_ran
  await supabase.from('daily_state').update({
    morning_ran:    true,
    eod_ran:        false,
    day_off_granted: false,
    date:           today
  }).eq('id', 1)

  // 4. Carry over unfinished non-routine tasks from yesterday
  const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0]
  const { data: carryover } = await supabase
    .from('task')
    .select('*')
    .eq('scheduled_for', yesterday)
    .eq('status', 'pending')
    .not('task_type', 'eq', 'routine')

  let carriedCount = 0
  for (const task of carryover || []) {
    const daysLate      = 1
    const lateMultiplier = Math.pow(getGame().tasks.late_penalty_per_day, daysLate)
    await supabase.from('task').update({ status: 'cancelled' }).eq('id', task.id)
    await supabase.from('task').insert({
      title:          task.title,
      task_type:      task.task_type,
      priority:       task.priority,
      difficulty:     task.difficulty,
      time_block:     task.time_block,
      scheduled_for:  today,
      is_recovery:    task.is_recovery,
      late_multiplier: lateMultiplier,
      template_id:    task.template_id
    })
    carriedCount++
  }

  // 5. Build briefing
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
    carriedCount ? `⚠ ${carriedCount} task(s) carried from yesterday` : '',
    tasksToday?.length ? `\n**Today (${tasksToday.length}):**\n${taskLines}` : 'No tasks scheduled.',
    '\nSystem ready.'
  ].filter(Boolean).join('\n')

  if (getServer().notifications.morning_briefing) {
    await postToDiscord(briefing)
    await sendPush('Morning briefing', `${tasksToday?.length ?? 0} tasks today. Streak: ${player.streak}`)
  }

  return { ok: true, spawned, carried: carriedCount }
}

// ── EOD ───────────────────────────────────────────────────────────────────────
export async function runEod() {
  const { data: state } = await supabase
    .from('daily_state')
    .select('morning_ran, eod_ran, mandatory_met, day_streak, date')
    .eq('id', 1).single()

  if (!state.morning_ran) return { skipped: true, reason: 'morning_not_run' }
  if (state.eod_ran)      return { skipped: true, reason: 'already_ran' }

  const today = state.date

  // 1. Mark all pending tasks as skipped
  await supabase.from('task')
    .update({ status: 'skipped' })
    .eq('scheduled_for', today)
    .eq('status', 'pending')

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

  await supabase.from('daily_snapshot').insert({
    date:           today,
    level:          player.level,
    current_xp:     player.current_xp,
    total_gold:     player.total_gold,
    available_gold: player.available_gold,
    day_streak:     newStreak,
    energy:         player.energy.current,
    mandatory_met:  state.mandatory_met,
    tasks_completed: completed ?? 0,
    tasks_skipped:   skipped   ?? 0
  })

  // 5. Roll daily state
  await supabase.rpc('roll_daily_state', {
    p_new_streak:  newStreak,
    p_streak_mult: streakMult
  })

  // 6. EOD summary
  const streakMsg   = state.mandatory_met ? `🔥 Streak: ${newStreak}` : `💀 Streak broken (${newStreak})`
  const summary = [
    `🌙 **EOD ${today}**`,
    streakMsg,
    `✅ ${completed ?? 0} completed  ⏭ ${skipped ?? 0} skipped`,
    `Lv${player.level}  ⚡${player.energy.current}/${player.energy.max}  ◆${player.available_gold}g`,
    'Day logged.'
  ].join('\n')

  if (getServer().notifications.eod_summary) {
    await postToDiscord(summary)
    await sendPush('Day complete', `${completed ?? 0} done. ${streakMsg}`)
  }

  return { ok: true, newStreak, mandatory_met: state.mandatory_met }
}

// ── REMIND ────────────────────────────────────────────────────────────────────
export async function runRemind() {
  const cfg         = getServer().notifications
  const minutesBefore = cfg.remind_minutes_before
  const now         = new Date()
  const windowEnd   = new Date(now.getTime() + minutesBefore * 60 * 1000).toISOString()
  const nowIso      = now.toISOString()

  const { data: upcoming } = await supabase
    .from('task')
    .select('id, title, task_type, priority, scheduled_at')
    .eq('status', 'pending')
    .in('task_type', ['anchor', 'mandatory', 'habit'])
    .not('scheduled_at', 'is', null)
    .gte('scheduled_at', nowIso)
    .lte('scheduled_at', windowEnd)
    .is('reminded_at', null)

  for (const task of upcoming || []) {
    const minsAway = Math.round((new Date(task.scheduled_at) - now) / 60000)
    const icons    = { anchor: '⚓', mandatory: '⚔', habit: '🔄' }
    const icon     = icons[task.task_type] ?? '📌'
    const msg      = `${icon} **${task.title}** — in ${minsAway} min`

    await postToDiscord(msg)
    await sendPush('Upcoming task', `${task.title} in ${minsAway} min`)
    await supabase.from('task').update({ reminded_at: nowIso }).eq('id', task.id)
  }

  return { notified: (upcoming || []).length }
}

// ── CLEANUP ───────────────────────────────────────────────────────────────────
export async function runCleanup() {
  const { ttl_days } = getServer().session
  const cutoff = new Date(Date.now() - ttl_days * 86400000).toISOString()
  const { data } = await supabase
    .from('conversation_session').delete().lt('updated_at', cutoff).select('id')
  return { sessions_deleted: data?.length ?? 0 }
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

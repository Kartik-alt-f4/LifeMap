// dbAgent.js — all database reads and writes
// No business logic here. Pure data access layer.

import { supabase } from './supabaseClient.js'
import { todayEST, estNaiveToUTC } from './dateUtils.js'
import { detectConflict, findAlternativeBlock } from './scheduleEngine.js'
import { getGame } from './configLoader.js'

// ── Player state ──────────────────────────────────────────────────────────────
export async function getPlayerState() {
  const [playerRes, energyRes, dailyRes] = await Promise.all([
    supabase.from('player').select('*').eq('id', 1).single(),
    supabase.from('energy_state').select('*').eq('id', 1).single(),
    supabase.from('daily_state').select('*').eq('id', 1).single()
  ])
  if (playerRes.error) throw playerRes.error
  if (energyRes.error) throw energyRes.error
  if (dailyRes.error)  throw dailyRes.error

  const p = playerRes.data
  const e = energyRes.data
  const d = dailyRes.data

  const { getRank } = await import('./rpgEngine.js')
  return {
    level:          p.current_level,
    rank:           getRank(p.current_level),
    current_xp:     p.current_xp,
    xp_to_next:     p.xp_to_next,
    total_gold:     p.total_gold,
    available_gold: p.available_gold,
    energy: {
      current:         e.current,
      max:             e.max,
      threshold_label: e.threshold_label
    },
    streak:             d.day_streak,
    mandatory_met:      d.mandatory_met,
    day_off_granted:    d.day_off_granted,
    free_leisure_today: d.free_leisure_today ?? false,
    date:               d.date
  }
}

// ── Tasks ─────────────────────────────────────────────────────────────────────
// Previously hid pending 'routine' tasks once their time_block had passed
// (EST-based cutoffs) — that left a pending task genuinely invisible for
// hours until EOD formally skipped it, with no way to see or complete it
// late. web/src/pages/Dashboard.jsx's isOverdue() already computes the same
// "has this task's window passed" check for any pending task and drives the
// .task-row.urgent styling — routine tasks now just flow through to that
// same mechanism instead of being hidden ahead of it.
export async function getTasksForDate(dateStr) {
  const { data, error } = await supabase
    .from('task')
    .select('*')
    .eq('scheduled_for', dateStr)
    .neq('status', 'cancelled')
    .order('scheduled_at', { ascending: true, nullsFirst: false })

  if (error) throw error
  return data || []
}

// ── Tasks still pending for a given date — used by the EOD cron ───────────────
// Unlike getTasksForDate(), only returns status='pending' rows — EOD needs
// exactly what's left to carry/penalize/skip, not completed or already-
// skipped tasks alongside them.
export async function getPendingTasksForDate(dateStr) {
  const { data, error } = await supabase
    .from('task')
    .select('*')
    .eq('scheduled_for', dateStr)
    .eq('status', 'pending')
  if (error) throw error
  return data || []
}

// ── Carry a missed task forward to a new date ──────────────────────────────────
// Used by the EOD cron for project/habit/bonus tasks still incomplete when the
// day closes — the only types that still carry (anchor, routine, and mandatory
// are all terminal: one skip, one possible penalty, no carry — see cronJobs.js
// runEod()). Closes out the old row and inserts a fresh one for newDateStr.
// The old row's status is user-configurable (game.json tasks.carry_visible):
// 'skipped' keeps it visible on its original day (getTasksForDate() only
// excludes 'cancelled') so a carried task's history doesn't just vanish;
// 'cancelled' is the quieter old behaviour — same row hidden, only the fresh
// carried copy shows up, on newDateStr.
//
// If task is templated, newDateStr may already have its own naturally-spawned
// instance — morning spawns 7 days ahead (see runMorning()), so by the time
// EOD carries today's missed copy forward, tomorrow's regular occurrence has
// often already been sitting there since this morning. Carrying forward
// anyway would duplicate it. Same per-template-per-date dedupe check
// spawn_template_instances() itself uses — if one's already there, leave it
// alone instead of inserting a second.
export async function carryTaskForward(task, newDateStr, carryPenalized) {
  const closeOut = getGame().tasks.carry_visible ? skipTask : cancelTask
  await closeOut(task.id)

  if (task.template_id) {
    const { data: existing, error: existingErr } = await supabase
      .from('task')
      .select('*')
      .eq('template_id', task.template_id)
      .eq('scheduled_for', newDateStr)
      .maybeSingle()
    if (existingErr) throw existingErr
    if (existing) return existing
  }

  const { data, error } = await supabase
    .from('task')
    .insert({
      template_id:     task.template_id,
      title:           task.title,
      task_type:       task.task_type,
      priority:        task.priority,
      difficulty:      task.difficulty,
      time_block:      task.time_block,
      scheduled_for:   newDateStr,
      is_recovery:     task.is_recovery,
      carry_penalized: carryPenalized
    })
    .select()
    .single()
  if (error) throw error
  return data
}

// ── Apply a missed-task penalty (calls SQL function atomically) ───────────────
export async function applyTaskPenalty(taskId, xpPenalty, goldPenalty, levelPenalty) {
  const { data, error } = await supabase.rpc('apply_task_penalty', {
    p_task_id:        taskId,
    p_xp_penalty:      xpPenalty,
    p_gold_penalty:    goldPenalty,
    p_new_level:       levelPenalty.newLevel,
    p_new_xp:          levelPenalty.newXp,
    p_new_xp_to_next:  levelPenalty.newXpToNext
  })
  if (error) throw error
  return data
}

// ── Create a one-off task ─────────────────────────────────────────────────────
// If time_block is set, resolves scheduling conflicts against max_tasks_per_block
// before inserting — may displace a weaker existing task to another block, or
// reroute this task to an alternative block if it's the weaker one (or a true
// tie). Covers every caller of createTask() — the agent path and the web/mobile
// "Add Task" UI alike. Recurring template spawns are a separate SQL-only path
// and are not covered by this. Conflict outcome, if any, is attached as
// `_conflict` on the returned row for callers that want to explain what
// happened (e.g. actionExecutor overriding the chat reply).
export async function createTask(fields) {
  const taskType     = fields.task_type
  const priority     = fields.priority      ?? 'P2'
  const scheduledFor = fields.scheduled_for ?? todayEST()
  let   timeBlock    = fields.time_block    ?? null
  let   conflict     = null

  if (timeBlock) {
    const { data: existing, error: existingErr } = await supabase
      .from('task')
      .select('id, title, task_type, priority, time_block, status')
      .eq('scheduled_for', scheduledFor)
      .in('status', ['pending', 'active'])
    if (existingErr) throw existingErr

    const result = detectConflict(taskType, priority, timeBlock, existing || [])

    if (result.hasConflict) {
      const isToday = scheduledFor === todayEST()
      const existingBlocks = {}
      for (const t of existing || []) {
        const b = t.time_block ?? 'unscheduled'
        if (!existingBlocks[b]) existingBlocks[b] = []
        existingBlocks[b].push(t)
      }

      if (result.action === 'displace') {
        const altForDisplaced = findAlternativeBlock(timeBlock, existingBlocks, { isToday, excludeBlock: timeBlock })
        if (altForDisplaced) {
          await moveTask(result.displaced.id, altForDisplaced)
          conflict = { action: 'displaced', displaced: result.displaced, movedTo: altForDisplaced, keptBlock: timeBlock }
        } else {
          // No room to relocate the existing task — fall back to rerouting the new one instead
          const altForNew = findAlternativeBlock(timeBlock, existingBlocks, { isToday })
          if (altForNew) {
            conflict  = { action: 'rerouted', requestedBlock: timeBlock, movedTo: altForNew, blocker: result.displaced }
            timeBlock = altForNew
          } else {
            conflict = { action: 'no_slot', requestedBlock: timeBlock }
          }
        }
      } else {
        // find_alternative — the new task is weaker, or it's a true tie
        const altForNew = findAlternativeBlock(timeBlock, existingBlocks, { isToday })
        if (altForNew) {
          conflict  = { action: 'rerouted', requestedBlock: timeBlock, movedTo: altForNew, blocker: result.blocker }
          timeBlock = altForNew
        } else {
          conflict = { action: 'no_slot', requestedBlock: timeBlock }
        }
      }
    }
  }

  const { data, error } = await supabase
    .from('task')
    .insert({
      title:         fields.title,
      task_type:     taskType,
      priority,
      difficulty:    fields.difficulty    ?? 'medium',
      time_block:    timeBlock,
      scheduled_for: scheduledFor,
      scheduled_at:  fields.scheduled_at ? estNaiveToUTC(fields.scheduled_at) : null,
      is_recovery:   fields.is_recovery   ?? false
    })
    .select()
    .single()

  if (error) throw error
  if (conflict) data._conflict = conflict
  return data
}

// ── Create a recurring template ───────────────────────────────────────────────
// recurrence: 'daily'|'weekdays'|'weekends'|'weekly'|'biweekly'|'monthly'|'yearly'
// weekly/biweekly need recurrence_day_of_week (0=Sun..6=Sat, matches Postgres DOW).
// monthly needs recurrence_day_of_month. yearly needs both recurrence_day_of_month
// and recurrence_month. See supabase/functions.sql spawn_template_instances().
export async function createTemplate(fields) {
  const { data, error } = await supabase
    .from('task_template')
    .insert({
      title:       fields.title,
      task_type:   fields.task_type,
      priority:    fields.priority    ?? 'P2',
      difficulty:  fields.difficulty  ?? 'medium',
      time_block:  fields.time_block  ?? null,
      is_recovery: fields.is_recovery ?? false,
      recurrence:               fields.recurrence               ?? 'daily',
      recurrence_day_of_week:   fields.recurrence_day_of_week   ?? null,
      recurrence_day_of_month:  fields.recurrence_day_of_month  ?? null,
      recurrence_month:         fields.recurrence_month         ?? null
    })
    .select()
    .single()

  if (error) throw error
  return data
}

// ── Spawn today's instance for a just-created template, if today matches its
// cadence ─────────────────────────────────────────────────────────────────────
// Reuses the same cadence-aware RPC the morning cron calls (idempotent — safe to
// call more than once for the same date). Returns the spawned task row, or null
// if today doesn't match the template's cadence (e.g. a "weekly on Monday"
// template created on a Tuesday — nothing to show until next Monday).
export async function spawnTodayInstance(templateId, dateStr) {
  const { error: rpcError } = await supabase.rpc('spawn_template_instances', { p_date: dateStr })
  if (rpcError) throw rpcError

  const { data, error } = await supabase
    .from('task')
    .select('*')
    .eq('template_id', templateId)
    .eq('scheduled_for', dateStr)
    .maybeSingle()
  if (error) throw error
  return data
}

// ── Edit a task ───────────────────────────────────────────────────────────────
export async function editTask(taskId, fields) {
  const ALLOWED = ['title','description','task_type','priority','difficulty','time_block',
                   'scheduled_at','scheduled_for','is_recovery']
  const update = Object.fromEntries(
    Object.entries(fields).filter(([k]) => ALLOWED.includes(k))
  )
  if (update.scheduled_at) update.scheduled_at = estNaiveToUTC(update.scheduled_at)
  if (!Object.keys(update).length) throw new Error('No valid fields to update')

  const { data, error } = await supabase
    .from('task')
    .update(update)
    .eq('id', taskId)
    .select()
    .single()

  if (error) throw error
  return data
}

// ── Move a task to a different time block ─────────────────────────────────────
export async function moveTask(taskId, newTimeBlock) {
  const { data, error } = await supabase
    .from('task')
    .update({ time_block: newTimeBlock })
    .eq('id', taskId)
    .select()
    .single()

  if (error) throw error
  return data
}

// ── Status changes ────────────────────────────────────────────────────────────
export async function skipTask(taskId) {
  const { data, error } = await supabase
    .from('task')
    .update({ status: 'skipped' })
    .eq('id', taskId)
    .select()
    .single()
  if (error) throw error
  return data
}

export async function cancelTask(taskId) {
  const { data, error } = await supabase
    .from('task')
    .update({ status: 'cancelled' })
    .eq('id', taskId)
    .select()
    .single()
  if (error) throw error
  return data
}

// ── Complete a task (calls SQL function atomically) ───────────────────────────
export async function completeTask(taskId, calc) {
  const { data, error } = await supabase.rpc('complete_task', {
    p_task_id:        taskId,
    p_xp_gained:      calc.xp,
    p_gold_gained:    calc.gold,
    p_streak_mult:    1 + calc.streakMult,
    p_new_level:      calc.newLevel,
    p_new_xp:         calc.newXp,
    p_new_xp_to_next: calc.newXpToNext,
    p_leveled_up:     calc.leveledUp,
    p_energy_drain:   calc.energyDrain,
    p_is_recovery:    calc.isRecovery
  })
  if (error) throw error
  if (!data) throw new Error('complete_task returned null')
  return data
}

// ── Retroactive completion for a genuine past day ─────────────────────────────
// Creates the task dated for that day AND marks it completed, atomically, in
// one RPC — see log_past_task() in functions.sql for why this is a separate
// function from complete_task rather than createTask()+completeTask().
export async function logPastTask(fields, calc) {
  const { data, error } = await supabase.rpc('log_past_task', {
    p_title:          fields.title,
    p_task_type:      fields.task_type,
    p_priority:       fields.priority,
    p_difficulty:     fields.difficulty,
    p_time_block:     fields.time_block,
    p_scheduled_for:  fields.scheduled_for,
    p_completed_at:   estNaiveToUTC(fields.completed_at),
    p_is_recovery:    fields.is_recovery,
    p_xp_gained:      calc.xp,
    p_gold_gained:    calc.gold,
    p_new_level:      calc.newLevel,
    p_new_xp:         calc.newXp,
    p_new_xp_to_next: calc.newXpToNext,
    p_leveled_up:     calc.leveledUp
  })
  if (error) throw error
  if (!data) throw new Error('log_past_task returned null')
  return data
}

// ── Templates ─────────────────────────────────────────────────────────────────
export async function getTemplates() {
  const { data, error } = await supabase
    .from('task_template')
    .select('*')
    .eq('active', true)
    .order('created_at', { ascending: true })
  if (error) throw error
  return data || []
}

export async function deactivateTemplate(templateId) {
  const { error } = await supabase
    .from('task_template')
    .update({ active: false })
    .eq('id', templateId)
  if (error) throw error
}

// ── Skills ────────────────────────────────────────────────────────────────────
export async function getSkills() {
  const { data, error } = await supabase
    .from('skill')
    .select('id, name, description, parent_skill_id, is_dynamic, current_level, current_xp, xp_to_next, current_streak')
    .order('current_level', { ascending: false })
  if (error) throw error
  return data || []
}

// ── Stats ─────────────────────────────────────────────────────────────────────
export async function getStats() {
  const { data, error } = await supabase
    .from('stat')
    .select('id, name, description, current_value, current_streak')
    .order('name', { ascending: true })
  if (error) throw error
  return data || []
}

// ── Shop ──────────────────────────────────────────────────────────────────────
export async function createShopItem({ name, description, cost_gold, type }) {
  const { data, error } = await supabase
    .from('shop_item')
    .insert({
      name:        name.trim(),
      description: description?.trim() ?? '',
      cost_gold:   parseInt(cost_gold) || 10,
      type:        ['leisure','day_off','day_off_plus'].includes(type) ? type : 'leisure',
      active:      true
    })
    .select().single()
  if (error) throw error
  return data
}

// ── Active shop items, minimal shape — for the agent's [SHOP] context block ───
// log_leisure and create_shop_item both need real shop_item ids to work with;
// without this the model has no ground truth and has to invent an id from a
// name alone.
export async function getActiveShopItems() {
  const { data, error } = await supabase
    .from('shop_item')
    .select('id, name, type, tracking_unit, cost_gold')
    .eq('active', true)
    .order('name')
  if (error) throw error
  return data || []
}

export async function getShopWithCounts() {
  const today = todayEST()
  const [itemsRes, purchasesRes] = await Promise.all([
    supabase.from('shop_item').select('*').eq('active', true).order('cost_gold'),
    supabase.from('purchase_log').select('shop_item_id').gte('purchased_at', `${today}T00:00:00`)
  ])
  if (itemsRes.error)     throw itemsRes.error
  if (purchasesRes.error) throw purchasesRes.error

  const counts = {}
  for (const p of purchasesRes.data || []) {
    counts[p.shop_item_id] = (counts[p.shop_item_id] || 0) + 1
  }
  return (itemsRes.data || []).map(item => ({
    ...item, purchased_today: counts[item.id] || 0
  }))
}

export async function buyItem(itemId) {
  const { data: item, error: itemErr } = await supabase
    .from('shop_item').select('*').eq('id', itemId).single()
  if (itemErr || !item) throw new Error(`Item not found: ${itemId}`)
  if (!item.active)     throw new Error(`Item not available: ${item.name}`)

  const { data, error } = await supabase.rpc('buy_item', {
    p_item_id:   itemId,
    p_gold_cost: item.cost_gold
  })
  if (error) throw error
  return data
}

// ── History + graphs ──────────────────────────────────────────────────────────
export async function getSnapshots(limit = 30) {
  const { data, error } = await supabase
    .from('daily_snapshot')
    .select('*')
    .order('date', { ascending: true })
    .limit(limit)
  if (error) throw error
  return data || []
}

export async function getCalendar(monthStr) {
  const [year, mon] = monthStr.split('-').map(Number)
  const start = `${monthStr}-01`
  const end   = new Date(Date.UTC(year, mon, 1)).toISOString().split('T')[0]

  const { data, error } = await supabase
    .from('task')
    .select('scheduled_for, completed_at, status, late_multiplier, task_type')
    .neq('task_type', 'routine')
    .gte('scheduled_for', start)
    .lt('scheduled_for', end)

  if (error) throw error

  const days = {}
  for (const task of data || []) {
    const d = task.scheduled_for
    if (!d) continue
    if (!days[d]) days[d] = { total: 0, completed: 0, skipped: 0, pending: 0 }
    days[d].total++
    if (task.status === 'completed') days[d].completed++
    // Written to work regardless of the carry_visible setting (see
    // carryTaskForward()) — a carried task's old row can be either
    // 'skipped' or 'cancelled' depending on it, and either way it's
    // unresolved that day, not a definitive skip. Only anchor is a true
    // terminal skip within this query (routine is already excluded above;
    // mandatory/project/habit/bonus always carry, never terminally skip).
    // 'cancelled' also covers genuine user-initiated cancellations
    // (/tasks/:id/cancel) — bucketing those as 'pending' too matches this
    // function's pre-existing behaviour for that case.
    else if (task.status === 'skipped' && task.task_type === 'anchor') days[d].skipped++
    else days[d].pending++
  }
  return days
}

// ── Push token ────────────────────────────────────────────────────────────────
export async function savePushToken(token, platform) {
  const { error } = await supabase
    .from('push_token')
    .upsert({ id: 1, token, platform, updated_at: new Date().toISOString() })
  if (error) throw error
}

// ── Leisure log ──────────────────────────────────────────────────────────────
export async function logLeisure(shopItemId, quantity = 1, unit = null, notes = null) {
  // Get tracking_unit from item if not provided
  if (!unit) {
    const { data: item } = await supabase
      .from('shop_item').select('tracking_unit').eq('id', shopItemId).single()
    unit = item?.tracking_unit === 'none' ? 'count' : (item?.tracking_unit ?? 'count')
  }
  const { data, error } = await supabase
    .from('leisure_log')
    .insert({ shop_item_id: shopItemId, quantity, unit, notes })
    .select().single()
  if (error) throw error
  return data
}

export async function getTodayLeisure() {
  const today = todayEST()
  const { data, error } = await supabase
    .from('leisure_log')
    .select('*, shop_item(name, tracking_unit)')
    .gte('logged_at', `${today}T00:00:00`)
    .order('logged_at', { ascending: false })
  if (error) throw error
  return data || []
}

export async function getPushToken() {
  const { data, error } = await supabase
    .from('push_token').select('token, platform').eq('id', 1).single()
  if (error || !data?.token) return null
  return data
}

// ── Conversation history (used by session manager) ────────────────────────────
export async function getOrCreateSession(sessionKey) {
  const { data, error } = await supabase
    .from('conversation_session')
    .upsert({ session_key: sessionKey, updated_at: new Date().toISOString() },
             { onConflict: 'session_key' })
    .select('id')
    .single()
  if (error) throw error
  return data.id
}

export async function getSessionMessages(sessionId, limit) {
  const { data, error } = await supabase
    .from('conversation_message')
    .select('role, content, order_index, actions')
    .eq('session_id', sessionId)
    .order('order_index', { ascending: true })
    .limit(limit)
  if (error) throw error
  return data || []
}

export async function appendMessage(sessionId, role, content, orderIndex, actions = null) {
  const { error } = await supabase
    .from('conversation_message')
    .insert({ session_id: sessionId, role, content, order_index: orderIndex, actions })
  if (error) throw error
}

export async function pruneOldMessages(sessionId, keepCount) {
  const { data } = await supabase
    .from('conversation_message')
    .select('id')
    .eq('session_id', sessionId)
    .order('order_index', { ascending: true })

  if (!data || data.length <= keepCount) return
  const toDelete = data.slice(0, data.length - keepCount).map(r => r.id)
  await supabase.from('conversation_message').delete().in('id', toDelete)
}

// ── Async description generation (non-blocking) ───────────────────────────────
// Called after task creation. Generates a short description using Gemini,
// taking into account the task title and any user-provided context.
export async function generateDescription(taskId, title, taskType, userContext = null) {
  try {
    const { GoogleGenerativeAI } = await import('@google/generative-ai')
    const { getServer } = await import('./configLoader.js')
    const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY)
    const model = genAI.getGenerativeModel({
      model: getServer().model.name,
      generationConfig: { temperature: 0.4, maxOutputTokens: 50 }
    })

    const contextLine = userContext
      ? `The user's full message was: "${userContext}" — it may describe several different tasks at once. Pull out only the detail relevant to "${title}"; ignore anything in it about their other, separate tasks.`
      : 'No extra context was given.'
    const prompt = `Task: "${title}" (type: ${taskType}).
${contextLine}
Write ONE sentence (max 20 words) describing what this specific task session involves. Stay grounded in "${title}" — never restate the user's whole message or mention their other tasks. If the message gives little or no detail for this one specifically, use your own reasonable, concrete judgment rather than being vague or generic — a bit of creative specificity beats a flat restatement.`

    const result = await model.generateContent(prompt)
    const description = result.response.text().trim().replace(/^"|"$/g, '')

    await supabase.from('task').update({ description }).eq('id', taskId)
    console.log(`[desc] task ${taskId} described`)
  } catch (err) {
    console.error(`[desc] task ${taskId} failed:`, err.message)
  }
}
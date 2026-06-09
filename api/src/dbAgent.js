// dbAgent.js — all database reads and writes
// No business logic here. Pure data access layer.

import { supabase } from './supabaseClient.js'
import * as rpgEngine from './rpgEngine.js'

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

  return {
    level:          p.current_level,
    current_xp:     p.current_xp,
    xp_to_next:     p.xp_to_next,
    total_gold:     p.total_gold,
    available_gold: p.available_gold,
    energy: {
      current:         e.current,
      max:             e.max,
      threshold_label: e.threshold_label
    },
    streak:          d.day_streak,
    mandatory_met:   d.mandatory_met,
    day_off_granted: d.day_off_granted,
    date:            d.date
  }
}

// ── Tasks ─────────────────────────────────────────────────────────────────────
export async function getTasksForDate(dateStr) {
  const today = new Date().toISOString().split('T')[0]
  const isToday = dateStr === today

  const { data, error } = await supabase
    .from('task')
    .select('*')
    .eq('scheduled_for', dateStr)
    .order('scheduled_at', { ascending: true, nullsFirst: false })

  if (error) throw error

  if (isToday) {
    // Filter passed routine time blocks using EST
    const estHour = parseInt(
      new Date().toLocaleString('en-US', {
        timeZone: 'America/New_York', hour: 'numeric', hour12: false
      }).replace('24', '0'), 10
    )
    const passedBlocks = []
    if (estHour >= 12) passedBlocks.push('morning')
    if (estHour >= 14) passedBlocks.push('noon')
    if (estHour >= 19) passedBlocks.push('evening')
    if (estHour >= 23) passedBlocks.push('night')

    return (data || []).filter(task => {
      if (task.task_type !== 'routine') return true
      if (!task.time_block)            return true
      if (task.status === 'completed') return true
      return !passedBlocks.includes(task.time_block)
    })
  }

  return data || []
}

// ── Create a one-off task ─────────────────────────────────────────────────────
export async function createTask(fields) {
  const { data, error } = await supabase
    .from('task')
    .insert({
      title:         fields.title,
      task_type:     fields.task_type,
      priority:      fields.priority      ?? 'P2',
      difficulty:    fields.difficulty    ?? 'medium',
      time_block:    fields.time_block    ?? null,
      scheduled_for: fields.scheduled_for ?? new Date().toISOString().split('T')[0],
      scheduled_at:  fields.scheduled_at  ?? null,
      is_recovery:   fields.is_recovery   ?? false
    })
    .select()
    .single()

  if (error) throw error
  return data
}

// ── Create a recurring template ───────────────────────────────────────────────
export async function createTemplate(fields) {
  const { data, error } = await supabase
    .from('task_template')
    .insert({
      title:       fields.title,
      task_type:   fields.task_type,
      priority:    fields.priority    ?? 'P2',
      difficulty:  fields.difficulty  ?? 'medium',
      time_block:  fields.time_block  ?? null,
      is_recovery: fields.is_recovery ?? false
    })
    .select()
    .single()

  if (error) throw error
  return data
}

// ── Edit a task ───────────────────────────────────────────────────────────────
export async function editTask(taskId, fields) {
  const ALLOWED = ['title','task_type','priority','difficulty','time_block',
                   'scheduled_at','scheduled_for','is_recovery']
  const update = Object.fromEntries(
    Object.entries(fields).filter(([k]) => ALLOWED.includes(k))
  )
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
export async function getShopWithCounts() {
  const today = new Date().toISOString().split('T')[0]
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
  const end   = new Date(year, mon, 1).toISOString().split('T')[0]

  const { data, error } = await supabase
    .from('task')
    .select('scheduled_for, completed_at, status, late_multiplier, task_type')
    .neq('task_type', 'routine')
    .neq('status', 'cancelled')
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
    else if (task.status === 'skipped') days[d].skipped++
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
    .select('role, content, order_index')
    .eq('session_id', sessionId)
    .order('order_index', { ascending: true })
    .limit(limit)
  if (error) throw error
  return data || []
}

export async function appendMessage(sessionId, role, content, orderIndex) {
  const { error } = await supabase
    .from('conversation_message')
    .insert({ session_id: sessionId, role, content, order_index: orderIndex })
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

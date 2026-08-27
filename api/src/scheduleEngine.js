// scheduleEngine.js — conflict detection and resolution
// Runs BEFORE the agent call to give the agent accurate schedule context.
// Also validates agent actions before execution.

import { supabase } from './supabaseClient.js'
import { getAgent, getGame } from './configLoader.js'

// ── Get today's schedule context (compact, low token cost) ───────────────────
// Returns only what the agent needs to schedule intelligently.
export async function getScheduleContext(dateStr) {
  const { data: tasks, error } = await supabase
    .from('task')
    .select('id, title, task_type, priority, time_block, scheduled_at, status')
    .eq('scheduled_for', dateStr)
    .in('status', ['pending', 'active', 'completed'])
    .order('scheduled_at', { ascending: true, nullsFirst: false })

  if (error) throw error

  // Group by time block
  const blocks = {}
  for (const task of tasks || []) {
    const block = task.time_block ?? 'unscheduled'
    if (!blocks[block]) blocks[block] = []
    blocks[block].push({
      id:       task.id,
      title:    task.title,
      type:     task.task_type,
      priority: task.priority,
      status:   task.status
    })
  }

  return blocks
}

// ── Format schedule context for agent prompt (compact string) ─────────────────
export function formatScheduleContext(blocks, currentTimeEST) {
  const lines = [`Current time: ${currentTimeEST} EST`, 'Schedule:']
  for (const [block, tasks] of Object.entries(blocks)) {
    if (block === 'unscheduled') continue
    const taskStr = tasks.map(t => `${t.title}(${t.type},${t.priority},${t.status})`).join(', ')
    lines.push(`  ${block}: ${taskStr || 'empty'}`)
  }
  if (blocks.unscheduled?.length) {
    const u = blocks.unscheduled.map(t => `${t.title}(${t.type})`).join(', ')
    lines.push(`  unscheduled: ${u}`)
  }
  return lines.join('\n')
}

// ── Priority rank (lower number = higher priority) ────────────────────────────
function priorityRank(taskType) {
  const order = getAgent().scheduling.priority_order
  const idx   = order.indexOf(taskType)
  return idx === -1 ? 999 : idx
}

// P0-P3 field rank — used only as a tiebreaker between two tasks of the SAME
// task_type competing for a slot. task_type is still the primary signal.
const PRIORITY_FIELD_ORDER = ['P0', 'P1', 'P2', 'P3']
function priorityFieldRank(priority) {
  const idx = PRIORITY_FIELD_ORDER.indexOf(priority)
  return idx === -1 ? 999 : idx
}

// Combined [type, field] strength — lower is stronger. Compared lexicographically.
function strength(taskType, priority) {
  return [priorityRank(taskType), priorityFieldRank(priority)]
}
function isStronger(a, b) {
  return a[0] !== b[0] ? a[0] < b[0] : a[1] < b[1]
}
function isEqualStrength(a, b) {
  return a[0] === b[0] && a[1] === b[1]
}

// ── Detect conflict for a proposed new task ───────────────────────────────────
// existingTasks: flat array of tasks for the same scheduled_for date, each with
// { time_block, status, task_type, priority }. Returns:
//   { hasConflict: false }
//   { hasConflict: true, action: 'displace',         displaced: task }
//   { hasConflict: true, action: 'find_alternative' }
// A true tie (same type AND same P0-P3) always resolves as find_alternative for
// the new task — no interactive "ask": the single-pass chat design has nowhere
// to hold a paused, multi-turn confirmation.
export function detectConflict(proposedType, proposedPriority, proposedBlock, existingTasks) {
  const { max_tasks_per_block } = getAgent().scheduling
  const inBlock = existingTasks.filter(t =>
    t.time_block === proposedBlock && ['pending', 'active'].includes(t.status)
  )

  if (inBlock.length < max_tasks_per_block) {
    return { hasConflict: false }
  }

  const proposedStrength = strength(proposedType, proposedPriority)
  let weakest = inBlock[0]
  let weakestStrength = strength(weakest.task_type, weakest.priority)
  for (const t of inBlock.slice(1)) {
    const s = strength(t.task_type, t.priority)
    if (isStronger(weakestStrength, s)) { weakest = t; weakestStrength = s }
  }

  if (isStronger(proposedStrength, weakestStrength)) {
    return { hasConflict: true, action: 'displace', displaced: weakest }
  }
  // Equal strength (true tie) or the new task is weaker — either way it's the
  // new task that gives way. `blocker` names the task that held the slot, for
  // the conflict_auto reply template.
  return { hasConflict: true, action: 'find_alternative', blocker: weakest }
}

// ── Find the next available block ─────────────────────────────────────────────
// existingBlocks: { [block]: task[] } — same shape getScheduleContext() returns.
// dateStr/isToday: when scheduling for today, blocks whose window has already
// passed (EST) are skipped — there's no point routing a task into this
// morning's slot at 8pm tonight. Irrelevant for a future date.
// excludeBlock: never offer this block back (used when relocating a task OUT
// of the block it's being displaced from).
export function findAlternativeBlock(preferredBlock, existingBlocks, { isToday = false, excludeBlock = null } = {}) {
  const { max_tasks_per_block, time_blocks } = getAgent().scheduling
  const blockOrder = Object.keys(time_blocks)

  const startIdx = Math.max(0, blockOrder.indexOf(preferredBlock))
  const ordered  = [...blockOrder.slice(startIdx), ...blockOrder.slice(0, startIdx)]

  const passedBlocks = isToday ? passedBlocksForToday() : []

  for (const block of ordered) {
    if (block === excludeBlock) continue
    if (passedBlocks.includes(block)) continue
    const count = (existingBlocks[block] || []).filter(
      t => ['pending', 'active'].includes(t.status)
    ).length
    if (count < max_tasks_per_block) return block
  }

  return null // all eligible blocks full
}

// Same cutoff hours getTasksForDate() uses for routine tasks, generalized here
// for any block-picking decision that needs to know what's already passed today.
function passedBlocksForToday() {
  const estHour = parseInt(
    new Date().toLocaleString('en-US', { timeZone: 'America/New_York', hour: 'numeric', hour12: false }).replace('24', '0'),
    10
  )
  const passed = []
  if (estHour >= 12) passed.push('morning')
  if (estHour >= 14) passed.push('noon')
  if (estHour >= 19) passed.push('evening')
  if (estHour >= 23) passed.push('night')
  return passed
}

// ── Tiny {placeholder} substitution for agent.json's reply_templates ──────────
export function renderTemplate(str, vars) {
  return str.replace(/\{(\w+)\}/g, (_, k) => (vars[k] ?? ''))
}

// ── Validate agent action list before execution ───────────────────────────────
export function validateActions(actions) {
  const errors = []
  for (const action of actions) {
    if (!action.type) {
      errors.push('Action missing type')
      continue
    }

    if (action.type === 'create_task' || action.type === 'create_template') {
      if (!action.title)     errors.push(`${action.type}: missing title`)
      if (!action.task_type) errors.push(`${action.type}: missing task_type`)
      const validTypes = getGame().tasks.types
      if (action.task_type && !validTypes.includes(action.task_type)) {
        errors.push(`${action.type}: invalid task_type '${action.task_type}'`)
      }
    }

    if (['complete_task','skip_task','cancel_task','move_task','edit_task'].includes(action.type)) {
      if (!action.task_id) errors.push(`${action.type}: missing task_id`)
    }
  }
  return errors
}

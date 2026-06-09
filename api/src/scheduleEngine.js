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

// ── Detect conflict for a proposed new task ───────────────────────────────────
// Returns: { hasConflict, displaced, action }
export function detectConflict(proposedType, proposedBlock, existingTasks) {
  const { max_tasks_per_block, conflict_resolution } = getAgent().scheduling
  const inBlock = existingTasks.filter(t =>
    t.time_block === proposedBlock && ['pending','active'].includes(t.status)
  )

  if (inBlock.length < max_tasks_per_block) {
    return { hasConflict: false }
  }

  // Block is full — find lowest priority existing task
  const lowestExisting = inBlock.sort(
    (a, b) => priorityRank(b.task_type) - priorityRank(a.task_type)
  )[0]

  if (priorityRank(proposedType) < priorityRank(lowestExisting.task_type)) {
    // New task outranks existing — displace existing
    return {
      hasConflict: true,
      action:      'displace',
      displaced:   lowestExisting
    }
  } else if (priorityRank(proposedType) === priorityRank(lowestExisting.task_type)) {
    // Equal priority — ask user
    return {
      hasConflict: true,
      action:      conflict_resolution === 'auto_by_priority' ? 'ask' : 'ask',
      displaced:   lowestExisting
    }
  } else {
    // New task is lower priority — find another block
    return {
      hasConflict: true,
      action:      'find_alternative',
      displaced:   null
    }
  }
}

// ── Find the next available block ─────────────────────────────────────────────
export function findAlternativeBlock(preferredBlock, existingBlocks) {
  const { priority_order, max_tasks_per_block } = getAgent().scheduling
  const blockOrder = ['morning', 'noon', 'evening', 'night', 'midnight']

  // Start from preferred block, look forward
  const startIdx = blockOrder.indexOf(preferredBlock)
  const ordered  = [
    ...blockOrder.slice(startIdx),
    ...blockOrder.slice(0, startIdx)
  ]

  for (const block of ordered) {
    const count = (existingBlocks[block] || []).filter(
      t => ['pending','active'].includes(t.status)
    ).length
    if (count < max_tasks_per_block) return block
  }

  return null // all blocks full
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

// actionExecutor.js — executes validated agent actions against the DB
// Called after every successful agent call. Order matters — moves before creates.

import {
  createTask, createTemplate, spawnTodayInstance, completeTask, skipTask, cancelTask,
  moveTask, editTask, getTasksForDate, generateDescription, createShopItem, logLeisure
} from './dbAgent.js'
import { calculateCompletion } from './rpgEngine.js'
import { projectTask } from './projectionEngine.js'
import { todayEST } from './dateUtils.js'
import { renderTemplate } from './scheduleEngine.js'
import { getAgent } from './configLoader.js'

// The model writes its reply before any action runs, so it can't know a
// scheduling conflict actually happened. If createTask() resolved one, build
// the accurate message from agent.json's own (previously unused) reply
// templates — server.js overrides the chat reply with this when present.
function conflictMessage(result) {
  const c = result?._conflict
  if (!c) return null
  const templates = getAgent().persona.reply_templates

  if (c.action === 'displaced') {
    return renderTemplate(templates.task_added_conflict, {
      title: result.title, type: result.task_type, time_block: c.keptBlock,
      displaced: c.displaced.title, new_block: c.movedTo
    })
  }
  if (c.action === 'rerouted') {
    return renderTemplate(templates.conflict_auto, {
      existing: c.blocker?.title ?? 'an existing task', slot: c.requestedBlock,
      new: result.title, alternative: c.movedTo
    })
  }
  if (c.action === 'no_slot') {
    return renderTemplate(templates.no_slot, { title: result.title, alternatives: 'none free' })
  }
  return null
}

export async function executeActions(actions, playerState, userMessage = null) {
  const today   = todayEST()
  const results = []

  for (const action of actions) {
    try {
      let result
      switch (action.type) {

        case 'create_task': {
          // A real recurrence tag routes to a task_template instead of a one-off
          // task — task_template has no scheduled_at/scheduled_for, only time_block,
          // so those are intentionally dropped on this path.
          const isRecurring = action.recurrence && action.recurrence !== 'none'

          if (isRecurring) {
            const template = await createTemplate({
              title:       action.title,
              task_type:   action.task_type,
              priority:    action.priority      ?? 'P2',
              difficulty:  action.difficulty    ?? 'medium',
              time_block:  action.time_block    ?? null,
              is_recovery: action.is_recovery   ?? false,
              recurrence:               action.recurrence,
              recurrence_day_of_week:   action.recurrence_day_of_week   ?? null,
              recurrence_day_of_month:  action.recurrence_day_of_month  ?? null,
              recurrence_month:         action.recurrence_month         ?? null
            })
            // Spawns today's instance only if today matches the cadence just set
            // (e.g. "every Monday" created on a Tuesday spawns nothing until next
            // Monday) — result may be the template itself if nothing spawned today.
            const spawnedTask = await spawnTodayInstance(template.id, today)
            result = spawnedTask ?? template
            if (spawnedTask?.id) {
              generateDescription(spawnedTask.id, action.title, action.task_type, userMessage)
                .catch(e => console.error('[desc]', e.message))
            }
          } else {
            result = await createTask({
              title:         action.title,
              task_type:     action.task_type,
              priority:      action.priority      ?? 'P2',
              difficulty:    action.difficulty    ?? 'medium',
              time_block:    action.time_block    ?? null,
              scheduled_for: action.scheduled_for ?? today,
              scheduled_at:  action.scheduled_at  ?? null,
              is_recovery:   action.is_recovery   ?? false
            })
            // Generate description async — pass original user message as context
            if (result?.id) {
              generateDescription(result.id, action.title, action.task_type, userMessage)
                .catch(e => console.error('[desc]', e.message))
            }
          }
          break
        }

        case 'create_template':
          result = await createTemplate({
            title:       action.title,
            task_type:   action.task_type,
            priority:    action.priority    ?? 'P2',
            difficulty:  action.difficulty  ?? 'medium',
            time_block:  action.time_block  ?? null,
            is_recovery: action.is_recovery ?? false
          })
          break

        case 'complete_task': {
          // Fetch the task first to compute rewards
          const tasks = await getTasksForDate(today)
          const task  = tasks.find(t => t.id === action.task_id)
          if (!task) throw new Error(`Task ${action.task_id} not found`)
          // Normalise playerState shape — calculateCompletion expects streak.day_streak
          const playerForCalc = {
            level:      playerState.level      ?? 1,
            current_xp: playerState.current_xp ?? 0,
            xp_to_next: playerState.xp_to_next ?? 100,
            streak:     { day_streak: playerState.streak ?? 0 }
          }
          const calc  = calculateCompletion(task, playerForCalc)
          result      = await completeTask(action.task_id, calc)
          // Queue projection async — don't block the response
          projectTask(action.task_id).catch(e =>
            console.error(`[projection] task ${action.task_id} failed:`, e)
          )
          break
        }

        case 'skip_task':
          result = await skipTask(action.task_id)
          break

        case 'cancel_task':
          result = await cancelTask(action.task_id)
          break

        case 'move_task':
          result = await moveTask(action.task_id, action.new_time_block)
          break

        case 'edit_task':
          result = await editTask(action.task_id, action.fields ?? {})
          break

        case 'log_leisure':
          result = await logLeisure(
            action.shop_item_id,
            action.quantity ?? 1,
            action.unit     ?? null,
            action.notes    ?? null
          )
          break

        case 'create_shop_item':
          result = await createShopItem({
            name:        action.name,
            description: action.description ?? '',
            cost_gold:   action.cost_gold   ?? 10,
            type:        action.item_type   ?? 'leisure'
          })
          break

        default:
          console.warn(`Unknown action type: ${action.type}`)
      }

      results.push({ action: action.type, success: true, result, conflictMessage: conflictMessage(result) })

    } catch (err) {
      console.error(`Action ${action.type} failed:`, err.message)
      results.push({ action: action.type, success: false, error: err.message })
    }
  }

  return results
}
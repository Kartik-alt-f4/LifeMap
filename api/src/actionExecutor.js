// actionExecutor.js — executes validated agent actions against the DB
// Called after every successful agent call. Order matters — moves before creates.

import {
  createTask, createTemplate, completeTask, skipTask, cancelTask,
  moveTask, editTask, getTasksForDate, generateDescription, createShopItem
} from './dbAgent.js'
import { calculateCompletion } from './rpgEngine.js'
import { projectTask } from './projectionEngine.js'

export async function executeActions(actions, playerState, userMessage = null) {
  const today   = new Date().toISOString().split('T')[0]
  const results = []

  for (const action of actions) {
    try {
      let result
      switch (action.type) {

        case 'create_task':
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
          break

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

      results.push({ action: action.type, success: true, result })

    } catch (err) {
      console.error(`Action ${action.type} failed:`, err.message)
      results.push({ action: action.type, success: false, error: err.message })
    }
  }

  return results
}
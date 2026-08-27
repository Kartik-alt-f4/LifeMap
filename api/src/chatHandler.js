// chatHandler.js — the actual chat pipeline, shared by every client that talks
// to the agent: the HTTP /chat route (web/mobile) and the Discord message
// listener. One implementation, so a fix here fixes both surfaces at once.

import { getPlayerState, getTasksForDate, getActiveShopItems } from './dbAgent.js'
import { getHistory, saveExchange, formatForGemini } from './sessionManager.js'
import { runAgent } from './agentPipeline.js'
import { executeActions } from './actionExecutor.js'
import { todayEST } from './dateUtils.js'

// The model writes its reply in the same JSON blob as the actions, before any
// of them actually run — it cannot know whether they succeeded. This builds
// the reply the user actually sees from what really happened:
//   - a resolved scheduling conflict overrides the reply with the accurate
//     outcome (see actionExecutor.js's conflictMessage)
//   - any failed action gets an explicit warning appended, regardless of what
//     the model said — previously a failure was invisible; the model's
//     optimistic "Added X" stood even when the write actually threw
//   - an empty model reply falls back to a plain summary of what succeeded
export function buildFinalReply(modelReply, actionResults) {
  if (actionResults.length === 0) return modelReply

  let reply = modelReply
  const conflictResult = actionResults.find(r => r.success && r.conflictMessage)
  if (conflictResult) {
    reply = conflictResult.conflictMessage
  } else if (!reply) {
    const successActions = actionResults.filter(r => r.success)
    if (successActions.length > 0) {
      reply = successActions.map(r => r.message).join('\n')
    }
  }

  const failed = actionResults.filter(r => !r.success)
  if (failed.length > 0) {
    const warning = failed.map(r => `⚠ ${r.action} failed: ${r.error}`).join('\n')
    reply = reply ? `${reply}\n${warning}` : warning
  }

  return reply
}

export async function handleChatMessage(message, sessionKey = 'web') {
  const today = todayEST()
  const [playerState, todayTasks, shopItems] = await Promise.all([
    getPlayerState(),
    getTasksForDate(today),
    getActiveShopItems()
  ])
  const { sessionId, messages } = await getHistory(sessionKey)
  const history = formatForGemini(messages)

  const agentResult = await runAgent(message, history, playerState, today, todayTasks, shopItems)

  let actionResults = []
  if (agentResult.actions?.length) {
    actionResults = await executeActions(agentResult.actions, playerState, message)
  }

  const finalReply = buildFinalReply(agentResult.reply, actionResults)

  await saveExchange(sessionId, message, finalReply ?? '', actionResults)

  return { reply: finalReply, actions: actionResults }
}

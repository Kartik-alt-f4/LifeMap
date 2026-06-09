// sessionManager.js — conversation history management
// Backed by conversation_session + conversation_message tables.

import { getOrCreateSession, getSessionMessages, appendMessage, pruneOldMessages } from './dbAgent.js'
import { getServer } from './configLoader.js'

export async function getHistory(sessionKey) {
  const { max_messages } = getServer().session
  const sessionId = await getOrCreateSession(sessionKey)
  const messages  = await getSessionMessages(sessionId, max_messages)
  return { sessionId, messages }
}

export async function saveExchange(sessionId, userMessage, modelReply) {
  const { max_messages, truncation_limit } = getServer().session

  // Get current max order_index
  const messages = await getSessionMessages(sessionId, max_messages)
  const maxIdx   = messages.length ? messages[messages.length - 1].order_index : 0

  const truncate = (s) => s.length > truncation_limit ? s.slice(0, truncation_limit) + '…' : s

  await appendMessage(sessionId, 'user',  truncate(userMessage), maxIdx + 1)
  await appendMessage(sessionId, 'model', truncate(modelReply),  maxIdx + 2)

  // Prune if over limit
  await pruneOldMessages(sessionId, max_messages)
}

// Format for Gemini history (parts array format)
export function formatForGemini(messages) {
  return messages.map(m => ({
    role:  m.role,
    parts: [{ text: m.content }]
  }))
}

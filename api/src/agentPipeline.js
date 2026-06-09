// agentPipeline.js — single Gemini call, structured JSON output, server executes
// No tool loop. No narration pass. One call, one response, deterministic execution.

import { GoogleGenerativeAI } from '@google/generative-ai'
import { buildSystemPrompt, getServer } from './configLoader.js'
import { getScheduleContext, formatScheduleContext, validateActions } from './scheduleEngine.js'

let _genAI = null

export function initGemini() {
  _genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY)
}

// ── Main entry point ──────────────────────────────────────────────────────────
// Returns: { reply, actions, needsClarification, clarificationQuestion }
export async function runAgent(userMessage, sessionHistory, playerState, dateStr) {
  const model = _genAI.getGenerativeModel({
    model: getServer().model.name,
    generationConfig: {
      temperature:     getServer().model.temperature,
      maxOutputTokens: getServer().model.max_output_tokens,
      responseMimeType: 'application/json'
    }
  })

  // Build schedule context — only fetch when message likely involves scheduling
  const needsSchedule = isSchedulingIntent(userMessage)
  let scheduleCtx = ''
  if (needsSchedule) {
    const blocks = await getScheduleContext(dateStr)
    const estTime = new Date().toLocaleString('en-US', {
      timeZone: 'America/New_York',
      hour: 'numeric', minute: '2-digit', hour12: true
    })
    scheduleCtx = '\n\n[SCHEDULE]\n' + formatScheduleContext(blocks, estTime) + '\n[/SCHEDULE]'
  }

  // Player state context — compact, only essentials
  const stateCtx = `\n\n[STATE]\nLv${playerState.level} | ⚡${playerState.energy.current}/${playerState.energy.max} | 🔥${playerState.streak} | ◆${playerState.available_gold}g\n[/STATE]`

  const fullMessage = userMessage + stateCtx + scheduleCtx

  // Trim history to config limit
  const { max_messages, truncation_limit } = getServer().session
  const safeHistory = trimHistory(sessionHistory, max_messages, truncation_limit)

  // Ensure history starts with user role (Gemini requirement)
  const geminiHistory = safeHistory[0]?.role === 'model'
    ? safeHistory.slice(1)
    : safeHistory

  const chat   = model.startChat({ systemInstruction: buildSystemPrompt(), history: geminiHistory })
  const result = await sendWithRetry(chat, fullMessage)
  const text   = result.response.text().trim()

  // Parse JSON response
  let parsed
  try {
    parsed = JSON.parse(text)
  } catch (err) {
    console.error('Agent returned invalid JSON:', text)
    return {
      reply:                "System error. Try again.",
      actions:              [],
      needsClarification:   false,
      clarificationQuestion: null
    }
  }

  // Validate actions before returning
  const validationErrors = validateActions(parsed.actions || [])
  if (validationErrors.length) {
    console.error('Agent action validation errors:', validationErrors, parsed)
    return {
      reply:                "Could not process request. Try rephrasing.",
      actions:              [],
      needsClarification:   false,
      clarificationQuestion: null
    }
  }

  return {
    reply:                 parsed.reply                  ?? '',
    actions:               parsed.actions                ?? [],
    needsClarification:    parsed.needs_clarification    ?? false,
    clarificationQuestion: parsed.clarification_question ?? null
  }
}

// ── Intent detection — skip schedule fetch for pure queries/chat ──────────────
function isSchedulingIntent(message) {
  const lower = message.toLowerCase()
  const schedulingWords = [
    'add', 'create', 'schedule', 'book', 'plan', 'tomorrow', 'today',
    'morning', 'noon', 'evening', 'night', 'move', 'reschedule', 'cancel',
    'skip', 'gym', 'meeting', 'call', 'done', 'finish', 'complete'
  ]
  return schedulingWords.some(w => lower.includes(w))
}

// ── History trimming ──────────────────────────────────────────────────────────
function trimHistory(history, maxMessages, truncationLimit) {
  const recent = history.slice(-maxMessages)
  return recent.map(msg => ({
    role:  msg.role,
    parts: [{ text: msg.content.slice(0, truncationLimit) }]
  }))
}

// ── Retry wrapper ─────────────────────────────────────────────────────────────
async function sendWithRetry(chat, message, maxRetries = 3) {
  let lastErr
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await chat.sendMessage(message)
    } catch (err) {
      lastErr = err
      console.error(`Gemini attempt ${attempt}/${maxRetries} failed:`, err.message)
      if (attempt < maxRetries) await sleep(attempt * 1000)
    }
  }
  throw lastErr
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)) }

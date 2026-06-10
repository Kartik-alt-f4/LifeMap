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
export async function runAgent(userMessage, sessionHistory, playerState, dateStr, todayTasks = []) {
  const systemPrompt = buildSystemPrompt()
  const model = _genAI.getGenerativeModel({
    model: getServer().model.name,
    systemInstruction: systemPrompt,
    generationConfig: {
      temperature:     getServer().model.temperature,
      maxOutputTokens: getServer().model.max_output_tokens,
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

  // Inject today's tasks so agent can find task IDs for edit/complete/skip/cancel
  let tasksCtx = ''
  if (todayTasks && todayTasks.length > 0) {
    const taskLines = todayTasks
      .map(t => `  id:${t.id} "${t.title}" ${t.task_type} ${t.priority} ${t.status}${t.time_block ? ' '+t.time_block : ''}`)
      .join('\n')
    tasksCtx = `\n\n[TODAY_TASKS]\n${taskLines}\n[/TODAY_TASKS]`
  }

  const fullMessage = userMessage + stateCtx + scheduleCtx + tasksCtx

  // Trim history to config limit
  const { max_messages, truncation_limit } = getServer().session
  const safeHistory = trimHistory(sessionHistory, max_messages, truncation_limit)

  // Ensure history starts with user role (Gemini requirement)
  const geminiHistory = safeHistory[0]?.role === 'model'
    ? safeHistory.slice(1)
    : safeHistory

  const chat   = model.startChat({ history: geminiHistory })
  const result = await sendWithRetry(chat, fullMessage)
  const text   = result.response.text().trim()

  // Parse JSON response — strip markdown fences if model wraps response
  let parsed
  try {
    const clean = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/,'').trim()
    parsed = JSON.parse(clean)
  } catch (err) {
    console.error('Agent returned invalid JSON:', text)
    return {
      reply:                 "System error. Try again.",
      actions:               [],
      needsClarification:    false,
      clarificationQuestion: null
    }
  }

  // Log what model returned in dev
  if (process.env.NODE_ENV !== 'production') {
    console.log('[agent] intent:', parsed.intent, '| actions:', JSON.stringify(parsed.actions))
  }

  // Soft validate — log errors but don't reject, execution will handle bad actions
  const validationErrors = validateActions(parsed.actions || [])
  if (validationErrors.length) {
    console.warn('[agent] action validation warnings:', validationErrors)
    // Attempt to auto-correct common issues rather than rejecting
    const corrected = (parsed.actions || []).map(action => {
      if ((action.type === 'create_task' || action.type === 'create_template') && action.task_type) {
        // Normalise task_type casing
        const lower = action.task_type.toLowerCase()
        const valid = ['anchor','mandatory','project','bonus','habit','routine']
        if (!valid.includes(lower)) action.task_type = 'habit' // safe default
        else action.task_type = lower
      }
      return action
    })
    parsed.actions = corrected
  }

  // If intent says edit but model returned create_task, flag it
  // Server will handle the conversion with task_id lookup
  if (parsed.intent === 'edit_task') {
    parsed.actions = (parsed.actions || []).map(action => {
      if (action.type === 'create_task') {
        // Convert to edit_task — server will find task_id by title match
        const { title, ...fields } = action
        return { type: 'edit_task', task_id: null, _title_hint: title, fields: Object.fromEntries(
          Object.entries(fields).filter(([k]) => !['type','is_recurring','scheduled_at','scheduled_for'].includes(k))
        )}
      }
      return action
    })
  }

  return {
    intent:                parsed.intent                 ?? 'chat',
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
// Handles both raw DB format {role, content} and pre-formatted {role, parts}
function trimHistory(history, maxMessages, truncationLimit) {
  if (!history || !Array.isArray(history)) return []
  const recent = history.slice(-maxMessages)
  return recent.map(msg => {
    // Get text from either format
    const text = msg.content
      ?? msg.parts?.[0]?.text
      ?? ''
    return {
      role:  msg.role,
      parts: [{ text: text.slice(0, truncationLimit) }]
    }
  })
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
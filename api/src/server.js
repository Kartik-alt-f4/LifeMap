import 'dotenv/config'
import express       from 'express'
import path          from 'path'
import { fileURLToPath } from 'url'

import { registerUser } from '../../scripts/register-user.js'

import { loadConfig, getConfig, getServer, writeConfigSection } from './configLoader.js'
import { initGemini, runAgent } from './agentPipeline.js'
import { initProjection, projectTask } from './projectionEngine.js'
import { initDiscordBot } from './discordBot.js'
import { executeActions } from './actionExecutor.js'
import { getHistory, saveExchange, formatForGemini } from './sessionManager.js'
import { runMorning, runEod, runRemind, runCleanup, checkStreakWarning } from './cronJobs.js'
import {
  getPlayerState, getTasksForDate, createTask, createTemplate, editTask,
  skipTask, cancelTask, completeTask, getTemplates, deactivateTemplate,
  getSkills, getStats, getShopWithCounts, buyItem,
  getSnapshots, getCalendar, savePushToken,
  generateDescription, logLeisure, getTodayLeisure, createShopItem
} from './dbAgent.js'
import { calculateCompletion } from './rpgEngine.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// ── Boot ──────────────────────────────────────────────────────────────────────
loadConfig()
initGemini()
initProjection()
initDiscordBot()

const app  = express()
const PORT = getServer().server.port

app.use(express.json())
app.use(express.static(path.join(__dirname, '../../web/dist')))

// ── Auth middleware for cron routes ───────────────────────────────────────────
function cronAuth(req, res, next) {
  if (req.headers['x-cron-secret'] !== process.env.CRON_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' })
  }
  next()
}

// ─────────────────────────────────────────────────────────────────────────────
// HEALTH
// ─────────────────────────────────────────────────────────────────────────────
app.get('/health', (_, res) => res.json({ status: 'ok' }))

// ─────────────────────────────────────────────────────────────────────────────
// CONFIG
// ─────────────────────────────────────────────────────────────────────────────
app.get('/config', (_, res) => {
  try {
    const { game, agent } = getConfig()
    res.json({ game, agent: { scheduling: agent.scheduling, persona: { reply_templates: agent.persona.reply_templates } } })
  } catch (e) { res.status(500).json({ error: e.message }) }
})

app.post('/config/:file/:section?', (req, res) => {
  try {
    writeConfigSection(req.params.file, req.params.section ?? null, req.body)
    res.json({ ok: true })
  } catch (e) { res.status(400).json({ error: e.message }) }
})

// ─────────────────────────────────────────────────────────────────────────────
// STATE
// ─────────────────────────────────────────────────────────────────────────────
app.get('/state', async (_, res) => {
  try { res.json(await getPlayerState()) }
  catch (e) { res.status(500).json({ error: e.message }) }
})

// ─────────────────────────────────────────────────────────────────────────────
// TASKS
// ─────────────────────────────────────────────────────────────────────────────
app.get('/tasks', async (req, res) => {
  try {
    const date = req.query.date ?? new Date().toISOString().split('T')[0]
    res.json(await getTasksForDate(date))
  } catch (e) { res.status(500).json({ error: e.message }) }
})

app.post('/tasks', async (req, res) => {
  try {
    const task = await createTask(req.body)
    // Generate description async — non-blocking
    if (!task.description) {
      generateDescription(task.id, task.title, task.task_type, req.body.description_context ?? null)
        .catch(e => console.error('[desc]', e.message))
    }
    res.json(task)
  }
  catch (e) { res.status(400).json({ error: e.message }) }
})

app.patch('/tasks/:id', async (req, res) => {
  try { res.json(await editTask(parseInt(req.params.id), req.body)) }
  catch (e) { res.status(400).json({ error: e.message }) }
})

app.post('/tasks/:id/complete', async (req, res) => {
  try {
    const taskId = parseInt(req.params.id)
    if (isNaN(taskId)) return res.status(400).json({ error: 'Invalid task ID' })

    const today  = new Date().toISOString().split('T')[0]
    const tasks  = await getTasksForDate(today)
    const task   = tasks.find(t => t.id === taskId)

    // Also check historical dates — task might not be "today" if scheduled differently
    const resolvedTask = task ?? (await (async () => {
      const { supabase } = await import('./supabaseClient.js')
      const { data } = await supabase.from('task').select('*').eq('id', taskId).single()
      return data
    })())

    if (!resolvedTask) return res.status(404).json({ error: 'Task not found' })
    if (resolvedTask.status === 'completed') return res.status(400).json({ error: 'Task already completed' })

    const ps   = await getPlayerState()
    // Normalise playerState shape for calculateCompletion
    const playerForCalc = {
      level:      ps.level      ?? 1,
      current_xp: ps.current_xp ?? 0,
      xp_to_next: ps.xp_to_next ?? 100,
      streak:     { day_streak: ps.streak ?? 0 }
    }
    const calc   = calculateCompletion(resolvedTask, playerForCalc)
    console.log('[complete] task:', resolvedTask.task_type, resolvedTask.difficulty)
    console.log('[complete] calc:', JSON.stringify(calc))
    if (calc.xp == null || calc.gold == null) {
      return res.status(500).json({ error: `calculateCompletion returned null: xp=${calc.xp} gold=${calc.gold}` })
    }
    const result = await completeTask(taskId, calc)
    projectTask(taskId).catch(e => console.error('[projection]', e))
    res.json(result)
  } catch (e) {
    console.error('Complete task error:', e.message)
    res.status(400).json({ error: e.message })
  }
})

app.post('/tasks/:id/skip', async (req, res) => {
  try { res.json(await skipTask(parseInt(req.params.id))) }
  catch (e) { res.status(400).json({ error: e.message }) }
})

app.post('/tasks/:id/cancel', async (req, res) => {
  try { res.json(await cancelTask(parseInt(req.params.id))) }
  catch (e) { res.status(400).json({ error: e.message }) }
})

// ─────────────────────────────────────────────────────────────────────────────
// TEMPLATES
// ─────────────────────────────────────────────────────────────────────────────
app.get('/templates', async (_, res) => {
  try { res.json(await getTemplates()) }
  catch (e) { res.status(500).json({ error: e.message }) }
})

app.post('/templates', async (req, res) => {
  try { res.json(await createTemplate(req.body)) }
  catch (e) { res.status(400).json({ error: e.message }) }
})

app.delete('/templates/:id', async (req, res) => {
  try { await deactivateTemplate(parseInt(req.params.id)); res.json({ ok: true }) }
  catch (e) { res.status(400).json({ error: e.message }) }
})

// ─────────────────────────────────────────────────────────────────────────────
// AGENT CHAT
// ─────────────────────────────────────────────────────────────────────────────
app.post('/chat', async (req, res) => {
  try {
    const { message, session_id = 'web' } = req.body
    if (!message) return res.status(400).json({ error: 'message required' })

    const today       = new Date().toISOString().split('T')[0]
    const [playerState, todayTasks] = await Promise.all([
      getPlayerState(),
      getTasksForDate(today)
    ])
    const { sessionId, messages } = await getHistory(session_id)
    const history     = formatForGemini(messages)

    const agentResult = await runAgent(message, history, playerState, today, todayTasks)
    const { actions, needsClarification, clarificationQuestion } = agentResult
    let { reply, intent } = agentResult

    // Server-side duplicate guard — filter out create_task where title already exists today
    const dedupedActions = actions.filter(action => {
      if (action.type !== 'create_task') return true
      const titleLower = (action.title ?? '').toLowerCase()
      const exists = todayTasks.some(t =>
        t.title.toLowerCase() === titleLower ||
        t.title.toLowerCase().includes(titleLower) ||
        titleLower.includes(t.title.toLowerCase())
      )
      if (exists) {
        console.log(`[dedup] blocked duplicate: "${action.title}"`)
        return false
      }
      return true
    })

    // Resolve edit_task with _title_hint — find task_id by title match
    const resolvedActions = dedupedActions.map(action => {
      if (action.type === 'edit_task' && !action.task_id && action._title_hint) {
        const hint = action._title_hint.toLowerCase()
        const match = todayTasks.find(t =>
          t.title.toLowerCase().includes(hint) || hint.includes(t.title.toLowerCase())
        )
        if (match) return { ...action, task_id: match.id }
      }
      return action
    })

    let actionResults = []
    let actionErrors  = []
    if (resolvedActions.length && !needsClarification) {
      actionResults = await executeActions(resolvedActions, playerState, message)
      actionErrors  = actionResults.filter(r => r.error)
    }

    // Refresh task list after any mutating action
    const mutating = ['add_task','edit_task','complete_task','skip_task','cancel_task']
    const freshTasks = mutating.includes(intent) && resolvedActions.length
      ? await getTasksForDate(today)
      : todayTasks

    // If actions failed, override reply to explain
    if (actionErrors.length) {
      const reasons = actionErrors.map(r => r.error).join(', ')
      reply = `Action failed: ${reasons}`
    }

    // Build task list reply server-side for any query
    const isQuery = intent === 'query' || /^(list|show|what).*(task|pending|today)|pending tasks/i.test(message)
    if (isQuery) {
      const TYPE_ICON = { anchor:'⚓', mandatory:'⚔', project:'📋', bonus:'⭐', habit:'🔄', routine:'🌿' }
      const fmt = tasks => tasks.map(t =>
        `  ${TYPE_ICON[t.task_type] ?? '◈'} ${t.title} (${t.priority}${t.time_block ? ', '+t.time_block : ''})`
      ).join('\n')

      const pending = freshTasks.filter(t => t.status === 'pending')
      const done    = freshTasks.filter(t => t.status === 'completed')
      const skipped = freshTasks.filter(t => t.status === 'skipped')

      const parts = []
      if (pending.length) parts.push(`Pending (${pending.length}):\n${fmt(pending)}`)
      if (done.length)    parts.push(`Done (${done.length}):\n${fmt(done)}`)
      if (skipped.length) parts.push(`Skipped (${skipped.length}):\n${fmt(skipped)}`)
      reply = parts.length ? parts.join('\n\n') : 'No tasks today.'
    }

    const finalReply = needsClarification ? clarificationQuestion : reply
    await saveExchange(sessionId, message, finalReply)

    res.json({ reply: finalReply, actions: actionResults })
  } catch (e) {
    console.error('Chat error:', e.message)
    res.status(500).json({ error: e.message })
  }
})

// ─────────────────────────────────────────────────────────────────────────────
// SKILLS / STATS / SHOP / GRAPHS
// ─────────────────────────────────────────────────────────────────────────────
app.get('/skills',    async (_, res) => { try { res.json(await getSkills()) }           catch (e) { res.status(500).json({ error: e.message }) } })

app.patch('/skills/:id', async (req, res) => {
  try {
    const { name, description } = req.body
    if (!name?.trim() && !description?.trim()) return res.status(400).json({ error: 'name or description required' })
    const { supabase } = await import('./supabaseClient.js')
    const update = {}
    if (name?.trim())        update.name        = name.trim()
    if (description?.trim()) update.description = description.trim()
    const { data, error } = await supabase
      .from('skill').update(update).eq('id', parseInt(req.params.id)).select().single()
    if (error) throw error
    res.json(data)
  } catch (e) { res.status(400).json({ error: e.message }) }
})
app.get('/stats',     async (_, res) => { try { res.json(await getStats()) }            catch (e) { res.status(500).json({ error: e.message }) } })

app.patch('/stats/:id', async (req, res) => {
  try {
    const { description } = req.body
    if (!description?.trim()) return res.status(400).json({ error: 'description required' })
    const { supabase } = await import('./supabaseClient.js')
    const { data, error } = await supabase
      .from('stat').update({ description: description.trim() })
      .eq('id', parseInt(req.params.id)).select().single()
    if (error) throw error
    res.json(data)
  } catch (e) { res.status(400).json({ error: e.message }) }
})
app.get('/shop',      async (_, res) => { try { res.json(await getShopWithCounts()) }   catch (e) { res.status(500).json({ error: e.message }) } })
app.get('/snapshots', async (_, res) => { try { res.json(await getSnapshots()) }        catch (e) { res.status(500).json({ error: e.message }) } })
app.get('/calendar',  async (req, res) => {
  try {
    const month = req.query.month ?? new Date().toISOString().slice(0, 7)
    res.json(await getCalendar(month))
  } catch (e) { res.status(500).json({ error: e.message }) }
})

app.post('/shop', async (req, res) => {
  try {
    const { name, description, cost_gold, type } = req.body
    if (!name?.trim()) return res.status(400).json({ error: 'name required' })
    const { supabase } = await import('./supabaseClient.js')
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
    res.json(data)
  } catch (e) { res.status(400).json({ error: e.message }) }
})

app.get('/leisure/today', async (_, res) => {
  try { res.json(await getTodayLeisure()) }
  catch (e) { res.status(500).json({ error: e.message }) }
})

app.post('/leisure/log', async (req, res) => {
  try {
    const { shop_item_id, quantity, unit, notes } = req.body
    if (!shop_item_id) return res.status(400).json({ error: 'shop_item_id required' })
    res.json(await logLeisure(shop_item_id, quantity ?? 1, unit ?? null, notes ?? null))
  } catch (e) { res.status(400).json({ error: e.message }) }
})

app.patch('/stats/re-embed', async (req, res) => res.status(405).json({ error: 'use POST' }))

app.post('/shop/:id/buy', async (req, res) => {
  try { res.json(await buyItem(parseInt(req.params.id))) }
  catch (e) { res.status(400).json({ error: e.message }) }
})

// ─────────────────────────────────────────────────────────────────────────────
// PUSH NOTIFICATIONS
// ─────────────────────────────────────────────────────────────────────────────
app.post('/notifications/register', async (req, res) => {
  try {
    const { token, platform } = req.body
    if (!token) return res.status(400).json({ error: 'token required' })
    await savePushToken(token, platform)
    res.json({ ok: true })
  } catch (e) { res.status(400).json({ error: e.message }) }
})

// ─────────────────────────────────────────────────────────────────────────────
// USER REGISTRATION — called by setup wizard when a friend finishes onboarding
// ─────────────────────────────────────────────────────────────────────────────
app.post('/register', async (req, res) => {
  try {
    const { renderUrl, name, googleUid } = req.body
    if (!renderUrl) return res.status(400).json({ error: 'renderUrl required' })
 
    const result = await registerUser(renderUrl, name ?? 'friend')
    res.json(result)
  } catch (e) {
    console.error('Register error:', e.message)
    res.status(500).json({ error: e.message })
  }
})

// ─────────────────────────────────────────────────────────────────────────────
// GEMINI KEY VALIDATION — called by setup wizard (avoids CORS on client side)
// ─────────────────────────────────────────────────────────────────────────────
app.post('/validate-gemini', async (req, res) => {
  try {
    const { key } = req.body
    if (!key) return res.status(400).json({ error: 'key required' })
 
    const r = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-lite:generateContent?key=${key}`,
      {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ contents: [{ parts: [{ text: 'ping' }] }] }),
      }
    )
    const data = await r.json().catch(() => ({}))
    if (r.status === 400 && data?.error?.status === 'API_KEY_INVALID') {
      return res.status(400).json({ error: 'Invalid Gemini key' })
    }
    res.json({ ok: true })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// ─────────────────────────────────────────────────────────────────────────────
// CRON ENDPOINTS (GitHub Actions only)
// ─────────────────────────────────────────────────────────────────────────────
app.post('/cron/morning', cronAuth, async (_, res) => {
  try { res.json(await runMorning()) }
  catch (e) { console.error('Morning cron error:', e); res.status(500).json({ error: e.message }) }
})

app.post('/cron/eod', cronAuth, async (_, res) => {
  try { res.json(await runEod()) }
  catch (e) { console.error('EOD cron error:', e); res.status(500).json({ error: e.message }) }
})

app.post('/cron/remind', cronAuth, async (_, res) => {
  try { await checkStreakWarning(); res.json(await runRemind()) }
  catch (e) { res.status(500).json({ error: e.message }) }
})

app.post('/cron/cleanup', cronAuth, async (_, res) => {
  try { res.json(await runCleanup()) }
  catch (e) { res.status(500).json({ error: e.message }) }
})

// ── Catch-all → React app ─────────────────────────────────────────────────────
app.get('*', (_, res) => {
  res.sendFile(path.join(__dirname, '../../web/dist/index.html'))
})

app.listen(PORT, () => console.log(`Life Map v2 running on :${PORT}`))
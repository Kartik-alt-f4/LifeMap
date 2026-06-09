import 'dotenv/config'
import express       from 'express'
import path          from 'path'
import { fileURLToPath } from 'url'

import { loadConfig, getServer, writeConfigSection, reloadConfig } from './configLoader.js'
import { initGemini }    from './agentPipeline.js'
import { initProjection } from './projectionEngine.js'
import { initDiscordBot, postToDiscord } from './discordBot.js'
import { runAgent }      from './agentPipeline.js'
import { executeActions } from './actionExecutor.js'
import { getHistory, saveExchange, formatForGemini } from './sessionManager.js'
import { runMorning, runEod, runRemind, runCleanup, checkStreakWarning } from './cronJobs.js'
import {
  getPlayerState, getTasksForDate, createTask, createTemplate, editTask,
  skipTask, cancelTask, completeTask, getTemplates, deactivateTemplate,
  getSkills, getStats, getShopWithCounts, buyItem,
  getSnapshots, getCalendar, savePushToken
} from './dbAgent.js'
import { calculateCompletion } from './rpgEngine.js'
import { projectTask }   from './projectionEngine.js'

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
    const { getConfig } = await import('./configLoader.js')
    const { game, agent } = getConfig()
    // Return only what the frontend needs
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
  try { res.json(await createTask(req.body)) }
  catch (e) { res.status(400).json({ error: e.message }) }
})

app.patch('/tasks/:id', async (req, res) => {
  try { res.json(await editTask(parseInt(req.params.id), req.body)) }
  catch (e) { res.status(400).json({ error: e.message }) }
})

app.post('/tasks/:id/complete', async (req, res) => {
  try {
    const taskId      = parseInt(req.params.id)
    const today       = new Date().toISOString().split('T')[0]
    const tasks       = await getTasksForDate(today)
    const task        = tasks.find(t => t.id === taskId)
    if (!task) return res.status(404).json({ error: 'Task not found' })
    const playerState = await getPlayerState()
    const calc        = calculateCompletion(task, playerState)
    const result      = await completeTask(taskId, calc)
    // Async projection — non-blocking
    projectTask(taskId).catch(e => console.error('[projection]', e))
    res.json(result)
  } catch (e) { res.status(400).json({ error: e.message }) }
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
    const playerState = await getPlayerState()
    const { sessionId, messages } = await getHistory(session_id)
    const history     = formatForGemini(messages)

    const { reply, actions, needsClarification, clarificationQuestion } =
      await runAgent(message, history, playerState, today)

    let actionResults = []
    if (actions.length && !needsClarification) {
      actionResults = await executeActions(actions, playerState)
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
app.get('/stats',     async (_, res) => { try { res.json(await getStats()) }            catch (e) { res.status(500).json({ error: e.message }) } })
app.get('/shop',      async (_, res) => { try { res.json(await getShopWithCounts()) }   catch (e) { res.status(500).json({ error: e.message }) } })
app.get('/snapshots', async (_, res) => { try { res.json(await getSnapshots()) }        catch (e) { res.status(500).json({ error: e.message }) } })
app.get('/calendar',  async (req, res) => {
  try {
    const month = req.query.month ?? new Date().toISOString().slice(0, 7)
    res.json(await getCalendar(month))
  } catch (e) { res.status(500).json({ error: e.message }) }
})

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

import 'dotenv/config'
import express       from 'express'
import path          from 'path'
import { fileURLToPath } from 'url'

import { registerUser }                    from '../../scripts/register-user.js'
import { setupSupabase, triggerEmbedSeed } from '../../scripts/setup-supabase.js'

import { loadConfig, getConfig, getServer, writeConfigSection } from './configLoader.js'
import { initGemini, runAgent }    from './agentPipeline.js'
import { initProjection, projectTask } from './projectionEngine.js'
import { initDiscordBot }          from './discordBot.js'
import { executeActions }          from './actionExecutor.js'
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

// ── CORS — allows setup wizard on any domain to reach this server ─────────────
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-cron-secret')
  if (req.method === 'OPTIONS') return res.sendStatus(204)
  next()
})

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

    const resolvedTask = task ?? (await (async () => {
      const { supabase } = await import('./supabaseClient.js')
      const { data } = await supabase.from('task').select('*').eq('id', taskId).single()
      return data
    })())

    if (!resolvedTask) return res.status(404).json({ error: 'Task not found' })
    if (resolvedTask.status === 'completed') return res.status(400).json({ error: 'Task already completed' })

    const ps   = await getPlayerState()
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

    let actionResults = []
    if (agentResult.actions?.length) {
      actionResults = await executeActions(agentResult.actions)
    }

    const updatedPlayer = await getPlayerState()
    const updatedTasks  = await getTasksForDate(today)

    let finalReply = agentResult.reply
    if (actionResults.length > 0) {
      const successActions = actionResults.filter(r => r.success)
      if (successActions.length > 0 && !finalReply) {
        finalReply = successActions.map(r => r.message).join('\n')
      }
    }

    await saveExchange(sessionId, message, finalReply ?? '', agentResult.actions ?? [])

    res.json({ reply: finalReply, actions: actionResults })
  } catch (e) {
    console.error('Chat error:', e.message)
    res.status(500).json({ error: e.message })
  }
})

// ─────────────────────────────────────────────────────────────────────────────
// SKILLS / STATS / SHOP / GRAPHS
// ─────────────────────────────────────────────────────────────────────────────
app.get('/skills', async (_, res) => { try { res.json(await getSkills()) }          catch (e) { res.status(500).json({ error: e.message }) } })

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

app.get('/stats', async (_, res) => { try { res.json(await getStats()) }            catch (e) { res.status(500).json({ error: e.message }) } })

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

app.get('/shop',      async (_, res) => { try { res.json(await getShopWithCounts()) } catch (e) { res.status(500).json({ error: e.message }) } })
app.get('/snapshots', async (_, res) => { try { res.json(await getSnapshots()) }      catch (e) { res.status(500).json({ error: e.message }) } })

app.get('/calendar', async (req, res) => {
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

app.post('/stats/re-embed', async (req, res) => {
  try {
    const { GoogleGenerativeAI } = await import('@google/generative-ai')
    const { supabase }           = await import('./supabaseClient.js')
    const embeddingModel         = getServer().model?.embedding_model ?? 'text-embedding-004'
    const model = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY)
      .getGenerativeModel({ model: embeddingModel })

    const { data: stats, error } = await supabase.from('stat').select('id, name, description')
    if (error) throw error

    for (const stat of stats) {
      const result = await model.embedContent(`${stat.name}. ${stat.description}`)
      await supabase.from('stat').update({ embedding_vector: result.embedding.values }).eq('id', stat.id)
    }
    res.json({ ok: true, count: stats.length })
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
// SETUP — wizard endpoints (no auth required — called during onboarding)
// ─────────────────────────────────────────────────────────────────────────────

// Gemini key validation
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

// Supabase schema + seed setup
app.post('/setup-supabase', async (req, res) => {
  try {
    const { supabaseUrl, pat } = req.body
    if (!supabaseUrl) return res.status(400).json({ error: 'supabaseUrl required' })
    if (!pat)         return res.status(400).json({ error: 'pat required' })
    const result = await setupSupabase(supabaseUrl, pat)
    res.json(result)
  } catch (e) {
    console.error('Supabase setup error:', e.message)
    res.status(500).json({ error: e.message })
  }
})

// Stat embedding seed — called on friend's own server after Render is live
app.post('/setup/embed', async (req, res) => {
  try {
    const { createClient }       = await import('@supabase/supabase-js')
    const { GoogleGenerativeAI } = await import('@google/generative-ai')
    const embeddingModel         = getServer().model?.embedding_model ?? 'text-embedding-004'

    const supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_KEY
    )
    const model = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY)
      .getGenerativeModel({ model: embeddingModel })

    const { data: stats, error } = await supabase
      .from('stat').select('id, name, description, embedding_vector')
    if (error) throw new Error(error.message)

    const needsEmbed = stats.filter(s => !s.embedding_vector)
    if (!needsEmbed.length) return res.json({ ok: true, embedded: 0, note: 'already done' })

    let embedded = 0
    for (const stat of needsEmbed) {
      const result = await model.embedContent(`${stat.name}. ${stat.description}`)
      const { error: updateErr } = await supabase
        .from('stat').update({ embedding_vector: result.embedding.values }).eq('id', stat.id)
      if (updateErr) throw new Error(`Failed to embed ${stat.name}: ${updateErr.message}`)
      embedded++
    }
    res.json({ ok: true, embedded })
  } catch (e) {
    console.error('Embed seed error:', e.message)
    res.status(500).json({ error: e.message })
  }
})

// UID lookup — returning user skips wizard
app.get('/lookup', async (req, res) => {
  try {
    const { uid } = req.query
    if (!uid) return res.status(400).json({ error: 'uid required' })

    const { readFileSync } = await import('fs')
    const { join }         = await import('path')
    const file  = join(process.cwd(), '../../config/users.json')
    const users = JSON.parse(readFileSync(file, 'utf8'))
    const found = users.find(u => u.googleUid === uid)

    if (found) return res.json({ found: true, renderUrl: found.url, name: found.name })
    res.json({ found: false })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// User registration + trigger embed on friend's server
app.post('/register', async (req, res) => {
  try {
    const { renderUrl, name, googleUid } = req.body
    if (!renderUrl) return res.status(400).json({ error: 'renderUrl required' })
    const result = await registerUser(renderUrl, name ?? 'friend', googleUid)
    // Trigger embed on friend's server non-blocking
    triggerEmbedSeed(renderUrl).catch(e => console.warn('[register] embed trigger failed:', e.message))
    res.json(result)
  } catch (e) {
    console.error('Register error:', e.message)
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
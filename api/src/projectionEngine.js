// projectionEngine.js — skill/stat embedding + projection
// Ported from v1 Supabase edge function (post-task-completion/index.ts).
// Now runs in Node.js — no edge function deployment needed.
// Called async after task completion (non-blocking).

import { GoogleGenerativeAI } from '@google/generative-ai'
import { supabase } from './supabaseClient.js'
import { getGame, getServer } from './configLoader.js'
import { computeSkillXpToNext, getProjectionMultiplier } from './rpgEngine.js'

let _genAI = null
export function initProjection() {
  _genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY)
}

// ── Cosine similarity ─────────────────────────────────────────────────────────
function cos(a, b) {
  let dot = 0, mA = 0, mB = 0
  for (let i = 0; i < a.length; i++) { dot += a[i]*b[i]; mA += a[i]*a[i]; mB += b[i]*b[i] }
  const d = Math.sqrt(mA) * Math.sqrt(mB)
  return d === 0 ? 0 : dot / d
}

function parseVec(v) { return typeof v === 'string' ? JSON.parse(v) : v }
function moveCentroid(old, nw, n) { return old.map((v, i) => (v*n + nw[i]) / (n+1)) }

function crossoverLabel(sim) {
  if (sim >= 0.90) return 'direct'
  if (sim >= 0.60) return 'partial'
  return 'indirect'
}

// ── Embed text via Gemini embedding API ──────────────────────────────────────
async function embed(text) {
  const model  = getServer().model.embedding_model
  const apiKey = process.env.GOOGLE_API_KEY
  const url    = `https://generativelanguage.googleapis.com/v1beta/models/${model}:embedContent?key=${apiKey}`
  const res    = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: `models/${model}`, content: { parts: [{ text }] } })
  })
  if (!res.ok) throw new Error(`Embed failed: ${res.status}`)
  return (await res.json()).embedding.values
}

// ── Name a new skill using Gemini ─────────────────────────────────────────────
async function nameSkill(titles) {
  const apiKey = process.env.GOOGLE_API_KEY
  const model  = getServer().model.name
  const url    = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`
  const prompt = `These tasks were completed repeatedly:\n${titles.map(t => `- ${t}`).join('\n')}\n\nName a skill (1-3 words). Return only the skill name.`
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.5, maxOutputTokens: 16 }
    })
  })
  if (!res.ok) throw new Error(`nameSkill failed: ${res.status}`)
  return ((await res.json()).candidates?.[0]?.content?.parts?.[0]?.text ?? 'New Skill').trim()
}

// ── Award XP to a skill ───────────────────────────────────────────────────────
async function awardSkillXP(taskId, skillId, xpAmt, sim, completedAt) {
  const { data: cur } = await supabase
    .from('skill').select('current_xp, current_level, xp_to_next').eq('id', skillId).single()
  if (!cur) return

  let xp = cur.current_xp + xpAmt
  let lv = cur.current_level
  let nx = cur.xp_to_next

  while (xp >= nx) { xp -= nx; lv++; nx = computeSkillXpToNext(lv) }

  await supabase.from('skill').update({ current_xp: xp, current_level: lv, xp_to_next: nx }).eq('id', skillId)
  await supabase.from('xp_ledger').insert({
    source_task_id: taskId, amount: xpAmt,
    target_type: 'skill', target_id: skillId,
    streak_multiplier_applied: 1.0,
    crossover_type: crossoverLabel(sim),
    timestamp: completedAt ?? new Date().toISOString()
  })
  await supabase.from('task_skill').upsert(
    { task_id: taskId, skill_id: skillId, similarity_score: sim },
    { onConflict: 'task_id,skill_id', ignoreDuplicates: true }
  )
}

// ── Graduate a top-level skill from a cluster ─────────────────────────────────
async function graduateSkill(clusterId, centroid, completedAt) {
  const cfg = getGame().skills
  const { data: rows } = await supabase
    .from('skill_candidate').select('task_id').eq('cluster_id', clusterId).is('parent_skill_id', null)
  const taskIds = (rows ?? []).map(r => r.task_id)
  if (!taskIds.length) return

  const { data: tasks } = await supabase
    .from('task').select('id, title, task_type, completed_at, embedding_vector').in('id', taskIds)
  const titles = (tasks ?? []).map(t => t.title)

  let skillName = 'Emerging Skill'
  try { skillName = await nameSkill(titles) } catch (e) { console.error('nameSkill failed:', e) }

  const { data: newSkill, error } = await supabase.from('skill').insert({
    name:            skillName,
    description:     `Auto-generated from: ${titles.join(', ')}`,
    is_dynamic:      true,
    parent_skill_id: null,
    origin_task_id:  taskIds[0],
    centroid_vector: centroid,
    current_xp: 0, current_level: 0, xp_to_next: 50, current_streak: 0
  }).select('id').single()

  if (error || !newSkill) { console.error('skill insert failed:', error); return }

  await supabase.from('skill_candidate').delete().eq('cluster_id', clusterId).is('parent_skill_id', null)

  for (const t of tasks ?? []) {
    if (!t.embedding_vector) continue
    const sim    = cos(parseVec(t.embedding_vector), centroid)
    if (sim < cfg.match_floor) continue
    const xpAmt  = getProjectionMultiplier(sim, cfg.projection_tiers) * 10
    await awardSkillXP(t.id, newSkill.id, xpAmt, sim, t.completed_at)
  }
  console.log(`[projection] graduated skill "${skillName}" (id:${newSkill.id})`)
}

// ── Main projection run for a single task ─────────────────────────────────────
export async function projectTask(taskId) {
  const cfg = getGame()

  const { data: task, error: tErr } = await supabase
    .from('task').select('id, title, task_type, projection_status, completed_at').eq('id', taskId).single()
  if (tErr || !task) { console.error('task not found for projection:', taskId); return }
  if (task.projection_status !== 'pending') return

  let taskVec
  try {
    taskVec = await embed(task.title)
  } catch (e) {
    console.error('[projection] embed failed:', e)
    await supabase.from('task').update({ projection_status: 'failed' }).eq('id', taskId)
    return
  }

  await supabase.from('task').update({ embedding_vector: taskVec }).eq('id', taskId)

  const baseXp = cfg.tasks.xp_base[task.task_type] ?? 10
  let anyMatch = false

  // ── Stat projection ──────────────────────────────────────────────────────
  const { data: stats } = await supabase.from('stat').select('id, name, current_value, embedding_vector')
  for (const s of stats ?? []) {
    if (!s.embedding_vector) continue
    const sim = cos(taskVec, parseVec(s.embedding_vector))
    if (sim < cfg.stats.match_floor) continue
    anyMatch = true
    const xpAmt = baseXp * getProjectionMultiplier(sim, cfg.stats.projection_tiers)
    const newValue = Math.min(cfg.stats.max_value, (s.current_value ?? 0) + xpAmt)
    await supabase.from('stat').update({ current_value: newValue }).eq('id', s.id)
    await supabase.from('xp_ledger').insert({
      source_task_id: taskId, amount: xpAmt,
      target_type: 'stat', target_id: s.id,
      streak_multiplier_applied: 1.0,
      crossover_type: crossoverLabel(sim),
      timestamp: task.completed_at ?? new Date().toISOString()
    })
    await supabase.from('task_stat').upsert(
      { task_id: taskId, stat_id: s.id, similarity_score: sim },
      { onConflict: 'task_id,stat_id', ignoreDuplicates: true }
    )
  }

  // ── Skill projection ─────────────────────────────────────────────────────
  const { data: skills } = await supabase
    .from('skill').select('id, current_xp, current_level, xp_to_next, centroid_vector, parent_skill_id')

  const matchedSkills = []
  for (const sk of skills ?? []) {
    if (!sk.centroid_vector) continue
    const sim = cos(taskVec, parseVec(sk.centroid_vector))
    if (sim < cfg.skills.match_floor) continue
    anyMatch = true
    const xpAmt = baseXp * getProjectionMultiplier(sim, cfg.skills.projection_tiers)
    await awardSkillXP(taskId, sk.id, xpAmt, sim, task.completed_at)
    matchedSkills.push({ id: sk.id, centroid: parseVec(sk.centroid_vector), parentId: sk.parent_skill_id })
  }

  // ── Top-level candidate bucket (if no skill matched) ──────────────────────
  if (!anyMatch) {
    const { data: cands } = await supabase
      .from('skill_candidate').select('cluster_id, cluster_centroid').is('parent_skill_id', null)
    const clusterMap = new Map()
    for (const row of cands ?? []) {
      if (row.cluster_centroid && !clusterMap.has(row.cluster_id)) {
        clusterMap.set(row.cluster_id, parseVec(row.cluster_centroid))
      }
    }
    let bestId = null, bestDist = Infinity
    for (const [cid, cen] of clusterMap.entries()) {
      const d = 1 - cos(taskVec, cen)
      if (d < bestDist) { bestDist = d; bestId = cid }
    }
    if (bestId && bestDist <= cfg.skills.candidate_max_distance) {
      const existing = clusterMap.get(bestId)
      const { count: n } = await supabase.from('skill_candidate')
        .select('id', { count: 'exact', head: true }).eq('cluster_id', bestId).is('parent_skill_id', null)
      const count  = n ?? 1
      const newCen = moveCentroid(existing, taskVec, count)
      const newDist = 1 - cos(taskVec, newCen)
      await supabase.from('skill_candidate').insert({
        task_id: taskId, cluster_id: bestId,
        distance_to_centroid: newDist, cluster_centroid: newCen, parent_skill_id: null
      })
      await supabase.from('skill_candidate')
        .update({ cluster_centroid: newCen })
        .eq('cluster_id', bestId).is('parent_skill_id', null).neq('task_id', taskId)
      if ((count + 1) >= cfg.skills.candidate_threshold) {
        await graduateSkill(bestId, newCen, task.completed_at)
      }
    } else {
      const newId = crypto.randomUUID()
      await supabase.from('skill_candidate').insert({
        task_id: taskId, cluster_id: newId,
        distance_to_centroid: 0, cluster_centroid: taskVec, parent_skill_id: null
      })
    }
  }

  await supabase.from('task').update({ projection_status: 'done' }).eq('id', taskId)
  console.log(`[projection] task ${taskId} done. match=${anyMatch}`)
}

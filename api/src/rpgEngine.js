// rpgEngine.js — all RPG reward calculations
// Pure functions. No DB calls. No side effects.
// Source: v1 logicAgent.js, updated for v2 config structure (game.json)

import { getGame } from './configLoader.js'

// ── Task rewards ──────────────────────────────────────────────────────────────
export function computeTaskRewards(task) {
  const { tasks } = getGame()

  const xpBase  = tasks.xp_base[task.task_type]   ?? 0
  const goldBase = tasks.gold_base[task.task_type] ?? 0

  const xpOffset   = tasks.difficulty_xp_offset[task.difficulty]   ?? 0
  const goldOffset = tasks.difficulty_gold_offset[task.difficulty] ?? 0

  const xp   = Math.max(0, xpBase + xpOffset)
  const gold = Math.max(tasks.gold_floor, goldBase + goldOffset)

  return { xp, gold }
}

// ── Streak multiplier ─────────────────────────────────────────────────────────
export function computeStreakMultiplier(dayStreak) {
  if (dayStreak <= 0) return 0
  const { formula_coefficient: c, formula_exponent: e } = getGame().streak
  return c * Math.pow(dayStreak, e)
}

// ── Level calculation ─────────────────────────────────────────────────────────
export function computeXpToNext(level) {
  const f = getGame().player.xp_level_formula
  if (level === 0) return f.level_0_xp
  if (level === 1) return f.level_1_xp
  let xp = f.base_xp
  for (let k = 2; k <= level; k++) {
    xp *= f.base_multiplier - f.decay_rate * (k - 2) / (k + f.decay_offset)
  }
  return Math.round(xp)
}

export function computeNewLevel(currentLevel, currentXp, xpGained) {
  let level    = currentLevel
  let xp       = currentXp + xpGained
  let xpToNext = computeXpToNext(level)

  while (xp >= xpToNext) {
    xp      -= xpToNext
    level   += 1
    xpToNext = computeXpToNext(level)
  }

  return { newLevel: level, newXp: xp, newXpToNext: xpToNext }
}

// ── Energy drain ──────────────────────────────────────────────────────────────
export function computeEnergyDrain(task) {
  const { energy } = getGame()
  const base   = energy.drain_by_type[task.task_type]              ?? 5
  const offset = energy.drain_difficulty_offset[task.difficulty]   ?? 0
  return Math.max(energy.drain_floor, base + offset)
}

// ── Skill XP to next level ────────────────────────────────────────────────────
export function computeSkillXpToNext(level) {
  const f = getGame().skills.xp_formula
  if (level === 0) return f.level_0_xp
  if (level === 1) return f.level_1_xp
  let xp = f.base_xp
  for (let k = 2; k <= level; k++) {
    xp *= f.base_multiplier - f.decay_rate * (k - 2) / (k + f.decay_offset)
  }
  return Math.round(xp)
}

// ── Projection tier multiplier (for skill/stat XP from embeddings) ────────────
export function getProjectionMultiplier(similarity, tiers) {
  const tier = tiers.find(t => similarity >= t.min && similarity <= t.max)
  return tier?.multiplier ?? 0
}

// ── Full task completion calc (used by POST /complete/:id) ────────────────────
export function calculateCompletion(task, player) {
  const { xp, gold }   = computeTaskRewards(task)
  const energyDrain     = computeEnergyDrain(task)
  const streakMult      = computeStreakMultiplier(player.streak.day_streak)
  const finalXp         = xp * (1 + streakMult)
  const { newLevel, newXp, newXpToNext } = computeNewLevel(
    player.level, player.current_xp, finalXp
  )
  const leveledUp = newLevel > player.level

  return {
    xp:         finalXp,
    gold,
    streakMult,
    energyDrain,
    newLevel,
    newXp,
    newXpToNext,
    leveledUp,
    isRecovery: task.is_recovery ?? false
  }
}

// ── Rank lookup ───────────────────────────────────────────────────────────────
export function getRank(level) {
  const ranks = getGame().ranks || []
  // Find the highest rank the player has reached
  const reached = ranks.filter(r => level >= r.level)
  return reached.length ? reached[reached.length - 1].title : 'Hatchling'
}
-- ═══════════════════════════════════════════════════════════════════════════
-- Migration 008 — retroactive task logging ("I went to gym last night")
-- Run this against an EXISTING Supabase project. A fresh project created from
-- the current schema.sql + functions.sql already has this — do not run it
-- there (just add log_past_task() from functions.sql).
--
-- New RPC, not a reuse of complete_task(): creates the task dated for a past
-- day AND marks it completed, atomically, in one transaction. Deliberately
-- does NOT touch daily_state/streak/mandatory_met (those were already locked
-- in by that day's EOD rollover — there's no per-day history to retroactively
-- correct) and does NOT drain energy (energy is current capacity, not
-- something a past action can retroactively cost). Rewards are flat base
-- XP/gold with no streak multiplier — app-side (rpgEngine.js) intentionally
-- skips computeStreakMultiplier() for this path so a backdated task can't be
-- used to farm rewards at today's live streak multiplier.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION log_past_task(
  p_title          text,
  p_task_type      text,
  p_priority       text,
  p_difficulty     text,
  p_time_block     text,
  p_scheduled_for  date,
  p_completed_at   timestamptz,
  p_is_recovery    boolean,
  p_xp_gained      numeric,
  p_gold_gained    numeric,
  p_new_level      integer,
  p_new_xp         numeric,
  p_new_xp_to_next numeric,
  p_leveled_up     boolean
)
RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
  v_task_id integer;
BEGIN
  INSERT INTO task (
    title, task_type, priority, difficulty, time_block,
    scheduled_for, status, completed_at, is_recovery
  ) VALUES (
    p_title, p_task_type, p_priority, p_difficulty, p_time_block,
    p_scheduled_for, 'completed', p_completed_at, p_is_recovery
  )
  RETURNING id INTO v_task_id;

  UPDATE player
  SET current_xp     = COALESCE(p_new_xp, 0),
      xp_to_next     = COALESCE(p_new_xp_to_next, 100),
      current_level  = COALESCE(p_new_level, 1),
      total_gold     = COALESCE(total_gold, 0)     + COALESCE(p_gold_gained, 0),
      available_gold = COALESCE(available_gold, 0) + COALESCE(p_gold_gained, 0)
  WHERE id = 1;

  INSERT INTO xp_ledger (
    source_task_id, amount, target_type, target_id,
    streak_multiplier_applied, timestamp
  ) VALUES (
    v_task_id, p_xp_gained, 'player', NULL,
    1.0, p_completed_at
  );

  INSERT INTO gold_ledger (source_task_id, amount, direction, reason, timestamp)
  VALUES (v_task_id, p_gold_gained, 'credit', 'retro_task_completion', p_completed_at);

  RETURN jsonb_build_object(
    'task_id',      v_task_id,
    'task_type',    p_task_type,
    'xp_gained',    p_xp_gained,
    'gold_gained',  p_gold_gained,
    'leveled_up',   p_leveled_up,
    'new_level',    p_new_level
  );

EXCEPTION WHEN OTHERS THEN
  RAISE;
END;
$$;

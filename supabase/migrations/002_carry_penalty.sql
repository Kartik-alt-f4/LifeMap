-- ═══════════════════════════════════════════════════════════════════════════
-- Migration 002 — type-aware EOD carryover with anchor/mandatory penalties
-- Run this against an EXISTING Supabase project. A fresh project created from
-- the current schema.sql + functions.sql already has this — do not run it there.
--
-- Adds task.carry_penalized (tracks whether a missed mandatory task's carry
-- chain already took its one-time penalty) and the apply_task_penalty() RPC
-- the EOD cron now calls for missed anchor/mandatory tasks.
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE task
  ADD COLUMN carry_penalized bool NOT NULL DEFAULT false;

CREATE OR REPLACE FUNCTION apply_task_penalty(
  p_task_id        integer,
  p_xp_penalty     numeric,
  p_gold_penalty   numeric,
  p_new_level      integer,
  p_new_xp         numeric,
  p_new_xp_to_next numeric
)
RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
  v_gold_before integer;
  v_gold_after  integer;
BEGIN
  SELECT available_gold INTO v_gold_before FROM player WHERE id = 1;
  v_gold_after := GREATEST(0, COALESCE(v_gold_before, 0) - p_gold_penalty::int);

  UPDATE player
  SET current_xp     = COALESCE(p_new_xp, 0),
      xp_to_next     = COALESCE(p_new_xp_to_next, 100),
      current_level  = COALESCE(p_new_level, 1),
      available_gold = v_gold_after
  WHERE id = 1;

  INSERT INTO xp_ledger (source_task_id, amount, target_type, target_id, streak_multiplier_applied, timestamp)
  VALUES (p_task_id, -p_xp_penalty, 'player', NULL, 1.0, now());

  INSERT INTO gold_ledger (source_task_id, amount, direction, reason)
  VALUES (p_task_id, p_gold_penalty::int, 'debit', 'missed_task_penalty');

  RETURN jsonb_build_object(
    'task_id',      p_task_id,
    'xp_penalty',   p_xp_penalty,
    'gold_penalty', p_gold_penalty,
    'gold_before',  v_gold_before,
    'gold_after',   v_gold_after,
    'new_level',    p_new_level
  );
EXCEPTION WHEN OTHERS THEN
  RAISE;
END;
$$;

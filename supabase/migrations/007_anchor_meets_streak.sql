-- ═══════════════════════════════════════════════════════════════════════════
-- Migration 007 — anchor tasks also satisfy the day's streak condition
-- Run this against an EXISTING Supabase project. A fresh project created from
-- the current schema.sql + functions.sql already has this — do not run it there.
--
-- Previously only completing a task_type='mandatory' task set
-- daily_state.mandatory_met — a day with no mandatory task at all could never
-- build streak even if every anchor/habit/routine/project/bonus task that day
-- was completed. anchor ("fixed daily structure point") is just as
-- non-negotiable as mandatory, so it now satisfies the same condition.
-- Column name stays mandatory_met to avoid a disruptive rename across the JS
-- codebase.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION complete_task(
  p_task_id        integer,
  p_xp_gained      numeric,
  p_gold_gained    numeric,
  p_streak_mult    numeric,
  p_new_level      integer,
  p_new_xp         numeric,
  p_new_xp_to_next numeric,
  p_leveled_up     boolean,
  p_energy_drain   integer,
  p_is_recovery    boolean
)
RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
  v_task_type    text;
  v_energy_after integer;
BEGIN
  SELECT task_type INTO v_task_type
  FROM task WHERE id = p_task_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Task % not found', p_task_id;
  END IF;
  IF (SELECT status FROM task WHERE id = p_task_id) = 'completed' THEN
    RAISE EXCEPTION 'Task % already completed', p_task_id;
  END IF;
  IF (SELECT status FROM task WHERE id = p_task_id) = 'cancelled' THEN
    RAISE EXCEPTION 'Task % is cancelled', p_task_id;
  END IF;

  UPDATE task
  SET status = 'completed', completed_at = now()
  WHERE id = p_task_id;

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
    p_task_id, p_xp_gained, 'player', NULL,
    p_streak_mult, now()
  );

  INSERT INTO gold_ledger (source_task_id, amount, direction, reason)
  VALUES (p_task_id, p_gold_gained, 'credit', 'task_completion');

  IF v_task_type IN ('mandatory', 'anchor') THEN
    UPDATE daily_state SET mandatory_met = true WHERE id = 1;
  END IF;

  UPDATE energy_state
  SET current = GREATEST(0, COALESCE(current, 100) - p_energy_drain)
  WHERE id = 1;

  IF p_is_recovery THEN
    UPDATE energy_state
    SET current = LEAST(max, COALESCE(current, 100) + 15)
    WHERE id = 1;
  END IF;

  SELECT current INTO v_energy_after FROM energy_state WHERE id = 1;

  UPDATE energy_state SET
    threshold_label = CASE
      WHEN v_energy_after >= 60 THEN 'normal'
      WHEN v_energy_after >= 30 THEN 'reduced'
      WHEN v_energy_after >= 10 THEN 'min_viable'
      ELSE 'recovery'
    END,
    last_updated = now()
  WHERE id = 1;

  IF v_energy_after = 0 THEN
    UPDATE daily_state SET day_off_granted = true WHERE id = 1;
  END IF;

  RETURN jsonb_build_object(
    'task_id',      p_task_id,
    'task_type',    v_task_type,
    'xp_gained',    p_xp_gained,
    'gold_gained',  p_gold_gained,
    'leveled_up',   p_leveled_up,
    'new_level',    p_new_level,
    'energy_after', v_energy_after
  );

EXCEPTION WHEN OTHERS THEN
  RAISE;
END;
$$;

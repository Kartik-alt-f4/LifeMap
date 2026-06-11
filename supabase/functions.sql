-- ═══════════════════════════════════════════════════════════════════════════
-- Life Map v2 — functions.sql
-- Run after schema.sql.
-- ═══════════════════════════════════════════════════════════════════════════


-- ── complete_task() ───────────────────────────────────────────────────────────
-- Called by POST /complete/:id via supabase.rpc()
-- App computes XP/gold/level/energy before calling — this fn writes atomically.
-- Parameters are all app-computed. Function just executes and records.

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
  -- Guard: must exist and be completable
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

  -- 1. Mark task completed
  UPDATE task
  SET status = 'completed', completed_at = now()
  WHERE id = p_task_id;

  -- 2. Award XP and gold — COALESCE guards against null columns after reset
  UPDATE player
  SET current_xp     = COALESCE(p_new_xp, 0),
      xp_to_next     = COALESCE(p_new_xp_to_next, 100),
      current_level  = COALESCE(p_new_level, 1),
      total_gold     = COALESCE(total_gold, 0)     + COALESCE(p_gold_gained, 0),
      available_gold = COALESCE(available_gold, 0) + COALESCE(p_gold_gained, 0)
  WHERE id = 1;

  -- 3. XP ledger
  INSERT INTO xp_ledger (
    source_task_id, amount, target_type, target_id,
    streak_multiplier_applied, timestamp
  ) VALUES (
    p_task_id, p_xp_gained, 'player', NULL,
    p_streak_mult, now()
  );

  -- 4. Gold ledger
  INSERT INTO gold_ledger (source_task_id, amount, direction, reason)
  VALUES (p_task_id, p_gold_gained, 'credit', 'task_completion');

  -- 5. Mandatory check
  IF v_task_type = 'mandatory' THEN
    UPDATE daily_state SET mandatory_met = true WHERE id = 1;
  END IF;

  -- 6. Energy drain
  UPDATE energy_state
  SET current = GREATEST(0, COALESCE(current, 100) - p_energy_drain)
  WHERE id = 1;

  -- 7. Recovery restore
  IF p_is_recovery THEN
    UPDATE energy_state
    SET current = LEAST(max, COALESCE(current, 100) + 15)
    WHERE id = 1;
  END IF;

  -- 8. Update energy threshold label
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

  -- 9. Auto day-off if energy hits zero
  IF v_energy_after = 0 THEN
    UPDATE daily_state SET day_off_granted = true WHERE id = 1;
  END IF;

  -- 10. Return result
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


-- ── buy_item() ────────────────────────────────────────────────────────────────
-- Kept verbatim from v1 fn_buy_item.sql — logic is correct.
-- Called by POST /buy/:id via supabase.rpc()

CREATE OR REPLACE FUNCTION buy_item(
  p_item_id   integer,
  p_gold_cost integer
)
RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
  v_available_gold integer;
  v_item_name      text;
  v_item_active    boolean;
  v_item_type      text;
  v_free_leisure   bool := false;
BEGIN

  SELECT name, active, type
  INTO v_item_name, v_item_active, v_item_type
  FROM shop_item
  WHERE id = p_item_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Item not found: %', p_item_id;
  END IF;
  IF NOT v_item_active THEN
    RAISE EXCEPTION 'Item not available: %', v_item_name;
  END IF;

  -- Check if leisure is free today (Day Off+ was purchased)
  SELECT free_leisure_today INTO v_free_leisure FROM daily_state WHERE id = 1;

  -- Skip gold check for leisure items on Day Off+ days
  IF NOT (v_item_type = 'leisure' AND v_free_leisure) THEN
    SELECT available_gold INTO v_available_gold FROM player WHERE id = 1;
    IF v_available_gold < p_gold_cost THEN
      RAISE EXCEPTION 'Insufficient gold. Have: %, Need: %', v_available_gold, p_gold_cost;
    END IF;
    UPDATE player SET available_gold = available_gold - p_gold_cost WHERE id = 1;
    INSERT INTO gold_ledger (source_task_id, amount, direction, reason)
    VALUES (NULL, p_gold_cost, 'debit', 'shop_purchase:' || v_item_name);
  END IF;

  INSERT INTO purchase_log (shop_item_id, gold_spent)
  VALUES (p_item_id, CASE WHEN v_item_type = 'leisure' AND v_free_leisure THEN 0 ELSE p_gold_cost END);

  -- Log leisure usage automatically on purchase
  IF v_item_type IN ('leisure', 'day_off_plus') THEN
    INSERT INTO leisure_log (shop_item_id, quantity, unit)
    SELECT p_item_id, 1,
      COALESCE(NULLIF(tracking_unit, 'none'), 'count')
    FROM shop_item WHERE id = p_item_id;
  END IF;

  IF v_item_type = 'day_off' THEN
    UPDATE daily_state SET mandatory_met = true, day_off_granted = true WHERE id = 1;
  END IF;

  IF v_item_type = 'day_off_plus' THEN
    UPDATE daily_state SET
      mandatory_met      = true,
      day_off_granted    = true,
      free_leisure_today = true
    WHERE id = 1;
  END IF;

  RETURN jsonb_build_object(
    'item_id',        p_item_id,
    'item_name',      v_item_name,
    'gold_spent',     p_gold_cost,
    'gold_remaining', v_available_gold - p_gold_cost
  );

EXCEPTION WHEN OTHERS THEN
  RAISE;
END;
$$;


-- ── regen_energy() ────────────────────────────────────────────────────────────
-- Called by morning cron and EOD recovery.
-- Kept verbatim from v1 fn_regen_energy.sql.

CREATE OR REPLACE FUNCTION regen_energy(p_amount integer)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  UPDATE energy_state
  SET current = LEAST(max, current + p_amount),
      last_updated = now()
  WHERE id = 1;

  -- Keep threshold label in sync
  UPDATE energy_state SET
    threshold_label = CASE
      WHEN current >= 60 THEN 'normal'
      WHEN current >= 30 THEN 'reduced'
      WHEN current >= 10 THEN 'min_viable'
      ELSE 'recovery'
    END
  WHERE id = 1;
END;
$$;


-- ── roll_daily_state() ────────────────────────────────────────────────────────
-- Called by EOD cron after snapshot is written.
-- Advances date, resets flags, updates streak.

CREATE OR REPLACE FUNCTION roll_daily_state(
  p_new_streak      integer,
  p_streak_mult     float
)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  UPDATE daily_state SET
    date               = CURRENT_DATE + 1,
    mandatory_met      = false,
    morning_ran        = false,
    eod_ran            = true,
    day_off_granted    = false,
    free_leisure_today = false,
    day_streak         = p_new_streak,
    streak_multiplier  = p_streak_mult
  WHERE id = 1;
END;
$$;


-- ── spawn_template_instances() ────────────────────────────────────────────────
-- Called by morning cron. Inserts today's task instances from active templates.
-- Idempotent — checks for existing instance before inserting.

CREATE OR REPLACE FUNCTION spawn_template_instances(p_date date)
RETURNS integer
LANGUAGE plpgsql
AS $$
DECLARE
  tpl     RECORD;
  spawned integer := 0;
BEGIN
  FOR tpl IN
    SELECT * FROM task_template WHERE active = true
  LOOP
    -- Skip if instance already exists for this template + date
    IF NOT EXISTS (
      SELECT 1 FROM task
      WHERE template_id = tpl.id
        AND scheduled_for = p_date
    ) THEN
      INSERT INTO task (
        template_id, title, task_type, priority, difficulty,
        time_block, scheduled_for, is_recovery, status
      ) VALUES (
        tpl.id, tpl.title, tpl.task_type, tpl.priority, tpl.difficulty,
        tpl.time_block, p_date, tpl.is_recovery, 'pending'
      );
      spawned := spawned + 1;
    END IF;
  END LOOP;

  RETURN spawned;
END;
$$;
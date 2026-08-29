-- ═══════════════════════════════════════════════════════════════════════════
-- Life Map v2 — functions.sql
-- Run after schema.sql.
--
-- Before running the SUPABASE-NATIVE CRON SCHEDULER section near the bottom
-- of this file, edit its two vault.create_secret() calls to your own Render
-- URL and CRON_SECRET — everything else in this file is deployment-generic.
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

  -- 5. Critical-task check — anchor ("fixed daily structure point") and
  -- mandatory ("must happen today or the day fails") both represent a
  -- non-negotiable commitment, so completing either satisfies the day's
  -- streak condition. Column name stays mandatory_met to avoid a disruptive
  -- rename across the JS codebase — its real meaning is now "a critical task
  -- was completed today."
  IF v_task_type IN ('mandatory', 'anchor') THEN
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


-- ── apply_task_penalty() ─────────────────────────────────────────────────────
-- Called by the EOD cron for an anchor or mandatory task that's still incomplete
-- when the day closes. App computes the penalty amounts and the post-penalty
-- level/XP (rpgEngine.computeLevelPenalty — floored at level 1 / 0 XP) before
-- calling; this function just applies them atomically and records the ledgers.
-- Gold is floored at 0 here, matching the XP floor already applied in JS.

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

  -- Negative amount records a loss — xp_ledger has no separate direction column
  -- the way gold_ledger does, so sign carries the meaning here.
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
-- p_new_date is passed explicitly (computed in JS as state.date + 1 day) rather
-- than derived here as CURRENT_DATE + 1 — those two disagree whenever
-- daily_state.date has drifted behind the real clock (e.g. cron missed a day or
-- more), which silently stranded carried-forward tasks on a date that never
-- became "today". See cronJobs.js runEod().
DROP FUNCTION IF EXISTS roll_daily_state(integer, float);

CREATE OR REPLACE FUNCTION roll_daily_state(
  p_new_streak      integer,
  p_streak_mult     float,
  p_new_date        date
)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  UPDATE daily_state SET
    date               = p_new_date,
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
-- Called by morning cron (and by the chat/agent create_task→recurring path, to
-- spawn a same-day instance if p_date happens to match the new template's cadence).
-- Cadence-checked per template, then idempotent — checks for an existing instance
-- for that template + date before inserting.

CREATE OR REPLACE FUNCTION spawn_template_instances(p_date date)
RETURNS integer
LANGUAGE plpgsql
AS $$
DECLARE
  tpl        RECORD;
  spawned    integer := 0;
  v_dow      integer;
  v_should   boolean;
  v_last_day integer;
BEGIN
  v_dow := EXTRACT(DOW FROM p_date)::int; -- 0 = Sunday .. 6 = Saturday

  FOR tpl IN
    SELECT * FROM task_template WHERE active = true
  LOOP
    v_should := false;

    IF tpl.recurrence = 'daily' THEN
      v_should := true;
    ELSIF tpl.recurrence = 'weekdays' THEN
      v_should := v_dow BETWEEN 1 AND 5;
    ELSIF tpl.recurrence = 'weekends' THEN
      v_should := v_dow IN (0, 6);
    ELSIF tpl.recurrence = 'weekly' THEN
      v_should := v_dow = tpl.recurrence_day_of_week;
    ELSIF tpl.recurrence = 'biweekly' THEN
      v_should := v_dow = tpl.recurrence_day_of_week
        AND MOD(FLOOR((p_date - COALESCE(tpl.recurrence_anchor_date, tpl.created_at::date)) / 7)::int, 2) = 0;
    ELSIF tpl.recurrence = 'monthly' THEN
      v_last_day := EXTRACT(DAY FROM (date_trunc('month', p_date) + interval '1 month - 1 day'))::int;
      v_should := EXTRACT(DAY FROM p_date)::int = LEAST(tpl.recurrence_day_of_month, v_last_day);
    ELSIF tpl.recurrence = 'yearly' THEN
      v_last_day := EXTRACT(DAY FROM (make_date(EXTRACT(YEAR FROM p_date)::int, tpl.recurrence_month, 1) + interval '1 month - 1 day'))::int;
      v_should := EXTRACT(MONTH FROM p_date)::int = tpl.recurrence_month
        AND EXTRACT(DAY FROM p_date)::int = LEAST(tpl.recurrence_day_of_month, v_last_day);
    END IF;

    -- Skip if instance already exists for this template + date
    IF v_should AND NOT EXISTS (
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

-- ── log_past_task() ────────────────────────────────────────────────────────────
-- Retroactive task logging ("I went to gym last night"). Creates the task
-- dated for a past day AND marks it completed, atomically, in one
-- transaction. Deliberately does NOT touch daily_state/streak/mandatory_met
-- (already locked in by that day's EOD rollover) and does NOT drain energy
-- (current capacity, not something a past action can retroactively cost).
-- App computes flat XP/gold with no streak multiplier before calling — see
-- rpgEngine.js and the comment in .migrations/008_retro_task_completion.sql.

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


-- ═══════════════════════════════════════════════════════════════════════════
-- ── SUPABASE-NATIVE CRON SCHEDULER ────────────────────────────────────────
-- Fires /cron/morning, /cron/eod, /cron/remind, /cron/cleanup, and /health
-- entirely from inside this database, on a schedule, via pg_cron + pg_net.
--
-- Why here instead of GitHub Actions: GitHub's scheduled workflows are a
-- shared queue across every GitHub user — under load, personal/free accounts
-- get delayed or dropped, sometimes by hours (measured directly on this
-- project: a daily cron landing 10-12h late, and a 14-minute health ping
-- actually firing every 8-13 *hours*). pg_cron is a background worker inside
-- this project's own dedicated Postgres instance, not competing with anyone
-- else's jobs — architecturally closer to a systemd timer than a shared
-- cloud scheduler. The GitHub Actions workflow equivalents of these jobs were
-- removed from the repo on 2026-08-29 after one of them (eod.yml) fired ~7
-- hours late and closed out a day only minutes after it began — keeping them
-- as a "harmless" backup turned out not to be harmless once this scheduler
-- was actually live. This is now the only trigger source.
--
-- The Render URL and CRON_SECRET live in Supabase Vault, not hardcoded into
-- the job SQL — that's what makes cron_trigger()/cron_ping_health() reusable
-- as-is for any deployment: only the two vault.create_secret() calls below
-- change per install, nothing else in this section does.
-- ═══════════════════════════════════════════════════════════════════════════

-- ▼▼▼ EDIT THESE TWO LINES for your own deployment before running ▼▼▼
-- render_url  = your own Render service URL (no trailing slash)
-- cron_secret = the same value you set as CRON_SECRET in Render's env vars
--
-- Guarded so re-running this file is safe — vault.create_secret() isn't
-- idempotent by name on its own, and a duplicate 'render_url'/'cron_secret'
-- would break the SELECT ... INTO lookups in cron_trigger() below.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM vault.decrypted_secrets WHERE name = 'render_url') THEN
    PERFORM vault.create_secret('https://your-name.onrender.com', 'render_url');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM vault.decrypted_secrets WHERE name = 'cron_secret') THEN
    PERFORM vault.create_secret('the-secret-you-set-in-render', 'cron_secret');
  END IF;
END $$;
-- ▲▲▲ ------------------------------------------------------------- ▲▲▲

-- Generic, reusable authenticated trigger — every /cron/* route needs the
-- same x-cron-secret header, so one function parameterized by path covers
-- morning/eod/remind/cleanup. Async (pg_net queues the request and returns
-- immediately) — cron jobs don't need to wait on the response.
CREATE OR REPLACE FUNCTION cron_trigger(p_path text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, vault, net
AS $$
DECLARE
  v_url    text;
  v_secret text;
BEGIN
  SELECT decrypted_secret INTO v_url    FROM vault.decrypted_secrets WHERE name = 'render_url';
  SELECT decrypted_secret INTO v_secret FROM vault.decrypted_secrets WHERE name = 'cron_secret';

  PERFORM net.http_post(
    url     := v_url || p_path,
    headers := jsonb_build_object('x-cron-secret', v_secret, 'Content-Type', 'application/json'),
    body    := '{}'::jsonb
  );
END;
$$;

-- Health ping has no auth — separate, simpler function.
CREATE OR REPLACE FUNCTION cron_ping_health()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, vault, net
AS $$
DECLARE
  v_url text;
BEGIN
  SELECT decrypted_secret INTO v_url FROM vault.decrypted_secrets WHERE name = 'render_url';
  PERFORM net.http_get(v_url || '/health');
END;
$$;

-- Canonical times, matching config/server.json's cron.*_utc values exactly.
-- No redundant offset-attempts needed here the way the GitHub Actions
-- workflows had — pg_cron isn't subject to the same external-queue
-- congestion those were compensating for.
select cron.schedule('render-health-ping', '*/10 * * * *', $$select cron_ping_health()$$);
select cron.schedule('render-morning',     '0 11 * * *',   $$select cron_trigger('/cron/morning')$$);
select cron.schedule('render-eod',         '0 3 * * *',    $$select cron_trigger('/cron/eod')$$);
select cron.schedule('render-remind',      '*/15 * * * *', $$select cron_trigger('/cron/remind')$$);
select cron.schedule('render-cleanup',     '0 3 * * 0',    $$select cron_trigger('/cron/cleanup')$$);

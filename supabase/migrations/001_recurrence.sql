-- ═══════════════════════════════════════════════════════════════════════════
-- Migration 001 — real recurrence cadences on task_template
-- Run this against an EXISTING Supabase project (one that already ran
-- schema.sql / functions.sql / seed.sql) to bring it up to date. A fresh
-- project created from the current schema.sql + functions.sql already has
-- this — do not run it there.
--
-- Before: task_template had no cadence at all — spawn_template_instances()
-- spawned every active template every single day. This adds real
-- daily / weekdays / weekends / weekly / biweekly / monthly / yearly cadences.
--
-- Existing template rows get recurrence = 'daily' by column default, which
-- exactly matches their current (only) behavior — no template's spawn
-- schedule changes as a result of running this.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. New columns on task_template ───────────────────────────────────────
ALTER TABLE task_template
  ADD COLUMN recurrence               text NOT NULL DEFAULT 'daily'
             CHECK (recurrence IN ('daily','weekdays','weekends','weekly','biweekly','monthly','yearly')),
  ADD COLUMN recurrence_day_of_week   int  CHECK (recurrence_day_of_week BETWEEN 0 AND 6),
  ADD COLUMN recurrence_day_of_month  int  CHECK (recurrence_day_of_month BETWEEN 1 AND 31),
  ADD COLUMN recurrence_month         int  CHECK (recurrence_month BETWEEN 1 AND 12),
  ADD COLUMN recurrence_anchor_date   date NOT NULL DEFAULT CURRENT_DATE;

ALTER TABLE task_template
  ADD CONSTRAINT recurrence_fields_check CHECK (
    (recurrence IN ('daily','weekdays','weekends')) OR
    (recurrence IN ('weekly','biweekly') AND recurrence_day_of_week IS NOT NULL) OR
    (recurrence = 'monthly' AND recurrence_day_of_month IS NOT NULL) OR
    (recurrence = 'yearly' AND recurrence_day_of_month IS NOT NULL AND recurrence_month IS NOT NULL)
  );

-- ── 2. Replace spawn_template_instances() with the cadence-aware version ───
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

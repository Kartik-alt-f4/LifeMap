-- ═══════════════════════════════════════════════════════════════════════════
-- Migration 006 — task.scheduled_at becomes a real timestamptz
-- Run this against an EXISTING Supabase project. A fresh project created from
-- the current schema.sql already has this — do not run it there.
--
-- Found via the anchor/mandatory long-lead reminder: the agent writes
-- scheduled_at as a naive "YYYY-MM-DDTHH:mm:ss" string with no timezone
-- marker ("3pm" meaning 3pm America/New_York, but nothing on the wire says
-- so). Stored in a timestamp-without-timezone column, re-parsed later with
-- JS's `new Date()`, that gets silently reinterpreted using whatever
-- timezone the *reading* process happens to be running in. It also meant the
-- reminder cron's SQL range comparisons (real UTC bounds vs EST-intended
-- naive digits) could select the wrong rows outright, not just display the
-- wrong countdown.
--
-- The USING clause reinterprets the existing naive digits as
-- America/New_York wall-clock time (matching how the agent actually writes
-- them — verified empirically) and converts to a correct UTC instant. Going
-- forward, api/src/dbAgent.js converts any naive scheduled_at through
-- dateUtils.estNaiveToUTC() before it's ever written, so this ambiguity
-- can't recur.
-- ═══════════════════════════════════════════════════════════════════════════

-- active_tasks (SELECT *) depends on this column — drop and recreate around
-- the type change, or the ALTER is rejected.
DROP VIEW IF EXISTS active_tasks;

ALTER TABLE task
  ALTER COLUMN scheduled_at TYPE timestamptz
  USING (scheduled_at AT TIME ZONE 'America/New_York');

CREATE OR REPLACE VIEW active_tasks AS
  SELECT * FROM task
  WHERE status NOT IN ('cancelled','skipped');

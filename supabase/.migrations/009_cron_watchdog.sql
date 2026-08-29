-- ═══════════════════════════════════════════════════════════════════════════
-- Migration 009 — cron watchdog (Discord warning if morning/EOD cron misses
-- its window by more than an hour)
-- Run this against an EXISTING Supabase project. A fresh project created from
-- the current schema.sql already has this — do not run it there.
--
-- daily_state.morning_ran/eod_ran are date-relative booleans that flip
-- meaning across the day boundary (see roll_daily_state() and cronJobs.js) —
-- not something a watchdog can safely compare against real clock time. These
-- new columns are plain "when did this last actually succeed" timestamps,
-- set once per real execution (never on an idempotency-skip), independent of
-- the date-rollover bookkeeping. The *_alert_sent_on columns store the date
-- (server.js's real UTC date) an alert was last sent, so a new day naturally
-- re-arms the check without any explicit reset step.
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE daily_state
  ADD COLUMN IF NOT EXISTS last_morning_run_at  timestamptz,
  ADD COLUMN IF NOT EXISTS last_eod_run_at       timestamptz,
  ADD COLUMN IF NOT EXISTS morning_alert_sent_on date,
  ADD COLUMN IF NOT EXISTS eod_alert_sent_on      date;

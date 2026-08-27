-- ═══════════════════════════════════════════════════════════════════════════
-- Migration 003 — roll_daily_state() takes its target date explicitly
-- Run this against an EXISTING Supabase project. A fresh project created from
-- the current schema.sql + functions.sql already has this — do not run it there.
--
-- Found via an end-to-end test of migration 002's carryover: daily_state.date
-- had drifted behind the real clock (cron missed a couple of days), and
-- roll_daily_state()'s own CURRENT_DATE + 1 disagreed with the date the app
-- had just carried tasks forward to — those tasks would have been stranded on
-- a date that never became "today". This makes both sides agree on the same
-- date instead of each independently deriving it.
-- ═══════════════════════════════════════════════════════════════════════════

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

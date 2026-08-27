-- ═══════════════════════════════════════════════════════════════════════════
-- Migration 005 — long-lead reminder for anchor/mandatory tasks
-- Run this against an EXISTING Supabase project. A fresh project created from
-- the current schema.sql already has this — do not run it there.
--
-- Adds a second reminder pass (~60-90 min before scheduled_at) for anchor and
-- mandatory tasks specifically, on top of the existing ~30-min reminder.
-- Needs its own tracking flag, separate from reminded_at, so a task can
-- receive both reminders without either blocking the other.
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE task
  ADD COLUMN early_reminded_at timestamptz;

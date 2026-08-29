-- ═══════════════════════════════════════════════════════════════════════════
-- Migration 004 — actually persist chat actions to conversation history
-- Run this against an EXISTING Supabase project. A fresh project created from
-- the current schema.sql already has this — do not run it there.
--
-- server.js (now chatHandler.js) always called saveExchange() with a 4th
-- `actions` argument, but sessionManager.saveExchange() only ever accepted 3
-- parameters — the actions array was silently dropped, never persisted.
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE conversation_message
  ADD COLUMN actions jsonb;

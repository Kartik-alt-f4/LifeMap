-- ═══════════════════════════════════════════════════════════════════════════
-- Migration 010 — Supabase-native cron scheduler (replaces GitHub Actions +
-- any external ping service as the reliability-critical trigger source)
--
-- Run this against an EXISTING Supabase project. A fresh project created from
-- the current schema.sql does NOT have this yet — see the note in schema.sql
-- once it's folded in there (tracked as a follow-up, along with removing the
-- GitHub Actions workflows once this has proven itself).
--
-- Why: GitHub Actions' scheduled workflows are a shared queue across every
-- GitHub user — under load, personal/free accounts get delayed or dropped,
-- sometimes by hours (measured directly: a daily cron landing 10-12h late,
-- and a */14-minute health ping actually firing every 8-13 HOURS instead).
-- pg_cron is a background worker inside this project's own dedicated
-- Postgres instance, not competing with anyone else's jobs — architecturally
-- closer to a systemd timer than a shared cloud scheduler.
--
-- Design: the Render URL and CRON_SECRET live in Supabase Vault, not
-- hardcoded into the job SQL — cron_trigger()/cron_ping_health() are fully
-- generic and reusable as-is. A future deployment (the "share with friends"
-- model — each friend runs their own Supabase project) only needs to swap
-- the two vault.create_secret() values below for their own; nothing else in
-- this file changes.
-- ═══════════════════════════════════════════════════════════════════════════

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Replace these two with the new deployment's own Render URL and CRON_SECRET
-- (the same value set on that Render service's CRON_SECRET env var).
select vault.create_secret('https://lifemap-b0ms.onrender.com', 'render_url');
select vault.create_secret('<your CRON_SECRET value>',          'cron_secret');

create or replace function cron_trigger(p_path text)
returns void
language plpgsql
security definer
set search_path = public, vault, net
as $$
declare
  v_url    text;
  v_secret text;
begin
  select decrypted_secret into v_url    from vault.decrypted_secrets where name = 'render_url';
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'cron_secret';

  perform net.http_post(
    url     := v_url || p_path,
    headers := jsonb_build_object('x-cron-secret', v_secret, 'Content-Type', 'application/json'),
    body    := '{}'::jsonb
  );
end;
$$;

create or replace function cron_ping_health()
returns void
language plpgsql
security definer
set search_path = public, vault, net
as $$
declare
  v_url text;
begin
  select decrypted_secret into v_url from vault.decrypted_secrets where name = 'render_url';
  perform net.http_get(v_url || '/health');
end;
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

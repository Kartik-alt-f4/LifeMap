# Setting up your own LifeMap

Everything a new deployment needs, in the order it actually has to happen —
what the in-app wizard already handles for you, and the couple of things it
can't.

## At a glance

| # | Step | |
|---|------|---|
| 1 | Create a Supabase project | **required** |
| 2 | Get a Gemini API key | **required** |
| 3 | Deploy to Render | **required** |
| 4 | Open your URL — Google sign-in, keys, schema push, all guided | **wizard** |
| 5 | Point the cron scheduler at your own server | **manual — 2 lines of SQL** |
| 6 | Connect Discord | optional |
| 7 | Enrich your stat descriptions | optional |

---

## 1. Create a Supabase project

Free tier is fine. Once it's created, go to **Settings → API** and note down
three things — you'll need all of them twice, once for Render and once for
the wizard:

| Value | Where |
|---|---|
| `Project URL` | Settings → API → Project URL |
| `anon public` key | Settings → API → Project API keys |
| `service_role` key | Settings → API → Project API keys *(secret — server only)* |

Then generate one more thing — **Account → Access Tokens → Generate new
token**. This is a personal access token (`sbp_...`), separate from the two
keys above. The setup wizard uses it once, to push the database schema for
you.

## 2. Get a Gemini API key

From [Google AI Studio](https://aistudio.google.com) — this is what runs the
chat agent and task descriptions. Free tier works, though it's rate-limited
(15 requests/minute) — fine for personal use.

## 3. Deploy to Render

No need to fork — the repo is public, and Render can deploy a Blueprint
(`render.yaml`) straight from it. Go to:

```
https://render.com/deploy?repo=https://github.com/Kartik-alt-f4/LifeMap
```

Render will read `render.yaml` (already set up — builds the web frontend and
starts the API automatically) and ask you to review the service before
creating it in *your own* Render account.

In the service's **Environment** tab, set:

| Key | Value |
|---|---|
| `SUPABASE_URL` | from step 1 |
| `SUPABASE_SERVICE_KEY` | `service_role` key from step 1 |
| `GOOGLE_API_KEY` | from step 2 |
| `CRON_SECRET` | any random string you choose — write it down, you'll need it again in step 5 |

Discord vars can wait — see step 6. Deploy, and wait for the service to go
live. Your URL will look like `https://your-name.onrender.com` — note it
down too.

> **Before you sign in in step 4:** Google sign-in only works on domains the
> shared LifeMap Firebase project has explicitly allowed. Send your Render
> URL to whoever's hosting that project — they'll add it to Firebase's
> Authorized domains list (a minute of work on their end). Signing in before
> that happens fails with an unauthorized-domain error.

## 4. Open your URL — the wizard takes it from here

Visit your Render URL. First run drops you into a guided setup:

1. **Sign in with Google.** This uses LifeMap's own shared sign-in — you're
   not setting up a separate Firebase project, just authenticating (assuming
   your Render domain's already been allowed, per the note in step 3).
2. **Paste your Gemini key** from step 2.
3. **Paste your Supabase details** — Project URL, personal access token,
   anon key, service role key, all from step 1. The wizard pushes the full
   schema, functions, and seed data into your project automatically here —
   no SQL editor needed for this part.
4. **Paste your Render URL** from step 3. This registers your account and
   triggers stat-embedding on your server automatically.

> **Handled for you:** schema + functions + seed data, stat embeddings, and
> account registration all happen without touching the Supabase SQL editor.
> That includes the whole reliability layer, too — `functions.sql` sets up a
> background job inside your own database that pings your server to keep it
> warm and fires the daily briefing, end-of-day rollup, reminders, and
> cleanup on schedule. Nothing external to set up, no third-party cron
> account.

## 5. Point the cron scheduler at your own server

> **The one thing the wizard can't fill in for you.** At the point in step 4
> where your Supabase schema gets pushed, the wizard doesn't yet know your
> Render URL — that's the *next* field you fill in. So the cron scheduler
> gets created pointed at a placeholder address, not your real one.

In the Supabase SQL editor, run this once — swap in your real Render URL and
the `CRON_SECRET` you picked in step 3:

```sql
select vault.update_secret(id, 'https://your-real-name.onrender.com')
  from vault.decrypted_secrets where name = 'render_url';
select vault.update_secret(id, 'the-secret-you-set-in-render')
  from vault.decrypted_secrets where name = 'cron_secret';
```

That's it — the same background job from step 4 now points at your actual
deployment.

## 6. Connect Discord — optional

Lets you manage tasks and get briefings without opening the web app.

1. At [discord.com/developers/applications](https://discord.com/developers/applications),
   create a new application
2. **Bot** → enable **Message Content Intent** → copy the token →
   `DISCORD_BOT_TOKEN`
3. Invite the bot to your server with message permissions
4. Right-click your target channel → **Copy Channel ID** →
   `DISCORD_CHANNEL_ID`
5. Channel settings → **Integrations → Webhooks** → create one →
   `DISCORD_WEBHOOK_URL`

Add all three as Render environment variables and redeploy.

## 7. Enrich your stat descriptions — optional, but worth it

Stats ship with generic descriptions. Task→stat matching gets noticeably
better once you make them specific to how *you'd* describe the activities
that belong to each one. **Settings → Stat descriptions** in the web UI —
edit, hit **Save & re-embed**, no script needed.

---

## What you don't need to touch

GitHub Actions secrets, a separate Firebase project, manually seeding stat
embeddings via script, or running anything from `supabase/.migrations/` — all
either automated by the wizard now or no longer load-bearing. There's no
GitHub Actions cron at all anymore — the Supabase-native scheduler set up in
step 4 is the only trigger source, and it's what actually keeps things
reliable.

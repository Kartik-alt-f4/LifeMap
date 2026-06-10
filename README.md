# Life Map v2

A personal RPG task manager. Complete tasks, earn XP and gold, track stats and skills via embedding-based projection. Talk to it in plain English.

**Stack:** Node.js + Express · Supabase (Postgres + pgvector) · Gemini API · React + Vite · Discord bot · GitHub Actions cron

---

## Prerequisites

- Node.js 20+
- A [Supabase](https://supabase.com) project (free tier works)
- A [Google AI Studio](https://aistudio.google.com) API key (Gemini)
- A [Render](https://render.com) account (free tier works)
- A GitHub account (for cron jobs via Actions)

Discord is optional but recommended for mobile access without the app.

---

## 1. Database setup

Open the Supabase SQL editor for your project and run these three files **in order**:

```
supabase/schema.sql
supabase/functions.sql
supabase/seed.sql
```

Each file has a comment at the top confirming the run order.

---

## 2. Local setup

```bash
git clone https://github.com/YOUR_USERNAME/LifeMap.git
cd LifeMap/api
npm install
```

Copy the example env file and fill in your values:

```bash
cp .env.example .env
```

```env
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_KEY=your-service-role-key
GOOGLE_API_KEY=your-google-ai-studio-key
CRON_SECRET=any-random-string-you-choose
```

Discord vars are optional — leave blank if skipping:

```env
DISCORD_BOT_TOKEN=
DISCORD_WEBHOOK_URL=
DISCORD_CHANNEL_ID=
```

---

## 3. Seed stat embeddings

This generates embedding vectors for the 6 stats (Strength, Vitality, etc.) so task→stat projection works. Run once after setup, and again any time you edit stat descriptions in Settings.

```bash
# Must be run from inside the api/ folder
cd api
node ../scripts/embed-seed.js
```

Expected output: 6 stats embedded, each showing `✅ (3072d)`.

---

## 4. Run locally

```bash
cd api
node src/server.js
```

The web UI is served at `http://localhost:3001`. The React app proxies API calls through Vite in dev:

```bash
cd web
npm install
npm run dev   # http://localhost:5173
```

> In dev, run both the API (`node src/server.js`) and Vite (`npm run dev`) concurrently.

---

## 5. Build the web frontend

Before deploying, build the frontend so the API can serve it as static files:

```bash
cd web
npm install
npm run build   # outputs to web/dist/
```

The Express server at `api/src/server.js` serves `web/dist/` automatically.

---

## 6. Deploy to Render

### 6a. Push to GitHub

Make sure your repo is pushed to GitHub with the latest files, including `web/dist/` — or configure Render to build it.

To have Render build the frontend automatically, update `render.yaml`:

```yaml
buildCommand: npm install && cd ../web && npm install && npm run build
```

### 6b. Connect to Render

1. Go to [render.com](https://render.com) → **New** → **Blueprint**
2. Connect your GitHub repo
3. Render will detect `render.yaml` and create the service automatically

### 6c. Set environment variables

In the Render dashboard for your service → **Environment**, add:

| Key | Value |
|-----|-------|
| `SUPABASE_URL` | Your Supabase project URL |
| `SUPABASE_SERVICE_KEY` | Your Supabase service role key |
| `GOOGLE_API_KEY` | Your Google AI Studio key |
| `CRON_SECRET` | The same random string from your `.env` |
| `DISCORD_BOT_TOKEN` | *(optional)* |
| `DISCORD_WEBHOOK_URL` | *(optional)* |
| `DISCORD_CHANNEL_ID` | *(optional)* |

### 6d. Verify deployment

Once deployed, your service URL will look like `https://lifemap.onrender.com`. Test it:

```bash
curl https://your-app.onrender.com/health
# → {"status":"ok"}

curl https://your-app.onrender.com/state
# → {"level":1,"current_xp":0,...}
```

---

## 7. GitHub Actions (cron jobs)

The workflows in `.github/workflows/` handle morning briefings, EOD summaries, task reminders, and server keepalive pings. They need two secrets.

Go to your GitHub repo → **Settings** → **Secrets and variables** → **Actions** → **New repository secret**:

| Secret | Value |
|--------|-------|
| `SERVER_URL` | Your Render URL, e.g. `https://lifemap.onrender.com` |
| `CRON_SECRET` | The same string you set in Render env vars |

### What each workflow does

| Workflow | Schedule | Purpose |
|----------|----------|---------|
| `health.yml` | Every 14 min | Keeps Render free tier from sleeping |
| `morning.yml` | 11:00 UTC (6am EST) | Spawns today's tasks, sends briefing |
| `eod.yml` | 03:00 UTC (10pm EST) | Closes the day, updates streak, snapshots |
| `remind.yml` | Every 15 min | Pings for tasks due soon |
| `cleanup.yml` | Weekly Sunday | Purges old conversation sessions |

> To change cron times, edit the `cron:` field in each `.yml` file. Times are in UTC.

---

## 8. Discord setup (optional)

Discord lets you manage tasks and receive briefings without opening the web app.

1. Go to [discord.com/developers/applications](https://discord.com/developers/applications) → **New Application**
2. Go to **Bot** → enable **Message Content Intent**
3. Copy the bot token → set as `DISCORD_BOT_TOKEN`
4. Invite the bot to your server with message permissions
5. Right-click your target channel → **Copy Channel ID** → set as `DISCORD_CHANNEL_ID`
6. Channel settings → **Integrations** → **Webhooks** → create one → set URL as `DISCORD_WEBHOOK_URL`

---

## 9. Stat descriptions (improves task→stat matching)

Out of the box, stats have generic descriptions. After some usage you'll want to enrich them so the embedding-based projection is more accurate.

Open **Settings → Stat descriptions** in the web UI. Edit each stat to be specific about what activities belong to it. For example:

- **Charisma:** *Communication, social skills, music, performance arts, influence, public speaking, creative expression*
- **Strength:** *Weightlifting, resistance training, physical labour, gym workouts, sports*

Hit **Save & re-embed** — the server regenerates embedding vectors automatically. No script needed.

---

## 10. Resetting data

```bash
cd api

# Soft reset — clears tasks, XP, gold, streak. Keeps stat/skill definitions.
node ../scripts/reset.js

# Hard reset — also clears skill XP, stat values, projection maps.
node ../scripts/reset.js --hard
```

---

## Project structure

```
lifemap/
├── .github/workflows/    Cron job definitions (GitHub Actions)
├── api/
│   ├── src/
│   │   ├── server.js         Express app + all routes
│   │   ├── agentPipeline.js  Gemini agent (single-call JSON output)
│   │   ├── actionExecutor.js Executes agent actions against DB
│   │   ├── dbAgent.js        All database reads and writes
│   │   ├── projectionEngine.js  Embedding-based skill/stat XP
│   │   ├── rpgEngine.js      XP, gold, level, streak calculations
│   │   ├── scheduleEngine.js Conflict detection and resolution
│   │   ├── cronJobs.js       Morning, EOD, remind, cleanup handlers
│   │   ├── sessionManager.js Conversation history
│   │   ├── configLoader.js   Loads game.json, agent.json, server.json
│   │   ├── discordBot.js     Discord gateway + webhook
│   │   └── supabaseClient.js Supabase client singleton
│   ├── .env.example
│   └── package.json
├── config/
│   ├── game.json    RPG mechanics (XP, gold, energy, ranks, stats)
│   ├── agent.json   Agent persona and scheduling behaviour
│   └── server.json  Server, model, session, notification settings
├── mobile/          React Native + Expo (in progress)
├── scripts/
│   ├── setup.js     Interactive setup wizard
│   ├── embed-seed.js  Seeds stat embedding vectors
│   └── reset.js     Wipes user data (soft or hard)
├── supabase/
│   ├── schema.sql   Database schema (single source of truth)
│   ├── functions.sql  Postgres functions (complete_task, buy_item, etc.)
│   └── seed.sql     Initial data (player, stats, shop items)
├── web/             React + Vite frontend
└── render.yaml      Render deployment config
```

---

## Forking for personal use

1. Fork the repo
2. Create your own Supabase project and run the SQL files
3. Get a Google AI Studio key
4. Run `embed-seed.js` to generate stat embeddings
5. Deploy to Render and set env vars
6. Add GitHub secrets for cron jobs
7. Open Settings and enrich stat descriptions for better tracking

All game mechanics (XP values, energy, ranks, skill thresholds) are editable in `config/game.json` or via the Settings page. No code changes needed for tuning.

# Life Map v2

A personal RPG task manager. Complete tasks, earn XP and gold, track stats and skills via embedding-based projection. Talk to it in plain English.

**Stack:** Node.js + Express · Supabase (Postgres + pgvector, incl. native `pg_cron`) · Gemini API · React + Vite · Discord bot

---

## Prerequisites

- Node.js 20+
- A [Supabase](https://supabase.com) project (free tier works)
- A [Google AI Studio](https://aistudio.google.com) API key (Gemini)
- A [Render](https://render.com) account (free tier works)

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

## 7. Cron (morning briefings, EOD, reminders, cleanup)

Handled by a Supabase-native scheduler (`pg_cron` + `pg_net`), set up automatically as
part of `functions.sql` — no GitHub Actions, no third-party cron account. See
[SETUP.md](SETUP.md) steps 4-5 for the full walkthrough, including the one manual step
(pointing it at your own Render URL/`CRON_SECRET` via two `vault.update_secret(...)`
calls).

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

## Deploying your own

See [SETUP.md](SETUP.md) for the full walkthrough — no fork needed, Render can deploy
this repo's Blueprint directly.

All game mechanics (XP values, energy, ranks, skill thresholds) are editable in `config/game.json` or via the Settings page. No code changes needed for tuning.


---

## Changelog — recent additions

### Leisure tracking
- `shop_item` now has a `tracking_unit` field: `none`, `count`, `minutes`, `boolean`
- New `leisure_log` table records usage — written automatically on purchase, or manually via `+` button (mobile/web) or chat (`"smoked 3"`, `"gamed 90 minutes"`)
- EOD cron writes a `leisure_summary` JSON blob into `daily_snapshot` for future graph plotting
- Agent understands `log_leisure` action — infers item from context, quantity from message

### Day Off+
- New shop item type: `day_off_plus` — sets `mandatory_met`, `day_off_granted`, and `free_leisure_today`
- When `free_leisure_today` is true, all leisure item purchases skip gold deduction
- Web navbar and mobile Today screen show a green `DAY OFF` / `DAY OFF+` badge
- `free_leisure_today` resets at EOD with `roll_daily_state()`

### Graphs page (web)
- New Graphs modal in the web navbar — shows XP, streak, gold, energy, tasks completed/skipped over time
- Uses `/snapshots` endpoint — data populated by EOD cron, nothing to configure
- Range selector: 7d, 14d, 30d, 90d

### Mobile updates
- Date navigation on Today screen — arrows to browse past/future days
- Profile screen has a ⚙ Settings button (top right)
- Shop screen shows today's leisure usage count per item
- Task drawer shows description and full edit fields including schedule and recurring

### Reset script
- Now clears `leisure_log` table
- Resets `free_leisure_today: false` in daily state
- Run: `cd api && node ../scripts/reset.js [--hard]`

### Agent improvements
- `create_shop_item` action — *"add a shop item called Netflix for 10 gold"*
- `log_leisure` action — *"smoked 3"*, *"watched 2 episodes"*, *"gamed for 90 minutes"*
- Discord bot now passes original message to `generateDescription` (context-aware descriptions)
- `PATCH /skills/:id` — edit skill name and description from Profile screen
-- ═══════════════════════════════════════════════════════════════════════════
-- Life Map v2 — schema.sql
-- Single source of truth. Run against a fresh Supabase project.
-- After running this file, run functions.sql then seed.sql.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── EXTENSIONS ───────────────────────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pgcrypto;


-- ── PLAYER STATE (single row, id = 1) ────────────────────────────────────────
CREATE TABLE player (
  id             int     PRIMARY KEY CHECK (id = 1),
  current_xp     int     NOT NULL DEFAULT 0,
  current_level  int     NOT NULL DEFAULT 1,
  xp_to_next     int     NOT NULL DEFAULT 100,
  total_gold     int     NOT NULL DEFAULT 0,
  available_gold int     NOT NULL DEFAULT 0
);

CREATE TABLE energy_state (
  id              int     PRIMARY KEY CHECK (id = 1),
  current         int     NOT NULL DEFAULT 100,
  max             int     NOT NULL DEFAULT 100,
  threshold_label text    NOT NULL DEFAULT 'normal'
                          CHECK (threshold_label IN ('normal','reduced','min_viable','recovery')),
  last_updated    timestamp NOT NULL DEFAULT now()
);

CREATE TABLE daily_state (
  id                int     PRIMARY KEY CHECK (id = 1),
  date              date    NOT NULL DEFAULT CURRENT_DATE,
  mandatory_met     bool    NOT NULL DEFAULT false,
  day_streak        int     NOT NULL DEFAULT 0,
  streak_multiplier float   NOT NULL DEFAULT 1.0,
  morning_ran       bool    NOT NULL DEFAULT false,
  eod_ran           bool    NOT NULL DEFAULT false,
  day_off_granted   bool    NOT NULL DEFAULT false
);


-- ── RECURRING TASK TEMPLATES ──────────────────────────────────────────────────
-- Defines what recurring tasks exist. Instances are spawned from these daily.
CREATE TABLE task_template (
  id          serial  PRIMARY KEY,
  title       text    NOT NULL,
  description text,
  task_type   text    NOT NULL
              CHECK (task_type IN ('anchor','mandatory','project','bonus','habit','routine')),
  priority    text    NOT NULL DEFAULT 'P2'
              CHECK (priority IN ('P0','P1','P2','P3')),
  difficulty  text    NOT NULL DEFAULT 'medium'
              CHECK (difficulty IN ('low','medium','high')),
  time_block  text
              CHECK (time_block IN ('morning','noon','evening','night','midnight')),
  is_recovery bool    NOT NULL DEFAULT false,
  active      bool    NOT NULL DEFAULT true,
  created_at  timestamp NOT NULL DEFAULT now()
);


-- ── TASKS (daily instances + one-off tasks) ───────────────────────────────────
-- template_id is NULL for one-off tasks added manually or by the agent.
-- scheduled_for is the date this task belongs to.
CREATE TABLE task (
  id                serial      PRIMARY KEY,
  template_id       int         REFERENCES task_template(id) ON DELETE SET NULL,
  title             text        NOT NULL,
  description       text,
  task_type         text        NOT NULL
                    CHECK (task_type IN ('anchor','mandatory','project','bonus','habit','routine')),
  priority          text        NOT NULL DEFAULT 'P2'
                    CHECK (priority IN ('P0','P1','P2','P3')),
  difficulty        text        NOT NULL DEFAULT 'medium'
                    CHECK (difficulty IN ('low','medium','high')),
  time_block        text
                    CHECK (time_block IN ('morning','noon','evening','night','midnight')),
  scheduled_for     date        NOT NULL DEFAULT CURRENT_DATE,
  scheduled_at      timestamp,
  status            text        NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending','active','completed','skipped','cancelled')),
  is_recovery       bool        NOT NULL DEFAULT false,
  late_multiplier   float       NOT NULL DEFAULT 1.0,
  embedding_vector  vector(3072),
  projection_status text        NOT NULL DEFAULT 'pending'
                    CHECK (projection_status IN ('pending','done','failed')),
  reminded_at       timestamptz,
  completed_at      timestamp,
  created_at        timestamp   NOT NULL DEFAULT now()
);

-- Index: quickly find today's tasks
CREATE INDEX task_scheduled_for_idx ON task(scheduled_for, status);
-- Index: find tasks pending projection after completion
CREATE INDEX task_projection_idx ON task(projection_status) WHERE status = 'completed';
-- Index: find tasks to remind
CREATE INDEX task_remind_idx ON task(reminded_at, scheduled_at) WHERE status = 'pending';
-- Index: find instances from a template
CREATE INDEX task_template_idx ON task(template_id, scheduled_for);


-- ── STATS (fixed categories, seeded once) ─────────────────────────────────────
-- Definitions come from game.json. Rows are seeded in seed.sql.
-- embedding_vector populated by embed-seed.js on first setup.
CREATE TABLE stat (
  id               serial      PRIMARY KEY,
  name             text        NOT NULL UNIQUE,
  description      text        NOT NULL,
  current_value    float       NOT NULL DEFAULT 0 CHECK (current_value >= 0 AND current_value <= 100),
  current_streak   int         NOT NULL DEFAULT 0,
  embedding_vector vector(3072)
);


-- ── SKILLS (grow dynamically from task patterns) ──────────────────────────────
CREATE TABLE skill (
  id               serial      PRIMARY KEY,
  parent_skill_id  int         REFERENCES skill(id) ON DELETE SET NULL,
  origin_task_id   int         REFERENCES task(id) ON DELETE SET NULL,
  name             text        NOT NULL,
  description      text        NOT NULL,
  is_dynamic       bool        NOT NULL DEFAULT true,
  current_xp       int         NOT NULL DEFAULT 0,
  current_level    int         NOT NULL DEFAULT 0,
  xp_to_next       int         NOT NULL DEFAULT 50,
  current_streak   int         NOT NULL DEFAULT 0,
  centroid_vector  vector(3072),
  created_at       timestamp   NOT NULL DEFAULT now()
);


-- ── SKILL CANDIDATE CLUSTERS ──────────────────────────────────────────────────
-- Tasks accumulate in clusters. When threshold hit, cluster graduates to a skill.
CREATE TABLE skill_candidate (
  id                   serial      PRIMARY KEY,
  task_id              int         NOT NULL REFERENCES task(id) ON DELETE CASCADE,
  cluster_id           uuid        NOT NULL DEFAULT gen_random_uuid(),
  parent_skill_id      int         REFERENCES skill(id) ON DELETE SET NULL,
  distance_to_centroid float       NOT NULL,
  cluster_centroid     vector(3072),
  status               text        NOT NULL DEFAULT 'pending'
                       CHECK (status IN ('pending','graduated','dismissed')),
  created_at           timestamp   NOT NULL DEFAULT now()
);

CREATE INDEX skill_candidate_cluster_idx ON skill_candidate(cluster_id);
CREATE INDEX skill_candidate_parent_idx  ON skill_candidate(parent_skill_id);


-- ── JOIN TABLES ───────────────────────────────────────────────────────────────
CREATE TABLE task_skill (
  task_id          int   NOT NULL REFERENCES task(id) ON DELETE CASCADE,
  skill_id         int   NOT NULL REFERENCES skill(id) ON DELETE CASCADE,
  similarity_score float NOT NULL,
  PRIMARY KEY (task_id, skill_id)
);

CREATE TABLE task_stat (
  task_id          int   NOT NULL REFERENCES task(id) ON DELETE CASCADE,
  stat_id          int   NOT NULL REFERENCES stat(id) ON DELETE CASCADE,
  similarity_score float NOT NULL,
  PRIMARY KEY (task_id, stat_id)
);

CREATE INDEX task_skill_skill_idx ON task_skill(skill_id);
CREATE INDEX task_stat_stat_idx   ON task_stat(stat_id);


-- ── LEDGERS (append-only) ─────────────────────────────────────────────────────
CREATE TABLE xp_ledger (
  id                        serial    PRIMARY KEY,
  source_task_id            int       REFERENCES task(id) ON DELETE RESTRICT,
  amount                    float     NOT NULL,
  target_type               text      NOT NULL CHECK (target_type IN ('player','skill','stat')),
  target_id                 int,
  streak_multiplier_applied float     NOT NULL DEFAULT 1.0,
  crossover_type            text      CHECK (crossover_type IN ('direct','partial','indirect')),
  timestamp                 timestamp NOT NULL DEFAULT now(),
  CONSTRAINT xp_target_check CHECK (
    (target_type = 'player' AND target_id IS NULL) OR
    (target_type != 'player' AND target_id IS NOT NULL)
  )
);

ALTER TABLE xp_ledger ENABLE ROW LEVEL SECURITY;
CREATE POLICY xp_no_update ON xp_ledger FOR UPDATE USING (false);
CREATE POLICY xp_no_delete ON xp_ledger FOR DELETE USING (false);

CREATE INDEX xp_ledger_target_idx    ON xp_ledger(target_type, target_id);
CREATE INDEX xp_ledger_timestamp_idx ON xp_ledger(timestamp);

CREATE TABLE gold_ledger (
  id             serial    PRIMARY KEY,
  source_task_id int       REFERENCES task(id) ON DELETE RESTRICT,
  amount         int       NOT NULL,
  direction      text      NOT NULL CHECK (direction IN ('credit','debit')),
  reason         text      NOT NULL,
  timestamp      timestamp NOT NULL DEFAULT now()
);

ALTER TABLE gold_ledger ENABLE ROW LEVEL SECURITY;
CREATE POLICY gold_no_update ON gold_ledger FOR UPDATE USING (false);
CREATE POLICY gold_no_delete ON gold_ledger FOR DELETE USING (false);

CREATE INDEX gold_ledger_direction_idx  ON gold_ledger(direction);
CREATE INDEX gold_ledger_timestamp_idx  ON gold_ledger(timestamp);


-- ── SHOP ─────────────────────────────────────────────────────────────────────
CREATE TABLE shop_item (
  id          serial  PRIMARY KEY,
  name        text    NOT NULL,
  description text    NOT NULL,
  cost_gold   int     NOT NULL CHECK (cost_gold > 0),
  type        text    NOT NULL CHECK (type IN ('leisure','day_off')),
  active      bool    NOT NULL DEFAULT true
);

CREATE TABLE purchase_log (
  id           serial    PRIMARY KEY,
  shop_item_id int       NOT NULL REFERENCES shop_item(id) ON DELETE RESTRICT,
  gold_spent   int       NOT NULL,
  purchased_at timestamp NOT NULL DEFAULT now()
);

ALTER TABLE purchase_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY purchase_no_update ON purchase_log FOR UPDATE USING (false);
CREATE POLICY purchase_no_delete ON purchase_log FOR DELETE USING (false);


-- ── DAILY SNAPSHOT ────────────────────────────────────────────────────────────
CREATE TABLE daily_snapshot (
  id              serial    PRIMARY KEY,
  date            date      NOT NULL UNIQUE,
  level           int,
  current_xp      int,
  total_gold      int,
  available_gold  int,
  day_streak      int,
  energy          int,
  mandatory_met   bool,
  tasks_completed int,
  tasks_skipped   int,
  created_at      timestamp NOT NULL DEFAULT now()
);


-- ── CONVERSATION HISTORY ──────────────────────────────────────────────────────
CREATE TABLE conversation_session (
  id          serial    PRIMARY KEY,
  session_key text      NOT NULL UNIQUE,
  updated_at  timestamp NOT NULL DEFAULT now(),
  created_at  timestamp NOT NULL DEFAULT now()
);

CREATE TABLE conversation_message (
  id          serial    PRIMARY KEY,
  session_id  int       NOT NULL REFERENCES conversation_session(id) ON DELETE CASCADE,
  order_index int       NOT NULL,
  role        text      NOT NULL CHECK (role IN ('user','model')),
  content     text      NOT NULL,
  created_at  timestamp NOT NULL DEFAULT now()
);

CREATE INDEX conversation_session_idx  ON conversation_session(updated_at);
CREATE INDEX conversation_message_idx  ON conversation_message(session_id, order_index);


-- ── PUSH NOTIFICATIONS ────────────────────────────────────────────────────────
-- Single row — one user, one device token (or null if not registered)
CREATE TABLE push_token (
  id         int  PRIMARY KEY CHECK (id = 1),
  token      text,
  platform   text CHECK (platform IN ('ios','android')),
  updated_at timestamp DEFAULT now()
);


-- ── PERMISSIONS ───────────────────────────────────────────────────────────────
GRANT ALL ON ALL TABLES    IN SCHEMA public TO service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO service_role;
GRANT ALL ON ALL TABLES    IN SCHEMA public TO anon;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO anon;
GRANT ALL ON ALL TABLES    IN SCHEMA public TO authenticated;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO authenticated;


-- ── VIEW: today's active tasks ────────────────────────────────────────────────
CREATE OR REPLACE VIEW active_tasks AS
  SELECT * FROM task
  WHERE status NOT IN ('cancelled','skipped');
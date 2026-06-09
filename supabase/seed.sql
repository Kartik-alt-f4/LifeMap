-- ═══════════════════════════════════════════════════════════════════════════
-- Life Map v2 — seed.sql
-- Run after functions.sql.
-- Seeds: player, energy_state, daily_state, push_token, stats, shop_items.
-- Stats here must match definitions in config/game.json stats.definitions.
-- embedding_vector intentionally NULL — populated by scripts/embed-seed.js
-- ═══════════════════════════════════════════════════════════════════════════

-- Singleton rows
INSERT INTO player (id) VALUES (1);
INSERT INTO energy_state (id) VALUES (1);
INSERT INTO daily_state (id) VALUES (1);
INSERT INTO push_token (id) VALUES (1);

-- Stats (6 fixed categories — descriptions must match game.json)
INSERT INTO stat (name, description) VALUES
  ('Strength',     'Physical power and endurance'),
  ('Vitality',     'Health, recovery, and resilience'),
  ('Agility',      'Speed, reflexes, and adaptability'),
  ('Intelligence', 'Learning, reasoning, and problem solving'),
  ('Willpower',    'Discipline, focus, and mental strength'),
  ('Charisma',     'Communication, influence, and presence');

-- Shop items (defaults — user can add more via settings or agent)
INSERT INTO shop_item (name, description, cost_gold, type) VALUES
  ('YouTube Evening', '1 hour of guilt-free YouTube',           10, 'leisure'),
  ('Gaming Session',  '1 hour of gaming, no guilt',             15, 'leisure'),
  ('Day Off',         'Mandatory met, treat it as a rest day',  30, 'day_off');


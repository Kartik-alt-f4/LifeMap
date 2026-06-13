-- ═══════════════════════════════════════════════════════════════════════════
-- Life Map v2 — seed.sql (updated to match live schema)
-- Run after schema.sql + functions.sql
-- ═══════════════════════════════════════════════════════════════════════════

-- Singleton rows
INSERT INTO player (id) VALUES (1);
INSERT INTO energy_state (id) VALUES (1);
INSERT INTO daily_state (id) VALUES (1);
INSERT INTO push_token (id) VALUES (1);

-- Stats (6 fixed categories)
INSERT INTO stat (name, description) VALUES
  ('Strength',     'Physical power, endurance, and athletic performance. Covers gym work, sports, manual labour, and physical training.'),
  ('Vitality',     'Health, recovery, sleep, nutrition, and overall wellbeing. Covers medical, rest, diet, and self-care tasks.'),
  ('Agility',      'Speed, reflexes, adaptability, and coordination. Covers fast-paced tasks, context switching, and quick execution.'),
  ('Intelligence', 'Learning, reasoning, research, and problem solving. Covers study, reading, coding, analysis, and creative thinking.'),
  ('Willpower',    'Discipline, focus, consistency, and mental strength. Covers deep work, habits, resisting distraction, and hard tasks.'),
  ('Charisma',     'Communication, influence, relationships, and presence. Covers social tasks, writing, presenting, and networking.');

-- Shop items (defaults with tracking_unit)
INSERT INTO shop_item (name, description, cost_gold, type, tracking_unit) VALUES
  ('YouTube Evening', '1 hour of guilt-free YouTube',          10, 'leisure',      'minutes'),
  ('Gaming Session',  '1 hour of gaming, no guilt',            15, 'leisure',      'minutes'),
  ('Takeout',         'Order whatever you want, no guilt',     20, 'leisure',      'boolean'),
  ('Day Off',         'Mandatory met, treat it as a rest day', 30, 'day_off',      'none'),
  ('Day Off+',        'Day off with all leisure free today',   50, 'day_off_plus', 'none');
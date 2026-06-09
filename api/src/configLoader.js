import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const CONFIG_DIR = path.join(__dirname, '../../config')

let _config = null

// ── Load all three config files ───────────────────────────────────────────────
export function loadConfig() {
  const files = { game: 'game.json', agent: 'agent.json', server: 'server.json' }
  _config = {}
  for (const [key, filename] of Object.entries(files)) {
    const filePath = path.join(CONFIG_DIR, filename)
    try {
      _config[key] = JSON.parse(fs.readFileSync(filePath, 'utf8'))
    } catch (err) {
      if (err.code === 'ENOENT') throw new Error(`Config file missing: ${filename}`)
      throw new Error(`Invalid JSON in ${filename}: ${err.message}`)
    }
  }
  return _config
}

// ── Reload from disk (called by POST /config after a write) ──────────────────
export function reloadConfig() {
  _config = null
  return loadConfig()
}

// ── Accessors ─────────────────────────────────────────────────────────────────
export function getConfig() {
  if (!_config) throw new Error('loadConfig() must be called before getConfig()')
  return _config
}

export function getGame()   { return getConfig().game   }
export function getAgent()  { return getConfig().agent  }
export function getServer() { return getConfig().server }

// ── System prompt (built from agent.json) ────────────────────────────────────
export function buildSystemPrompt() {
  const { persona, scheduling, inference, output_schema } = getAgent()

  return `You are ${persona.name}.
Tone: ${persona.tone}

PRIORITY ORDER (highest to lowest): ${scheduling.priority_order.join(' → ')}

TIME BLOCKS: ${Object.entries(scheduling.time_blocks)
    .map(([name, t]) => `${name}(${t.start}-${t.end})`).join(', ')}

CONFLICT RULE: ${scheduling.conflict_resolution}. Equal priority: ${scheduling.equal_priority_resolution}.
Max tasks per block: ${scheduling.max_tasks_per_block}.

TASK TYPE INFERENCE:
${Object.entries(inference.type_rules).map(([t, r]) => `- ${t}: ${r}`).join('\n')}

RECOVERY KEYWORDS (set is_recovery=true if task title contains these):
${inference.recovery_keywords.join(', ')}

DIFFICULTY INFERENCE:
${Object.entries(inference.difficulty_rules).map(([d, r]) => `- ${d}: ${r}`).join('\n')}

REPLY TEMPLATES (use these exact formats, fill placeholders):
${Object.entries(persona.reply_templates).map(([k, v]) => `- ${k}: "${v}"`).join('\n')}

OUTPUT: Respond ONLY with valid JSON. No markdown, no explanation, no preamble.
Schema:
{
  "intent": "add_task|complete_task|skip_task|cancel_task|query|chat",
  "reply": "string shown to user",
  "needs_clarification": false,
  "clarification_question": null,
  "actions": []
}

Action types and their required fields:
create_task:    { title, task_type, priority, difficulty, time_block, scheduled_at(ISO|null), is_recovery, is_recurring, recurrence_days(array|null) }
create_template:{ title, task_type, priority, difficulty, time_block, is_recovery }
complete_task:  { task_id }
skip_task:      { task_id }
cancel_task:    { task_id }
move_task:      { task_id, new_time_block }
edit_task:      { task_id, fields(object with changed fields only) }
`
}

// ── Rank from level ───────────────────────────────────────────────────────────
export function getRank(level) {
  const ranks = getGame().player.ranks
  const eligible = ranks.filter(r => r.level <= level)
  return eligible.length ? eligible[eligible.length - 1].title : ranks[0].title
}

// ── Write a config section (used by settings page) ────────────────────────────
export function writeConfigSection(file, section, value) {
  const allowed = ['game', 'agent', 'server']
  if (!allowed.includes(file)) throw new Error(`Unknown config file: ${file}`)

  const filePath = path.join(CONFIG_DIR, `${file}.json`)
  const current = JSON.parse(fs.readFileSync(filePath, 'utf8'))

  if (!section) {
    // Replace entire file (validated by caller)
    fs.writeFileSync(filePath, JSON.stringify(value, null, 2))
  } else {
    // Replace specific top-level section
    current[section] = value
    fs.writeFileSync(filePath, JSON.stringify(current, null, 2))
  }

  reloadConfig()
}

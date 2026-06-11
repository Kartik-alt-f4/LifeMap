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
  const { persona, scheduling, inference } = getAgent()
  const { tasks: taskCfg } = getGame()

  return `You are ${persona.name}. Tone: ${persona.tone}

RULES (follow strictly):
- NO CONFIRM STEP. Act immediately on first message. Never ask "shall I add this?" or "want me to create?".
- If the user says "yes", "ok", "sure", "do it" — they are confirming something from OUTSIDE this context. Reply: "Not sure what to confirm. Try rephrasing."
- INFER everything: type, priority, difficulty, time_block, is_recovery. Never ask.
- ONE LINE REPLY per action. No questions after success.
- DUPLICATE GUARD: before creating, check TODAY_TASKS. If same title exists, say so instead of creating again.
- Use TODAY_TASKS task IDs for edits/completions/skips.
- For edits: use edit_task with task_id from TODAY_TASKS and only changed fields.
- DATE: always use the DATE/TOMORROW values from [STATE]. Never guess dates.

XP REWARDS: ${JSON.stringify(taskCfg.xp_base)}
GOLD REWARDS (base by type): ${JSON.stringify(taskCfg.gold_base)}
GOLD DIFFICULTY OFFSET: ${JSON.stringify(taskCfg.difficulty_gold_offset)}

TASK TYPES (infer from context):
${Object.entries(inference.type_rules).map(([t,r]) => `  ${t}: ${r}`).join('\n')}

PRIORITY ORDER (high to low): ${scheduling.priority_order.join(' > ')}
VALID PRIORITIES: P0, P1, P2, P3 only. P4 does not exist — use P3 for lowest priority.

TIME BLOCKS: ${Object.entries(scheduling.time_blocks).map(([n,t]) => `${n}(${t.start}-${t.end})`).join(', ')}

TIME INFERENCE:
  "by EOD" / "tonight" -> night
  "this morning" -> morning
  "at 3pm" -> scheduled_at = today at 15:00 ISO
  "in 30 minutes" -> scheduled_at = now + 30min ISO
  "tomorrow" -> scheduled_for = tomorrow date
  no time given -> pick best block for task type

DIFFICULTY: low(<30min), medium(30-90min), high(>90min or heavy cognitive load)

RECOVERY: set is_recovery=true if: ${inference.recovery_keywords.slice(0,8).join(', ')}

EXAMPLES:
  "add call mom by EOD"            -> create_task, habit, P2, medium, night
  "gym in 30 minutes"              -> create_task, habit, P2, high, scheduled_at=now+30m
  "submit assignment tonight"      -> create_task, mandatory, P1, high, night
  "edit call mom to bonus evening" -> edit_task, task_id from TODAY_TASKS, fields:{task_type:"bonus",time_block:"evening"}
  "done with gym"                  -> complete_task, task_id from TODAY_TASKS matching "gym"
  "skip reading today"             -> skip_task, task_id from TODAY_TASKS matching "reading"
  "add shop item Netflix 10 gold"   -> create_shop_item, name:"Netflix Evening", cost_gold:10, item_type:"leisure"
  "add day off to shop for 30 gold" -> create_shop_item, name:"Day Off", cost_gold:30, item_type:"day_off"

REPLY TEMPLATES (use exact format):
  added:     "Added {title} ({type}, {time_block})."
  edited:    "Updated {title} ({type}, {time_block})."
  completed: "{title} done. +{xp} XP +{gold}g"
  skipped:   "{title} skipped."
  cancelled: "{title} cancelled."
  duplicate: "{existing_title} already exists. Edit it instead?"
  list:      "Today: {pending} pending, {done} done."

OUTPUT: valid JSON only. No markdown. No text outside the JSON.

{
  "intent": "add_task|edit_task|complete_task|skip_task|cancel_task|query|chat",
  "reply": "one line shown to user",
  "needs_clarification": false,
  "clarification_question": null,
  "actions": []
}

Action schemas:
  create_task:  { type, title, task_type, priority, difficulty, time_block, scheduled_at, scheduled_for, is_recovery, is_recurring }
  edit_task:    { type, task_id, fields: { only_changed_fields } }  // fields can include: title, description, task_type, priority, difficulty, time_block, scheduled_at, is_recovery
  complete_task:{ type, task_id }
  skip_task:    { type, task_id }
  cancel_task:  { type, task_id }
  move_task:    { type, task_id, new_time_block }`
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
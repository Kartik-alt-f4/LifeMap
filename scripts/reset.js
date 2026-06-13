// scripts/reset.js
// Wipes all user data and resets to fresh install state.
// Run from api/ folder:
//   cd api && node ../scripts/reset.js
//   cd api && node ../scripts/reset.js --hard

import { createRequire } from 'module'
import { fileURLToPath } from 'url'
import path              from 'path'
import { createInterface } from 'readline'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const API_DIR   = path.join(__dirname, '../api')
const require   = createRequire(import.meta.url)

const dotenv = require(path.join(API_DIR, 'node_modules/dotenv'))
dotenv.config({ path: path.join(API_DIR, '.env') })

const { createClient } = require(path.join(API_DIR, 'node_modules/@supabase/supabase-js'))
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY)

const HARD = process.argv.includes('--hard')

const rl = createInterface({ input: process.stdin, output: process.stdout })
const ask = q => new Promise(r => rl.question(q, r))

async function step(label, fn) {
  process.stdout.write(`  ${label.padEnd(40)}`)
  try {
    const { error } = await fn()
    if (error) { console.log(`❌  ${error.message}`); return false }
    console.log('✅')
    return true
  } catch (e) { console.log(`❌  ${e.message}`); return false }
}

async function run() {
  console.log('\n  Life Map — Reset Tool\n')
  console.log(`  Mode: ${HARD ? 'HARD (clears skill XP + stat values)' : 'SOFT (keeps skill/stat definitions)'}`)
  console.log('  Clears: tasks, templates, ledgers, sessions, snapshots, leisure logs, player XP/gold/streak.\n')

  const confirm = await ask('  Type "reset" to confirm: ')
  if (confirm.trim() !== 'reset') {
    console.log('\n  Cancelled.\n')
    rl.close(); return
  }

  console.log()

  // ORDER MATTERS — FK constraints
  await step('Clear XP ledger',              () => supabase.from('xp_ledger').delete().neq('id', 0))
  await step('Clear gold ledger',            () => supabase.from('gold_ledger').delete().neq('id', 0))
  await step('Clear purchase log',           () => supabase.from('purchase_log').delete().neq('id', 0))
  await step('Clear leisure log',            () => supabase.from('leisure_log').delete().neq('id', 0))
  await step('Delete all tasks',             () => supabase.from('task').delete().neq('id', 0))
  await step('Delete all templates',         () => supabase.from('task_template').delete().neq('id', 0))
  await step('Clear daily snapshots',        () => supabase.from('daily_snapshot').delete().neq('id', 0))
  await step('Clear conversation sessions',  () => supabase.from('conversation_session').delete().neq('id', 0))
  await step('Clear conversation messages',  () => supabase.from('conversation_message').delete().neq('id', 0))

  await step('Reset player XP + gold',       () => supabase.from('player').update({
    current_level: 1, current_xp: 0, xp_to_next: 100,
    total_gold: 0, available_gold: 0
  }).eq('id', 1))

  await step('Reset energy to full',         () => supabase.from('energy_state').update({
    current: 100, threshold_label: 'normal'
  }).eq('id', 1))

  await step('Reset daily state + streak',   () => supabase.from('daily_state').update({
    day_streak: 0, mandatory_met: false, day_off_granted: false,
    free_leisure_today: false, date: new Date().toISOString().split('T')[0]
  }).eq('id', 1))

  if (HARD) {
    await step('Clear skill projection map',  () => supabase.from('task_skill').delete().neq('task_id', 0))
    await step('Clear stat projection map',   () => supabase.from('task_stat').delete().neq('task_id', 0))
    await step('Clear skill candidates',      () => supabase.from('skill_candidate').delete().neq('id', 0))
    await step('Reset skill XP to 0',         () => supabase.from('skill').update({
      current_level: 0, current_xp: 0, xp_to_next: 50, current_streak: 0
    }).neq('id', 0))
    await step('Reset stat values to 0',      () => supabase.from('stat').update({
      current_value: 0, current_streak: 0
    }).neq('id', 0))
  }

  console.log('\n  Reset complete. Restart the server to begin fresh.\n')
  rl.close()
}

run().catch(e => { console.error(e.message); process.exit(1) }) 
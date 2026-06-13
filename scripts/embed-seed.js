// scripts/embed-seed.js
// Seeds embedding vectors for all stats in the DB.
// Run once after initial setup, and again if you change stat definitions.
//
// Usage: node scripts/embed-seed.js
// Requires: .env in project root OR api/.env

import 'dotenv/config'
import { createClient }        from '@supabase/supabase-js'
import { GoogleGenerativeAI }  from '@google/generative-ai'
import { readFileSync }        from 'fs'
import { fileURLToPath }       from 'url'
import path                    from 'path'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// ── Load config to get embedding model name ───────────────────────────────────
const serverCfg = JSON.parse(
  readFileSync(path.join(__dirname, '../config/server.json'), 'utf8')
)
const EMBEDDING_MODEL = serverCfg.model.embedding_model

// ── Clients ───────────────────────────────────────────────────────────────────
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
)
const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY)

// ── Main ──────────────────────────────────────────────────────────────────────
async function run() {
  console.log('\n  Life Map — stat embedding seed\n')

  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY || !process.env.GOOGLE_API_KEY) {
    console.error('  ❌  Missing env vars. Copy .env.example to api/.env and fill in values.')
    process.exit(1)
  }

  // Fetch all stats
  const { data: stats, error } = await supabase
    .from('stat')
    .select('id, name, description, embedding_vector')

  if (error) {
    console.error('  ❌  Could not fetch stats:', error.message)
    process.exit(1)
  }

  if (!stats.length) {
    console.error('  ❌  No stats found. Did you run seed.sql?')
    process.exit(1)
  }

  const needsEmbed = stats.filter(s => !s.embedding_vector)
  const alreadyDone = stats.length - needsEmbed.length

  if (alreadyDone > 0) {
    console.log(`  ℹ  ${alreadyDone} stat(s) already embedded — skipping`)
  }

  if (!needsEmbed.length) {
    console.log('  ✅  All stats already embedded. Nothing to do.\n')
    return
  }

  console.log(`  Embedding ${needsEmbed.length} stat(s) using ${EMBEDDING_MODEL}...\n`)

  const model = genAI.getGenerativeModel({ model: EMBEDDING_MODEL })
  let success = 0
  let failed  = 0

  for (const stat of needsEmbed) {
    const text = `${stat.name}. ${stat.description}`
    process.stdout.write(`  ${stat.name.padEnd(16)}`)

    try {
      const result    = await model.embedContent(text)
      const embedding = result.embedding.values

      const { error: updateErr } = await supabase
        .from('stat')
        .update({ embedding_vector: embedding })
        .eq('id', stat.id)

      if (updateErr) throw new Error(updateErr.message)

      console.log(`✅  (${embedding.length}d)`)
      success++
    } catch (err) {
      console.log(`❌  ${err.message}`)
      failed++
    }
  }

  console.log()
  console.log(`  Done. ${success} embedded, ${failed} failed.\n`)

  if (failed > 0) {
    console.log('  Re-run this script to retry failed stats.')
    process.exit(1)
  }
}

run().catch(err => {
  console.error('  Unexpected error:', err.message)
  process.exit(1)
})
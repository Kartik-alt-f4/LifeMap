// scripts/setup-supabase.js
// Called by POST /setup-supabase on the server.
// 1. Runs schema.sql + functions.sql + seed.sql via Supabase Management API
// 2. Then triggers stat embedding via the server's own /setup/embed endpoint

const GITHUB_RAW = 'https://raw.githubusercontent.com/Kartik-alt-f4/LifeMap/main'

async function fetchSQL(filename) {
  const res = await fetch(`${GITHUB_RAW}/supabase/${filename}`)
  if (!res.ok) throw new Error(`Failed to fetch ${filename} from GitHub: ${res.status}`)
  return res.text()
}

async function execSQL(projectRef, pat, sql) {
  const res = await fetch(
    `https://api.supabase.com/v1/projects/${projectRef}/database/query`,
    {
      method:  'POST',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': `Bearer ${pat}`,
      },
      body: JSON.stringify({ query: sql }),
    }
  )

  const data = await res.json().catch(() => ({}))

  if (!res.ok) {
    const msg = data?.message ?? data?.error ?? JSON.stringify(data)
    // Ignore already-exists — schema is idempotent
    if (msg.includes('already exists') || msg.includes('duplicate')) return { ok: true }
    throw new Error(msg || `HTTP ${res.status}`)
  }
  return data
}

export async function setupSupabase(supabaseUrl, pat) {
  const match = supabaseUrl.match(/https:\/\/([^.]+)\.supabase\.co/)
  if (!match) throw new Error('Invalid Supabase URL. Must be https://xxxx.supabase.co')
  const projectRef = match[1]

  const steps = [
    { name: 'pgvector',  sql: 'CREATE EXTENSION IF NOT EXISTS vector;' },
    { name: 'schema',    sql: await fetchSQL('schema.sql') },
    { name: 'functions', sql: await fetchSQL('functions.sql') },
    { name: 'seed',      sql: await fetchSQL('seed.sql') },
  ]

  const results = []
  for (const step of steps) {
    try {
      await execSQL(projectRef, pat, step.sql)
      results.push({ step: step.name, ok: true })
    } catch (e) {
      throw new Error(`${step.name} failed: ${e.message}`)
    }
  }

  return { ok: true, steps: results, projectRef }
}

// Called after Render URL is confirmed healthy — embeds stats on the new server
export async function triggerEmbedSeed(renderUrl) {
  const url = renderUrl.replace(/\/$/, '')
  try {
    const res = await fetch(`${url}/setup/embed`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      signal:  AbortSignal.timeout(60000), // embedding takes ~20-30s
    })
    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      console.warn('[setup] Embed seed failed:', err.error ?? res.status)
      return { ok: false }
    }
    return res.json()
  } catch (e) {
    console.warn('[setup] Embed seed timeout or error:', e.message)
    return { ok: false }
  }
}
// scripts/setup-supabase.js
// Uses Supabase Management API with a personal access token (PAT)
// to run schema + functions + seed on a new project.
// PAT is obtained from https://supabase.com/dashboard/account/tokens

const GITHUB_RAW = 'https://raw.githubusercontent.com/Kartik-alt-f4/LifeMap/main'

async function fetchSQL(filename) {
  const res = await fetch(`${GITHUB_RAW}/supabase/${filename}`)
  if (!res.ok) throw new Error(`Failed to fetch ${filename}: ${res.status}`)
  return res.text()
}

async function execSQL(projectRef, pat, sql) {
  const res = await fetch(
    `https://api.supabase.com/v1/projects/${projectRef}/database/query`,
    {
      method: 'POST',
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
    // Ignore already-exists errors — schema is idempotent
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
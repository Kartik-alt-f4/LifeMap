// scripts/setup-supabase.js
// Called by POST /setup-supabase on the server.
// Fetches SQL files from GitHub and runs them against a new Supabase project
// via the Supabase Management API (pg REST endpoint).

const GITHUB_RAW = 'https://raw.githubusercontent.com/Kartik-alt-f4/LifeMap/main'

async function fetchSQL(filename) {
  const res = await fetch(`${GITHUB_RAW}/supabase/${filename}`)
  if (!res.ok) throw new Error(`Failed to fetch ${filename}: ${res.status}`)
  return res.text()
}

async function runSQL(supabaseUrl, serviceKey, sql) {
  // Use the pg REST endpoint via Supabase's SQL execution API
  const apiUrl = `${supabaseUrl}/rest/v1/rpc/exec_sql`

  // Actually use the pg endpoint directly
  const res = await fetch(`${supabaseUrl}/rest/v1/`, {
    method: 'POST',
    headers: {
      'Content-Type':  'application/json',
      'Authorization': `Bearer ${serviceKey}`,
      'apikey':        serviceKey,
    },
  })

  // Use Supabase Management API SQL endpoint
  // Extract project ref from URL: https://xxxx.supabase.co -> xxxx
  const projectRef = supabaseUrl.match(/https:\/\/([^.]+)\.supabase\.co/)?.[1]
  if (!projectRef) throw new Error('Invalid Supabase URL format')

  const sqlRes = await fetch(
    `https://api.supabase.com/v1/projects/${projectRef}/database/query`,
    {
      method: 'POST',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': `Bearer ${serviceKey}`,
      },
      body: JSON.stringify({ query: sql }),
    }
  )

  if (!sqlRes.ok) {
    const err = await sqlRes.json().catch(() => ({}))
    throw new Error(err.message ?? err.error ?? `SQL execution failed: ${sqlRes.status}`)
  }
  return sqlRes.json()
}

export async function setupSupabase(supabaseUrl, serviceKey) {
  const projectRef = supabaseUrl.match(/https:\/\/([^.]+)\.supabase\.co/)?.[1]
  if (!projectRef) throw new Error('Invalid Supabase URL. Should be https://xxxx.supabase.co')

  const results = []

  // 1. Enable pgvector extension first
  await fetch(
    `https://api.supabase.com/v1/projects/${projectRef}/database/query`,
    {
      method: 'POST',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': `Bearer ${serviceKey}`,
      },
      body: JSON.stringify({ query: 'CREATE EXTENSION IF NOT EXISTS vector;' }),
    }
  )
  results.push({ step: 'pgvector', ok: true })

  // 2. Schema
  const schema = await fetchSQL('schema.sql')
  await fetch(
    `https://api.supabase.com/v1/projects/${projectRef}/database/query`,
    {
      method: 'POST',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': `Bearer ${serviceKey}`,
      },
      body: JSON.stringify({ query: schema }),
    }
  ).then(async r => {
    if (!r.ok) {
      const e = await r.json().catch(() => ({}))
      throw new Error(`schema.sql failed: ${e.message ?? r.status}`)
    }
  })
  results.push({ step: 'schema', ok: true })

  // 3. Functions
  const functions = await fetchSQL('functions.sql')
  await fetch(
    `https://api.supabase.com/v1/projects/${projectRef}/database/query`,
    {
      method: 'POST',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': `Bearer ${serviceKey}`,
      },
      body: JSON.stringify({ query: functions }),
    }
  ).then(async r => {
    if (!r.ok) {
      const e = await r.json().catch(() => ({}))
      throw new Error(`functions.sql failed: ${e.message ?? r.status}`)
    }
  })
  results.push({ step: 'functions', ok: true })

  // 4. Seed
  const seed = await fetchSQL('seed.sql')
  await fetch(
    `https://api.supabase.com/v1/projects/${projectRef}/database/query`,
    {
      method: 'POST',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': `Bearer ${serviceKey}`,
      },
      body: JSON.stringify({ query: seed }),
    }
  ).then(async r => {
    if (!r.ok) {
      const e = await r.json().catch(() => ({}))
      throw new Error(`seed.sql failed: ${e.message ?? r.status}`)
    }
  })
  results.push({ step: 'seed', ok: true })

  return { ok: true, steps: results, projectRef }
}
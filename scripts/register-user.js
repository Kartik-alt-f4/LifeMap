// scripts/register-user.js
// Reads config/users.json from GitHub, appends a new user, commits it back.
// Called by POST /register on the server.
// Requires env vars: GITHUB_TOKEN, GITHUB_REPO (e.g. "Kartik-alt-f4/LifeMap")

const GITHUB_API = 'https://api.github.com'
const FILE_PATH  = 'config/users.json'

async function ghFetch(path, options = {}) {
  const res = await fetch(`${GITHUB_API}${path}`, {
    ...options,
    headers: {
      'Authorization': `Bearer ${process.env.GITHUB_TOKEN}`,
      'Accept':        'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'Content-Type':  'application/json',
      ...options.headers,
    },
  })
  const data = await res.json()
  if (!res.ok) throw new Error(data.message ?? `GitHub API ${res.status}`)
  return data
}

export async function registerUser(renderUrl, name, googleUid) {
  const repo = process.env.GITHUB_REPO
  if (!repo)                  throw new Error('GITHUB_REPO env var not set')
  if (!process.env.GITHUB_TOKEN) throw new Error('GITHUB_TOKEN env var not set')

  // 1. Get current file + SHA
  const file = await ghFetch(`/repos/${repo}/contents/${FILE_PATH}`)
  const current = JSON.parse(Buffer.from(file.content, 'base64').toString('utf8'))

  // 2. Check if already registered
  const exists = current.find(u => u.url === renderUrl)
  if (exists) return { ok: true, already: true, users: current }

  // 3. Append new user
  const updated = [...current, { url: renderUrl, name: name || 'friend', googleUid: googleUid || null }]
  const content  = Buffer.from(JSON.stringify(updated, null, 2) + '\n').toString('base64')

  // 4. Commit back
  await ghFetch(`/repos/${repo}/contents/${FILE_PATH}`, {
    method: 'PUT',
    body: JSON.stringify({
      message: `chore: register user ${name || renderUrl}`,
      content,
      sha: file.sha,
    }),
  })

  return { ok: true, already: false, users: updated }
}
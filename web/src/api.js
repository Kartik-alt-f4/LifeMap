// src/api.js — all API calls to the Render backend
// BASE_URL is read from localStorage config set during setup wizard.
// Falls back to the hardcoded URL so your own instance always works.

const FALLBACK = 'https://lifemap-b0ms.onrender.com'

function getBase() {
  try {
    const cfg = localStorage.getItem('lifemap_config')
    if (cfg) {
      const parsed = JSON.parse(cfg)
      if (parsed.renderUrl) return parsed.renderUrl.replace(/\/$/, '')
    }
  } catch (_) {}
  return FALLBACK
}

async function req(path, options = {}) {
  const BASE = getBase()
  const res  = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  })

  const text = await res.text()

  if (text.trim().startsWith('<')) {
    console.error(`[api] HTML response for ${path}:`, text.slice(0, 200))
    throw new Error(`Server error on ${path} — check Render logs`)
  }

  let data
  try {
    data = JSON.parse(text)
  } catch (e) {
    console.error(`[api] JSON parse failed for ${path}:`, text.slice(0, 200))
    throw new Error(`Invalid JSON from ${path}`)
  }

  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`)
  return data
}

// Config helpers — used by setup wizard
export function getStoredConfig() {
  try {
    const cfg = localStorage.getItem('lifemap_config')
    return cfg ? JSON.parse(cfg) : null
  } catch (_) { return null }
}

export function saveStoredConfig(config) {
  localStorage.setItem('lifemap_config', JSON.stringify(config))
}

export function clearStoredConfig() {
  localStorage.removeItem('lifemap_config')
}

// Health check — used by setup wizard to validate Render URL
export async function checkHealth(renderUrl) {
  const url = renderUrl.replace(/\/$/, '')
  const res = await fetch(`${url}/health`, { signal: AbortSignal.timeout(10000) })
  if (!res.ok) throw new Error(`Health check failed: ${res.status}`)
  return res.json()
}

export const getConfig    = ()      => req('/config')
export const getState     = ()      => req('/state')
export const getTasks     = (date)  => req(`/tasks${date ? `?date=${date}` : ''}`)
export const completeTask = (id)    => req(`/tasks/${id}/complete`, { method: 'POST', body: JSON.stringify({}) })
export const skipTask     = (id)    => req(`/tasks/${id}/skip`,     { method: 'POST', body: JSON.stringify({}) })
export const cancelTask   = (id)    => req(`/tasks/${id}/cancel`,   { method: 'POST', body: JSON.stringify({}) })
export const editTask     = (id, body) => req(`/tasks/${id}`, { method: 'PATCH', body: JSON.stringify(body) })
export const chat         = (msg)   => req('/chat', { method: 'POST', body: JSON.stringify({ message: msg, session_id: 'web' }) })
export const getStats     = ()      => req('/stats')
export const getShop      = ()      => req('/shop')
export const buyItem      = (id)    => req(`/shop/${id}/buy`, { method: 'POST', body: JSON.stringify({}) })
export const getSkills      = ()         => req('/skills')
export const createTask     = (body)     => req('/tasks',     { method: 'POST', body: JSON.stringify(body) })
export const createTemplate = (body)     => req('/templates', { method: 'POST', body: JSON.stringify(body) })
export const saveConfig   = (file, section, body) => req(`/config/${file}/${section}`, { method: 'POST', body: JSON.stringify(body) })
export const getSnapshots = ()      => req('/snapshots')
export const getCalendar  = (month) => req(`/calendar${month ? `?month=${month}` : ''}`)
export const registerPush = (token, platform) =>
  req('/notifications/register', { method: 'POST', body: JSON.stringify({ token, platform }) })
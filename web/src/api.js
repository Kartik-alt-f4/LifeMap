// web/src/api.js — all fetch calls to the backend
// Single source of truth for API communication.
// BASE_URL falls back to localhost for dev, uses relative path in prod.

const BASE = import.meta.env.VITE_API_URL || ''

async function req(path, options = {}) {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  })
  const data = await res.json()
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`)
  return data
}

// ── State ─────────────────────────────────────────────────────────────────────
export const getState     = ()      => req('/state')
export const getConfig    = ()      => req('/config')

// ── Tasks ─────────────────────────────────────────────────────────────────────
export const getTasks     = (date)  => req(`/tasks${date ? `?date=${date}` : ''}`)
export const createTask   = (body)  => req('/tasks',          { method: 'POST', body: JSON.stringify(body) })
export const editTask     = (id, b) => req(`/tasks/${id}`,    { method: 'PATCH', body: JSON.stringify(b) })
export const completeTask = (id)    => req(`/tasks/${id}/complete`, { method: 'POST' })
export const skipTask     = (id)    => req(`/tasks/${id}/skip`,     { method: 'POST' })
export const cancelTask   = (id)    => req(`/tasks/${id}/cancel`,   { method: 'POST' })

// ── Templates ─────────────────────────────────────────────────────────────────
export const getTemplates      = ()    => req('/templates')
export const createTemplate    = (b)   => req('/templates',      { method: 'POST',   body: JSON.stringify(b) })
export const deleteTemplate    = (id)  => req(`/templates/${id}`, { method: 'DELETE' })

// ── Chat ──────────────────────────────────────────────────────────────────────
export const chat = (message, session_id = 'web') =>
  req('/chat', { method: 'POST', body: JSON.stringify({ message, session_id }) })

// ── RPG ───────────────────────────────────────────────────────────────────────
export const getSkills    = ()       => req('/skills')
export const getStats     = ()       => req('/stats')
export const getSnapshots = ()       => req('/snapshots')
export const getCalendar  = (month)  => req(`/calendar${month ? `?month=${month}` : ''}`)

// ── Shop ──────────────────────────────────────────────────────────────────────
export const getShop  = ()    => req('/shop')
export const buyItem  = (id)  => req(`/shop/${id}/buy`, { method: 'POST' })

// ── Config (settings page) ────────────────────────────────────────────────────
export const saveConfig = (file, section, value) =>
  req(`/config/${file}${section ? `/${section}` : ''}`, {
    method: 'POST', body: JSON.stringify(value)
  })
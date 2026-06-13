// src/api.js — all API calls to the Render backend
const BASE = 'https://lifemap-b0ms.onrender.com'

async function req(path, options = {}) {
  const res = await fetch(`${BASE}${path}`, {
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

export const getConfig    = ()      => req('/config')
export const getState     = ()      => req('/state')
export const getTasks     = (date)  => req(`/tasks${date ? `?date=${date}` : ''}`)
export const completeTask = (id)    => req(`/tasks/${id}/complete`, { method: 'POST', body: JSON.stringify({}) })
export const skipTask     = (id)    => req(`/tasks/${id}/skip`,     { method: 'POST', body: JSON.stringify({}) })
export const cancelTask   = (id)    => req(`/tasks/${id}/cancel`,   { method: 'POST', body: JSON.stringify({}) })
export const chat         = (msg)   => req('/chat', { method: 'POST', body: JSON.stringify({ message: msg, session_id: 'mobile' }) })
export const getStats     = ()      => req('/stats')
export const getShop      = ()      => req('/shop')
export const buyItem      = (id)    => req(`/shop/${id}/buy`, { method: 'POST', body: JSON.stringify({}) })
export const registerPush = (token, platform) =>
  req('/notifications/register', { method: 'POST', body: JSON.stringify({ token, platform }) })
export const getSkills    = ()      => req('/skills')
export const editTask     = (id, body) => req(`/tasks/${id}`, { method: 'PATCH', body: JSON.stringify(body) })
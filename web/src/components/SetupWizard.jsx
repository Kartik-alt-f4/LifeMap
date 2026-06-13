// src/components/SetupWizard.jsx
// First-run setup wizard. Shows when no config in localStorage.
// Steps: Google Sign-In → Gemini key → Render setup → done

import { useState, useEffect } from 'react'
import { initializeApp }       from 'firebase/app'
import { getAuth, signInWithPopup, GoogleAuthProvider, onAuthStateChanged } from 'firebase/auth'
import { saveStoredConfig, checkHealth } from '../api.js'

// ── Firebase init ─────────────────────────────────────────────────────────────
const firebaseConfig = {
  apiKey:            "AIzaSyC0IMifCiKPjYHSg8N3lWw7D3oFQb1mZy8",
  authDomain:        "lifemap-d12c1.firebaseapp.com",
  projectId:         "lifemap-d12c1",
  storageBucket:     "lifemap-d12c1.firebasestorage.app",
  messagingSenderId: "683890530184",
  appId:             "1:683890530184:web:4092e0119971a3ab054c3d"
}

let _app, _auth
function getFirebase() {
  if (!_app) { _app = initializeApp(firebaseConfig); _auth = getAuth(_app) }
  return { auth: _auth }
}

// ── Helpers ───────────────────────────────────────────────────────────────────
async function validateGeminiKey(key, renderUrl) {
  // Validate via our own server to avoid CORS issues with direct Gemini calls
  const base = renderUrl ? renderUrl.replace(/\/$/, '') : 'https://lifemap-b0ms.onrender.com'
  const res  = await fetch(`${base}/validate-gemini`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ key }),
    signal:  AbortSignal.timeout(15000),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.error ?? 'Invalid Gemini key')
  }
  return true
}

async function setupSupabase(supabaseUrl, pat) {
  // Routes through your server to avoid CORS
  const base = 'https://lifemap-b0ms.onrender.com'
  const res  = await fetch(`${base}/setup-supabase`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ supabaseUrl, pat }),
    signal:  AbortSignal.timeout(60000),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.error ?? 'Supabase setup failed')
  }
  return res.json()
}

async function lookupUser(googleUid) {
  // Check your server first — if UID already registered, return their config
  const BASE = 'https://lifemap-b0ms.onrender.com'
  try {
    const res = await fetch(`${BASE}/lookup?uid=${encodeURIComponent(googleUid)}`, {
      signal: AbortSignal.timeout(8000),
    })
    if (!res.ok) return null
    const data = await res.json()
    return data.found ? data : null
  } catch (_) { return null }
}

async function registerWithServer(renderUrl, name, googleUid) {
  const url = renderUrl.replace(/\/$/, '')
  const res = await fetch(`${url}/register`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ renderUrl, name, googleUid }),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.error ?? 'Registration failed')
  }
  return res.json()
}

// ── Copy button ───────────────────────────────────────────────────────────────
function CopyField({ label, value }) {
  const [copied, setCopied] = useState(false)
  const copy = () => {
    navigator.clipboard.writeText(value)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }
  return (
    <div style={{ marginBottom: 8 }}>
      <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.1em', color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: 4 }}>
        {label}
      </div>
      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
        <div style={{
          flex: 1, background: 'var(--bg)', border: '1px solid var(--border)',
          borderRadius: 'var(--radius-sm)', padding: '6px 10px',
          fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--text)',
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>
          {value}
        </div>
        <button
          onClick={copy}
          style={{
            padding: '6px 12px', borderRadius: 'var(--radius-sm)',
            border: '1px solid var(--border)', fontSize: 11, fontWeight: 600,
            color: copied ? 'var(--success)' : 'var(--text-muted)',
            borderColor: copied ? 'var(--success)' : 'var(--border)',
            background: copied ? 'rgba(62,207,142,0.08)' : 'transparent',
            transition: 'all 140ms ease', whiteSpace: 'nowrap',
            cursor: 'pointer',
          }}
        >
          {copied ? '✓ Copied' : 'Copy'}
        </button>
      </div>
    </div>
  )
}

// ── Step indicator ────────────────────────────────────────────────────────────
function Steps({ current, total }) {
  return (
    <div style={{ display: 'flex', gap: 6, justifyContent: 'center', marginBottom: 28 }}>
      {Array.from({ length: total }).map((_, i) => (
        <div key={i} style={{
          width: i === current ? 20 : 6,
          height: 6, borderRadius: 3,
          background: i === current ? 'var(--accent)'
                    : i < current  ? 'rgba(123,110,246,0.4)'
                    : 'var(--surface3)',
          transition: 'all 200ms ease',
        }} />
      ))}
    </div>
  )
}

// ── Step 1: Google Sign-In ────────────────────────────────────────────────────
function StepSignIn({ onDone }) {
  const [loading, setLoading] = useState(false)
  const [error,   setError]   = useState('')

  const signIn = async () => {
    setLoading(true); setError('')
    try {
      const { auth } = getFirebase()
      const provider  = new GoogleAuthProvider()
      const result    = await signInWithPopup(auth, provider)
      const user      = result.user

      // Check if already registered — skip wizard if so
      setError('') // clear
      const existing = await lookupUser(user.uid)
      if (existing) {
        // Restore config and jump straight to app
        saveStoredConfig({
          renderUrl: existing.renderUrl,
          googleUid: user.uid,
          name:      existing.name ?? user.displayName,
        })
        onDone({ googleUid: user.uid, name: user.displayName, returning: true, renderUrl: existing.renderUrl })
        return
      }

      onDone({ googleUid: user.uid, name: user.displayName, email: user.email })
    } catch (e) {
      setError(e.message ?? 'Sign-in failed')
    } finally { setLoading(false) }
  }

  return (
    <div>
      <div style={s.stepIcon}>◈</div>
      <h2 style={s.stepTitle}>Welcome to Life Map</h2>
      <p style={s.stepDesc}>Sign in with Google to get started. Your account links your setup so you can recover it on any device.</p>

      {error && <div style={s.error}>{error}</div>}

      <button onClick={signIn} disabled={loading} style={s.googleBtn}>
        {loading ? 'Signing in…' : (
          <>
            <svg width="18" height="18" viewBox="0 0 24 24" style={{ flexShrink: 0 }}>
              <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
              <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
              <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z"/>
              <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
            </svg>
            Sign in with Google
          </>
        )}
      </button>
    </div>
  )
}

// ── Step 2: Gemini Key ────────────────────────────────────────────────────────
function StepGemini({ onDone, onBack }) {
  const [key,      setKey]      = useState('')
  const [loading,  setLoading]  = useState(false)
  const [error,    setError]    = useState('')

  const validate = async () => {
    if (!key.trim()) return
    setLoading(true); setError('')
    try {
      await validateGeminiKey(key.trim(), null)
      onDone({ geminiKey: key.trim() })
    } catch (e) {
      setError('Key invalid or quota exceeded. Double-check it and try again.')
    } finally { setLoading(false) }
  }

  return (
    <div>
      <div style={s.stepIcon}>🔑</div>
      <h2 style={s.stepTitle}>Gemini API Key</h2>
      <p style={s.stepDesc}>
        Life Map uses Google Gemini for AI task management. Get a free key from Google AI Studio.
      </p>

      <a
        href="https://aistudio.google.com/app/apikey"
        target="_blank"
        rel="noreferrer"
        style={s.linkBtn}
      >
        Open Google AI Studio →
      </a>

      <div style={{ marginTop: 20, marginBottom: 6 }}>
        <label style={s.fieldLabel}>Paste your API key</label>
        <input
          style={s.input}
          type="password"
          placeholder="AIza..."
          value={key}
          onChange={e => setKey(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && validate()}
        />
      </div>

      {error && <div style={s.error}>{error}</div>}

      <div style={s.btnRow}>
        <button onClick={onBack} style={s.backBtn}>← Back</button>
        <button onClick={validate} disabled={!key.trim() || loading} style={s.primaryBtn}>
          {loading ? 'Validating…' : 'Validate & continue'}
        </button>
      </div>
    </div>
  )
}

// ── Step 3: Supabase Setup ───────────────────────────────────────────────────
function StepSupabase({ onDone, onBack }) {
  const [url,      setUrl]      = useState('')
  const [pat,      setPat]      = useState('')
  const [anonKey,  setAnonKey]  = useState('')
  const [serviceKey, setServiceKey] = useState('')
  const [loading,  setLoading]  = useState(false)
  const [phase,    setPhase]    = useState('input')
  const [progress, setProgress] = useState('')
  const [error,    setError]    = useState('')

  const run = async () => {
    const cleanUrl = url.trim().replace(/\/$/, '')
    if (!cleanUrl || !pat.trim()) return
    setLoading(true); setError(''); setPhase('running')

    try {
      setProgress('Enabling pgvector extension…')
      await new Promise(r => setTimeout(r, 600))
      setProgress('Running schema.sql…')
      await new Promise(r => setTimeout(r, 600))
      setProgress('Running functions.sql…')

      await setupSupabase(cleanUrl, pat.trim())

      setProgress('Seeding default data…')
      await new Promise(r => setTimeout(r, 400))
      setProgress('Done!')
      await new Promise(r => setTimeout(r, 500))

      onDone({
        supabaseUrl: cleanUrl,
        anonKey:     anonKey.trim(),
        serviceKey:  serviceKey.trim(),
      })
    } catch (e) {
      setError(e.message)
      setPhase('input')
    } finally { setLoading(false) }
  }

  if (phase === 'running') return (
    <div style={{ textAlign: 'center' }}>
      <div style={{ fontSize: 32, marginBottom: 16 }}>⚙️</div>
      <h2 style={s.stepTitle}>Setting up your database</h2>
      <p style={{ ...s.stepDesc, color: 'var(--accent)' }}>{progress}</p>
      <div style={{
        width: '100%', height: 4, background: 'var(--surface3)',
        borderRadius: 2, overflow: 'hidden', marginTop: 8,
      }}>
        <div style={{
          height: '100%', background: 'var(--accent)', borderRadius: 2,
          width: '60%', animation: 'shimmer 1.4s infinite',
        }} />
      </div>
    </div>
  )

  return (
    <div>
      <div style={s.stepIcon}>🗄️</div>
      <h2 style={s.stepTitle}>Set up your database</h2>
      <p style={s.stepDesc}>
        Create a free Supabase project. We'll set up the schema automatically.
      </p>

      <div style={{
        background: 'var(--surface2)', border: '1px solid var(--border)',
        borderRadius: 'var(--radius-sm)', padding: '12px 14px',
        fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.8,
        marginBottom: 20,
      }}>
        <strong style={{ color: 'var(--text)' }}>Steps:</strong><br/>
        1. Create a free account + new project at <a href="https://supabase.com" target="_blank" rel="noreferrer" style={{ color: 'var(--accent)' }}>supabase.com</a><br/>
        2. Go to <span style={{ color: 'var(--accent)', fontFamily: 'var(--mono)' }}>supabase.com/dashboard/account/tokens</span> → create an Access Token (starts with <span style={{ fontFamily: 'var(--mono)' }}>sbp_</span>)<br/>
        3. Go to your project → <span style={{ color: 'var(--accent)', fontFamily: 'var(--mono)' }}>Settings → API</span> → copy the three values below
      </div>

      <div style={{ marginBottom: 6 }}>
        <label style={s.fieldLabel}>Project URL <span style={{ color: 'var(--text-dim)', fontWeight: 400 }}>(Settings → API → Project URL)</span></label>
        <input style={s.input} type="url" placeholder="https://xxxx.supabase.co"
          value={url} onChange={e => setUrl(e.target.value)} />
      </div>

      <div style={{ marginBottom: 6 }}>
        <label style={s.fieldLabel}>
          Access Token <span style={{ color: 'var(--text-dim)', fontWeight: 400 }}>(account/tokens — starts with sbp_)</span>
        </label>
        <input style={s.input} type="password" placeholder="sbp_..."
          value={pat} onChange={e => setPat(e.target.value)} />
        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: -10, marginBottom: 16, lineHeight: 1.5 }}>
          This is your <strong>personal account token</strong>, not a project key. Used once to run the schema setup. Never stored.
        </div>
      </div>

      <div style={{ marginBottom: 6 }}>
        <label style={s.fieldLabel}>Anon Key <span style={{ color: 'var(--text-dim)', fontWeight: 400 }}>(Settings → API → anon public)</span></label>
        <input style={s.input} type="password" placeholder="eyJhbGciOiJIUzI1NiIs..."
          value={anonKey} onChange={e => setAnonKey(e.target.value)} />
      </div>

      <div style={{ marginBottom: 6 }}>
        <label style={s.fieldLabel}>Service Role Key <span style={{ color: 'var(--text-dim)', fontWeight: 400 }}>(Settings → API → service_role secret)</span></label>
        <input style={s.input} type="password" placeholder="eyJhbGciOiJIUzI1NiIs..."
          value={serviceKey} onChange={e => setServiceKey(e.target.value)} />
        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: -10, marginBottom: 16, lineHeight: 1.5 }}>
          The anon key and service role key are both <strong>long JWT strings</strong> starting with <span style={{ fontFamily: 'var(--mono)' }}>eyJ</span> — different from the access token.
        </div>
      </div>

      {error && <div style={s.error}>{error}</div>}

      <div style={s.btnRow}>
        <button onClick={onBack} style={s.backBtn}>← Back</button>
        <button onClick={run} disabled={!url.trim() || !pat.trim() || loading} style={s.primaryBtn}>
          Set up database
        </button>
      </div>
    </div>
  )
}

// ── .env file generator ──────────────────────────────────────────────────────
function downloadEnvFile(data, cronSecret) {
  const lines = [
    '# Life Map — Render environment variables',
    '# Import this file in Render: Environment → Add from .env',
    '',
    `SUPABASE_URL=${data.supabaseUrl ?? ''}`,
    `SUPABASE_ANON_KEY=${data.anonKey ?? ''}`,
    `SUPABASE_SERVICE_KEY=${data.serviceKey ?? ''}`,
    `GOOGLE_API_KEY=${data.geminiKey ?? ''}`,
    `CRON_SECRET=${cronSecret ?? ''}`,
    'NODE_ENV=production',
  ].join('\n')

  const blob = new Blob([lines], { type: 'text/plain' })
  const url  = URL.createObjectURL(blob)
  const a    = document.createElement('a')
  a.href     = url
  a.download = 'lifemap.env'
  a.click()
  URL.revokeObjectURL(url)
}

// ── Step 4: Render Setup ──────────────────────────────────────────────────────
function StepRender({ data, onDone, onBack }) {
  const [url,     setUrl]     = useState('')
  const [loading, setLoading] = useState(false)
  const [error,   setError]   = useState('')
  const [phase,   setPhase]   = useState('guide') // 'guide' | 'url'

  const envVars = [
    { key: 'SUPABASE_URL',         value: data.supabaseUrl || '(your Supabase project URL)' },
    { key: 'SUPABASE_ANON_KEY',    value: data.anonKey     || '(Project Settings → API → anon key)' },
    { key: 'SUPABASE_SERVICE_KEY', value: data.serviceKey  || '(Project Settings → API → service_role key)' },
    { key: 'GOOGLE_API_KEY',       value: data.geminiKey   || '(your Gemini API key)' },
    { key: 'CRON_SECRET',          value: '(ask Kartik for the master cron token)' },
    { key: 'NODE_ENV',             value: 'production' },
  ]

  const confirm = async () => {
    const cleaned = url.trim().replace(/\/$/, '')
    if (!cleaned.includes('onrender.com') && !cleaned.startsWith('http')) {
      setError('Enter a valid Render URL (e.g. https://lifemap-yourname.onrender.com)')
      return
    }
    setLoading(true); setError('')
    try {
      await checkHealth(cleaned)
      await registerWithServer(cleaned, data.name, data.googleUid)
      onDone({ renderUrl: cleaned })
    } catch (e) {
      setError(e.message ?? 'Could not reach that URL. Is Render fully deployed?')
    } finally { setLoading(false) }
  }

  if (phase === 'guide') return (
    <div>
      <div style={s.stepIcon}>⚙️</div>
      <h2 style={s.stepTitle}>Set up your server</h2>
      <p style={s.stepDesc}>
        Each Life Map user runs their own private server. Follow these steps in Render — it's free.
      </p>

      <div style={s.guideSteps}>
        {[
          { n: '1', text: 'Go to render.com and create a free account' },
          { n: '2', text: 'Click "New +" → "Web Service"' },
          { n: '3', text: 'Choose "Deploy from Git repo" and paste:' },
          { n: '4', text: 'Set these environment variables (copy each one):' },
          { n: '5', text: 'Click "Create Web Service" and wait for deploy (~3 min)' },
        ].map(step => (
          <div key={step.n} style={s.guideStep}>
            <div style={s.guideNum}>{step.n}</div>
            <div style={{ flex: 1 }}>
              <div style={s.guideText}>{step.text}</div>
              {step.n === '3' && (
                <CopyField label="GitHub repo URL" value="https://github.com/Kartik-alt-f4/LifeMap" />
              )}
              {step.n === '4' && (
                <div style={{
                  background: 'var(--bg)', border: '1px solid var(--border)',
                  borderRadius: 'var(--radius-sm)', padding: '10px 12px',
                  fontSize: 11, color: 'var(--text-muted)', lineHeight: 2,
                  marginTop: 6,
                }}>
                  <div><span style={{ color: 'var(--text)', fontWeight: 600 }}>Branch:</span> main</div>
                  <div><span style={{ color: 'var(--text)', fontWeight: 600 }}>Root Directory:</span> <span style={{ fontFamily: 'var(--mono)', color: 'var(--accent)' }}>api</span></div>
                  <div><span style={{ color: 'var(--text)', fontWeight: 600 }}>Runtime:</span> Node</div>
                  <div><span style={{ color: 'var(--text)', fontWeight: 600 }}>Build Command:</span> <span style={{ fontFamily: 'var(--mono)' }}>npm install</span></div>
                  <div><span style={{ color: 'var(--text)', fontWeight: 600 }}>Start Command:</span> <span style={{ fontFamily: 'var(--mono)' }}>node ./src/server.js</span></div>
                  <div><span style={{ color: 'var(--text)', fontWeight: 600 }}>Instance Type:</span> Free</div>
                </div>
              )}
              {step.n === '5' && (
                <div style={{ marginTop: 8 }}>
                  <div style={{
                    background: 'var(--surface2)', border: '1px solid var(--border)',
                    borderRadius: 'var(--radius-sm)', padding: '10px 12px',
                    fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.8,
                    marginBottom: 10,
                  }}>
                    In Render: <strong style={{ color: 'var(--text)' }}>Environment → Add from .env file</strong><br/>
                    Download your pre-filled .env file below, then import it.<br/>
                    <span style={{ color: 'var(--warning)' }}>⚠ Fill in CRON_SECRET manually — message Kartik for this value.</span>
                  </div>
                  <button
                    onClick={() => downloadEnvFile(data, '')}
                    style={{
                      width: '100%', padding: '9px',
                      background: 'var(--accent-dim)',
                      border: '1px solid var(--accent)',
                      borderRadius: 'var(--radius-sm)',
                      color: 'var(--accent)',
                      fontSize: 13, fontWeight: 700,
                      cursor: 'pointer', marginBottom: 8,
                    }}
                  >
                    ↓ Download lifemap.env
                  </button>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.6 }}>
                    All values are pre-filled except CRON_SECRET. Add that manually in Render after importing.
                  </div>
                </div>
              )}
            </div>
          </div>
        ))}
      </div>

      <div style={s.btnRow}>
        <button onClick={onBack} style={s.backBtn}>← Back</button>
        <button
          onClick={() => { window.open('https://render.com', '_blank'); setPhase('url') }}
          style={s.primaryBtn}
        >
          Open Render →
        </button>
      </div>
      <button onClick={() => setPhase('url')} style={s.skipLink}>
        Already set up Render? Enter your URL
      </button>
    </div>
  )

  return (
    <div>
      <div style={s.stepIcon}>🔗</div>
      <h2 style={s.stepTitle}>Enter your Render URL</h2>
      <p style={s.stepDesc}>
        Once your Render service is deployed and running, paste the URL here.
        It looks like: <span style={{ fontFamily: 'var(--mono)', color: 'var(--accent)' }}>https://lifemap-yourname.onrender.com</span>
      </p>

      <div style={{ marginBottom: 6 }}>
        <label style={s.fieldLabel}>Your Render URL</label>
        <input
          style={s.input}
          type="url"
          placeholder="https://lifemap-yourname.onrender.com"
          value={url}
          onChange={e => setUrl(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && confirm()}
        />
      </div>

      {error && <div style={s.error}>{error}</div>}

      {loading && (
        <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 12 }}>
          Checking your server… this may take up to 30s if Render is waking up.
        </div>
      )}

      <div style={s.btnRow}>
        <button onClick={() => setPhase('guide')} style={s.backBtn}>← Back</button>
        <button onClick={confirm} disabled={!url.trim() || loading} style={s.primaryBtn}>
          {loading ? 'Connecting…' : 'Connect & finish'}
        </button>
      </div>
    </div>
  )
}

// ── Step 4: Done ──────────────────────────────────────────────────────────────
function StepDone({ onEnter }) {
  return (
    <div style={{ textAlign: 'center' }}>
      <div style={{ fontSize: 48, marginBottom: 16 }}>✦</div>
      <h2 style={s.stepTitle}>You're all set</h2>
      <p style={s.stepDesc}>
        Your Life Map is ready. Complete tasks, earn XP, build skills.
      </p>
      <button onClick={onEnter} style={{ ...s.primaryBtn, width: '100%', marginTop: 8, padding: '12px' }}>
        Enter Life Map
      </button>
    </div>
  )
}

// ── Main wizard ───────────────────────────────────────────────────────────────
export default function SetupWizard({ onComplete }) {
  const [step, setStep] = useState(0)
  const [data, setData] = useState({})

  const advance = (newData) => {
    const merged = { ...data, ...newData }
    setData(merged)
    // Returning user — config already saved, skip to done
    if (merged.returning) {
      finish(merged)
      return
    }
    setStep(s => s + 1)
  }

  const finish = (override) => {
    const d = override ?? data
    const config = {
      renderUrl: d.renderUrl,
      geminiKey: d.geminiKey,
      googleUid: d.googleUid,
      name:      d.name,
    }
    saveStoredConfig(config)
    onComplete(config)
  }

  const TOTAL = 5

  return (
    <div style={s.overlay}>
      <div style={s.card}>
        {/* Logo */}
        <div style={s.logoRow}>
          <svg width="32" height="32" viewBox="0 0 64 64" fill="none">
            <rect width="64" height="64" rx="12" fill="#7b6ef6"/>
            <path d="M32 10 L46 32 L32 54 L18 32 Z" fill="white"/>
            <path d="M26 22 L32 16 L38 22 L34 22 L34 38 L40 38 L32 46 L24 38 L30 38 L30 22 Z" fill="#0F172A"/>
            <circle cx="32" cy="16" r="3" fill="#0F172A"/>
            <circle cx="24" cy="40" r="2.5" fill="#0F172A"/>
            <circle cx="40" cy="40" r="2.5" fill="#0F172A"/>
          </svg>
          <span style={s.logoText}>LIFE MAP</span>
        </div>

        <Steps current={step} total={TOTAL} />

        {step === 0 && <StepSignIn   onDone={advance} />}
        {step === 1 && <StepGemini   onDone={advance} onBack={() => setStep(0)} data={data} />}
        {step === 2 && <StepSupabase onDone={advance} onBack={() => setStep(1)} data={data} />}
        {step === 3 && <StepRender   onDone={advance} onBack={() => setStep(2)} data={data} />}
        {step === 4 && <StepDone     onEnter={finish} />}
      </div>
    </div>
  )
}

// ── Styles ────────────────────────────────────────────────────────────────────
const s = {
  overlay: {
    position: 'fixed', inset: 0, zIndex: 500,
    background: 'var(--bg)',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    padding: '16px',
  },
  card: {
    width: '100%', maxWidth: 480,
    background: 'var(--surface)',
    border: '1px solid var(--border-hi)',
    borderRadius: 'var(--radius)',
    padding: '32px 28px',
    maxHeight: '92dvh',
    overflowY: 'auto',
  },
  logoRow: {
    display: 'flex', alignItems: 'center', gap: 10,
    justifyContent: 'center', marginBottom: 28,
  },
  logoText: {
    fontSize: 14, fontWeight: 700, letterSpacing: '0.2em',
    color: 'var(--text)',
  },
  stepIcon: {
    fontSize: 32, textAlign: 'center', marginBottom: 12,
  },
  stepTitle: {
    fontSize: 18, fontWeight: 600, color: 'var(--text)',
    textAlign: 'center', marginBottom: 10, letterSpacing: '-0.01em',
  },
  stepDesc: {
    fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.65,
    textAlign: 'center', marginBottom: 24,
  },
  fieldLabel: {
    display: 'block', fontSize: 9, fontWeight: 700,
    letterSpacing: '0.12em', color: 'var(--text-muted)',
    textTransform: 'uppercase', marginBottom: 6,
  },
  input: {
    width: '100%', background: 'var(--bg)',
    border: '1px solid var(--border)',
    borderRadius: 'var(--radius-sm)', padding: '9px 12px',
    fontSize: 13, color: 'var(--text)', outline: 'none',
    marginBottom: 16,
  },
  primaryBtn: {
    background: 'var(--accent)', color: '#fff',
    border: 'none', borderRadius: 'var(--radius-sm)',
    padding: '9px 20px', fontSize: 13, fontWeight: 700,
    cursor: 'pointer', letterSpacing: '0.04em',
    opacity: 1, transition: 'opacity 140ms ease',
  },
  backBtn: {
    background: 'none', color: 'var(--text-muted)',
    border: '1px solid var(--border)',
    borderRadius: 'var(--radius-sm)',
    padding: '9px 16px', fontSize: 13, fontWeight: 600,
    cursor: 'pointer',
  },
  btnRow: {
    display: 'flex', gap: 8, justifyContent: 'space-between',
    marginTop: 8,
  },
  googleBtn: {
    width: '100%', display: 'flex', alignItems: 'center',
    justifyContent: 'center', gap: 10,
    background: '#fff', color: '#1f1f1f',
    border: '1px solid rgba(0,0,0,0.12)',
    borderRadius: 'var(--radius-sm)', padding: '10px 20px',
    fontSize: 14, fontWeight: 600, cursor: 'pointer',
    transition: 'box-shadow 140ms ease', marginTop: 8,
  },
  linkBtn: {
    display: 'block', textAlign: 'center',
    padding: '8px', borderRadius: 'var(--radius-sm)',
    border: '1px solid var(--border)',
    fontSize: 12, fontWeight: 600, color: 'var(--accent)',
    marginBottom: 4,
  },
  error: {
    background: 'var(--danger-dim)', border: '1px solid rgba(240,75,75,0.25)',
    borderRadius: 'var(--radius-sm)', padding: '8px 12px',
    fontSize: 12, color: 'var(--danger)', marginBottom: 14,
  },
  guideSteps: {
    display: 'flex', flexDirection: 'column', gap: 16,
    marginBottom: 24,
  },
  guideStep: {
    display: 'flex', gap: 12, alignItems: 'flex-start',
  },
  guideNum: {
    width: 22, height: 22, borderRadius: 11,
    background: 'var(--accent-dim)', border: '1px solid var(--accent)',
    color: 'var(--accent)', fontSize: 11, fontWeight: 700,
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    flexShrink: 0, marginTop: 1,
  },
  guideText: {
    fontSize: 13, color: 'var(--text)', lineHeight: 1.5,
    marginBottom: 8,
  },
  skipLink: {
    display: 'block', width: '100%', textAlign: 'center',
    fontSize: 12, color: 'var(--text-muted)', marginTop: 12,
    background: 'none', border: 'none', cursor: 'pointer',
    textDecoration: 'underline',
  },
}
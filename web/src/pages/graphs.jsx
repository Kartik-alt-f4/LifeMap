// web/src/pages/Graphs.jsx
import { useState, useEffect } from 'react'
import { getSnapshots } from '../api.js'

function LineChart({ data, dataKey, color, label, format }) {
  if (!data.length) return null
  const values = data.map(d => d[dataKey] ?? 0)
  const max    = Math.max(...values, 1)
  const min    = Math.min(...values)
  const range  = max - min || 1
  const W = 100, H = 60
  const pts = values.map((v, i) => {
    const x = (i / (values.length - 1 || 1)) * W
    const y = H - ((v - min) / range) * H
    return `${x},${y}`
  }).join(' ')

  return (
    <div style={{ marginBottom: 24 }}>
      <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', letterSpacing: '0.12em', marginBottom: 8, textTransform: 'uppercase' }}>
        {label}
      </div>
      <div style={{ position: 'relative', background: 'var(--bg)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)', padding: '12px 14px' }}>
        <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{ width: '100%', height: 80, display: 'block' }}>
          <defs>
            <linearGradient id={`grad-${dataKey}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity="0.25" />
              <stop offset="100%" stopColor={color} stopOpacity="0" />
            </linearGradient>
          </defs>
          {/* Fill */}
          <polygon
            points={`0,${H} ${pts} ${W},${H}`}
            fill={`url(#grad-${dataKey})`}
          />
          {/* Line */}
          <polyline
            points={pts}
            fill="none"
            stroke={color}
            strokeWidth="0.8"
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        </svg>
        {/* Min/max labels */}
        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4 }}>
          <span style={{ fontSize: 9, color: 'var(--text-muted)', fontFamily: 'var(--mono)' }}>
            {format ? format(values[0]) : values[0]}
          </span>
          <span style={{ fontSize: 11, fontWeight: 700, color, fontFamily: 'var(--mono)' }}>
            {format ? format(values[values.length - 1]) : values[values.length - 1]}
          </span>
        </div>
      </div>
    </div>
  )
}

function BarChart({ data, dataKey, color, label }) {
  if (!data.length) return null
  const values = data.map(d => d[dataKey] ?? 0)
  const max    = Math.max(...values, 1)

  return (
    <div style={{ marginBottom: 24 }}>
      <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', letterSpacing: '0.12em', marginBottom: 8, textTransform: 'uppercase' }}>
        {label}
      </div>
      <div style={{ background: 'var(--bg)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)', padding: '12px 14px' }}>
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 2, height: 60 }}>
          {values.map((v, i) => (
            <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end' }}>
              <div style={{
                height: `${(v / max) * 100}%`,
                minHeight: v > 0 ? 2 : 0,
                background: color,
                borderRadius: '2px 2px 0 0',
                opacity: 0.7 + (i / values.length) * 0.3,
              }} />
            </div>
          ))}
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4 }}>
          <span style={{ fontSize: 9, color: 'var(--text-muted)', fontFamily: 'var(--mono)' }}>
            {data[0]?.date?.slice(5)}
          </span>
          <span style={{ fontSize: 9, color: 'var(--text-muted)', fontFamily: 'var(--mono)' }}>
            {data[data.length - 1]?.date?.slice(5)}
          </span>
        </div>
      </div>
    </div>
  )
}

export default function Graphs() {
  const [snapshots, setSnapshots] = useState([])
  const [loading,   setLoading]   = useState(true)
  const [range,     setRange]     = useState(30)

  useEffect(() => {
    getSnapshots().then(data => {
      setSnapshots(data)
      setLoading(false)
    }).catch(console.error)
  }, [])

  const data = snapshots.slice(-range)

  if (loading) return (
    <div style={{ padding: 20, color: 'var(--text-muted)', fontSize: 12 }}>Loading snapshots…</div>
  )

  if (!data.length) return (
    <div style={{ padding: 20, color: 'var(--text-muted)', fontSize: 12 }}>
      No data yet — snapshots are written at EOD. Come back tomorrow.
    </div>
  )

  const ranges = [7, 14, 30, 90]

  return (
    <div style={{ padding: '0 20px 20px' }}>
      {/* Range selector */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 20, paddingTop: 16 }}>
        {ranges.map(r => (
          <button
            key={r}
            onClick={() => setRange(r)}
            style={{
              fontSize: 10, fontWeight: 700, letterSpacing: '0.08em',
              padding: '4px 11px', borderRadius: 'var(--radius-sm)',
              border: `1px solid ${range === r ? 'var(--accent)' : 'var(--border)'}`,
              color: range === r ? 'var(--accent)' : 'var(--text-muted)',
              background: range === r ? 'var(--accent-dim)' : 'transparent',
              cursor: 'pointer'
            }}
          >{r}d</button>
        ))}
        <span style={{ fontSize: 10, color: 'var(--text-muted)', marginLeft: 'auto', alignSelf: 'center' }}>
          {data.length} day{data.length !== 1 ? 's' : ''} of data
        </span>
      </div>

      <LineChart data={data} dataKey="current_xp"      color="var(--accent)" label="XP"          />
      <LineChart data={data} dataKey="day_streak"      color="var(--warning)" label="Streak"     />
      <LineChart data={data} dataKey="available_gold"  color="var(--gold)"   label="Gold"        />
      <LineChart data={data} dataKey="energy"          color="#3ecf8e"       label="Energy (EOD)" />
      <BarChart  data={data} dataKey="tasks_completed" color="var(--accent)" label="Tasks completed" />
      <BarChart  data={data} dataKey="tasks_skipped"   color="var(--danger)" label="Tasks skipped"   />
    </div>
  )
}
import { useState, useEffect } from 'react'
import { getStats } from '../api.js'

const ICONS = { Strength:'💪', Vitality:'❤️', Agility:'⚡', Intelligence:'🧠', Willpower:'🔮', Charisma:'💬' }

function streakClass(n) {
  if (!n || n === 0) return 'streak-zero'
  if (n <= -7) return 'streak-decay'
  return n > 0 ? 'streak-pos' : 'streak-neg'
}

export default function Stats() {
  const [stats, setStats]     = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    getStats().then(s => { setStats(s); setLoading(false) }).catch(console.error)
  }, [])

  return (
    <div className="stats-grid">
      {loading ? [0,1,2,3,4,5].map(i => <div key={i} className="skeleton" style={{ height:96 }} />) :
       (stats || []).map(stat => (
        <div key={stat.id} className="stat-card" title={stat.description}>
          <div className="stat-card-header">
            <span className="stat-icon">{ICONS[stat.name] ?? '◈'}</span>
            <span className="stat-name">{stat.name.toUpperCase()}</span>
          </div>
          <div className="stat-bar">
            <div className="stat-bar-fill" style={{ width:`${Math.min(100, stat.current_value ?? 0)}%` }} />
          </div>
          <div className="stat-footer">
            <span className="stat-score">{Math.round(stat.current_value ?? 0)}</span>
            <span className={`stat-streak ${streakClass(stat.current_streak)}`}>
              {stat.current_streak > 0 ? '+' : ''}{stat.current_streak}
            </span>
          </div>
        </div>
      ))}
    </div>
  )
}
// src/components/MobileProfile.jsx
import { useState } from 'react'
import Stats    from '../pages/Stats.jsx'
import Skills   from '../pages/Skills.jsx'
import Graphs   from '../pages/Graphs.jsx'
import Settings from '../pages/Settings.jsx'

const TABS = [
  { id: 'stats',    label: 'Stats',    icon: '💪' },
  { id: 'skills',   label: 'Skills',   icon: '◈'  },
  { id: 'graphs',   label: 'Graphs',   icon: '📊' },
  { id: 'settings', label: 'Settings', icon: '⚙'  },
]

function xpPct(cur, next) {
  return next ? Math.min(100, Math.max(0, (cur / next) * 100)) : 0
}

function energyPct(cur, max) {
  return max ? Math.min(100, Math.max(0, (cur / max) * 100)) : 0
}

function energyColor(ps) {
  const pct = energyPct(ps?.energy?.current ?? 0, ps?.energy?.max ?? 100)
  if (pct < 10) return 'var(--energy-recovery)'
  if (pct < 30) return 'var(--energy-min)'
  if (pct < 60) return 'var(--energy-reduced)'
  return 'var(--energy-normal)'
}

export default function MobileProfile({ playerState: ps, config, onRefresh, onSaved }) {
  const [tab, setTab] = useState('stats')
  const isDayOff = ps?.day_off_granted || ps?.free_leisure_today
  const eColor   = energyColor(ps)
  const ePct     = energyPct(ps?.energy?.current ?? 0, ps?.energy?.max ?? 100)

  return (
    <div className="mobile-profile">

      {/* ── Player header — mirrors TodayScreen header from the app ── */}
      <div className={`mob-profile-header${isDayOff ? ' day-off' : ''}`}>

        {/* Row 1: level + rank | streak + gold + day off */}
        <div className="mob-profile-row1">
          <div className="mob-profile-level">
            <span className="mob-prof-lv">Lv.{ps?.level ?? '—'}</span>
            <span className="mob-prof-rank">{ps?.rank ?? ''}</span>
          </div>
          <div className="mob-profile-badges">
            {isDayOff && (
              <span className="mob-dayoff-badge">
                {ps?.free_leisure_today ? 'DAY OFF+' : 'DAY OFF'}
              </span>
            )}
            {(ps?.streak ?? 0) > 0 && (
              <span className="mob-streak-badge">🔥 {ps.streak}d</span>
            )}
            <span className="mob-gold-badge">◆ {ps?.available_gold ?? 0}g</span>
          </div>
        </div>

        {/* Energy bar */}
        <div className="mob-prof-energy-block">
          <div className="mob-prof-energy-labels">
            <span className="mob-prof-elabel">⚡ ENERGY</span>
            <span className="mob-prof-eval" style={{ color: eColor }}>
              {ps?.energy?.current ?? 0}
              <span className="mob-prof-emax"> / {ps?.energy?.max ?? 100}</span>
            </span>
          </div>
          <div className="mob-prof-etrack">
            <div
              className="mob-prof-efill"
              style={{ width: `${ePct}%`, backgroundColor: eColor }}
            >
              {ePct > 15 && (
                <span className="mob-prof-epct">{Math.round(ePct)}%</span>
              )}
            </div>
          </div>
        </div>

        {/* XP bar */}
        <div className="mob-prof-xp-block">
          <div className="mob-prof-xp-labels">
            <span className="mob-prof-elabel">XP</span>
            <span className="mob-prof-elabel">
              {ps?.current_xp ?? 0} / {ps?.xp_to_next ?? 100}
            </span>
          </div>
          <div className="mob-prof-xptrack">
            <div
              className="mob-prof-xpfill"
              style={{ width: `${xpPct(ps?.current_xp ?? 0, ps?.xp_to_next ?? 100)}%` }}
            />
          </div>
        </div>
      </div>

      {/* ── Sub-tabs ── */}
      <div className="mob-profile-tabs">
        {TABS.map(t => (
          <button
            key={t.id}
            className={`mob-profile-tab${tab === t.id ? ' active' : ''}`}
            onClick={() => setTab(t.id)}
          >
            <span>{t.icon}</span>
            <span>{t.label}</span>
          </button>
        ))}
      </div>

      {/* ── Tab content ── */}
      <div className="mob-profile-content">
        {tab === 'stats'    && <Stats />}
        {tab === 'skills'   && <Skills />}
        {tab === 'graphs'   && <Graphs />}
        {tab === 'settings' && (
          config
            ? <Settings config={config} onSaved={onSaved} />
            : <div className="empty-state">Loading config…</div>
        )}
      </div>
    </div>
  )
}
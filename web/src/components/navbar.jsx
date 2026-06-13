import { useState } from 'react'

function energyClass(label) {
  return { normal:'energy-normal', reduced:'energy-reduced', min_viable:'energy-min', recovery:'energy-recovery' }[label] ?? 'energy-normal'
}
function xpPct(cur, next) { return next ? Math.min(100, Math.max(0, (cur/next)*100)) : 0 }

export default function Navbar({ playerState: ps, activeModal, onOpenModal, onRefresh, onAddTask }) {
  const isDayOff = ps?.day_off_granted || ps?.free_leisure_today
  const [levelOpen, setLevelOpen] = useState(false)

  return (
    <nav className="navbar" style={isDayOff ? { borderBottomColor: 'rgba(62,207,142,0.35)', boxShadow: 'inset 0 -1px 0 rgba(62,207,142,0.15), 0 0 40px rgba(62,207,142,0.06)' } : {}}>
      <div className="brand" style={{ cursor:'pointer' }} onClick={() => onOpenModal(null)}>
        <div className="brand-mark" />
        <span className="brand-name">LIFE MAP</span>
        {isDayOff && (
          <span style={{
            fontSize: '9px', fontWeight: 700, letterSpacing: '0.1em',
            color: 'var(--success)', backgroundColor: 'rgba(62,207,142,0.12)',
            border: '1px solid rgba(62,207,142,0.3)',
            padding: '2px 7px', borderRadius: 3,
            textTransform: 'uppercase'
          }}>
            {ps?.free_leisure_today ? 'Day Off+' : 'Day Off'}
          </span>
        )}
      </div>

      {/* Stats — hidden on mobile via CSS */}
      <div className="nav-stats desktop-only">
        <div className={`nav-stat ${ps ? energyClass(ps.energy?.threshold_label) : ''}`}>
          <div>
            <div className="stat-label">Energy</div>
            <div className="stat-bar-row">
              <div className="mini-bar">
                <div className="mini-bar-fill" style={{ width: ps ? `${xpPct(ps.energy?.current, ps.energy?.max)}%` : '0%' }} />
              </div>
              <span className="stat-value">{ps ? `${ps.energy?.current}/${ps.energy?.max}` : '—'}</span>
            </div>
          </div>
        </div>
        <div className="nav-divider" />

        <div className="nav-stat">
          <div>
            <div className="stat-label">Streak</div>
            <span className="stat-value" style={{ color: (ps?.streak ?? 0) > 0 ? 'var(--warning)' : 'var(--text-muted)' }}>
              {ps ? `${ps.streak > 0 ? '🔥' : ''}${ps.streak}d` : '—'}
            </span>
          </div>
        </div>
        <div className="nav-divider" />

        <div className="nav-stat" style={{ position:'relative', cursor:'pointer' }}
          onClick={() => setLevelOpen(o => !o)}>
          <div>
            <div className="stat-label">Level</div>
            <div className="stat-bar-row">
              <span className="stat-value">Lv.{ps?.level ?? '—'}</span>
              <div className="mini-bar">
                <div className="mini-bar-fill xp-fill" style={{ width: ps ? `${xpPct(ps.current_xp, ps.xp_to_next)}%` : '0%' }} />
              </div>
              <span className="stat-value" style={{ fontSize:'10px', color:'var(--text-muted)' }}>
                {ps ? `${ps.current_xp}/${ps.xp_to_next}` : '—'}
              </span>
              <span style={{ fontSize:'10px', color:'var(--text-muted)' }}>▾</span>
            </div>
          </div>

          {levelOpen && ps && (
            <>
              <div style={{ position:'fixed', inset:0, zIndex:299 }} onClick={e => { e.stopPropagation(); setLevelOpen(false) }} />
              <div style={{
                position:'absolute', top:'calc(100% + 4px)', left:'50%',
                transform:'translateX(-50%)', width:200,
                background:'var(--surface)', border:'1px solid var(--border-hi)',
                borderRadius:'var(--radius-sm)', padding:'12px 14px',
                zIndex:300, boxShadow:'0 8px 32px rgba(0,0,0,0.5)'
              }}>
                <div style={{ fontSize:'13px', fontWeight:600, color:'var(--accent)', marginBottom:4 }}>
                  Lv.{ps.level}
                </div>
                {ps.rank && (
                  <div style={{ fontSize:'10px', color:'var(--text-muted)', marginBottom:6, letterSpacing:'0.04em' }}>
                    {ps.rank}
                  </div>
                )}
                <div style={{ fontSize:'11px', color:'var(--text-muted)', marginBottom:8, fontFamily:'var(--mono)' }}>
                  {ps.current_xp} / {ps.xp_to_next} XP
                </div>
                <div style={{ height:4, background:'var(--surface3)', borderRadius:2, overflow:'hidden' }}>
                  <div style={{ height:'100%', background:'var(--accent)', borderRadius:2, width:`${xpPct(ps.current_xp, ps.xp_to_next)}%` }} />
                </div>
              </div>
            </>
          )}
        </div>
        <div className="nav-divider" />

        <div className="nav-stat">
          <div>
            <div className="stat-label">Gold</div>
            <span className="stat-value gold-value">◆ {ps?.available_gold ?? '—'}g</span>
          </div>
        </div>
      </div>

      {/* Nav actions — hidden on mobile via CSS */}
      <div className="nav-actions desktop-only">
        <button className="nav-btn nav-btn-add" onClick={onAddTask}>
          + Add task
        </button>
        {[
          { id:'skills',   label:'Skills'   },
          { id:'stats',    label:'Stats'    },
          { id:'shop',     label:'Shop'     },
          { id:'graphs',   label:'Graphs'   },
          { id:'settings', label:'Settings' },
        ].map(p => (
          <button
            key={p.id}
            className="nav-btn"
            style={activeModal === p.id
              ? { borderColor:'var(--accent)', color:'var(--accent)', background:'var(--accent-dim)' }
              : {}}
            onClick={() => onOpenModal(activeModal === p.id ? null : p.id)}
          >
            {p.label}
          </button>
        ))}
      </div>
    </nav>
  )
}
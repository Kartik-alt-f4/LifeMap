import { useState, useEffect } from 'react'
import { saveConfig, getStats } from '../api.js'

const ADVANCED_SECTIONS = ['skills', 'streak']

export default function Settings({ config, onSaved }) {
  const [section,    setSection]    = useState('tasks')
  const [advanced,   setAdvanced]   = useState(false)
  const [saving,     setSaving]     = useState(false)
  const [saved,      setSaved]      = useState(false)
  const [statDefs,   setStatDefs]   = useState([])
  const [statSaving, setStatSaving] = useState(false)
  const [statSaved,  setStatSaved]  = useState(false)
  const [statStatus, setStatStatus] = useState('')   // 'saved' | 'embedding' | 'done' | 'error'

  useEffect(() => {
    getStats()
      .then(s => setStatDefs(s.map(st => ({ ...st, _desc: st.description ?? '' }))))
      .catch(console.error)
  }, [])

  if (!config) return (
    <div className="modal-body" style={{ padding: 20 }}>
      <div className="empty-state">Loading config...</div>
    </div>
  )

  const g = config.game
  const [xpBase,   setXpBase]   = useState({ ...g.tasks.xp_base })
  const [goldBase, setGoldBase] = useState({ ...g.tasks.gold_base })
  const [energy,   setEnergy]   = useState({ ...g.energy })

  const save = async () => {
    setSaving(true)
    try {
      await saveConfig('game', 'tasks',  { ...g.tasks, xp_base: xpBase, gold_base: goldBase })
      await saveConfig('game', 'energy', energy)
      setSaved(true); setTimeout(() => setSaved(false), 2000)
      onSaved()
    } catch (e) { alert(e.message) }
    finally { setSaving(false) }
  }

  const saveStats = async () => {
    setStatSaving(true)
    setStatStatus('saving')
    try {
      // 1. Save all descriptions
      await Promise.all(statDefs.map(s =>
        fetch(`/stats/${s.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ description: s._desc })
        }).then(r => { if (!r.ok) throw new Error(`Failed to save ${s.name}`) })
      ))
      setStatStatus('embedding')
      // 2. Trigger re-embedding server-side
      const res = await fetch('/stats/re-embed', { method: 'POST' })
      if (!res.ok) throw new Error('Re-embed failed')
      setStatStatus('done')
      setTimeout(() => setStatStatus(''), 3000)
    } catch (e) {
      setStatStatus('error')
      alert(e.message)
    } finally { setStatSaving(false) }
  }

  const basicSections = [
    { id: 'tasks',  label: 'Task rewards' },
    { id: 'energy', label: 'Energy' },
    { id: 'stats',  label: 'Stat descriptions' },
    { id: 'shop',   label: 'Shop items' },
  ]
  const advSections = [
    { id: 'streak', label: 'Streak formula' },
    { id: 'skills', label: 'Skill thresholds' },
  ]
  const sections = advanced ? [...basicSections, ...advSections] : basicSections

  const Row = ({ label, hint, value, onChange, readOnly }) => (
    <div className="setting-row">
      <div>
        <div className="setting-label">{label}</div>
        {hint && <div className="setting-hint">{hint}</div>}
      </div>
      <input
        className="setting-input"
        type="number"
        value={value}
        readOnly={readOnly}
        style={readOnly ? { opacity: 0.5, cursor: 'default' } : {}}
        onChange={e => onChange?.(Number(e.target.value))}
      />
    </div>
  )

  const statSaveLabel = {
    '':          'Save & re-embed',
    saving:      'Saving…',
    embedding:   'Embedding…',
    done:        '✓ Done',
    error:       'Error — retry',
  }[statStatus] ?? 'Save & re-embed'

  return (
    <div className="settings-layout">
      <div className="settings-nav">
        {sections.map(s => (
          <div
            key={s.id}
            className={`settings-nav-item${section === s.id ? ' active' : ''}${ADVANCED_SECTIONS.includes(s.id) ? ' adv' : ''}`}
            style={ADVANCED_SECTIONS.includes(s.id) ? { opacity: 0.75, fontSize: '11px' } : {}}
            onClick={() => setSection(s.id)}
          >{s.label}</div>
        ))}
        <div style={{ padding: '12px 16px 4px', marginTop: 'auto' }}>
          <button
            onClick={() => { setAdvanced(a => !a); if (ADVANCED_SECTIONS.includes(section)) setSection('tasks') }}
            style={{
              fontSize: '10px', fontWeight: 600, letterSpacing: '0.08em',
              color: advanced ? 'var(--accent)' : 'var(--text-muted)',
              padding: '4px 8px', borderRadius: 'var(--radius-sm)',
              border: `1px solid ${advanced ? 'var(--accent)' : 'var(--border)'}`,
              background: advanced ? 'var(--accent-dim)' : 'transparent',
              width: '100%', cursor: 'pointer', transition: 'all var(--t-fast)'
            }}
          >
            {advanced ? '▾ Hide advanced' : '▸ Advanced'}
          </button>
        </div>
      </div>

      <div className="settings-content">

        {section === 'tasks' && (
          <>
            <div className="settings-section">
              <div className="settings-section-title">XP per task type</div>
              {Object.entries(xpBase).map(([type, val]) => (
                <Row key={type} label={type} value={val}
                  onChange={v => setXpBase(b => ({ ...b, [type]: v }))} />
              ))}
            </div>
            <div className="settings-section">
              <div className="settings-section-title">Gold per task type</div>
              {Object.entries(goldBase).map(([type, val]) => (
                <Row key={type} label={type} value={val}
                  onChange={v => setGoldBase(b => ({ ...b, [type]: v }))} />
              ))}
            </div>
            <div className="settings-section">
              <div className="settings-section-title">Difficulty offsets (XP)</div>
              {Object.entries(g.tasks.difficulty_xp_offset).map(([d, v]) => (
                <Row key={d} label={d} value={v} readOnly hint="Edit in game.json" />
              ))}
            </div>
          </>
        )}

        {section === 'energy' && (
          <div className="settings-section">
            <div className="settings-section-title">Energy settings</div>
            <Row label="Max energy"            value={energy.max}                    onChange={v => setEnergy(e => ({ ...e, max: v }))} />
            <Row label="Morning regen"          value={energy.passive_morning_regen}  onChange={v => setEnergy(e => ({ ...e, passive_morning_regen: v }))} />
            <Row label="Recovery task restore"  value={energy.recovery_task_restore}  onChange={v => setEnergy(e => ({ ...e, recovery_task_restore: v }))} />
            <div className="settings-section-title" style={{ marginTop: 12 }}>Drain by type</div>
            {Object.entries(g.energy.drain_by_type).map(([type, val]) => (
              <Row key={type} label={type} value={val} readOnly hint="Edit in game.json" />
            ))}
          </div>
        )}

        {section === 'stats' && (
          <div className="settings-section">
            <div className="settings-section-title">Stat descriptions</div>
            <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginBottom: 14, lineHeight: 1.7 }}>
              Richer descriptions = better task→stat matching via embeddings.
              Be specific about what activities, behaviours, and skills belong to each stat.
            </div>
            {statDefs.map((stat, idx) => (
              <div key={stat.id} style={{ marginBottom: 14 }}>
                <div style={{ fontSize: '11px', fontWeight: 700, color: 'var(--text)', marginBottom: 5, letterSpacing: '0.08em' }}>
                  {stat.name.toUpperCase()}
                </div>
                <textarea
                  value={stat._desc}
                  onChange={e => setStatDefs(prev =>
                    prev.map((s, i) => i === idx ? { ...s, _desc: e.target.value } : s)
                  )}
                  rows={3}
                  style={{
                    width: '100%', background: 'var(--surface2)',
                    border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)',
                    padding: '7px 9px', fontSize: '11px', color: 'var(--text)',
                    resize: 'vertical', fontFamily: 'var(--font)', lineHeight: 1.55,
                    outline: 'none', transition: 'border-color var(--t-fast)',
                    boxSizing: 'border-box'
                  }}
                  onFocus={e  => { e.target.style.borderColor = 'var(--accent)' }}
                  onBlur={e   => { e.target.style.borderColor = 'var(--border)' }}
                />
              </div>
            ))}
            <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginBottom: 10, lineHeight: 1.6 }}>
              Saving will update the DB and automatically regenerate embedding vectors.
              {statStatus === 'embedding' && <span style={{ color: 'var(--accent)' }}> Embedding in progress…</span>}
              {statStatus === 'done'      && <span style={{ color: 'var(--success)' }}> All embeddings updated.</span>}
            </div>
            <button
              className="settings-save"
              disabled={statSaving}
              onClick={saveStats}
              style={statStatus === 'done' ? { background: 'var(--success)' } : {}}
            >
              {statSaveLabel}
            </button>
          </div>
        )}

        {section === 'shop' && (
          <div className="settings-section">
            <div className="settings-section-title">Shop items</div>
            <div style={{ fontSize: '12px', color: 'var(--text-muted)', lineHeight: 1.6 }}>
              Shop items are defined in <span style={{ fontFamily: 'var(--mono)', color: 'var(--accent)' }}>config/game.json → shop.default_items</span> and seeded to the database on first setup.<br /><br />
              Or add items directly via the chat: <span style={{ fontFamily: 'var(--mono)', color: 'var(--accent)' }}>"add a shop item called..."</span>
            </div>
          </div>
        )}

        {section === 'streak' && (
          <div className="settings-section">
            <div className="settings-section-title">Streak formula (advanced)</div>
            <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginBottom: 12, lineHeight: 1.6 }}>
              Bonus XP multiplier grows with streak length.<br />
              Formula: <span style={{ fontFamily: 'var(--mono)', color: 'var(--accent)' }}>
                {g.streak.formula_coefficient} × day^{g.streak.formula_exponent}
              </span>
            </div>
            <Row label="Day 30 bonus"  value="~15%" readOnly />
            <Row label="Day 100 bonus" value="~32%" readOnly />
            <Row label="Day 365 bonus" value="~55%" readOnly />
          </div>
        )}

        {section === 'skills' && (
          <div className="settings-section">
            <div className="settings-section-title">Skill projection (advanced)</div>
            <Row label="Match floor"               value={g.skills.match_floor}               readOnly hint="Min similarity to award XP to a skill" />
            <Row label="Candidate threshold"       value={g.skills.candidate_threshold}       readOnly hint="Tasks needed to graduate a new skill" />
            <Row label="Candidate max distance"    value={g.skills.candidate_max_distance}    readOnly hint="Max cosine distance to join a cluster" />
            <Row label="Child match floor"         value={g.skills.child_match_floor}         readOnly hint="Min similarity for child skill clusters" />
            <Row label="Child candidate threshold" value={g.skills.child_candidate_threshold} readOnly hint="Tasks needed to graduate a child skill" />
          </div>
        )}

        {section !== 'stats' && !ADVANCED_SECTIONS.includes(section) && (
          <button className="settings-save" onClick={save} disabled={saving}>
            {saved ? '✓ Saved' : saving ? 'Saving…' : 'Save changes'}
          </button>
        )}

      </div>
    </div>
  )
}
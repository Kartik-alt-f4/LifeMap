import { useState } from 'react'
import { createTask, createTemplate } from '../api.js'

const TYPES        = ['anchor','mandatory','project','bonus','habit','routine']
const PRIORITIES   = ['P0','P1','P2','P3']
const DIFFICULTIES = ['low','medium','high']
const TIME_BLOCKS  = ['morning','noon','evening','night','midnight']
const RECURRENCES  = ['daily','weekdays','weekends','weekly']

function todayStr() { return new Date().toISOString().split('T')[0] }

export default function AddTaskModal({ config, onClose, onAdded }) {
  const [title,        setTitle]       = useState('')
  const [taskType,     setTaskType]    = useState('mandatory')
  const [priority,     setPriority]    = useState('P2')
  const [difficulty,   setDifficulty]  = useState('medium')
  const [timeBlock,    setTimeBlock]   = useState('')
  const [isRecurring,  setRecurring]   = useState(false)
  const [recurrence,   setRecurrence]  = useState('daily')
  const [isRecovery,   setRecovery]    = useState(false)
  const [useSchedule,  setUseSchedule] = useState(false)
  const [schedDate,    setSchedDate]   = useState(todayStr())
  const [schedTime,    setSchedTime]   = useState('')
  const [submitting,   setSubmitting]  = useState(false)
  const [error,        setError]       = useState('')

  const submit = async () => {
    if (!title.trim()) { setError('Title is required.'); return }
    setSubmitting(true); setError('')

    let scheduled_at = null
    if (useSchedule && schedDate) {
      scheduled_at = schedTime
        ? new Date(`${schedDate}T${schedTime}:00`).toISOString()
        : new Date(`${schedDate}T09:00:00`).toISOString()
    }

    try {
      const payload = {
        title:      title.trim(),
        task_type:  taskType,
        priority,
        difficulty,
        time_block:   (!useSchedule && timeBlock) ? timeBlock : null,
        is_recovery:  isRecovery,
        scheduled_for: useSchedule ? schedDate : undefined,
        scheduled_at
      }

      if (isRecurring) {
        await createTemplate({ ...payload, recurrence_pattern: recurrence })
      } else {
        await createTask(payload)
      }
      onAdded()
    } catch (e) { setError(e.message); setSubmitting(false) }
  }

  const Seg = ({ options, value, onChange, getClass }) => (
    <div className="seg-group">
      {options.map(o => (
        <button key={o} type="button"
          className={`seg-btn${value === o ? ' active' : ''}${getClass ? ' ' + getClass(o) : ''}`}
          onClick={() => onChange(o)}
        >{o}</button>
      ))}
    </div>
  )

  const Toggle = ({ label, hint, value, onChange }) => (
    <div className="toggle-row">
      <div>
        <div className="at-label">{label}</div>
        {hint && <div style={{ fontSize:'11px', color:'var(--text-muted)', marginTop:2 }}>{hint}</div>}
      </div>
      <div className={`toggle-track${value ? ' on' : ''}`} onClick={() => onChange(!value)}>
        <div className="toggle-thumb" />
      </div>
    </div>
  )

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="at-panel">
        <div>
          <div className="at-title">New task</div>
          <div className="at-subtitle">Title + type required. Everything else optional.</div>
        </div>

        <div className="at-field">
          <label className="at-label">Title <span style={{ color:'var(--accent)' }}>*</span></label>
          <input
            className="at-input"
            placeholder="What needs to be done?"
            value={title}
            onChange={e => setTitle(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && submit()}
            autoFocus
          />
        </div>

        <div className="at-field">
          <label className="at-label">Type <span style={{ color:'var(--accent)' }}>*</span></label>
          <Seg options={TYPES} value={taskType} onChange={setTaskType} />
        </div>

        <div className="at-field">
          <label className="at-label">Priority</label>
          <Seg options={PRIORITIES} value={priority} onChange={setPriority}
            getClass={o => ({ P0:'p0', P1:'p1' })[o] ?? ''} />
        </div>

        <div className="at-field">
          <label className="at-label">Difficulty</label>
          <Seg options={DIFFICULTIES} value={difficulty} onChange={setDifficulty} />
        </div>

        {/* Time block OR specific schedule — mutually exclusive */}
        {!useSchedule && (
          <div className="at-field">
            <label className="at-label">Time block <span style={{ color:'var(--text-muted)', fontWeight:400 }}>(optional)</span></label>
            <div className="seg-group">
              {TIME_BLOCKS.map(b => (
                <button key={b} type="button"
                  className={`seg-btn${timeBlock === b ? ' active' : ''}`}
                  onClick={() => setTimeBlock(tb => tb === b ? '' : b)}
                >{b}</button>
              ))}
            </div>
          </div>
        )}

        <Toggle
          label="Schedule at specific time"
          hint={useSchedule ? '' : 'Pin to a date and/or exact time'}
          value={useSchedule}
          onChange={v => { setUseSchedule(v); if (v) setTimeBlock('') }}
        />

        {useSchedule && (
          <div style={{ display:'flex', gap:10 }}>
            <div className="at-field" style={{ flex:1 }}>
              <label className="at-label">Date</label>
              <input
                type="date"
                className="at-input"
                style={{ colorScheme:'dark' }}
                value={schedDate}
                onChange={e => setSchedDate(e.target.value)}
              />
            </div>
            <div className="at-field" style={{ flex:1 }}>
              <label className="at-label">Time <span style={{ color:'var(--text-muted)', fontWeight:400 }}>(optional)</span></label>
              <input
                type="time"
                className="at-input"
                style={{ colorScheme:'dark' }}
                value={schedTime}
                onChange={e => setSchedTime(e.target.value)}
              />
            </div>
          </div>
        )}

        <Toggle
          label="Recurring task"
          hint="Spawns daily from a template"
          value={isRecurring}
          onChange={setRecurring}
        />

        {isRecurring && (
          <div className="at-field">
            <label className="at-label">Recurrence</label>
            <Seg options={RECURRENCES} value={recurrence} onChange={setRecurrence} />
          </div>
        )}

        <Toggle
          label="Recovery task"
          hint="Restores +15 energy on completion"
          value={isRecovery}
          onChange={setRecovery}
        />

        {error && <div className="at-error">{error}</div>}

        <div className="at-actions">
          <button className="at-cancel" onClick={onClose}>Cancel</button>
          <button className="at-submit" onClick={submit} disabled={submitting}>
            {submitting ? 'Adding…' : isRecurring ? 'Add recurring' : 'Add task'}
          </button>
        </div>
      </div>
    </div>
  )
}
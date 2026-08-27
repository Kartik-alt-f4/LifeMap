import { useState } from 'react'
import { editTask } from '../api.js'

const TYPE_ICONS = { anchor:'⚓', mandatory:'⚔', project:'📋', bonus:'⭐', habit:'🔄', routine:'🌿' }
const TYPES        = ['anchor','mandatory','project','bonus','habit','routine']
const PRIORITIES   = ['P0','P1','P2','P3']
const DIFFICULTIES = ['low','medium','high']
const TIME_BLOCKS  = ['morning','noon','evening','night','midnight','']

function computeRewards(task, config) {
  const g = config?.game
  if (!g) return { xp: 0, gold: 0, energy: 0 }
  const xp   = Math.max(0,
    (g.tasks.xp_base[task.task_type]                ?? 0) +
    (g.tasks.difficulty_xp_offset?.[task.difficulty] ?? 0)
  )
  const gold = Math.max(g.tasks.gold_floor ?? 1,
    (g.tasks.gold_base[task.task_type]                ?? 0) +
    (g.tasks.difficulty_gold_offset?.[task.difficulty] ?? 0)
  )
  const energyBase   = g.energy.drain_by_type?.[task.task_type]              ?? 5
  const energyOffset = g.energy.drain_difficulty_offset?.[task.difficulty]   ?? 0
  const energy       = Math.max(g.energy.drain_floor ?? 1, energyBase + energyOffset)
  return { xp, gold, energy }
}

export default function TaskDrawer({ task, config, isToday, onComplete, onSkip, onCancel, onClose, onEdited }) {
  const [editing,    setEditing]    = useState(false)
  const [saving,     setSaving]     = useState(false)
  const [editError,  setEditError]  = useState('')

  // Edit fields
  const [title,      setTitle]      = useState(task.title)
  const [taskType,   setTaskType]   = useState(task.task_type)
  const [priority,   setPriority]   = useState(task.priority)
  const [difficulty, setDifficulty] = useState(task.difficulty)
  const [timeBlock,  setTimeBlock]  = useState(task.time_block ?? '')
  const [isRecovery, setRecovery]   = useState(task.is_recovery ?? false)

  const { xp, gold, energy } = computeRewards(
    editing ? { ...task, task_type: taskType, difficulty } : task,
    config
  )

  const isPending   = task.status === 'pending'
  const isCompleted = task.status === 'completed'
  const isSkipped   = task.status === 'skipped'

  const saveEdit = async () => {
    setSaving(true); setEditError('')
    try {
      await editTask(task.id, {
        title, task_type: taskType, priority, difficulty,
        time_block: timeBlock || null, is_recovery: isRecovery
      })
      setEditing(false)
      onEdited?.()
    } catch (e) { setEditError(e.message) }
    finally { setSaving(false) }
  }

  const Seg = ({ options, value, onChange, small }) => (
    <div className="seg-group" style={{ flexWrap:'wrap', gap:3 }}>
      {options.filter(Boolean).map(o => (
        <button key={o} type="button"
          className={`seg-btn${value === o ? ' active' : ''}`}
          style={small ? { fontSize:'9px', padding:'2px 6px' } : {}}
          onClick={() => onChange(o)}
        >{o || 'none'}</button>
      ))}
    </div>
  )

  return (
    <div className="drawer">
      <div className="drawer-inner">
        <div className="drawer-header">
          <div style={{ display:'flex', alignItems:'center', gap:6 }}>
            <span style={{ fontSize:16 }}>{TYPE_ICONS[task.task_type] ?? '◈'}</span>
            <span className="drawer-type">{task.task_type}</span>
          </div>
          <button className="drawer-close" onClick={onClose}>✕</button>
        </div>

        {editing ? (
          <>
            <div className="at-field">
              <label className="at-label">Title</label>
              <input className="at-input" value={title} onChange={e => setTitle(e.target.value)} style={{ fontSize:13 }} />
            </div>
            <div className="at-field">
              <label className="at-label">Type</label>
              <Seg options={TYPES} value={taskType} onChange={setTaskType} small />
            </div>
            <div style={{ display:'flex', gap:8 }}>
              <div className="at-field" style={{ flex:1 }}>
                <label className="at-label">Priority</label>
                <Seg options={PRIORITIES} value={priority} onChange={setPriority} small />
              </div>
              <div className="at-field" style={{ flex:1 }}>
                <label className="at-label">Difficulty</label>
                <Seg options={DIFFICULTIES} value={difficulty} onChange={setDifficulty} small />
              </div>
            </div>
            <div className="at-field">
              <label className="at-label">Time block</label>
              <Seg options={[...TIME_BLOCKS]} value={timeBlock} onChange={v => setTimeBlock(v === timeBlock ? '' : v)} small />
            </div>
            <div className="toggle-row">
              <span className="at-label">Recovery</span>
              <div className={`toggle-track${isRecovery ? ' on' : ''}`} onClick={() => setRecovery(r => !r)}>
                <div className="toggle-thumb" />
              </div>
            </div>
            {editError && <div className="drawer-error">{editError}</div>}
            <div className="drawer-actions">
              <button className="drawer-complete" onClick={saveEdit} disabled={saving}>
                {saving ? 'Saving…' : 'Save changes'}
              </button>
              <button className="drawer-edit" onClick={() => setEditing(false)}>Cancel edit</button>
            </div>
          </>
        ) : (
          <>
            <div className="drawer-title">{task.title}</div>

            <div className="tags" style={{ flexWrap:'wrap' }}>
              {task.priority   && <span className={`tag tag-${task.priority.toLowerCase()}`}>{task.priority}</span>}
              {task.difficulty && <span className="tag">{task.difficulty}</span>}
              {task.time_block && <span className="tag">{task.time_block}</span>}
              {task.is_recovery && <span className="tag" style={{ borderColor:'rgba(62,207,142,0.3)', color:'var(--success)' }}>recovery</span>}
              {task.late_multiplier < 1.0 && (
                <span className="tag" style={{ borderColor:'rgba(240,180,41,0.3)', color:'var(--warning)' }}>
                  −{Math.round((1-task.late_multiplier)*100)}% late
                </span>
              )}
            </div>

            {task.description && (
              <div className="drawer-desc">{task.description}</div>
            )}

            <div className="drawer-rewards">
              <div className="drawer-reward">
                <span className="dr-label">XP</span>
                <span className="dr-value xp-color">+{xp}</span>
              </div>
              <div className="drawer-reward">
                <span className="dr-label">Gold</span>
                <span className="dr-value gold-color">+{gold}g</span>
              </div>
              <div className="drawer-reward">
                <span className="dr-label">Energy</span>
                <span className="dr-value" style={{ color:'var(--text-muted)' }}>−{energy}⚡</span>
              </div>
            </div>

            <div className="drawer-actions">
              {isCompleted && <div className="drawer-done-label">✓ Completed</div>}
              {isSkipped   && <div className="drawer-done-label" style={{ color:'var(--text-muted)' }}>Skipped</div>}

              {isPending && isToday && (
                <button className="drawer-complete" onClick={() => onComplete(task.id)}>
                  Mark complete
                </button>
              )}
              {isPending && (
                <>
                  <button className="drawer-edit" onClick={() => setEditing(true)}>Edit task</button>
                  <button className="drawer-edit" onClick={() => onSkip(task.id)}
                    style={{ borderColor:'var(--border)', color:'var(--text-muted)' }}>
                    Skip for today
                  </button>
                  <button className="drawer-cancel-link" onClick={() => onCancel(task.id)}>Cancel task</button>
                </>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
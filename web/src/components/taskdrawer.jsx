import { editTask } from '../api.js'

const TYPE_ICONS = { anchor:'⚓', mandatory:'⚔', project:'📋', bonus:'⭐', habit:'🔄', routine:'🌿' }

function computeRewards(task, config) {
  const g = config?.game
  if (!g) return { xp: 0, gold: 0, energy: 0 }
  const xp    = g.tasks.xp_base[task.task_type] ?? 0
  const gold  = Math.max(g.tasks.gold_floor, (g.tasks.gold_base[task.task_type] ?? 0) + (g.tasks.difficulty_gold_offset?.[task.difficulty] ?? 0))
  const energy = g.energy.drain_by_type[task.task_type] ?? 5
  return { xp, gold, energy }
}

export default function TaskDrawer({ task, config, isToday, onComplete, onSkip, onCancel, onClose }) {
  const { xp, gold, energy } = computeRewards(task, config)
  const isPending   = task.status === 'pending'
  const isCompleted = task.status === 'completed'
  const isSkipped   = task.status === 'skipped'

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

        <div className="drawer-title">{task.title}</div>

        <div className="tags" style={{ flexWrap:'wrap' }}>
          {task.priority   && <span className={`tag tag-${task.priority.toLowerCase()}`}>{task.priority}</span>}
          {task.difficulty && <span className="tag">{task.difficulty}</span>}
          {task.time_block && <span className="tag">{task.time_block}</span>}
          {task.is_recovery && <span className="tag" style={{ borderColor:'rgba(62,207,142,0.3)', color:'var(--success)' }}>recovery</span>}
          {task.late_multiplier < 1.0 && (
            <span className="tag" style={{ borderColor:'rgba(240,180,41,0.3)', color:'var(--warning)' }}>
              −{Math.round((1 - task.late_multiplier) * 100)}% late
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
              <button className="drawer-edit" onClick={() => onSkip(task.id)}>Skip for today</button>
              <button className="drawer-cancel-link" onClick={() => onCancel(task.id)}>Cancel task</button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
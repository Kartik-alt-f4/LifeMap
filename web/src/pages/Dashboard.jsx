import { useState, useEffect, useRef, useCallback } from 'react'
import { getTasks, completeTask, skipTask, cancelTask, chat } from '../api.js'
import AddTaskModal from '../components/AddTaskModal.jsx'
import TaskDrawer   from '../components/TaskDrawer.jsx'
import CalendarModal from '../components/CalendarModal.jsx'

const TYPE_ICONS = { anchor:'⚓', mandatory:'⚔', project:'📋', bonus:'⭐', habit:'🔄', routine:'🌿' }

function todayStr() { return new Date().toISOString().split('T')[0] }

function formatDate(d) {
  const date  = new Date(d + 'T00:00:00')
  const today = new Date(); today.setHours(0,0,0,0)
  const diff  = Math.round((date - today) / 86400000)
  if (diff === 0)  return 'Today'
  if (diff === -1) return 'Yesterday'
  if (diff === 1)  return 'Tomorrow'
  return date.toLocaleDateString('en-US', { weekday:'short', month:'short', day:'numeric' })
}

function shiftDate(d, days) {
  const date = new Date(d + 'T00:00:00')
  date.setDate(date.getDate() + days)
  return date.toISOString().split('T')[0]
}

function computeRewards(task, config) {
  const g = config?.game
  if (!g) return { xp: 0, gold: 0 }
  const xp   = Math.max(0,
    (g.tasks.xp_base[task.task_type]           ?? 0) +
    (g.tasks.difficulty_xp_offset?.[task.difficulty] ?? 0)
  )
  const gold = Math.max(g.tasks.gold_floor ?? 1,
    (g.tasks.gold_base[task.task_type]           ?? 0) +
    (g.tasks.difficulty_gold_offset?.[task.difficulty] ?? 0)
  )
  return { xp, gold }
}

const BLOCK_END_HOURS = { morning:12, noon:14, evening:19, night:23, midnight:6 }

function isOverdue(task) {
  if (task.status !== 'pending') return false
  // Carried from previous day
  if (task.late_multiplier < 1.0) return true
  // Has exact time and it's passed
  if (task.scheduled_at) {
    return new Date(task.scheduled_at) < new Date()
  }
  // Time block has ended (EST)
  if (task.time_block) {
    const estHour = parseInt(
      new Date().toLocaleString('en-US', { timeZone: 'America/New_York', hour: 'numeric', hour12: false }).replace('24','0'), 10
    )
    const blockEnd = BLOCK_END_HOURS[task.time_block]
    if (blockEnd) return estHour >= blockEnd
  }
  return false
}

export default function Dashboard({ playerState, config, onRefresh }) {
  const [date,       setDate]       = useState(todayStr())
  const [tasks,      setTasks]      = useState(null)
  const [loading,    setLoading]    = useState(true)
  const [selected,   setSelected]   = useState(null)
  const [showAdd,    setShowAdd]    = useState(false)
  const [showCal,    setShowCal]    = useState(false)
  const [messages,   setMessages]   = useState([])
  const [chatInput,  setChatInput]  = useState('')
  const [sending,    setSending]    = useState(false)
  const messagesEnd = useRef(null)
  const isToday     = date === todayStr()

  const loadTasks = useCallback(async (d) => {
    setLoading(true)
    try {
      const data = await getTasks(d === todayStr() ? undefined : d)
      setTasks(data)
    } catch (e) { console.error(e) }
    finally { setLoading(false) }
  }, [])

  useEffect(() => { loadTasks(date) }, [date, loadTasks])

  useEffect(() => {
    // Listen for Add Task button in navbar
    const handler = (e) => {
      if (e.target.dataset.addtask) setShowAdd(true)
    }
    document.addEventListener('click', handler)
    return () => document.removeEventListener('click', handler)
  }, [])

  useEffect(() => {
    messagesEnd.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const goDate = (days) => setDate(d => shiftDate(d, days))

  const handleComplete = async (taskId) => {
    try {
      await completeTask(taskId)
      await loadTasks(date)
      await onRefresh()
      setSelected(null)
    } catch (e) { console.error(e) }
  }

  const handleSkip = async (taskId) => {
    try {
      await skipTask(taskId)
      await loadTasks(date)
      setSelected(null)
    } catch (e) { console.error(e) }
  }

  const handleCancel = async (taskId) => {
    try {
      await cancelTask(taskId)
      await loadTasks(date)
      setSelected(null)
    } catch (e) { console.error(e) }
  }

  const sendChat = async () => {
    if (!chatInput.trim() || sending) return
    const text = chatInput.trim()
    setChatInput('')
    setSending(true)
    setMessages(m => [...m, { role:'user', text }])

    try {
      const { reply } = await chat(text)
      setMessages(m => [...m, { role:'system', text: reply }])
      await loadTasks(date)
      await onRefresh()
    } catch (e) {
      setMessages(m => [...m, { role:'system', text:`⚠ ${e.message}` }])
    } finally { setSending(false) }
  }

  // Next pending task
  // Next task: prefer pending + not overdue, fall back to first pending
  const nextTask = tasks?.find(t => t.status === 'pending' && !isOverdue(t))
    ?? tasks?.find(t => t.status === 'pending')
  const sorted   = tasks ? [...tasks].sort((a, b) => {
    if (a.status === 'completed' && b.status !== 'completed') return 1
    if (a.status !== 'completed' && b.status === 'completed') return -1
    return 0
  }) : []

  return (
    <main className="main">
      {/* ── LEFT: Task panel ── */}
      <section className="col" style={{ position:'relative' }}>

        {/* Task drawer overlay */}
        {selected && (
          <TaskDrawer
            task={selected}
            config={config}
            isToday={isToday}
            onComplete={handleComplete}
            onSkip={handleSkip}
            onCancel={handleCancel}
            onClose={() => setSelected(null)}
            onEdited={() => loadTasks(date)}
          />
        )}

        {/* Next task card */}
        {nextTask ? (
          <div className="next-card" onClick={() => setSelected(nextTask)} style={{ cursor:'pointer' }}>
            <div>
              <div className="next-label">▶ next up</div>
              <div className="next-title" style={{ overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                {nextTask.title}
              </div>
            </div>
            <div>
              <div className="tags" style={{ marginBottom:6 }}>
                <span className={`tag tag-${nextTask.task_type}`}>{nextTask.task_type}</span>
                <span className={`tag tag-${nextTask.priority?.toLowerCase()}`}>{nextTask.priority}</span>
                {nextTask.difficulty && <span className="tag">{nextTask.difficulty}</span>}
                {nextTask.time_block  && <span className="tag">{nextTask.time_block}</span>}
              </div>
              {config && (() => {
                const { xp, gold } = computeRewards(nextTask, config)
                return (
                  <div className="next-rewards">
                    <span className="reward reward-xp">+{xp} XP</span>
                    <span className="reward reward-gold">+{gold}g</span>
                  </div>
                )
              })()}
            </div>
          </div>
        ) : (
          <div className="next-card">
            <div>
              <div className="next-label">▶ all clear</div>
              <div className="next-title" style={{ color:'var(--text-muted)' }}>No pending tasks.</div>
            </div>
            <div />
          </div>
        )}

        {/* Date selector */}
        <div className="date-selector">
          <button className="date-nav-btn" onClick={() => goDate(-1)}>‹</button>
          <button className="date-display" onClick={() => setShowCal(true)}>
            <span>{formatDate(date)}</span>
            <span className="cal-icon">📅</span>
          </button>
          <button className="date-nav-btn" onClick={() => goDate(1)}>›</button>
        </div>

        {/* Task list */}
        <div className="card task-list-card">
          <div className="card-header">
            <span className="card-title">Tasks</span>
            <span className="count-badge">
              {tasks ? `${tasks.filter(t => t.status === 'pending').length} pending` : '—'}
            </span>
          </div>
          <div className="task-list">
            {loading ? (
              [0,1,2].map(i => <div key={i} className="skeleton" />)
            ) : sorted.length === 0 ? (
              <div className="empty-state">No tasks for this day.</div>
            ) : sorted.map(task => {
              const { xp, gold } = computeRewards(task, config)
              const done    = task.status === 'completed'
              const urgent  = isOverdue(task)
              const carried = task.late_multiplier < 1.0 && !done
              return (
                <div
                  key={task.id}
                  className={`task-row${done ? ' completed' : task.status === 'skipped' ? ' skipped' : urgent ? ' urgent' : carried ? ' carried' : ''}`}
                  onClick={() => setSelected(task)}
                >
                  <span className="task-icon">{done ? '✓' : TYPE_ICONS[task.task_type] ?? '◈'}</span>
                  <div className="task-body">
                    <div className="task-title-row">
                      <span className={`task-name${done ? ' done' : ''}`}>{task.title}</span>
                      <div className="task-rewards-inline">
                        <span className="t-reward xp-color">+{xp}</span>
                        <span className="t-reward gold-color">+{gold}g</span>
                      </div>
                    </div>
                    <div className="task-meta" style={{ display:'flex', gap:3, flexWrap:'wrap', marginTop:3 }}>
                      <span className={`tag tag-${task.task_type}`} style={{ fontSize:'9px', padding:'1px 5px' }}>{task.task_type}</span>
                      <span className={`tag tag-${task.priority?.toLowerCase()}`} style={{ fontSize:'9px', padding:'1px 5px' }}>{task.priority}</span>
                      {task.time_block && <span className="tag" style={{ fontSize:'9px', padding:'1px 5px' }}>{task.time_block}</span>}
                      {task.difficulty && task.difficulty !== 'medium' && <span className="tag" style={{ fontSize:'9px', padding:'1px 5px' }}>{task.difficulty}</span>}
                      {carried && <span className="tag" style={{ fontSize:'9px', padding:'1px 5px', borderColor:'rgba(240,180,41,0.3)', color:'var(--warning)' }}>carried</span>}
                      {task.is_recovery && <span className="tag" style={{ fontSize:'9px', padding:'1px 5px', borderColor:'rgba(62,207,142,0.25)', color:'var(--success)' }}>recovery</span>}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      </section>

      {/* ── RIGHT: Chat panel ── */}
      <section className="col">
        <div className="card chat-card">
          <div className="card-header">
            <span className="card-title">System interface</span>
            <span className="chat-session">SESSION: WEB</span>
          </div>

          <div className="chat-messages">
            {messages.length === 0 ? (
              <div className="chat-welcome">
                <div className="welcome-icon">◈</div>
                <div className="welcome-text">System online. How can I help?</div>
              </div>
            ) : messages.map((m, i) => (
              <div key={i} className={`message ${m.role}`}>
                <div className="bubble">{m.text}</div>
              </div>
            ))}
            {sending && (
              <div className="message system">
                <div className="bubble">
                  <div className="typing">
                    <span/><span/><span/>
                  </div>
                </div>
              </div>
            )}
            <div ref={messagesEnd} />
          </div>

          <div className="chat-input-area">
            <div className="input-row">
              <textarea
                className="chat-input"
                placeholder="Add a task, mark done, ask anything..."
                rows={1}
                value={chatInput}
                onChange={e => {
                  setChatInput(e.target.value)
                  e.target.style.height = 'auto'
                  e.target.style.height = Math.min(e.target.scrollHeight, 120) + 'px'
                }}
                onKeyDown={e => {
                  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendChat() }
                }}
              />
              <button className="send-btn" onClick={sendChat} disabled={sending}>▶</button>
            </div>
          </div>
        </div>
      </section>

      {/* Modals */}
      {showAdd && (
        <AddTaskModal
          config={config}
          onClose={() => setShowAdd(false)}
          onAdded={async () => { setShowAdd(false); await loadTasks(date); await onRefresh() }}
        />
      )}
      {showCal && (
        <CalendarModal
          onClose={() => setShowCal(false)}
          onSelectDate={d => { setDate(d); setShowCal(false) }}
        />
      )}
    </main>
  )
}
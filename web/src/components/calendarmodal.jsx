import { useState, useEffect } from 'react'
import { getCalendar } from '../api.js'

function todayStr() { return new Date().toISOString().split('T')[0] }

export default function CalendarModal({ onClose, onSelectDate }) {
  const now = new Date()
  const [year,  setYear]  = useState(now.getFullYear())
  const [month, setMonth] = useState(now.getMonth() + 1)
  const [data,  setData]  = useState({})

  const monthStr = `${year}-${String(month).padStart(2,'0')}`

  useEffect(() => {
    getCalendar(monthStr).then(setData).catch(console.error)
  }, [monthStr])

  const shiftMonth = (d) => {
    let m = month + d, y = year
    if (m > 12) { m = 1;  y++ }
    if (m < 1)  { m = 12; y-- }
    setMonth(m); setYear(y)
  }

  const firstDay = new Date(year, month - 1, 1).getDay()
  const offset   = firstDay === 0 ? 6 : firstDay - 1
  const daysInMonth = new Date(year, month, 0).getDate()
  const today    = todayStr()
  const monthName = new Date(year, month - 1, 1).toLocaleDateString('en-US', { month:'short', year:'numeric' })

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ width: 'min(480px, calc(100vw - 32px))', maxHeight:'auto' }}>
        <div className="modal-header">
          <span className="modal-title">Calendar</span>
          <div className="cal-nav">
            <button className="cal-nav-btn" onClick={() => shiftMonth(-1)}>‹</button>
            <span className="cal-month">{monthName.toUpperCase()}</span>
            <button className="cal-nav-btn" onClick={() => shiftMonth(1)}>›</button>
          </div>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>
        <div className="cal-grid-wrap">
          <div className="cal-weekdays">
            {['Mo','Tu','We','Th','Fr','Sa','Su'].map(d => <span key={d}>{d}</span>)}
          </div>
          <div className="cal-days">
            {Array(offset).fill(null).map((_, i) => <div key={`e${i}`} className="cal-day empty" />)}
            {Array(daysInMonth).fill(null).map((_, i) => {
              const day     = i + 1
              const dateStr = `${monthStr}-${String(day).padStart(2,'0')}`
              const d       = data[dateStr]
              const isToday = dateStr === today
              return (
                <div
                  key={day}
                  className={`cal-day${isToday ? ' today' : ''}`}
                  onClick={() => onSelectDate(dateStr)}
                >
                  <span className="cal-day-num">{day}</span>
                  {d && d.total > 0 && (
                    <div className="cal-dots">
                      {d.completed > 0 && <span className="cal-dot dot-done" />}
                      {d.skipped   > 0 && <span className="cal-dot dot-skipped" />}
                      {d.pending   > 0 && <span className="cal-dot dot-pending" />}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      </div>
    </div>
  )
}
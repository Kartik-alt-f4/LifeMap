// dateUtils.js — the app's single source of truth for "what day is it".
// Every "today" the app computes is anchored to America/New_York, not the
// server's local time or UTC. `new Date().toISOString().split('T')[0]` is
// always the UTC calendar date — after ~7-8pm EST that's already tomorrow,
// which used to silently misdate tasks created in the evening, "today's
// tasks" fetches, chat context, and cron carryover windows.

// "Today" as a YYYY-MM-DD string, in America/New_York. en-CA formats dates
// as YYYY-MM-DD, which is what makes this a one-liner.
export function todayEST() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' })
}

// Pure calendar-date arithmetic on a YYYY-MM-DD string — treats it as a plain
// calendar date, not a moment in time, so it's immune to DST edge cases near
// midnight (unlike adding 86400000ms to a real Date, which can land on the
// wrong side of a spring-forward/fall-back day).
export function addDays(dateStr, days) {
  const [y, m, d] = dateStr.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d))
  dt.setUTCDate(dt.getUTCDate() + days)
  return dt.toISOString().split('T')[0]
}

export function tomorrowEST() {
  return addDays(todayEST(), 1)
}

// The agent writes scheduled_at as a naive "YYYY-MM-DDTHH:mm:ss" string with
// no timezone marker — "3pm" means 3pm America/New_York, but nothing says so
// on the wire. Stored in a timestamp-without-timezone column and later
// re-parsed with `new Date()`, that gets silently reinterpreted using
// whatever timezone the *reading* process happens to be running in — right on
// this box today only because its local zone happens to also be
// America/New_York, and wrong the moment that's no longer true.
// This makes the actual intended instant explicit: if the string already
// carries a timezone (Z or ±HH:mm), it's trusted as-is; otherwise it's parsed
// as America/New_York wall-clock time (DST-correct) and converted to a real,
// unambiguous UTC instant. Call this once, at write time — everything
// downstream (SQL range comparisons, JS Date arithmetic) is then comparing
// true instants and needs no special-casing of its own.
export function estNaiveToUTC(dateTimeStr) {
  if (!dateTimeStr) return dateTimeStr
  if (/[Zz]|[+-]\d{2}:?\d{2}$/.test(dateTimeStr)) {
    return new Date(dateTimeStr).toISOString()
  }

  const utcGuess = new Date(dateTimeStr + 'Z')
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false
  }).formatToParts(utcGuess).reduce((acc, p) => { acc[p.type] = p.value; return acc }, {})
  const hour = parts.hour === '24' ? '00' : parts.hour
  const estAsIfUTC = new Date(`${parts.year}-${parts.month}-${parts.day}T${hour}:${parts.minute}:${parts.second}Z`)
  const offsetMs   = utcGuess.getTime() - estAsIfUTC.getTime()

  return new Date(utcGuess.getTime() + offsetMs).toISOString()
}

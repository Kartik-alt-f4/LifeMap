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

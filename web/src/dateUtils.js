// dateUtils.js — mirrors api/src/dateUtils.js. "Today" must be computed in
// America/New_York, not the browser's local timezone or UTC —
// `new Date().toISOString().split('T')[0]` is the UTC calendar date, which is
// already tomorrow after ~8pm EDT / 7pm EST, silently defaulting the app to
// the wrong day's task list for anyone using it in the evening.

export function todayEST() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' })
}

// Pure calendar-date arithmetic on a YYYY-MM-DD string — immune to DST edge
// cases near midnight, unlike building a browser-local Date and calling
// .setDate() (which can land on the wrong side of a spring-forward/fall-back
// day whenever the browser's local timezone isn't America/New_York).
export function addDays(dateStr, days) {
  const [y, m, d] = dateStr.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d))
  dt.setUTCDate(dt.getUTCDate() + days)
  return dt.toISOString().split('T')[0]
}

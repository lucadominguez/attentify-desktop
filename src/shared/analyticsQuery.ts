import type { ActivitySession, AnalyticsQuerySpec } from './types'

// Shared analytics aggregation. Deliberately lives in `shared/` so the AI tool
// (main process) and the Analytics page (renderer) compute custom cards identically —
// the tool validates/snapshots a query, and the page recomputes it live from the same
// logic. This is what makes a user-described card trustworthy and reusable.

export interface AnalyticsRow {
  label: string
  value: number        // milliseconds, session count, or 0-100 focus ratio (see unit)
  detail?: string
}

export interface AnalyticsResult {
  rows: AnalyticsRow[]
  unit: 'ms' | 'count' | 'percent'
  total: number        // sum for time/count; overall focus ratio for focus_ratio
  matched: number      // number of sessions that passed the filter
}

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

function domainOf(s: ActivitySession): string {
  if (s.url) {
    try { return new URL(s.url).hostname.replace(/^www\./, '') } catch { /* fall through */ }
  }
  return s.app
}

function keyFor(s: ActivitySession, groupBy: AnalyticsQuerySpec['groupBy']): string {
  switch (groupBy) {
    case 'app': return s.app || 'unknown'
    case 'category': return s.category || 'other'
    case 'domain': return domainOf(s)
    case 'hour': return String(new Date(s.startTime).getHours())
    case 'weekday': return WEEKDAYS[new Date(s.startTime).getDay()]!
  }
}

export function runAnalyticsQuery(sessions: ActivitySession[], spec: AnalyticsQuerySpec): AnalyticsResult {
  const cutoff = Date.now() - Math.max(1, spec.rangeDays) * 24 * 60 * 60 * 1000
  const filtered = sessions.filter((s) => {
    if (s.startTime < cutoff) return false
    if (spec.distraction === 'only' && !s.isDistraction) return false
    if (spec.distraction === 'exclude' && s.isDistraction) return false
    return true
  })

  // Accumulate per group: total time, session count, and focused-time for ratio.
  const acc = new Map<string, { time: number; count: number; focused: number }>()
  for (const s of filtered) {
    const k = keyFor(s, spec.groupBy)
    const cur = acc.get(k) ?? { time: 0, count: 0, focused: 0 }
    cur.time += s.duration
    cur.count += 1
    if (!s.isDistraction) cur.focused += s.duration
    acc.set(k, cur)
  }

  const unit: AnalyticsResult['unit'] = spec.metric === 'time' ? 'ms' : spec.metric === 'sessions' ? 'count' : 'percent'

  let rows: AnalyticsRow[] = [...acc.entries()].map(([label, v]) => {
    const value =
      spec.metric === 'time' ? v.time :
      spec.metric === 'sessions' ? v.count :
      v.time > 0 ? Math.round((v.focused / v.time) * 100) : 0
    const detail =
      spec.metric === 'focus_ratio' ? `${v.count} sessions` :
      spec.metric === 'sessions' ? `${Math.round(v.time / 60000)}m` :
      `${v.count} sessions`
    return { label, value, detail }
  })

  // Hour/weekday read best in chronological order; everything else by magnitude.
  if (spec.groupBy === 'hour') rows.sort((a, b) => Number(a.label) - Number(b.label))
  else if (spec.groupBy === 'weekday') rows.sort((a, b) => WEEKDAYS.indexOf(a.label) - WEEKDAYS.indexOf(b.label))
  else rows.sort((a, b) => b.value - a.value)

  if (spec.limit && spec.limit > 0 && spec.groupBy !== 'hour' && spec.groupBy !== 'weekday') {
    rows = rows.slice(0, spec.limit)
  }

  // Prettify the hour labels after sorting.
  if (spec.groupBy === 'hour') {
    rows = rows.map((r) => {
      const h = Number(r.label)
      const label = h === 0 ? '12am' : h < 12 ? `${h}am` : h === 12 ? '12pm' : `${h - 12}pm`
      return { ...r, label }
    })
  }

  const totalTime = filtered.reduce((a, s) => a + s.duration, 0)
  const totalFocused = filtered.reduce((a, s) => a + (s.isDistraction ? 0 : s.duration), 0)
  const total =
    spec.metric === 'time' ? totalTime :
    spec.metric === 'sessions' ? filtered.length :
    totalTime > 0 ? Math.round((totalFocused / totalTime) * 100) : 0

  return { rows, unit, total, matched: filtered.length }
}

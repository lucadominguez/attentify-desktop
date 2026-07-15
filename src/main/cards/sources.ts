import { getActiveGoals, getPreferences, getPatterns, getInferences } from '../data/repository'
import { getStore } from '../store'
import type { CardSource } from '../../shared/types'

// Resolves the non-activity card sources.
//
// runAnalyticsQuery only takes ActivitySession[], because activity is a uniform log you
// can aggregate. The other sources are not that shape at all: goals, preferences,
// inferences and patterns are DB tables, and schedules live in the store. They are not
// aggregations, they are the AI's working memory, so they render as a `list` rather than
// a chart and are resolved here instead of being forced through the query engine.
//
// This is what makes Logic expressible as cards. The tools to MUTATE these already
// exist (add_goal, set_preference, resolve_inference); only reading them is new.

export interface CardItem {
  label: string
  detail?: string
}

const ago = (ts: number): string => {
  const d = Math.floor((Date.now() - ts) / 86400000)
  if (d <= 0) return 'today'
  if (d === 1) return 'yesterday'
  if (d < 30) return `${d}d ago`
  return `${Math.floor(d / 30)}mo ago`
}

export function resolveSource(source: CardSource, limit = 10): CardItem[] {
  switch (source) {
    case 'goals':
      return getActiveGoals()
        .slice(0, limit)
        .map((g) => ({ label: g.text, detail: `set ${ago(g.created_at)}` }))

    case 'preferences':
      return getPreferences()
        .slice(0, limit)
        .map((p) => ({ label: `${p.key}: ${p.value}`, detail: p.scope === 'always' ? undefined : p.scope }))

    case 'inferences':
      return getInferences('pending')
        .slice(0, limit)
        .map((i) => ({
          label: `${i.value}`,
          detail: `${Math.round(i.confidence * 100)}% · ${i.reasoning ?? 'pattern detected'}`.slice(0, 90),
        }))

    case 'patterns':
      // 30 days: patterns are slow signals, and a shorter window reads as "none found".
      return getPatterns(Date.now() - 30 * 86400000, true)
        .slice(0, limit)
        .map((p) => ({ label: p.title, detail: `${p.severity} · ${ago(p.detected_at)}` }))

    case 'schedules':
      // Schedules live in the store, not a table.
      return (getStore().schedules ?? [])
        .slice(0, limit)
        .map((s) => ({
          label: s.name,
          detail: `${s.startTime}–${s.endTime} · ${s.days.length === 7 ? 'daily' : `${s.days.length} days`}${s.active ? '' : ' · off'}`,
        }))

    case 'activity':
    default:
      // Activity is aggregated by runAnalyticsQuery in the renderer, never listed here.
      return []
  }
}

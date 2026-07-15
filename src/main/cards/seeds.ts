import type { CustomAnalyticsCard } from '../../shared/types'

// The cards Attentify ships with.
//
// These are NOT special. Every one is an ordinary spec the AI genuinely could have
// produced from a sentence, which is the whole promise: anything you see here, you could
// have asked for, and you can edit or delete it like anything else. That constraint is
// why the viz vocabulary grew. If a default needed a shape the user could not request,
// the promise would be a lie and the seed would just be a bespoke component in a card
// costume.
//
// Action seeds pin REAL tool calls, so their params must match the tool's own schema
// exactly: start_focus_session takes `duration_minutes` (not ms), and create_schedule
// takes `days` as weekday numbers with "HH:MM" times. A pinned call with the wrong
// param names would silently do the wrong thing rather than fail loudly.

/** Stable ids so re-seeding can never duplicate a card the user already has. */
const seedId = (n: string): string => `seed-${n}`

export function defaultCards(now = Date.now()): CustomAnalyticsCard[] {
  const base = { seeded: true as const, createdAt: now }

  return [
    // ── Analytics ─────────────────────────────────────────────────────────────
    {
      ...base, id: seedId('today'), kind: 'data', page: 'analytics', order: 0,
      title: 'Today at a glance',
      description: 'Tracked time today and the apps behind it',
      viz: 'summary',
      spec: { source: 'activity', rangeDays: 1, groupBy: 'app', metric: 'time', distraction: 'all', limit: 4 },
    },
    {
      ...base, id: seedId('week-split'), kind: 'data', page: 'analytics', order: 1,
      title: 'Where your week went',
      description: 'Time split by category, last 7 days',
      viz: 'progress',
      spec: { source: 'activity', rangeDays: 7, groupBy: 'category', metric: 'time', distraction: 'all', limit: 5 },
    },
    {
      ...base, id: seedId('heatmap'), kind: 'data', page: 'analytics', order: 2,
      title: 'Focus heatmap',
      description: 'When you work, hour by weekday',
      // 14 days so the grid has enough to show a shape rather than a scatter.
      viz: 'heatmap',
      spec: { source: 'activity', rangeDays: 14, groupBy: 'hour', metric: 'time', distraction: 'all' },
    },
    {
      ...base, id: seedId('changed'), kind: 'data', page: 'analytics', order: 3,
      title: 'What changed this week',
      description: 'Ranked against the week before',
      viz: 'ranked',
      spec: { source: 'activity', rangeDays: 7, groupBy: 'app', metric: 'time', distraction: 'all', limit: 6 },
    },
    {
      ...base, id: seedId('distractions'), kind: 'data', page: 'analytics', order: 4,
      title: 'Top distractions',
      description: 'Where off-task time goes',
      viz: 'bar',
      spec: { source: 'activity', rangeDays: 7, groupBy: 'domain', metric: 'time', distraction: 'only', limit: 8 },
    },
    {
      ...base, id: seedId('focus-hour'), kind: 'data', page: 'analytics', order: 5,
      title: 'Focus by hour',
      description: 'When you focus best across the day',
      viz: 'line',
      spec: { source: 'activity', rangeDays: 7, groupBy: 'hour', metric: 'focus_ratio', distraction: 'all' },
    },

    // ── Timesheets ────────────────────────────────────────────────────────────
    {
      ...base, id: seedId('ts-apps'), kind: 'data', page: 'timesheets', order: 0,
      title: 'Time per app',
      description: 'Every app you touched, last 7 days',
      viz: 'table',
      spec: { source: 'activity', rangeDays: 7, groupBy: 'app', metric: 'time', distraction: 'all', limit: 15 },
    },
    {
      ...base, id: seedId('ts-daily'), kind: 'data', page: 'timesheets', order: 1,
      title: 'Daily breakdown',
      description: 'Tracked time by day of week',
      viz: 'bar',
      spec: { source: 'activity', rangeDays: 7, groupBy: 'weekday', metric: 'time', distraction: 'all' },
    },
    {
      ...base, id: seedId('ts-total'), kind: 'data', page: 'timesheets', order: 2,
      title: 'Tracked this week',
      description: 'Total time Attentify has seen',
      viz: 'number',
      spec: { source: 'activity', rangeDays: 7, groupBy: 'app', metric: 'time', distraction: 'all' },
    },

    // ── Deep Focus (action cards: controls, not queries) ───────────────────────
    {
      ...base, id: seedId('df-pomodoro'), kind: 'action', page: 'deep-focus', order: 0,
      title: 'Pomodoro',
      description: 'A standard 25 minute block',
      viz: 'number',
      action: { tool: 'start_focus_session', params: { mode: 'normal', duration_minutes: 25 }, label: 'Start 25 min', confirm: false },
      spec: { rangeDays: 1, groupBy: 'app', metric: 'time', distraction: 'all' },
    },
    {
      ...base, id: seedId('df-flow'), kind: 'action', page: 'deep-focus', order: 1,
      title: 'Flow state',
      description: 'A locked 90 minutes with no bypass',
      viz: 'number',
      action: { tool: 'start_focus_session', params: { mode: 'deep', duration_minutes: 90 }, label: 'Start 90 min', confirm: true },
      spec: { rangeDays: 1, groupBy: 'app', metric: 'time', distraction: 'all' },
    },
    {
      ...base, id: seedId('df-deep'), kind: 'action', page: 'deep-focus', order: 2,
      title: 'Deep work',
      description: 'A locked 3 hours. You cannot end this early.',
      viz: 'number',
      action: { tool: 'start_focus_session', params: { mode: 'deep', duration_minutes: 180 }, label: 'Start 3 hours', confirm: true },
      spec: { rangeDays: 1, groupBy: 'app', metric: 'time', distraction: 'all' },
    },
    {
      ...base, id: seedId('df-end'), kind: 'action', page: 'deep-focus', order: 3,
      title: 'End session',
      description: 'Stop a normal session. Deep sessions refuse until they expire.',
      viz: 'number',
      action: { tool: 'stop_focus_session', params: {}, label: 'End now', confirm: true },
      spec: { rangeDays: 1, groupBy: 'app', metric: 'time', distraction: 'all' },
    },

    // ── Logic (the AI's working memory, not activity) ─────────────────────────
    // These read non-activity sources, resolved in main by cards/sources.ts rather than
    // aggregated by runAnalyticsQuery, which only understands the session log.
    {
      ...base, id: seedId('lg-goals'), kind: 'data', page: 'logic', order: 0,
      title: 'What you told me to protect',
      description: 'Your active goals',
      viz: 'list',
      spec: { source: 'goals', rangeDays: 31, groupBy: 'app', metric: 'time', distraction: 'all', limit: 8 },
    },
    {
      ...base, id: seedId('lg-prefs'), kind: 'data', page: 'logic', order: 1,
      title: 'What I have learned',
      description: 'Preferences picked up from how you work',
      viz: 'list',
      spec: { source: 'preferences', rangeDays: 31, groupBy: 'app', metric: 'time', distraction: 'all', limit: 10 },
    },
    {
      ...base, id: seedId('lg-inferences'), kind: 'data', page: 'logic', order: 2,
      title: 'Waiting on your call',
      description: 'Things I spotted but have not acted on',
      viz: 'list',
      spec: { source: 'inferences', rangeDays: 31, groupBy: 'app', metric: 'time', distraction: 'all', limit: 8 },
    },
    {
      ...base, id: seedId('lg-patterns'), kind: 'data', page: 'logic', order: 3,
      title: 'Patterns in how you drift',
      description: 'Behaviours detected over the last month',
      viz: 'list',
      spec: { source: 'patterns', rangeDays: 31, groupBy: 'app', metric: 'time', distraction: 'all', limit: 8 },
    },

    // ── Scheduler ─────────────────────────────────────────────────────────────
    {
      ...base, id: seedId('sch-active'), kind: 'data', page: 'scheduler', order: 0,
      title: 'Your schedules',
      description: 'Blocks that turn on and off by themselves',
      viz: 'list',
      spec: { source: 'schedules', rangeDays: 31, groupBy: 'app', metric: 'time', distraction: 'all', limit: 10 },
    },
    {
      ...base, id: seedId('sch-workday'), kind: 'action', page: 'scheduler', order: 1,
      title: 'Work hours focus',
      description: 'Block social media 9 to 5, weekdays',
      viz: 'number',
      action: {
        tool: 'create_schedule',
        params: { name: 'Work hours focus', days: [1, 2, 3, 4, 5], start_time: '09:00', end_time: '17:00', categories: ['social_media'] },
        label: 'Add this schedule', confirm: true,
      },
      spec: { rangeDays: 1, groupBy: 'app', metric: 'time', distraction: 'all' },
    },
    {
      ...base, id: seedId('sch-evening'), kind: 'action', page: 'scheduler', order: 2,
      title: 'Wind down',
      description: 'Block video and social from 10pm, every night',
      viz: 'number',
      action: {
        tool: 'create_schedule',
        params: { name: 'Wind down', days: [0, 1, 2, 3, 4, 5, 6], start_time: '22:00', end_time: '06:00', categories: ['video', 'social_media'] },
        label: 'Add this schedule', confirm: true,
      },
      spec: { rangeDays: 1, groupBy: 'app', metric: 'time', distraction: 'all' },
    },
  ]
}

/**
 * Merge the shipped cards in without ever touching the user's own.
 *
 * Runs on every launch rather than once at install, so an existing user picks up new
 * seeds too. Matching is by stable id, so a seed the user edited is left alone and a
 * seed they DELETED stays deleted (we only add ids that are absent... which would
 * resurrect deletions, so deletions are remembered separately by the caller).
 */
export function mergeSeeds(existing: CustomAnalyticsCard[], dismissedSeedIds: string[] = []): CustomAnalyticsCard[] {
  const have = new Set(existing.map((c) => c.id))
  const dismissed = new Set(dismissedSeedIds)
  const missing = defaultCards().filter((c) => !have.has(c.id) && !dismissed.has(c.id))
  if (!missing.length) return existing
  // Seeds go after whatever the user already has, so a returning user never finds their
  // own cards pushed down the page.
  return [...existing, ...missing]
}

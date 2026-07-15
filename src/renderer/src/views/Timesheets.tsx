import React, { useEffect, useMemo, useState, useCallback } from 'react'
import { Clock, RefreshCw, ChevronLeft, ChevronRight, MessageSquare } from 'lucide-react'
import type { ActivitySession, AppCategory } from '@shared/types'
import { MetricDrill, TableQuery, AskAIProvider } from '../components/MetricDrill'
import { useTheme } from '../context/ThemeContext'

const api = (window as unknown as { electronAPI: Window['electronAPI'] }).electronAPI

// RescueTime-style timesheet: how your logged time breaks down, day by day, by
// category and by app — plus a weekly grid and per-day time entries.

interface TimesheetsProps {
  onChatWith?: (msg: string) => void
}

// Category → colour, aligned to the Slate & Violet palette.
const CAT_COLOR: Record<AppCategory, string> = {
  productivity: '#34d399', development: '#34d399',
  communication: '#fbbf24',
  browser: '#3b9eff',
  social: '#f87171', entertainment: '#f87171', gaming: '#f87171',
  system: '#64748b', other: '#475569',
}

// RescueTime-like productivity weighting per category (for the "productivity" %).
const PRODUCTIVE_CATS = new Set<AppCategory>(['productivity', 'development'])
const DISTRACTING_CATS = new Set<AppCategory>(['social', 'entertainment', 'gaming'])

function fmt(ms: number): string {
  const h = Math.floor(ms / 3600000), m = Math.floor((ms % 3600000) / 60000)
  if (h > 0 && m > 0) return `${h}h ${m}m`
  if (h > 0) return `${h}h`
  if (m > 0) return `${m}m`
  const s = Math.floor(ms / 1000)
  return s > 0 ? `${s}s` : '-'
}
function fmtHM(ms: number): string {
  const h = Math.floor(ms / 3600000), m = Math.floor((ms % 3600000) / 60000)
  return `${h}:${String(m).padStart(2, '0')}`
}
function dayKey(ts: number): string { return new Date(ts).toISOString().split('T')[0]! }
function fmtDay(d: Date): string { return d.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' }) }

interface DayData {
  key: string
  date: Date
  total: number
  productive: number
  distracting: number
  neutral: number
  byCategory: Map<AppCategory, number>
  byApp: Map<string, { ms: number; category: AppCategory; sessions: number }>
  /** The day's real sessions, in order. A rollup cannot answer "what did I do at 2pm". */
  entries: ActivitySession[]
}

function buildDays(sessions: ActivitySession[], weekStart: number): DayData[] {
  const days: DayData[] = []
  for (let i = 0; i < 7; i++) {
    const date = new Date(weekStart + i * 86400000)
    days.push({
      key: dayKey(date.getTime()), date, total: 0, productive: 0, distracting: 0, neutral: 0,
      byCategory: new Map(), byApp: new Map(), entries: [],
    })
  }
  const index = new Map(days.map((d) => [d.key, d]))
  for (const s of sessions) {
    const d = index.get(dayKey(s.startTime))
    if (!d) continue
    d.total += s.duration
    if (PRODUCTIVE_CATS.has(s.category)) d.productive += s.duration
    else if (DISTRACTING_CATS.has(s.category) || s.isDistraction) d.distracting += s.duration
    else d.neutral += s.duration
    d.byCategory.set(s.category, (d.byCategory.get(s.category) ?? 0) + s.duration)
    const a = d.byApp.get(s.app) ?? { ms: 0, category: s.category, sessions: 0 }
    a.ms += s.duration; a.sessions += 1
    d.byApp.set(s.app, a)
    d.entries.push(s)
  }
  // Chronological: a timesheet is read down the day, not by size.
  for (const d of days) d.entries.sort((a, b) => a.startTime - b.startTime)
  return days
}

export default function Timesheets({ onChatWith }: TimesheetsProps): React.ReactElement {
  const { colors } = useTheme()
  const [sessions, setSessions] = useState<ActivitySession[]>([])
  const [loading, setLoading] = useState(true)
  const [weekOffset, setWeekOffset] = useState(0) // 0 = this week, -1 = last week
  const [selectedDay, setSelectedDay] = useState<string | null>(null)

  const load = useCallback(() => {
    setLoading(true)
    api.getTimesheet(28).then((r) => setSessions(r.sessions ?? [])).catch(() => setSessions([])).finally(() => setLoading(false))
  }, [])
  useEffect(() => { load() }, [load])
  useEffect(() => {
    const off = api.onStoreRefresh?.(() => load())
    return () => { off?.() }
  }, [load])

  // Monday-start week containing today, shifted by weekOffset.
  const weekStart = useMemo(() => {
    const now = new Date()
    now.setHours(0, 0, 0, 0)
    const dow = (now.getDay() + 6) % 7 // 0 = Monday
    return now.getTime() - dow * 86400000 + weekOffset * 7 * 86400000
  }, [weekOffset])

  const days = useMemo(() => buildDays(sessions, weekStart), [sessions, weekStart])
  const weekTotal = days.reduce((a, d) => a + d.total, 0)
  const weekProductive = days.reduce((a, d) => a + d.productive, 0)
  const weekDistracting = days.reduce((a, d) => a + d.distracting, 0)
  const productivityPct = weekTotal > 0 ? Math.round((weekProductive / weekTotal) * 100) : 0
  const maxDay = Math.max(1, ...days.map((d) => d.total))

  // Per-app weekly rollup.
  const weekApps = useMemo(() => {
    const map = new Map<string, { ms: number; category: AppCategory; sessions: number }>()
    for (const d of days) for (const [app, v] of d.byApp) {
      const cur = map.get(app) ?? { ms: 0, category: v.category, sessions: 0 }
      cur.ms += v.ms; cur.sessions += v.sessions
      map.set(app, cur)
    }
    return [...map.entries()].map(([app, v]) => ({ app, ...v })).sort((a, b) => b.ms - a.ms).slice(0, 12)
  }, [days])

  const selected = selectedDay ? days.find((d) => d.key === selectedDay) ?? null : null
  const weekLabel = `${fmtDay(new Date(weekStart))} – ${fmtDay(new Date(weekStart + 6 * 86400000))}`

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="w-5 h-5 rounded-full animate-spin" style={{ border: `2px solid ${colors.border}`, borderTopColor: colors.accent }} />
      </div>
    )
  }

  const Stat = ({ label, value, color }: { label: string; value: string; color?: string }): React.ReactElement => (
    <div className="flex rounded-xl" style={{ background: colors.cardBg, border: `1px solid ${colors.border}` }}>
      <MetricDrill full width={300}
        spec={{ title: label, subtitle: `${value} · week of ${weekLabel}`, askPrompt: `For the week of ${weekLabel}, my "${label}" is ${value}. What does that tell you and what should I change?` }}
        render={
          <div className="flex flex-col gap-1 p-3.5">
            <span className="text-[11px]" style={{ color: colors.textMuted }}>{label}</span>
            <span className="text-[22px] font-semibold leading-none data-value" style={{ color: color ?? colors.textPrimary }}>{value}</span>
          </div>
        }
      />
    </div>
  )

  return (
   <AskAIProvider value={onChatWith}>
    <div className="p-4 space-y-4 animate-fade-in max-w-5xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <Clock size={16} style={{ color: colors.accent }} />
          <div>
            <h1 className="font-semibold text-[15px]" style={{ color: colors.textPrimary }}>Timesheets</h1>
            <p className="text-[11px]" style={{ color: colors.textMuted }}>Where your logged time went, day by day</p>
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          <button onClick={() => setWeekOffset((w) => w - 1)} className="p-1.5 rounded-lg" style={{ border: `1px solid ${colors.border}`, color: colors.textMuted }} title="Previous week">
            <ChevronLeft size={14} />
          </button>
          <span className="text-[11px] px-2 min-w-[150px] text-center" style={{ color: colors.textSecondary }}>{weekLabel}</span>
          <button onClick={() => setWeekOffset((w) => Math.min(0, w + 1))} disabled={weekOffset >= 0}
            className="p-1.5 rounded-lg disabled:opacity-40" style={{ border: `1px solid ${colors.border}`, color: colors.textMuted }} title="Next week">
            <ChevronRight size={14} />
          </button>
          <button onClick={load} className="flex items-center gap-1.5 px-3 py-1.5 text-[11px] rounded-lg ml-1"
            style={{ background: colors.accentBg, color: colors.textMuted, border: `1px solid ${colors.border}` }}>
            <RefreshCw size={11} /> Refresh
          </button>
        </div>
      </div>


      {/* Summary */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Stat label="Logged this week" value={fmt(weekTotal)} />
        <Stat label="Productive" value={fmt(weekProductive)} color={colors.positive} />
        <Stat label="Distracting" value={fmt(weekDistracting)} color={colors.negative} />
        <Stat label="Productivity" value={`${productivityPct}%`} color={productivityPct >= 60 ? colors.positive : productivityPct >= 35 ? colors.warning : colors.negative} />
      </div>

      {weekTotal === 0 ? (
        <div className="rounded-xl p-6 text-center" style={{ background: colors.cardBg, border: `1px solid ${colors.border}` }}>
          <p className="text-[13px]" style={{ color: colors.textSecondary }}>No time logged this week.</p>
          <p className="text-[11px] mt-1" style={{ color: colors.textMuted }}>Keep Attentify running, your timesheet fills in as you work.</p>
        </div>
      ) : (
        <>
          {/* Weekly grid, one row per day with a stacked category bar */}
          <div className="rounded-xl p-4" style={{ background: colors.cardBg, border: `1px solid ${colors.border}` }}>
            <div className="flex items-center justify-between mb-3">
              <p className="text-[11px] font-medium" style={{ color: colors.textMuted }}>Daily breakdown. Click a day for details</p>
              <TableQuery title="Daily breakdown" summary={days.map((d) => `${fmtDay(d.date)} ${fmtHM(d.total)}`).join(', ')} />
            </div>
            <div className="space-y-1.5">
              {days.map((d) => {
                const isToday = d.key === dayKey(Date.now())
                const isSel = d.key === selectedDay
                const cats = [...d.byCategory.entries()].sort((a, b) => b[1] - a[1])
                return (
                  <button
                    key={d.key}
                    onClick={() => setSelectedDay(isSel ? null : d.key)}
                    className="w-full flex items-center gap-3 py-1.5 px-2 rounded-lg text-left transition-colors"
                    style={{ background: isSel ? colors.accentBg : 'transparent' }}
                  >
                    <span className="text-[11px] w-24 flex-shrink-0" style={{ color: isToday ? colors.accent : colors.textSecondary, fontWeight: isToday ? 600 : 400 }}>
                      {fmtDay(d.date)}
                    </span>
                    <div className="flex-1 h-5 rounded-md overflow-hidden flex" style={{ background: 'rgba(120,130,160,0.08)', minWidth: 0 }}>
                      {cats.map(([cat, ms]) => (
                        <div key={cat} title={`${cat}: ${fmt(ms)}`} style={{ width: `${(ms / maxDay) * 100}%`, background: CAT_COLOR[cat] }} />
                      ))}
                    </div>
                    <span className="text-[11px] w-16 text-right flex-shrink-0 data-value" style={{ color: colors.textPrimary }}>{fmtHM(d.total)}</span>
                  </button>
                )
              })}
            </div>
            {/* Legend */}
            <div className="flex flex-wrap gap-x-4 gap-y-1.5 mt-4 pt-3" style={{ borderTop: `1px solid ${colors.border}` }}>
              {(['productivity', 'development', 'browser', 'communication', 'social', 'entertainment', 'gaming', 'system', 'other'] as AppCategory[]).map((c) => (
                <span key={c} className="flex items-center gap-1.5 text-[10px] capitalize" style={{ color: colors.textMuted }}>
                  <span className="w-2.5 h-2.5 rounded-sm" style={{ background: CAT_COLOR[c] }} /> {c}
                </span>
              ))}
            </div>
          </div>

          {/* Selected-day time entries OR weekly per-app table */}
          {selected ? (
            // This used to render selected.byApp: a per-app ROLLUP under a heading that
            // said "time entries". Same aggregate as the weekly table, just filtered to a
            // day, with no times and no titles. Clicking a day is a request for what you
            // actually did, so show the real sessions, and keep the rollup below them.
            <div className="rounded-xl p-4" style={{ background: colors.cardBg, border: `1px solid ${colors.border}` }}>
              <div className="flex items-center justify-between mb-3">
                <p className="text-[12px] font-medium" style={{ color: colors.textPrimary }}>{fmtDay(selected.date)} time entries</p>
                <div className="flex items-center gap-2">
                  <span className="text-[11px]" style={{ color: colors.textMuted }}>
                    {selected.entries.length} {selected.entries.length === 1 ? 'entry' : 'entries'} · {fmt(selected.total)} total
                  </span>
                  <TableQuery
                    title={`${fmtDay(selected.date)} time entries`}
                    summary={selected.entries.length
                      ? `${selected.entries.length} sessions, ${fmt(selected.total)} tracked. ${[...selected.byApp.entries()].sort((a, b) => b[1].ms - a[1].ms).slice(0, 5).map(([app, v]) => `${app} ${fmt(v.ms)}`).join(', ')}`
                      : 'No sessions tracked on this day.'}
                  />
                </div>
              </div>

              {selected.entries.length === 0 ? (
                <p className="text-[11px] py-6 text-center" style={{ color: colors.textMuted }}>
                  Nothing tracked on this day.
                </p>
              ) : (
                <>
                  <div className="rounded-lg overflow-hidden mb-4" style={{ border: `1px solid ${colors.border}` }}>
                    <div className="flex items-center gap-3 px-3 py-1.5" style={{ background: colors.rowEven, borderBottom: `1px solid ${colors.border}` }}>
                      <span className="text-[8px] uppercase tracking-wider" style={{ color: colors.textDim, width: 92 }}>when</span>
                      <span className="text-[8px] uppercase tracking-wider" style={{ color: colors.textDim, width: 92 }}>app</span>
                      <span className="text-[8px] uppercase tracking-wider flex-1" style={{ color: colors.textDim }}>what</span>
                      <span className="text-[8px] uppercase tracking-wider" style={{ color: colors.textDim, width: 48, textAlign: 'right' }}>time</span>
                    </div>
                    <div style={{ maxHeight: 320, overflowY: 'auto' }}>
                      {selected.entries.map((e, i) => (
                        <div key={e.id ?? i} className="flex items-center gap-3 px-3 py-1.5"
                          style={{ background: i % 2 ? 'transparent' : colors.rowOdd }}>
                          <span className="text-[9.5px] data-value flex-shrink-0" style={{ color: colors.textMuted, width: 92 }}>
                            {new Date(e.startTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                            {' – '}
                            {new Date(e.endTime || e.startTime + e.duration).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                          </span>
                          <span className="text-[10.5px] truncate flex-shrink-0" style={{ color: colors.textSecondary, width: 92 }}>{e.app}</span>
                          <span className="text-[10.5px] truncate flex-1" style={{ color: colors.textMuted }}>
                            {e.title || e.url || <span style={{ color: colors.textDim }}>(no title)</span>}
                          </span>
                          <span className="text-[10.5px] data-value flex-shrink-0"
                            style={{ color: e.isDistraction ? colors.negative : colors.textPrimary, width: 48, textAlign: 'right' }}>
                            {fmt(e.duration)}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>

                  <p className="text-[9px] font-bold uppercase tracking-widest mb-1.5" style={{ color: colors.labelDim }}>
                    That day, by app
                  </p>
                  <TimeEntryTable rows={[...selected.byApp.entries()].map(([app, v]) => ({ app, ...v })).sort((a, b) => b.ms - a.ms)} total={selected.total} colors={colors} />
                </>
              )}
            </div>
          ) : (
            <div className="rounded-xl p-4" style={{ background: colors.cardBg, border: `1px solid ${colors.border}` }}>
              <div className="flex items-center justify-between mb-3">
                <p className="text-[12px] font-medium" style={{ color: colors.textPrimary }}>Top apps this week</p>
                <TableQuery title="Top apps this week" summary={weekApps.slice(0, 6).map((r) => `${r.app} ${fmt(r.ms)}`).join(', ')} />
              </div>
              <TimeEntryTable rows={weekApps} total={weekTotal} colors={colors} />
            </div>
          )}

          {onChatWith && (
            <button
              onClick={() => onChatWith(`Look at my timesheet for the week of ${weekLabel}: ${fmt(weekTotal)} logged, ${fmt(weekProductive)} productive (${productivityPct}%), ${fmt(weekDistracting)} distracting. Where am I leaking time and what should I change?`)}
              className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-[12px] font-medium transition-colors hover:brightness-110"
              style={{ background: colors.accentBg, border: `1px solid ${colors.border}`, color: colors.accent }}
            >
              <MessageSquare size={13} /> Ask Attentify about this week
            </button>
          )}
        </>
      )}
    </div>
   </AskAIProvider>
  )
}

function TimeEntryTable(
  { rows, total, colors }: { rows: { app: string; ms: number; category: AppCategory; sessions: number }[]; total: number; colors: ReturnType<typeof useTheme>['colors'] }
): React.ReactElement {
  const max = Math.max(1, ...rows.map((r) => r.ms))
  return (
    <div className="space-y-1.5">
      {rows.map((r) => (
        <div key={r.app} className="flex items-center gap-3" title={`${r.app} · ${r.sessions} session${r.sessions !== 1 ? 's' : ''} · ${total > 0 ? Math.round((r.ms / total) * 100) : 0}% of the day`}>
          <span className="w-2.5 h-2.5 rounded-sm flex-shrink-0" style={{ background: CAT_COLOR[r.category] }} />
          <span className="text-[12px] w-40 truncate flex-shrink-0" style={{ color: colors.textSecondary }}>{r.app}</span>
          <div className="flex-1 h-3 rounded overflow-hidden" style={{ background: 'rgba(120,130,160,0.08)', minWidth: 0 }}>
            <div className="h-full rounded" style={{ width: `${(r.ms / max) * 100}%`, background: CAT_COLOR[r.category], opacity: 0.85 }} />
          </div>
          <span className="text-[11px] w-16 text-right flex-shrink-0 data-value" style={{ color: colors.textPrimary }}>{fmt(r.ms)}</span>
        </div>
      ))}
    </div>
  )
}

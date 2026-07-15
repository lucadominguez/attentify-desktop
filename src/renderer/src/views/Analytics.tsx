import React, { useEffect, useState, useCallback, useRef, useMemo } from 'react'
import {
  BarChart2, Activity, X, AlertTriangle, RefreshCw,
  ChevronUp, ChevronDown, Clock, Zap, TrendingUp, MessageSquare, Lightbulb, Download, Check, Globe,
  Sparkles, Trash2, ArrowRight,
} from 'lucide-react'
import type { HeuristicAlert, ActivitySession, AppCategory, CustomAnalyticsCard } from '@shared/types'
import { runAnalyticsQuery } from '@shared/analyticsQuery'
import CardCanvas from '../components/cards/CardCanvas'
import { detectPrivacyMode, privacyLabel, type PrivacyMode } from '@shared/privacyMode'
import { MetricDrill, TableQuery, AskAIProvider, type DrillSpec, type DrillRow } from '../components/MetricDrill'
import { useTheme } from '../context/ThemeContext'

const api = (window as unknown as { electronAPI: Window['electronAPI'] }).electronAPI

// Stable empty array so the useMemo below keeps a constant dependency identity
// before data loads (a fresh [] each render would invalidate the memo every time).
const EMPTY_SESSIONS: ActivitySession[] = []

// ── Animated stat number (counts up on mount) ─────────────────────────────────
function AnimatedStat({ value }: { value: string }): React.ReactElement {
  const match = value.match(/^(\d+)(.*)$/)
  const rafRef = useRef(0)
  const [displayed, setDisplayed] = useState(0)

  useEffect(() => {
    if (!match) return
    const target = parseInt(match[1])
    const dur = 750
    const start = performance.now()
    const tick = (now: number): void => {
      const t = Math.min((now - start) / dur, 1)
      const eased = 1 - Math.pow(1 - t, 3)
      setDisplayed(Math.round(target * eased))
      if (t < 1) rafRef.current = requestAnimationFrame(tick)
    }
    rafRef.current = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(rafRef.current)
  }, [value]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!match) return <>{value}</>
  return <>{displayed}{match[2]}</>
}

// ── Types ─────────────────────────────────────────────────────────────────────

interface DomainRow { domain: string; category: string; classification: string; confidence: number; total_ms: number; last_seen: number }
interface IdlePeriod { start: number; end: number; duration: number; prevApp: string; nextApp: string }
interface Relapse { ts: number; app: string; prevApp: string; gapMs: number; duration: number }

interface AnalyticsData {
  today: {
    focusScore: number; focusedTime: number; distractedTime: number
    neutralTime: number; blockEvents: number; focusSessions: number
    appBreakdown: { app: string; duration: number; category: AppCategory }[]
  }
  weekly: {
    focusedTime: number; distractedTime: number
    timePerApp: Record<string, number>; sessionCount: number; blockEvents: number
  }
  heuristicAlerts: HeuristicAlert[]
  recentSessions: ActivitySession[]
  domains: DomainRow[]
}

interface DayRow { day: string; date: string; focused: number; distracted: number; tracked: number; score: number; sessions: number; topApp: string; distractRate: number }
interface AppRow { app: string; category: AppCategory; totalTime: number; sessions: number; avgDuration: number; pctOfTime: number; isDistraction: boolean }
interface HourRow { hour: number; focused: number; distracted: number; ratio: number; sessions: number; topApp: string; switchRate: number }
interface HeatCell { focused: number; distracted: number }

type SortDir = 'asc' | 'desc'

// ── Formatters ────────────────────────────────────────────────────────────────

function fmt(ms: number): string {
  const h = Math.floor(ms / 3600000), m = Math.floor((ms % 3600000) / 60000), s = Math.floor((ms % 60000) / 1000)
  if (h > 0 && m > 0) return `${h}h ${m}m`
  if (h > 0) return `${h}h`
  if (m > 0) return `${m}m`
  return `${s}s`
}

// Below this much tracked time, ratios and streaks are statistical noise, a "100%
// focus score" off 8 minutes means nothing. We gate insight cards behind it and show
// a "keep tracking" state instead, so the app never contradicts itself.
const INSIGHT_MIN_MS = 20 * 60 * 1000

// Duration display that distinguishes a real zero ("0m") from a metric with no data
// behind it. Pass hasData=false when nothing was tracked at all.
function durOrZero(ms: number, hasData: boolean): string {
  if (!hasData) return 'No data'
  return ms > 0 ? fmt(ms) : '0m'
}
function fmtTime(ts: number): string { return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) }
function fmtDate(ts: number): string { return new Date(ts).toLocaleDateString([], { month: 'short', day: 'numeric' }) }
function fmtHour(h: number): string { return h === 0 ? '12am' : h < 12 ? `${h}am` : h === 12 ? '12pm' : `${h - 12}pm` }

// ── Color palettes ────────────────────────────────────────────────────────────

const CAT_COLOR: Record<AppCategory, string> = {
  browser: '#3b9eff', social: '#f87171', entertainment: '#f87171',
  gaming: '#ff6b35', productivity: '#34d399', communication: '#fbbf24',
  development: '#34d399', system: '#546e7a', other: '#455a64',
}
const SEV: Record<HeuristicAlert['severity'], { bg: string; text: string; label: string }> = {
  high: { bg: 'rgba(248,113,113,0.15)', text: '#f87171', label: 'HIGH' },
  medium: { bg: 'rgba(251,191,36,0.15)', text: '#fbbf24', label: 'MED' },
  low: { bg: 'rgba(52,211,153,0.15)', text: '#34d399', label: 'LOW' },
}
const TYPE_LABELS: Record<HeuristicAlert['type'], string> = {
  'rapid-switching': 'Rapid Switching',
  'repeated-visits': 'Repeated Visits',
  'late-night': 'Late Night',
  'long-session': 'Long Session',
  'focus-drift': 'Focus Drift',
  'doom-loop': 'Doom Loop',
  'micro-escape': 'Micro-Escape',
  'notification-fomo': 'Notification FOMO',
  'video-rabbit-hole': 'Video Rabbit Hole',
  'phantom-checking': 'Phantom Checking',
  'pre-task-avoidance': 'Pre-Task Avoidance',
  'news-anxiety': 'News Anxiety',
  'tab-anxiety': 'Tab Anxiety',
}

// ── Data builders ─────────────────────────────────────────────────────────────

function buildDayRows(sessions: ActivitySession[]): DayRow[] {
  const map = new Map<string, { focused: number; distracted: number; sessions: number; apps: Map<string, number> }>()
  for (const s of sessions) {
    const key = new Date(s.startTime).toISOString().split('T')[0]!
    const cur = map.get(key) ?? { focused: 0, distracted: 0, sessions: 0, apps: new Map() }
    if (s.isDistraction) cur.distracted += s.duration
    else cur.focused += s.duration
    cur.sessions++
    cur.apps.set(s.app, (cur.apps.get(s.app) ?? 0) + s.duration)
    map.set(key, cur)
  }
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
  return Array.from(map.entries()).sort(([a], [b]) => a.localeCompare(b)).slice(-7).map(([date, v]) => {
    const d = new Date(date + 'T12:00:00')
    const tracked = v.focused + v.distracted
    const score = tracked > 0 ? Math.round(Math.min(100, (v.focused / tracked) * 120)) : 0
    const distractRate = tracked > 0 ? Math.round((v.distracted / tracked) * 100) : 0
    const topApp = [...v.apps.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? '-'
    return { day: days[d.getDay()]!, date, focused: v.focused, distracted: v.distracted, tracked, score, sessions: v.sessions, topApp, distractRate }
  })
}

function buildAppRows(sessions: ActivitySession[], totalTrackedMs: number): AppRow[] {
  const appMap = new Map<string, { totalTime: number; sessions: number; category: AppCategory; isDistraction: boolean }>()
  for (const s of sessions) {
    const cur = appMap.get(s.app) ?? { totalTime: 0, sessions: 0, category: s.category, isDistraction: s.isDistraction }
    cur.totalTime += s.duration
    cur.sessions++
    if (s.isDistraction) cur.isDistraction = true
    appMap.set(s.app, cur)
  }
  const base = totalTrackedMs || 1
  return Array.from(appMap.entries()).map(([app, v]) => ({
    app, category: v.category, totalTime: v.totalTime, sessions: v.sessions,
    avgDuration: v.sessions > 0 ? Math.round(v.totalTime / v.sessions) : 0,
    pctOfTime: Math.round((v.totalTime / base) * 100),
    isDistraction: v.isDistraction,
  })).filter((r) => r.totalTime > 5000).sort((a, b) => b.totalTime - a.totalTime).slice(0, 30)
}

function buildHourRows(sessions: ActivitySession[]): HourRow[] {
  const today = new Date().toISOString().split('T')[0]
  const todaySessions = sessions.filter((s) => new Date(s.startTime).toISOString().split('T')[0] === today)
  const map = new Map<number, { focused: number; distracted: number; sessions: number; apps: Map<string, number>; startTimes: number[] }>()
  for (const s of todaySessions) {
    const h = new Date(s.startTime).getHours()
    const cur = map.get(h) ?? { focused: 0, distracted: 0, sessions: 0, apps: new Map(), startTimes: [] }
    if (s.isDistraction) cur.distracted += s.duration
    else cur.focused += s.duration
    cur.sessions++
    cur.apps.set(s.app, (cur.apps.get(s.app) ?? 0) + s.duration)
    cur.startTimes.push(s.startTime)
    map.set(h, cur)
  }
  return Array.from(map.entries()).sort(([a], [b]) => a - b).map(([hour, v]) => {
    const total = v.focused + v.distracted
    const ratio = total > 0 ? Math.round((v.focused / total) * 100) : -1
    const topApp = [...v.apps.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? '-'
    const trackedHrs = Math.max(total / 3600000, 0.0167)
    const switchRate = Math.round(v.sessions / trackedHrs)
    return { hour, focused: v.focused, distracted: v.distracted, ratio, sessions: v.sessions, topApp, switchRate }
  })
}

function buildHourOfWeekMatrix(sessions: ActivitySession[]): HeatCell[][] {
  const matrix: HeatCell[][] = Array.from({ length: 7 }, () =>
    Array.from({ length: 24 }, () => ({ focused: 0, distracted: 0 }))
  )
  for (const s of sessions) {
    const d = new Date(s.startTime)
    const dow = (d.getDay() + 6) % 7
    const h = d.getHours()
    const cell = matrix[dow]![h]!
    if (s.isDistraction) cell.distracted += s.duration
    else cell.focused += s.duration
  }
  return matrix
}

function buildCategoryBreakdown(sessions: ActivitySession[]): { cat: AppCategory; ms: number; color: string; pct: number }[] {
  const map = new Map<AppCategory, number>()
  for (const s of sessions) map.set(s.category, (map.get(s.category) ?? 0) + s.duration)
  const total = [...map.values()].reduce((a, b) => a + b, 0) || 1
  return [...map.entries()]
    .map(([cat, ms]) => ({ cat, ms, color: CAT_COLOR[cat], pct: (ms / total) * 100 }))
    .sort((a, b) => b.ms - a.ms)
    .filter((r) => r.ms > 10000)
}

function extractDomain(url: string): string | null {
  try { return new URL(url).hostname.replace(/^www\./, '') } catch { return null }
}

function buildIdlePeriods(sessions: ActivitySession[]): IdlePeriod[] {
  const IDLE_MIN_MS = 3 * 60 * 1000
  const sorted = [...sessions].sort((a, b) => a.startTime - b.startTime)
  const out: IdlePeriod[] = []
  for (let i = 0; i < sorted.length - 1; i++) {
    const gap = sorted[i + 1]!.startTime - sorted[i]!.endTime
    if (gap >= IDLE_MIN_MS) {
      out.push({ start: sorted[i]!.endTime, end: sorted[i + 1]!.startTime, duration: gap, prevApp: sorted[i]!.app, nextApp: sorted[i + 1]!.app })
    }
  }
  return out
}

function buildRelapses(sessions: ActivitySession[]): Relapse[] {
  const WINDOW_MS = 30 * 60 * 1000
  const distractions = [...sessions].filter((s) => s.isDistraction).sort((a, b) => a.startTime - b.startTime)
  const out: Relapse[] = []
  for (let i = 1; i < distractions.length; i++) {
    const prev = distractions[i - 1]!, curr = distractions[i]!
    const gap = curr.startTime - prev.endTime
    if (gap > 60000 && gap < WINDOW_MS) {
      out.push({ ts: curr.startTime, app: curr.app, prevApp: prev.app, gapMs: gap, duration: curr.duration })
    }
  }
  return out
}

function computeStreaks(sessions: ActivitySession[]): { longest: number; current: number; count: number; avgLen: number } {
  const sorted = [...sessions].filter((s) => !s.isDistraction).sort((a, b) => a.startTime - b.startTime)
  const GAP = 5 * 60 * 1000
  const streaks: number[] = []
  let cur = 0, curEnd = 0
  for (const s of sorted) {
    if (cur === 0 || s.startTime - curEnd > GAP) { if (cur > 0) streaks.push(cur); cur = s.duration }
    else cur += s.duration
    curEnd = s.endTime
  }
  if (cur > 0) streaks.push(cur)
  const now = Date.now()
  let currentStreak = 0
  for (const s of [...sessions].sort((a, b) => b.startTime - a.startTime)) {
    if (now - s.endTime > GAP) break
    if (s.isDistraction) break
    currentStreak += s.duration
  }
  return {
    longest: streaks.length > 0 ? Math.max(...streaks) : 0,
    current: currentStreak,
    count: streaks.length,
    avgLen: streaks.length > 0 ? Math.round(streaks.reduce((a, b) => a + b, 0) / streaks.length) : 0,
  }
}

function cellColor(cell: HeatCell): string {
  const total = cell.focused + cell.distracted
  if (total < 30000) return 'rgba(20,38,60,0.5)'
  const r = cell.focused / total
  if (r >= 0.7) return `rgba(52,211,153,${0.35 + r * 0.55})`
  if (r >= 0.4) return `rgba(251,191,36,${0.4 + (1 - r) * 0.35})`
  return `rgba(248,113,113,${0.45 + (1 - r) * 0.4})`
}

// ── SVG: Focus line chart ─────────────────────────────────────────────────────

function FocusLineChart({ hourRows }: { hourRows: HourRow[] }): React.ReactElement | null {
  const W = 300, H = 72, PL = 8, PR = 28, PT = 6, PB = 12
  const iW = W - PL - PR, iH = H - PT - PB
  const pts = Array.from({ length: 24 }, (_, h) => ({ h, v: hourRows.find((r) => r.hour === h)?.ratio ?? -1 }))
    .filter((p) => p.v >= 0)
  if (pts.length < 2) return null
  const toX = (h: number) => PL + (h / 23) * iW
  const toY = (v: number) => PT + iH - (v / 100) * iH
  const lineStr = pts.map((p) => `${toX(p.h)},${toY(p.v)}`).join(' ')
  const areaPath = `M${toX(pts[0]!.h)},${PT + iH} ${pts.map((p) => `L${toX(p.h)},${toY(p.v)}`).join(' ')} L${toX(pts[pts.length - 1]!.h)},${PT + iH}Z`
  const y70 = toY(70), y40 = toY(40)
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ display: 'block', overflow: 'visible' }}>
      <defs>
        <linearGradient id="areaGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#6366f1" stopOpacity="0.25" />
          <stop offset="100%" stopColor="#6366f1" stopOpacity="0.01" />
        </linearGradient>
      </defs>
      <line x1={PL} y1={y70} x2={W - PR} y2={y70} stroke="rgba(52,211,153,0.2)" strokeWidth="0.6" strokeDasharray="3,3" />
      <line x1={PL} y1={y40} x2={W - PR} y2={y40} stroke="rgba(248,113,113,0.2)" strokeWidth="0.6" strokeDasharray="3,3" />
      <text x={W - PR + 2} y={y70 + 3} fontSize="5" fill="rgba(52,211,153,0.55)">70%</text>
      <text x={W - PR + 2} y={y40 + 3} fontSize="5" fill="rgba(248,113,113,0.55)">40%</text>
      {[0, 6, 12, 18, 23].map((h) => (
        <text key={h} x={toX(h)} y={H - 1} fontSize="4.5" fill="rgba(99,102,241,0.35)" textAnchor="middle" fontFamily="Share Tech Mono, monospace">{fmtHour(h)}</text>
      ))}
      <path d={areaPath} fill="url(#areaGrad)" />
      <polyline points={lineStr} fill="none" stroke="#6366f1" strokeWidth="1.6" strokeLinejoin="round" strokeLinecap="round" filter="url(#lineGlow)" />
      {pts.map((p) => (
        <circle key={p.h} cx={toX(p.h)} cy={toY(p.v)} r="2"
          fill={p.v >= 70 ? '#34d399' : p.v >= 40 ? '#fbbf24' : '#f87171'}
          stroke="rgba(2,9,18,0.9)" strokeWidth="0.8"
        />
      ))}
    </svg>
  )
}

// ── Infographic: Today's session timeline ─────────────────────────────────────

function SessionTimeline({ sessions }: { sessions: ActivitySession[] }): React.ReactElement | null {
  const todayStart = new Date().setHours(0, 0, 0, 0)
  const now = Date.now()
  const dayMs = now - todayStart
  const todaySessions = sessions
    .filter((s) => s.startTime >= todayStart)
    .sort((a, b) => a.startTime - b.startTime)
  if (todaySessions.length === 0) return null
  const hourMarks = [0, 3, 6, 9, 12, 15, 18, 21]
  const focusedMs = todaySessions.filter((s) => !s.isDistraction).reduce((t, s) => t + s.duration, 0)
  const distMs = todaySessions.filter((s) => s.isDistraction).reduce((t, s) => t + s.duration, 0)
  // Collapse a near-empty timeline rather than render an empty frame.
  if (focusedMs + distMs < 120000) return null
  return (
    <div className="section-panel p-3">
      <div className="flex items-center justify-between mb-2">
        <p className="hud-label">Today's Session Timeline</p>
        <div className="flex items-center gap-3">
          <span className="text-[9px] flex items-center gap-1" style={{ color: 'rgba(99,102,241,0.45)' }}>
            <span className="inline-block w-2 h-2 rounded-sm" style={{ background: 'rgba(52,211,153,0.7)' }} />
            {fmt(focusedMs)} focused
          </span>
          <span className="text-[9px] flex items-center gap-1" style={{ color: 'rgba(99,102,241,0.45)' }}>
            <span className="inline-block w-2 h-2 rounded-sm" style={{ background: 'rgba(248,113,113,0.7)' }} />
            {fmt(distMs)} distracted
          </span>
        </div>
      </div>
      <div className="relative rounded-md overflow-hidden" style={{ height: 22, background: 'rgba(20,38,60,0.5)' }}>
        {todaySessions.map((s) => {
          const left = ((s.startTime - todayStart) / dayMs) * 100
          const width = Math.max((s.duration / dayMs) * 100, 0.12)
          return (
            <div
              key={s.id}
              className="absolute top-0 bottom-0 transition-opacity hover:opacity-90"
              title={`${s.app} · ${fmt(s.duration)}`}
              style={{
                left: `${Math.min(left, 99.5)}%`,
                width: `${width}%`,
                background: s.isDistraction ? 'rgba(248,113,113,0.75)' : 'rgba(52,211,153,0.72)',
              }}
            />
          )
        })}
        <div className="absolute top-0 bottom-0 w-px bg-white/40" style={{ right: 0 }} />
      </div>
      <div className="relative mt-1" style={{ height: 10 }}>
        {hourMarks.map((h) => {
          const pct = (h * 3600000 / dayMs) * 100
          if (pct > 100) return null
          return (
            <span key={h} className="absolute -translate-x-1/2 text-[7.5px]" style={{ left: `${pct}%`, color: 'rgba(99,102,241,0.2)' }}>
              {fmtHour(h)}
            </span>
          )
        })}
        <span className="absolute text-[7.5px] right-0" style={{ color: 'rgba(99,102,241,0.45)' }}>now</span>
      </div>
    </div>
  )
}

// ── Infographic: Hour-of-week heatmap ─────────────────────────────────────────

const DOW_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

function HourOfWeekHeatmap({ matrix }: { matrix: HeatCell[][] }): React.ReactElement {
  const hasData = matrix.some((row) => row.some((c) => c.focused + c.distracted > 0))
  return (
    <div className="section-panel p-3">
      <div className="flex items-center justify-between mb-2">
        <p className="hud-label">Focus Heatmap by Hour of Week</p>
        <div className="flex items-center gap-3 text-[8.5px]" style={{ color: 'rgba(99,102,241,0.45)' }}>
          <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm inline-block" style={{ background: 'rgba(52,211,153,0.75)' }} /> focused</span>
          <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm inline-block" style={{ background: 'rgba(251,191,36,0.65)' }} /> mixed</span>
          <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm inline-block" style={{ background: 'rgba(248,113,113,0.7)' }} /> distracted</span>
          <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm inline-block" style={{ background: 'rgba(20,38,60,0.5)' }} /> no data</span>
          <TableQuery title="Focus heatmap (hour of week)" summary="focus ratio by day-of-week and hour" />
        </div>
      </div>
      {!hasData ? (
        <p className="text-[10px] text-center py-6" style={{ color: 'rgba(99,102,241,0.3)' }}>No session data yet. The heatmap fills in after several sessions</p>
      ) : (
        <div className="flex gap-2">
          <div className="flex flex-col gap-0.5 flex-shrink-0" style={{ paddingTop: 14 }}>
            {DOW_LABELS.map((d) => (
              <div key={d} className="text-[8.5px] text-right leading-none" style={{ height: 11, lineHeight: '11px', color: 'rgba(99,102,241,0.45)' }}>{d}</div>
            ))}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex mb-0.5">
              {Array.from({ length: 24 }, (_, h) => (
                <div key={h} className="flex-1 text-center" style={{ minWidth: 0 }}>
                  {[0, 6, 12, 18].includes(h) && (
                    <span className="text-[7.5px]" style={{ color: 'rgba(99,102,241,0.2)' }}>{fmtHour(h)}</span>
                  )}
                </div>
              ))}
            </div>
            {matrix.map((row, dow) => (
              <div key={dow} className="flex gap-px mb-px">
                {row.map((cell, h) => {
                  const total = cell.focused + cell.distracted
                  const ratioStr = total > 0 ? ` · ${Math.round((cell.focused / total) * 100)}% focused` : ''
                  return (
                    <div
                      key={h}
                      className="flex-1 rounded-sm"
                      style={{ height: 11, background: cellColor(cell), minWidth: 0 }}
                      title={`${DOW_LABELS[dow]} ${fmtHour(h)}${total > 0 ? ` · ${fmt(total)} tracked${ratioStr}` : ' · no data'}`}
                    />
                  )
                })}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// ── Infographic: 24h heatmap row ──────────────────────────────────────────────

function HourlyHeatmapRow({ hourRows }: { hourRows: HourRow[] }): React.ReactElement {
  const { colors } = useTheme()
  return (
    <div>
      <div className="flex items-center justify-between mb-1.5">
        <p className="hud-label">Hourly Focus Map Today</p>
        <div className="flex items-center gap-3 text-[8.5px]" style={{ color: colors.textMuted }}>
          <span className="flex items-center gap-1"><span className="w-2 h-2 rounded inline-block" style={{ background: '#34d399' }} />focused</span>
          <span className="flex items-center gap-1"><span className="w-2 h-2 rounded inline-block" style={{ background: '#f87171' }} />distracted</span>
          <span className="flex items-center gap-1"><span className="w-2 h-2 rounded inline-block" style={{ background: colors.border }} />no data</span>
        </div>
      </div>
      <div className="flex gap-0.5 items-end" style={{ height: 36 }}>
        {Array.from({ length: 24 }, (_, h) => {
          const row = hourRows.find((r) => r.hour === h)
          const total = row ? row.focused + row.distracted : 0
          const ratio = row ? row.ratio : -1
          const bg = ratio === -1 ? colors.border
            : ratio >= 70 ? `rgba(52,211,153,${0.35 + (ratio / 100) * 0.6})`
            : ratio >= 40 ? `rgba(251,191,36,${0.35 + ((100 - ratio) / 100) * 0.4})`
            : `rgba(248,113,113,${0.45 + ((100 - ratio) / 100) * 0.45})`
          const height = total > 0 ? Math.max(18, Math.min(100, (total / 3600000) * 100)) : 6
          return (
            <div
              key={h}
              className="flex-1 flex flex-col items-center gap-0"
              title={row ? `${fmtHour(h)}: ${fmt(row.focused)} focused, ${fmt(row.distracted)} distracted · ${ratio}% focus ratio` : `${fmtHour(h)}: no data`}
            >
              <div className="w-full rounded-sm" style={{ height: `${height}%`, minHeight: 3, background: bg }} />
            </div>
          )
        })}
      </div>
      <div className="flex justify-between mt-1">
        {[0, 3, 6, 9, 12, 15, 18, 21].map((h) => (
          <span key={h} className="text-[7.5px]" style={{ color: 'rgba(99,102,241,0.2)' }}>{fmtHour(h)}</span>
        ))}
      </div>
    </div>
  )
}

// ── Infographic: 7-day focus score strip ─────────────────────────────────────

function DayScoreStrip({ dayRows }: { dayRows: DayRow[] }): React.ReactElement | null {
  if (dayRows.length === 0) return null
  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <p className="hud-label">7-Day Focus Score</p>
        <TableQuery title="7-day focus score" summary={dayRows.map((d) => `${d.day} ${d.score}%`).join(', ')} />
      </div>
      <div className="flex gap-1.5">
        {dayRows.map((d) => {
          const color = d.score >= 70 ? '#34d399' : d.score >= 40 ? '#fbbf24' : '#f87171'
          const isToday = d.date === new Date().toISOString().split('T')[0]
          return (
            <div
              key={d.date}
              className="flex-1 flex flex-col items-center gap-1"
              title={`${d.day} ${d.date}: ${d.score}% focus score · ${fmt(d.focused)} focused, ${fmt(d.distracted)} distracted`}
            >
              <div
                className="w-full rounded-md flex items-center justify-center text-[9px] font-bold"
                style={{
                  height: 32,
                  background: `${color}${isToday ? '30' : '18'}`,
                  border: `1px solid ${color}${isToday ? '60' : '25'}`,
                  color,
                  boxShadow: isToday ? `0 0 8px ${color}20` : 'none',
                }}
              >
                {d.tracked > 0 ? `${d.score}%` : '-'}
              </div>
              <span className="text-[8.5px]" style={{ color: isToday ? '#818cf8' : '#6b84a0' }}>{d.day}</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ── Infographic: App bar chart ────────────────────────────────────────────────

function AppBarChart({ rows }: { rows: AppRow[] }): React.ReactElement | null {
  const top = rows.slice(0, 10)
  const max = top[0]?.totalTime ?? 1
  if (top.length === 0) return null
  return (
    <div className="mb-3">
      <p className="text-[9px] font-semibold uppercase tracking-widest mb-2" style={{ color: 'rgba(99,102,241,0.45)' }}>Top Apps by Time Distribution</p>
      <div className="space-y-1.5">
        {top.map((row) => (
          <div
            key={row.app}
            className="flex items-center gap-2"
            title={`${row.app}: ${fmt(row.totalTime)} total (${row.pctOfTime}% of tracked time) · ${row.sessions} session${row.sessions !== 1 ? 's' : ''} · avg ${fmt(row.avgDuration)}/session · ${row.isDistraction ? 'classified as distraction' : 'classified as productive'}`}
          >
            <div className="w-24 text-[10px] truncate flex-shrink-0 text-right" style={{ color: 'rgba(180,210,235,0.6)' }}>{row.app}</div>
            <div className="flex-1 h-4 overflow-hidden" style={{ background: 'rgba(99,102,241,0.04)', border: '1px solid rgba(99,102,241,0.06)' }}>
              <div
                className="h-full rounded-sm flex items-center px-1.5"
                style={{
                  width: `${(row.totalTime / max) * 100}%`,
                  background: row.isDistraction
                    ? 'linear-gradient(90deg, rgba(248,113,113,0.65), rgba(248,113,113,0.35))'
                    : 'linear-gradient(90deg, rgba(99,102,241,0.5), rgba(99,102,241,0.25))',
                  minWidth: 2,
                }}
              >
                {(row.totalTime / max) > 0.2 && (
                  <span className="text-[8px] text-white/80 font-mono tabular-nums">{fmt(row.totalTime)}</span>
                )}
              </div>
            </div>
            <div className="w-10 text-right text-[9px] font-mono tabular-nums flex-shrink-0" style={{ color: 'rgba(99,102,241,0.45)' }}>{fmt(row.totalTime)}</div>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Redesigned "Today": one prominent summary + a dense KPI strip ─────────────
// Replaces eight equal cards. The score, time, and progress bar form one coherent
// story; the strip below adds change-vs-baseline and targets without more boxes.

function fmtClock(ts: number): string {
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

// App-aggregated drill rows (time per app, biggest first) — used by several metric
// drill-downs so the detail behind "Focused" / "Distracted" is real, not vague.
function aggAppRows(sessions: ActivitySession[], tone: DrillRow['tone']): DrillRow[] {
  const m = new Map<string, number>()
  for (const s of sessions) m.set(s.app, (m.get(s.app) ?? 0) + s.duration)
  return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([app, ms]) => ({ label: app, value: fmt(ms), tone }))
}

function qualityLabel(score: number): string {
  if (score >= 85) return 'Excellent session'
  if (score >= 70) return 'Strong focus'
  if (score >= 50) return 'Mixed session'
  if (score >= 30) return 'Fragmented. Hard to hold focus'
  return 'Heavily scattered'
}

// "+38m" / "−21m" from a signed millisecond delta (uses a real minus sign).
function fmtSignedMin(ms: number): string {
  const sign = ms >= 0 ? '+' : '−'
  const m = Math.round(Math.abs(ms) / 60000)
  if (m >= 60) { const h = Math.floor(m / 60), mm = m % 60; return `${sign}${h}h${mm ? ` ${mm}m` : ''}` }
  return `${sign}${m}m`
}

function TodaySummaryCard({ score, focusedMs, distractedMs, idleMs, distractionEvents, switchRate, hasData, drills }: {
  score: number; focusedMs: number; distractedMs: number; idleMs: number
  distractionEvents: number; switchRate: number; hasData: boolean
  drills: { score?: DrillSpec; focused?: DrillSpec; distracted?: DrillSpec; idle?: DrillSpec; distraction?: DrillSpec; switches?: DrillSpec }
}): React.ReactElement {
  const { colors } = useTheme()
  const scoreColor = score >= 70 ? colors.positive : score >= 40 ? colors.warning : colors.negative
  const totalBar = Math.max(focusedMs + distractedMs + idleMs, 1)
  const fw = (focusedMs / totalBar) * 100
  const dw = (distractedMs / totalBar) * 100
  const iw = (idleMs / totalBar) * 100
  const distOk = distractionEvents < 3
  const switchOk = switchRate < 25

  if (!hasData) {
    return (
      <div className="section-panel p-4 flex items-center gap-3">
        <span className="text-3xl font-bold leading-none" style={{ color: colors.textMuted }}>-</span>
        <p className="text-[11px] leading-relaxed" style={{ color: colors.textMuted }}>
          No activity tracked yet today. Your focus summary appears here once Attentify has watched a few minutes of work.
        </p>
      </div>
    )
  }

  return (
    <div className="section-panel p-4">
      {/* Score + time, the two halves of the same story (each clickable for detail) */}
      <div className="flex items-start justify-between gap-4 mb-3">
        <MetricDrill spec={drills.score ?? { title: 'Focus score' }} width={320} className="px-2 py-1 -ml-2"
          render={
            <div>
              <div className="flex items-baseline gap-2">
                <span className="text-[40px] font-bold leading-none tracking-tight" style={{ color: scoreColor }}>
                  <AnimatedStat value={`${Math.round(score)}%`} />
                </span>
                <span className="text-sm font-medium" style={{ color: colors.textSecondary }}>Focused</span>
              </div>
              <p className="text-[11px] mt-2" style={{ color: scoreColor }}>{qualityLabel(score)}</p>
            </div>
          }
        />
        <div className="flex flex-col items-end gap-0.5 flex-shrink-0">
          <MetricDrill spec={drills.focused ?? { title: 'Focused time' }} width={320} className="px-2 py-0.5"
            render={
              <p className="text-lg font-semibold data-value" style={{ color: colors.positive }}>
                {fmt(focusedMs)} <span className="text-[11px] font-normal" style={{ color: colors.textMuted }}>focused</span>
              </p>
            }
          />
          <p className="text-[11px]" style={{ color: colors.textMuted }}>
            <MetricDrill spec={drills.distracted ?? { title: 'Distracted time' }} width={320} className="px-1"
              render={<span style={{ color: colors.negative }}>{fmt(distractedMs)} distracted</span>} />
            {idleMs > 0 && <> · <MetricDrill spec={drills.idle ?? { title: 'Idle time' }} width={320} className="px-1"
              render={<span style={{ color: colors.textSecondary }}>{fmt(idleMs)} idle</span>} /></>}
          </p>
        </div>
      </div>

      {/* Progress visualization — focused / distracted / idle in one bar */}
      <div className="flex h-2.5 rounded-full overflow-hidden mb-3.5" style={{ background: colors.accentBg }}>
        {fw > 0 && <div style={{ width: `${fw}%`, background: colors.positive }} title={`${fmt(focusedMs)} focused`} />}
        {dw > 0 && <div style={{ width: `${dw}%`, background: colors.negative }} title={`${fmt(distractedMs)} distracted`} />}
        {iw > 0 && <div style={{ width: `${iw}%`, background: 'rgba(120,140,170,0.35)' }} title={`${fmt(idleMs)} idle`} />}
      </div>

      {/* Goals — click to see the events behind the number */}
      <div className="grid grid-cols-2 gap-2">
        <MetricDrill spec={drills.distraction ?? { title: 'Distraction events' }} full width={340}
          render={
            <div className="flex items-center justify-between gap-2 px-2 py-1.5">
              <div>
                <p className="text-[13px] font-semibold" style={{ color: distOk ? colors.textPrimary : colors.negative }}>
                  {distractionEvents} distraction event{distractionEvents !== 1 ? 's' : ''}
                </p>
                <p className="text-[9px] mt-0.5 hud-label" style={{ color: colors.textDim }}>Goal &lt; 3 · click for detail</p>
              </div>
              <span className="text-[8.5px] px-1.5 py-0.5 rounded flex-shrink-0" style={{ background: distOk ? colors.positiveBg : colors.negativeBg, color: distOk ? colors.positive : colors.negative }}>
                {distOk ? 'on target' : 'over'}
              </span>
            </div>
          }
        />
        <MetricDrill spec={drills.switches ?? { title: 'Context switching' }} full width={340}
          render={
            <div className="flex items-center justify-between gap-2 px-2 py-1.5">
              <div>
                <p className="text-[13px] font-semibold" style={{ color: switchOk ? colors.textPrimary : colors.warning }}>
                  {switchRate} switches/hour
                </p>
                <p className="text-[9px] mt-0.5 hud-label" style={{ color: colors.textDim }}>Goal &lt; 25/hour · click for detail</p>
              </div>
              <span className="text-[8.5px] px-1.5 py-0.5 rounded flex-shrink-0" style={{ background: switchOk ? colors.positiveBg : colors.warningBg, color: switchOk ? colors.positive : colors.warning }}>
                {switchOk ? 'on target' : 'high'}
              </span>
            </div>
          }
        />
      </div>
    </div>
  )
}

interface Kpi { label: string; value: string; delta?: { text: string; good: boolean }; sub: string; drill?: DrillSpec }

// One shared container, subtle vertical separators, not six cards. Each metric is
// clickable: it opens a drill-down with the detail behind the number + Ask AI.
function KpiStrip({ items, onAskAI }: { items: Kpi[]; onAskAI?: (p: string) => void }): React.ReactElement {
  const { colors } = useTheme()
  const cell = (k: Kpi): React.ReactElement => (
    <div className="px-3 py-2.5">
      <p className="hud-label mb-1" style={{ color: colors.textMuted }}>{k.label}</p>
      <div className="flex items-baseline gap-1.5">
        <span className="text-[15px] font-semibold data-value" style={{ color: colors.textPrimary }}>{k.value}</span>
        {k.delta && (
          <span className="text-[9px] font-medium flex-shrink-0" style={{ color: k.delta.good ? colors.positive : colors.negative }}>{k.delta.text}</span>
        )}
      </div>
      <p className="text-[8.5px] mt-0.5 truncate" style={{ color: colors.textDim, fontFamily: '"Share Tech Mono", monospace' }}>{k.sub}</p>
    </div>
  )
  return (
    <div className="section-panel flex items-stretch overflow-x-auto">
      {items.map((k, i) => (
        <div key={k.label} className="flex-1 flex" style={{ minWidth: 96, borderLeft: i === 0 ? 'none' : `1px solid ${colors.border}` }}>
          {k.drill
            ? <MetricDrill spec={k.drill} onAskAI={onAskAI} full width={320} render={cell(k)} />
            : cell(k)}
        </div>
      ))}
    </div>
  )
}

// Right-hand diagnostic column: categories + top apps + top distractions. Answers
// "how much / what % / which app / was it a distraction" better than a donut.
function TimeDistributionPanel({ sessions, appRows }: { sessions: ActivitySession[]; appRows: AppRow[] }): React.ReactElement {
  const { colors } = useTheme()
  const cats = buildCategoryBreakdown(sessions)
  const total = cats.reduce((s, c) => s + c.ms, 0)
  const maxCat = cats[0]?.ms ?? 1
  const topApps = appRows.slice(0, 5)
  const distMap = new Map<string, number>()
  for (const s of sessions) if (s.isDistraction) distMap.set(s.app, (distMap.get(s.app) ?? 0) + s.duration)
  const topDist = [...distMap.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4)

  // Private / incognito / Tor time — detected from the stored window title so it also
  // covers historical sessions. We report it honestly (time tracked, URLs not visible)
  // rather than mis-attributing it to a domain.
  const privMap = new Map<PrivacyMode, number>()
  for (const s of sessions) {
    const mode = s.privacy ?? detectPrivacyMode(s.app, s.title)
    if (mode) privMap.set(mode, (privMap.get(mode) ?? 0) + s.duration)
  }
  const privRows = [...privMap.entries()].sort((a, b) => b[1] - a[1])
  const privTotal = privRows.reduce((s, [, ms]) => s + ms, 0)

  if (total < 60000) {
    return <p className="text-[10px] text-center py-8 leading-relaxed" style={{ color: colors.textMuted }}>Not enough recognised activity yet.<br />A breakdown appears as apps are classified.</p>
  }

  const catSummary = cats.slice(0, 5).map((c) => `${c.cat} ${fmt(c.ms)}`).join(', ')
  const appSummary = topApps.map((a) => `${a.app} ${fmt(a.totalTime)}`).join(', ')
  const distSummary = topDist.map(([app, ms]) => `${app} ${fmt(ms)}`).join(', ')
  return (
    <div className="space-y-3.5">
      <div>
        <div className="flex items-center justify-between mb-2">
          <p className="hud-label">Time Distribution</p>
          <TableQuery title="Time Distribution" summary={catSummary} />
        </div>
        <div className="space-y-1.5">
          {cats.slice(0, 6).map((c) => (
            <div key={c.cat} className="flex items-center gap-2" title={`${c.cat}: ${fmt(c.ms)} (${Math.round(c.pct)}%)`}>
              <span className="text-[10px] capitalize flex-shrink-0" style={{ width: 74, color: colors.textSecondary }}>{c.cat}</span>
              <span className="text-[10px] data-value text-right flex-shrink-0" style={{ width: 46, color: colors.textPrimary }}>{fmt(c.ms)}</span>
              <span className="text-[9px] data-value text-right flex-shrink-0" style={{ width: 30, color: colors.textMuted }}>{Math.round(c.pct)}%</span>
              <div className="flex-1 h-1.5 rounded-full overflow-hidden min-w-0" style={{ background: colors.accentBg }}>
                <div className="h-full rounded-full" style={{ width: `${(c.ms / maxCat) * 100}%`, background: c.color }} />
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 pt-1" style={{ borderTop: `1px solid ${colors.border}` }}>
        <div>
          <div className="flex items-center justify-between mb-2 mt-2.5">
            <p className="hud-label">Top Apps</p>
            <TableQuery title="Top Apps" summary={appSummary} />
          </div>
          <div className="space-y-1">
            {topApps.map((a) => (
              <div key={a.app} className="flex items-center justify-between gap-2">
                <span className="text-[10px] truncate" style={{ color: colors.textSecondary }}>{a.app}</span>
                <span className="text-[10px] data-value flex-shrink-0" style={{ color: colors.textPrimary }}>{fmt(a.totalTime)}</span>
              </div>
            ))}
          </div>
        </div>
        <div>
          <div className="flex items-center justify-between mb-2 mt-2.5">
            <p className="hud-label">Top Distractions</p>
            {topDist.length > 0 && <TableQuery title="Top Distractions" summary={distSummary} />}
          </div>
          {topDist.length === 0 ? (
            <p className="text-[9px]" style={{ color: colors.textDim }}>None recorded.</p>
          ) : (
            <div className="space-y-1">
              {topDist.map(([app, ms]) => (
                <div key={app} className="flex items-center justify-between gap-2">
                  <span className="text-[10px] truncate" style={{ color: colors.negative }}>{app}</span>
                  <span className="text-[10px] data-value flex-shrink-0" style={{ color: colors.textPrimary }}>{fmt(ms)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {privTotal >= 30000 && (
        <div className="pt-2.5" style={{ borderTop: `1px solid ${colors.border}` }}>
          <div className="flex items-center justify-between mb-1.5">
            <p className="hud-label" style={{ color: colors.warning }}>Private Windows</p>
            <span className="text-[10px] data-value" style={{ color: colors.textPrimary }}>{fmt(privTotal)}</span>
          </div>
          <div className="flex flex-wrap gap-1.5 mb-1">
            {privRows.map(([mode, ms]) => (
              <span key={mode} className="text-[9px] px-1.5 py-0.5 rounded" style={{ background: colors.warningBg, color: colors.warning }}>
                {privacyLabel(mode)} · {fmt(ms)}
              </span>
            ))}
          </div>
          <p className="text-[9px] leading-snug" style={{ color: colors.textMuted }}>
            Time tracked, but URLs inside are not captured, so this time isn&apos;t attributed to a site.
          </p>
        </div>
      )}
    </div>
  )
}

// The four insight cards, recast as one ranked table with a single recommendation —
// so relative importance is explicit instead of four equal-weight boxes.
type Priority = 'Critical' | 'High' | 'Medium' | 'Low'
interface RankRow { priority: Priority; signal: string; current: string; baseline: string; impact: string }

function RankedInsightTable({ rows, recommendation }: {
  rows: RankRow[]
  recommendation: { action: string; effect: string } | null
}): React.ReactElement | null {
  const { colors } = useTheme()
  if (rows.length === 0) return null
  const PRI: Record<Priority, string> = { Critical: colors.negative, High: colors.negative, Medium: colors.warning, Low: colors.positive }
  return (
    <div className="section-panel overflow-hidden">
      <table className="hud-table">
        <thead><tr><Th>Priority</Th><Th>Signal</Th><Th>Current</Th><Th>Baseline</Th><Th>Impact</Th></tr></thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={r.signal} style={{ background: i % 2 === 0 ? colors.rowEven : colors.rowOdd }}>
              <td className="px-2.5 py-1.5">
                <span className="text-[8px] px-1.5 py-0.5 rounded font-bold uppercase" style={{ background: PRI[r.priority] + '22', color: PRI[r.priority] }}>{r.priority}</span>
              </td>
              <td className="px-2.5 py-1.5 text-[11px] font-medium whitespace-nowrap" style={{ color: colors.textPrimary }}>{r.signal}</td>
              <td className="px-2.5 py-1.5 text-[10px] data-value whitespace-nowrap" style={{ color: colors.textSecondary }}>{r.current}</td>
              <td className="px-2.5 py-1.5 text-[10px] data-value whitespace-nowrap" style={{ color: colors.textMuted }}>{r.baseline}</td>
              <td className="px-2.5 py-1.5 text-[10px]" style={{ color: colors.textSecondary }}>{r.impact}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {recommendation && (
        <div className="px-3 py-2.5" style={{ borderTop: `1px solid ${colors.border}`, background: colors.accentBg }}>
          <p className="hud-label mb-1" style={{ color: colors.accent }}>Recommended action</p>
          <p className="text-[11px] leading-snug" style={{ color: colors.textPrimary }}>{recommendation.action}</p>
          <p className="text-[9.5px] mt-1" style={{ color: colors.textMuted }}>Expected effect: {recommendation.effect}</p>
        </div>
      )}
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

interface AnalyticsProps {
  onChatWith?: (msg: string) => void
}

export default function Analytics({ onChatWith }: AnalyticsProps): React.ReactElement {
  const [data, setData] = useState<AnalyticsData | null>(null)
  const [loading, setLoading] = useState(true)
  const [appSort, setAppSort] = useState<{ col: keyof AppRow; dir: SortDir }>({ col: 'totalTime', dir: 'desc' })
  const [activeTab, setActiveTab] = useState<'apps' | 'daily' | 'patterns' | 'alerts'>('apps')
  const [exporting, setExporting] = useState<'idle' | 'busy' | 'done' | 'error'>('idle')

  const load = useCallback((): void => {
    setLoading(true)
    api.getAnalytics().then((d) => setData(d as AnalyticsData)).catch(() => {}).finally(() => setLoading(false))
  }, [])

  useEffect(() => { load() }, [load])
  useEffect(() => {
    const off = api.onStoreRefresh?.(() => load())
    return () => { off?.() }
  }, [load])

  const dismissAlert = async (id: string): Promise<void> => {
    await api.dismissHeuristicAlert(id)
    load()
  }

  const handleExportPdf = async (): Promise<void> => {
    if (exporting === 'busy') return
    setExporting('busy')
    try {
      const result = await api.exportPdf()
      const next = result.ok ? 'done' : result.canceled ? 'idle' : 'error'
      setExporting(next)
      if (next !== 'idle') setTimeout(() => setExporting('idle'), 2500)
    } catch {
      setExporting('error')
      setTimeout(() => setExporting('idle'), 2500)
    }
  }

  const { colors } = useTheme()

  // Memoized session-derived aggregates. Declared BEFORE the early return so the
  // hook order is stable. Each builder scans every session with several filter/sort
  // passes; keying on recentSessions avoids recomputing them on unrelated re-renders
  // (Insights tab switches, export/refresh button state changes).
  const sessionsForDerive = data?.recentSessions ?? EMPTY_SESSIONS
  const derived = useMemo(() => {
    const totalTracked = sessionsForDerive.reduce((s, r) => s + r.duration, 0)
    return {
      totalTracked,
      dayRows: buildDayRows(sessionsForDerive),
      appRows: buildAppRows(sessionsForDerive, totalTracked),
      hourRows: buildHourRows(sessionsForDerive),
      matrix: buildHourOfWeekMatrix(sessionsForDerive),
      streaks: computeStreaks(sessionsForDerive),
      idlePeriods: buildIdlePeriods(sessionsForDerive),
      relapses: buildRelapses(sessionsForDerive),
    }
  }, [sessionsForDerive])

  if (loading || !data) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="flex flex-col items-center gap-3">
          <div className="w-5 h-5 rounded-full animate-spin" style={{ border: `2px solid ${colors.border}`, borderTopColor: colors.accent }} />
          <p className="text-[10px] uppercase tracking-widest" style={{ color: colors.textMuted, fontFamily: '"Share Tech Mono", monospace' }}>Loading…</p>
        </div>
      </div>
    )
  }

  const { today, weekly, heuristicAlerts, recentSessions } = data
  const domains = data.domains ?? []
  const totalWeekly = weekly.focusedTime + weekly.distractedTime
  const focusPct = totalWeekly > 0 ? (weekly.focusedTime / totalWeekly) * 100 : 0
  const activeAlerts = heuristicAlerts.filter((a) => !a.dismissed)

  const { totalTracked, dayRows, appRows, hourRows, matrix, streaks, idlePeriods, relapses } = derived

  const weeklyAvgScore = dayRows.length > 0 ? Math.round(dayRows.reduce((s, r) => s + r.score, 0) / dayRows.length) : 0
  const todayTracked = today.focusedTime + today.distractedTime + today.neutralTime
  const switchFreq = recentSessions.length > 0 && totalTracked > 0
    ? Math.round((recentSessions.length / (totalTracked / 3600000)) * 10) / 10 : 0

  const topDistractor = appRows.find(r => r.isDistraction)
  const distractDebtMs = weekly.distractedTime
  const avgDailyWastedMs = distractDebtMs > 0 ? Math.round(distractDebtMs / Math.max(dayRows.length, 1)) : 0

  const todayStart = new Date().setHours(0, 0, 0, 0)
  const todayIdlePeriods = idlePeriods.filter((ip) => ip.start >= todayStart)
  const todayIdleMs = todayIdlePeriods.reduce((s, ip) => s + ip.duration, 0)
  const todayRelapses = relapses.filter((r) => r.ts >= todayStart)

  // ── Today-specific figures + a 7-day baseline (prior tracked days, today excluded)
  // so every KPI can show change-vs-average instead of a bare number. ────────────
  const todaySessions = recentSessions.filter((s) => s.startTime >= todayStart)
  const todayDistractionEvents = todaySessions.filter((s) => s.isDistraction).length
  const todaySwitchRate = todayTracked > 0 ? Math.round(todaySessions.length / (todayTracked / 3600000)) : 0
  // Today-scoped aggregates so the TODAY section never shows week-long totals (which
  // read as wrong, e.g. "15h today"). Weekly figures stay in the This Week section.
  const todayAppRows = buildAppRows(todaySessions, todayTracked)
  const todayTopDistractor = todayAppRows.find((r) => r.isDistraction)
  const todayStreaks = computeStreaks(todaySessions)

  // 7-day baseline (prior tracked days, today excluded) so KPIs + drills can compare.
  const todayKey = new Date().toISOString().split('T')[0]
  const priorDays = dayRows.filter((d) => d.date !== todayKey && d.tracked > 0)
  const avgOf = (arr: number[]): number => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0)
  const hasBaseline = priorDays.length > 0
  const blScore = avgOf(priorDays.map((d) => d.score))
  const blFocused = avgOf(priorDays.map((d) => d.focused))
  const blDistracted = avgOf(priorDays.map((d) => d.distracted))
  const blSwitch = avgOf(priorDays.map((d) => (d.tracked > 0 ? d.sessions / (d.tracked / 3600000) : 0)))

  // ── Drill-down detail behind each headline metric ───────────────────────────
  const todaySessionsAsc = [...todaySessions].sort((a, b) => a.startTime - b.startTime)
  const distractSessionsToday = todaySessions.filter((s) => s.isDistraction).sort((a, b) => b.startTime - a.startTime)
  const focusSessionsToday = todaySessions.filter((s) => !s.isDistraction)
  const transitions = new Map<string, number>()
  for (let i = 1; i < todaySessionsAsc.length; i++) {
    const a = todaySessionsAsc[i - 1]!.app, b = todaySessionsAsc[i]!.app
    if (a !== b) transitions.set(`${a} → ${b}`, (transitions.get(`${a} → ${b}`) ?? 0) + 1)
  }
  const topTransitions = [...transitions.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8)

  const distractionDrill: DrillSpec = {
    title: 'Distraction events today',
    subtitle: `${todayDistractionEvents} event${todayDistractionEvents !== 1 ? 's' : ''} · goal < 3`,
    rows: distractSessionsToday.slice(0, 12).map((s) => ({
      label: s.title ? s.title.slice(0, 40) : s.app,
      sub: `${s.app} · ${fmtClock(s.startTime)}`, value: fmt(s.duration), tone: 'negative' as const,
    })),
    empty: 'No distraction events today. Nice.',
    note: distractSessionsToday.length > 12 ? `+${distractSessionsToday.length - 12} more today` : undefined,
    askPrompt: `I had ${todayDistractionEvents} distraction events today${todayTopDistractor ? `, mostly ${todayTopDistractor.app}` : ''}. What triggered them and how do I cut them?`,
  }
  const switchDrill: DrillSpec = {
    title: 'Context switching today',
    subtitle: `${todaySwitchRate}/h · goal < 25`,
    rows: topTransitions.map(([t, n]) => ({ label: t, value: `${n}×` })),
    empty: 'Not enough switching yet to analyze.',
    note: 'Each app-to-app switch carries a re-entry cost. Repeated pairs are worth automating away or batching.',
    askPrompt: `I'm switching apps about ${todaySwitchRate} times an hour today. Which of these switches look unnecessary, and how do I reduce context switching?`,
  }
  const idleDrill: DrillSpec = {
    title: 'Idle gaps today',
    subtitle: `${fmt(todayIdleMs)} across ${todayIdlePeriods.length} gap${todayIdlePeriods.length !== 1 ? 's' : ''} ≥3m`,
    rows: [...todayIdlePeriods].sort((a, b) => b.start - a.start).slice(0, 12).map((ip) => ({
      label: `after ${ip.prevApp}`, sub: fmtClock(ip.start), value: fmt(ip.duration), tone: 'warning' as const,
    })),
    empty: 'No idle gaps ≥3m today.',
    askPrompt: `I had ${fmt(todayIdleMs)} of idle time today across ${todayIdlePeriods.length} gaps. Is that a problem and what should I do about it?`,
  }
  const relapseDrill: DrillSpec = {
    title: 'Relapses today',
    subtitle: `${todayRelapses.length} return${todayRelapses.length !== 1 ? 's' : ''} to distraction within 30m · goal < 3`,
    rows: [...todayRelapses].sort((a, b) => b.ts - a.ts).slice(0, 12).map((r) => ({
      label: r.app, sub: `after ${r.prevApp} · ${fmtClock(r.ts)}`, value: `+${fmt(r.gapMs)}`, tone: 'negative' as const,
    })),
    empty: 'No relapses today. Discipline holding.',
    askPrompt: `I relapsed into distractions ${todayRelapses.length} times today. How do I make my recoveries stick?`,
  }
  const focusDrill: DrillSpec = {
    title: 'Focus score today',
    subtitle: `${Math.round(today.focusScore)}% · target 85%`,
    rows: [
      { label: 'Focused time', value: fmt(today.focusedTime), tone: 'positive' as const },
      { label: 'Distracted time', value: fmt(today.distractedTime), tone: 'negative' as const },
      { label: 'Idle time', value: fmt(todayIdleMs), tone: 'warning' as const },
      ...(hasBaseline ? [{ label: '7-day average', value: `${Math.round(blScore)}%` } as DrillRow] : []),
    ],
    note: 'Focus score weights focused vs distracted time, lightly rewarding long unbroken blocks.',
    askPrompt: `My focus score today is ${Math.round(today.focusScore)}%${hasBaseline ? ` vs a ${Math.round(blScore)}% average` : ''}. Break down what's driving it and how to raise it.`,
  }
  const focusedDrill: DrillSpec = {
    title: 'Focused time today',
    subtitle: `${fmt(today.focusedTime)} · ${todayTracked > 0 ? Math.round((today.focusedTime / todayTracked) * 100) : 0}% of tracked`,
    rows: aggAppRows(focusSessionsToday, 'positive'),
    empty: 'No focused time recorded yet today.',
    askPrompt: `Where did my ${fmt(today.focusedTime)} of focused time go today, and how do I protect more of it?`,
  }
  const distractedDrill: DrillSpec = {
    title: 'Distracted time today',
    subtitle: `${fmt(today.distractedTime)} · ${todayTracked > 0 ? Math.round((today.distractedTime / todayTracked) * 100) : 0}% of tracked`,
    rows: aggAppRows(todaySessions.filter((s) => s.isDistraction), 'negative'),
    empty: 'No distracted time recorded today.',
    askPrompt: `What ate my ${fmt(today.distractedTime)} of distracted time today, and what's the single highest-ROI thing to block?`,
  }

  const kpiItems: Kpi[] = [
    {
      label: 'Focus', value: todayTracked > 0 ? `${Math.round(today.focusScore)}%` : '-',
      delta: hasBaseline ? { text: `${today.focusScore - blScore >= 0 ? '+' : '−'}${Math.abs(Math.round(today.focusScore - blScore))}pp`, good: today.focusScore >= blScore } : undefined,
      sub: 'Target 85%', drill: focusDrill,
    },
    {
      label: 'Focused', value: durOrZero(today.focusedTime, todayTracked > 0),
      delta: hasBaseline ? { text: fmtSignedMin(today.focusedTime - blFocused), good: today.focusedTime >= blFocused } : undefined,
      sub: todayTracked > 0 ? `${Math.round((today.focusedTime / todayTracked) * 100)}% of time` : 'no data', drill: focusedDrill,
    },
    {
      label: 'Distracted', value: durOrZero(today.distractedTime, todayTracked > 0),
      delta: hasBaseline ? { text: fmtSignedMin(today.distractedTime - blDistracted), good: today.distractedTime <= blDistracted } : undefined,
      sub: todayTracked > 0 ? `${Math.round((today.distractedTime / todayTracked) * 100)}% of time` : 'no data', drill: distractedDrill,
    },
    {
      label: 'Idle', value: durOrZero(todayIdleMs, todayTracked > 0),
      sub: `${todayIdlePeriods.length} gap${todayIdlePeriods.length !== 1 ? 's' : ''} ≥3m`, drill: idleDrill,
    },
    {
      label: 'Switches', value: todayTracked > 0 ? `${todaySwitchRate}/h` : '-',
      delta: hasBaseline && blSwitch > 0 ? { text: `${todaySwitchRate - blSwitch >= 0 ? '+' : '−'}${Math.abs(Math.round(((todaySwitchRate - blSwitch) / blSwitch) * 100))}%`, good: todaySwitchRate <= blSwitch } : undefined,
      sub: 'Target <25', drill: switchDrill,
    },
    {
      label: 'Relapses', value: String(todayRelapses.length),
      sub: 'Target <3', drill: relapseDrill,
    },
  ]

  // Ranked diagnostics, the four insight cards recast as a prioritized table.
  const PRI_ORDER: Record<Priority, number> = { Critical: 0, High: 1, Medium: 2, Low: 3 }
  const rankRows: RankRow[] = []
  if (todayTracked > 0 && todaySwitchRate > 0) {
    rankRows.push({
      priority: todaySwitchRate > 40 ? 'Critical' : todaySwitchRate > 25 ? 'High' : 'Low',
      signal: 'Context switching', current: `${todaySwitchRate}/h`,
      baseline: hasBaseline && blSwitch > 0 ? `${Math.round(blSwitch)}/h` : '-',
      impact: todaySwitchRate > 25 ? `~${Math.round((todaySwitchRate - 25) * 0.4)}m focus lost` : 'within target',
    })
  }
  if (todayTopDistractor && todayTopDistractor.pctOfTime >= 2) {
    rankRows.push({
      priority: todayTopDistractor.pctOfTime > 15 ? 'High' : todayTopDistractor.pctOfTime > 7 ? 'Medium' : 'Low',
      signal: `${todayTopDistractor.app} distraction`, current: fmt(todayTopDistractor.totalTime),
      baseline: '-', impact: `${todayTopDistractor.pctOfTime}% of today's time`,
    })
  }
  rankRows.push({
    priority: todayStreaks.longest > 3600000 ? 'Low' : 'Medium',
    signal: 'Longest focus block', current: todayStreaks.longest > 0 ? fmt(todayStreaks.longest) : '-',
    baseline: todayStreaks.avgLen > 0 ? `avg ${fmt(todayStreaks.avgLen)}` : '-',
    impact: todayStreaks.longest > 3600000 ? 'deep-work capable' : 'aim for 45m+ blocks',
  })
  if (todayIdleMs > 5 * 60000) {
    rankRows.push({
      priority: todayIdleMs > 3600000 ? 'Medium' : 'Low',
      signal: 'Idle gaps', current: fmt(todayIdleMs), baseline: '-',
      impact: `${todayIdlePeriods.length} gap${todayIdlePeriods.length !== 1 ? 's' : ''} ≥3m`,
    })
  }
  rankRows.sort((a, b) => PRI_ORDER[a.priority] - PRI_ORDER[b.priority])

  // Estimate reclaimable minutes from TODAY's distractor time (not a week-long total),
  // so the projection stays believable ("~18 fewer minutes", not "391 per session").
  const distractorMinToday = todayTopDistractor ? Math.round(todayTopDistractor.totalTime / 60000) : 0
  const recommendation = todayTopDistractor && distractorMinToday >= 3
    ? { action: `Block ${todayTopDistractor.app} during active focus sessions.`, effect: `up to ~${Math.max(5, Math.round(distractorMinToday * 0.6))} fewer distracted minutes reclaimed per day.` }
    : todaySwitchRate > 25
      ? { action: 'Start a timed Deep Focus session to cut context switching.', effect: 'fewer re-entry costs and noticeably longer focus blocks.' }
      : null

  const sortedApps = [...appRows].sort((a, b) => {
    const av = a[appSort.col] as number | string | boolean
    const bv = b[appSort.col] as number | string | boolean
    if (typeof av === 'number' && typeof bv === 'number') return appSort.dir === 'asc' ? av - bv : bv - av
    return appSort.dir === 'asc' ? String(av).localeCompare(String(bv)) : String(bv).localeCompare(String(av))
  })

  const toggleSort = (col: keyof AppRow): void =>
    setAppSort((p) => p.col === col ? { col, dir: p.dir === 'asc' ? 'desc' : 'asc' } : { col, dir: 'desc' })

  const SortIcon = ({ col }: { col: keyof AppRow }): React.ReactElement =>
    appSort.col !== col
      ? <ChevronUp size={9} style={{ color: 'rgba(99,102,241,0.25)' }} />
      : appSort.dir === 'asc' ? <ChevronUp size={9} style={{ color: '#6366f1' }} /> : <ChevronDown size={9} style={{ color: '#6366f1' }} />

  const handleAskDaemon = (): void => {
    if (!onChatWith) return
    const topApp = appRows[0]?.app ?? 'unknown'
    const topDist = appRows.find((r) => r.isDistraction)?.app ?? 'none'
    onChatWith(
      `Analytics: ${Math.round(focusPct)}% focus ratio this week, ${fmt(weekly.focusedTime)} focused, ${fmt(weekly.distractedTime)} distracted. ` +
      `Top app: "${topApp}", top distraction: "${topDist}". ` +
      `Today focus score: ${Math.round(today.focusScore)}%, ${today.blockEvents} blocks. ` +
      `Switch rate: ${switchFreq}/h. Longest streak: ${fmt(streaks.longest)}. ` +
      `Give me a detailed analysis and specific actions I should take.`
    )
  }

  const kpiChip = (chip: { label: string; value: string; color: string; sub: string; tooltip: string; drill?: DrillSpec }, i: number, baseDelay = 0): React.ReactElement => (
    <div
      key={chip.label}
      className="section-panel flex animate-entry"
      style={{ animationDelay: `${baseDelay + i * 55}ms`, animationFillMode: 'both', opacity: 0 }}
      title={chip.tooltip}
    >
      <MetricDrill full width={300}
        spec={chip.drill ?? { title: chip.label, subtitle: `${chip.value} · ${chip.sub}`, note: chip.tooltip, askPrompt: `Tell me about my ${chip.label.toLowerCase()} (${chip.value}). What does it mean and how do I improve it?` }}
        render={
          <div className="flex flex-col gap-1 p-3">
            <p className="text-base font-bold leading-none data-value" style={{ color: chip.color }}>
              <AnimatedStat value={chip.value} />
            </p>
            <p className="text-[9px] leading-tight" style={{ color: colors.textMuted, fontFamily: '"Share Tech Mono", monospace' }}>
              {chip.label}
            </p>
            <p className="text-[8px]" style={{ color: colors.textDim, fontFamily: '"Share Tech Mono", monospace' }}>
              {chip.sub}
            </p>
          </div>
        }
      />
    </div>
  )

  return (
   <AskAIProvider value={onChatWith}>
    <div className="p-4 space-y-4 animate-fade-in">

      {/* ── Header ───────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <BarChart2 size={16} style={{ color: colors.accent, flexShrink: 0 }} />
          <div>
            <h1 className="font-semibold text-[14px]" style={{ color: colors.textPrimary }}>
              Analytics
            </h1>
            <p className="text-[9px] mt-0.5" style={{ color: colors.textMuted, fontFamily: '"Share Tech Mono", monospace' }}>
              {recentSessions.length} sessions tracked
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {onChatWith && (
            <button onClick={handleAskDaemon} className="flex items-center gap-1.5 px-3 py-1.5 text-[10px] font-medium transition-all hover:opacity-80"
              style={{ background: colors.accentBg, color: colors.accent, border: `1px solid ${colors.border}` }}>
              <MessageSquare size={10} /> Ask AI
            </button>
          )}
          <button
            onClick={handleExportPdf}
            disabled={exporting === 'busy'}
            className="flex items-center gap-1.5 px-3 py-1.5 text-[10px] font-medium transition-all hover:opacity-80 disabled:opacity-50 disabled:cursor-not-allowed"
            style={{
              background: exporting === 'done' ? 'rgba(52,211,153,0.08)' : exporting === 'error' ? 'rgba(248,113,113,0.08)' : colors.accentBg,
              color: exporting === 'done' ? '#34d399' : exporting === 'error' ? '#f87171' : colors.textMuted,
              border: `1px solid ${exporting === 'done' ? 'rgba(52,211,153,0.3)' : exporting === 'error' ? 'rgba(248,113,113,0.3)' : colors.border}`,
            }}
            title="Export report as PDF"
          >
            {exporting === 'busy' ? <><RefreshCw size={9} className="animate-spin" /> Exporting…</> :
             exporting === 'done' ? <><Check size={9} /> Saved</> :
             exporting === 'error' ? <><X size={9} /> Failed</> :
             <><Download size={9} /> Export PDF</>}
          </button>
          <button onClick={load} className="flex items-center gap-1.5 px-3 py-1.5 text-[10px] font-medium transition-all hover:opacity-80"
            style={{ background: colors.accentBg, color: colors.textMuted, border: `1px solid ${colors.border}` }}>
            <RefreshCw size={9} /> Refresh
          </button>
        </div>
      </div>

      {/* ── Build-your-own analytics (AI) ────────────────────────────────── */}
      <CustomAnalyticsSection />

      {/* ── AI Insights ──────────────────────────────────────────────────── */}
      {/* Gated behind a minimum-data threshold so we never praise "100% focus"
          off a few minutes of tracking (which reads as broken next to the
          fragmented-streak stats). Until then, one honest "keep tracking" card. */}
      {totalWeekly < INSIGHT_MIN_MS && (
        <div className="section-panel px-3 py-3 flex items-center gap-2.5">
          <Lightbulb size={12} style={{ color: colors.accent, flexShrink: 0 }} />
          <p className="text-[10px] leading-relaxed" style={{ color: colors.textSecondary }}>
            Not enough data yet to draw conclusions yet. Keep Attentify running and insights will appear once there's enough activity to be meaningful.
          </p>
        </div>
      )}

      {/* ════════════════ TODAY ════════════════════════════════════════════ */}
      <AnalyticsSectionHeader
        label="Today"
        sub={new Date().toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric' })}
      />

      {/* One prominent summary — score, time and progress as a single story */}
      <TodaySummaryCard
        score={today.focusScore}
        focusedMs={today.focusedTime}
        distractedMs={today.distractedTime}
        idleMs={todayIdleMs}
        distractionEvents={todayDistractionEvents}
        switchRate={todaySwitchRate}
        hasData={todayTracked > 0}
        drills={{ score: focusDrill, focused: focusedDrill, distracted: distractedDrill, idle: idleDrill, distraction: distractionDrill, switches: switchDrill }}
      />

      {/* Dense KPI strip — click any metric for the detail behind it + Ask AI */}
      <KpiStrip items={kpiItems} />

      {/* Session analysis (left) + diagnostic column (right) */}
      <div className="grid grid-cols-3 gap-2">
        <div className="col-span-2 space-y-2">
          <SessionTimeline sessions={recentSessions} />
          <div className="section-panel p-3 space-y-3">
            <HourlyHeatmapRow hourRows={hourRows} />
            {hourRows.length >= 2 && (
              <div>
                <p className="hud-label mb-2">Focus Score Curve</p>
                <FocusLineChart hourRows={hourRows} />
              </div>
            )}
          </div>
        </div>
        <div className="section-panel p-3">
          <TimeDistributionPanel sessions={todaySessions} appRows={todayAppRows} />
        </div>
      </div>

      {/* Diagnostics — ranked issues + one recommended action */}
      {totalWeekly >= INSIGHT_MIN_MS && rankRows.length > 0 && (
        <div>
          <div className="flex items-center justify-between mb-2">
            <p className="hud-label">Ranked Diagnostics</p>
            <TableQuery title="Ranked diagnostics" summary={rankRows.map((r) => `${r.priority}: ${r.signal} ${r.current}`).join('; ')} />
          </div>
          <RankedInsightTable rows={rankRows} recommendation={recommendation} />
        </div>
      )}

      {/* Relapse + Idle tracker */}
      {(todayRelapses.length > 0 || todayIdlePeriods.length > 0) && (
        <RelapseTracker relapses={todayRelapses} idlePeriods={todayIdlePeriods} />
      )}

      {/* ════════════════ THIS WEEK ════════════════════════════════════════ */}
      <AnalyticsSectionHeader
        label="This Week"
        sub={`${dayRows.length} day${dayRows.length !== 1 ? 's' : ''} tracked · ${Math.round(focusPct)}% focus ratio`}
      />

      {/* Weekly KPIs */}
      <div className="grid grid-cols-6 gap-1.5">
        {[
          { label: 'Focus Time', value: fmt(weekly.focusedTime), color: '#34d399', sub: `${Math.round(focusPct)}% ratio`, tooltip: `${fmt(weekly.focusedTime)} focused this week` },
          { label: 'Time Lost', value: fmt(weekly.distractedTime), color: weekly.distractedTime > 7 * 3600000 ? '#f87171' : '#fbbf24', sub: `${Math.round(100 - focusPct)}% ratio`, tooltip: `${fmt(weekly.distractedTime)} on distractions` },
          { label: 'Avg Score', value: `${weeklyAvgScore}%`, color: weeklyAvgScore >= 70 ? '#34d399' : weeklyAvgScore >= 40 ? '#fbbf24' : '#f87171', sub: `${dayRows.length} days`, tooltip: `Average daily focus score` },
          { label: 'Longest Run', value: streaks.longest > 0 ? fmt(streaks.longest) : '-', color: '#34d399', sub: 'unbroken focus', tooltip: `Longest unbroken focus streak` },
          { label: 'Avg Run', value: streaks.avgLen > 0 ? fmt(streaks.avgLen) : '-', color: '#6366f1', sub: `${streaks.count} streaks`, tooltip: `Average streak length` },
          { label: 'Blocked', value: String(weekly.blockEvents), color: '#6366f1', sub: 'this week', tooltip: `${weekly.blockEvents} total block events` },
        ].map((chip, i) => kpiChip(chip, i, 330))}
      </div>

      {/* Weekly: Bar split + daily stacks | Distraction cost cards */}
      {totalWeekly > 0 && (
        <div className="grid grid-cols-3 gap-2">
          {/* Left 2/3: weekly bar + per-day stacks + day scores */}
          <div className="col-span-2 space-y-2">
            <div className="section-panel px-3 py-2.5">
              <div className="flex items-center justify-between mb-1.5">
                <p className="hud-label">Focus vs Distraction</p>
                <div className="flex items-center gap-3 text-[9px]" style={{ color: 'rgba(99,102,241,0.4)', fontFamily: '"Share Tech Mono", monospace' }}>
                  <span className="flex items-center gap-1"><span className="inline-block w-1.5 h-1.5" style={{ background: '#34d399' }} />{fmt(weekly.focusedTime)} focused</span>
                  <span className="flex items-center gap-1"><span className="inline-block w-1.5 h-1.5" style={{ background: '#ff6b35' }} />{fmt(weekly.distractedTime)} distracted</span>
                  <TableQuery title="Focus vs Distraction (this week)" summary={`${fmt(weekly.focusedTime)} focused vs ${fmt(weekly.distractedTime)} distracted, ${Math.round(focusPct)}% focus ratio`} />
                </div>
              </div>
              <div className="flex overflow-hidden h-2" style={{ background: 'rgba(99,102,241,0.06)', border: '1px solid rgba(99,102,241,0.1)' }}>
                {focusPct > 0 && <div className="bar-fill" style={{ width: `${focusPct}%`, background: 'linear-gradient(90deg, rgba(0,100,50,0.9), rgba(52,211,153,0.85))' }} />}
                {weekly.distractedTime > 0 && <div className="bar-fill delay-2" style={{ width: `${(weekly.distractedTime / totalWeekly) * 100}%`, background: 'linear-gradient(90deg, rgba(140,30,10,0.9), rgba(255,107,53,0.8))' }} />}
              </div>
              <div className="flex mt-1.5 gap-1">
                {dayRows.map((d) => {
                  const focused = d.tracked > 0 ? (d.focused / d.tracked) * 100 : 0
                  const distracted = d.tracked > 0 ? (d.distracted / d.tracked) * 100 : 0
                  const isToday = d.date === new Date().toISOString().split('T')[0]
                  return (
                    <div key={d.date} className="flex-1 flex flex-col gap-0.5" title={`${d.day}: ${d.score}% focus score`}>
                      <div className="w-full overflow-hidden flex flex-col-reverse" style={{ height: 20, background: 'rgba(99,102,241,0.03)', border: isToday ? '1px solid rgba(99,102,241,0.2)' : '1px solid rgba(99,102,241,0.06)' }}>
                        <div style={{ flex: focused, background: 'rgba(52,211,153,0.5)', minHeight: focused > 0 ? 1 : 0 }} />
                        <div style={{ flex: distracted, background: 'rgba(255,107,53,0.45)', minHeight: distracted > 0 ? 1 : 0 }} />
                        {d.tracked === 0 && <div className="flex-1" style={{ background: 'rgba(99,102,241,0.03)' }} />}
                      </div>
                      <p className="text-[7px] text-center data-value" style={{ color: isToday ? 'rgba(99,102,241,0.7)' : 'rgba(99,102,241,0.25)' }}>{d.day.slice(0, 2)}</p>
                    </div>
                  )
                })}
              </div>
            </div>
            <div className="section-panel p-3">
              <DayScoreStrip dayRows={dayRows} />
            </div>
          </div>

          {/* Right 1/3: distraction cost cards stacked */}
          <div className="space-y-2">
            {[
              { label: 'Distraction Debt', value: fmt(distractDebtMs), sub: 'lost this week', detail: avgDailyWastedMs > 0 ? `~${fmt(avgDailyWastedMs)}/day avg` : null, color: '#f87171' },
              { label: 'Switch Cost', value: recentSessions.length > 0 ? fmt(recentSessions.length * 23 * 60000) : '-', sub: 'recovery overhead', detail: `${recentSessions.length} switches × 23m`, color: '#fbbf24' },
              { label: 'Reclaim Potential', value: topDistractor ? fmt(topDistractor.totalTime) : '-', sub: topDistractor ? `block ${topDistractor.app}` : 'no distractors', detail: topDistractor ? `${topDistractor.pctOfTime}% of time` : null, color: '#34d399' },
            ].map((card) => (
              <div key={card.label} className="section-panel flex animate-entry"
                style={{ borderLeft: `2px solid ${card.color}`, animationFillMode: 'both', opacity: 0 }}>
                <MetricDrill full width={300}
                  spec={{ title: card.label, subtitle: `${card.value} · ${card.sub}`, note: card.detail ?? undefined, askPrompt: `Explain my "${card.label}" (${card.value}) this week and what I can do about it.` }}
                  render={
                    <div className="p-3">
                      <p className="text-[8px] uppercase tracking-wide mb-1.5" style={{ color: colors.textMuted, fontFamily: '"Share Tech Mono", monospace' }}>{card.label}</p>
                      <p className="text-xl font-bold leading-none data-value" style={{ color: card.color }}>{card.value}</p>
                      <p className="text-[9px] mt-1 leading-snug" style={{ color: colors.textSecondary }}>{card.sub}</p>
                      {card.detail && <p className="text-[8px] mt-0.5 data-value" style={{ color: colors.textDim, fontFamily: '"Share Tech Mono", monospace' }}>{card.detail}</p>}
                    </div>
                  }
                />
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ════════════════ PATTERNS ═════════════════════════════════════════ */}
      <AnalyticsSectionHeader label="Patterns" sub="Hour-of-week focus distribution" />
      <HourOfWeekHeatmap matrix={matrix} />

      {/* ════════════════ DEEP DIVE ════════════════════════════════════════ */}
      <AnalyticsSectionHeader label="Deep Dive" sub={`${recentSessions.length} sessions · ${sortedApps.length} apps tracked`} />

      {/* Tabs */}
      <div className="flex gap-0 items-center" style={{ borderBottom: `1px solid ${colors.border}` }}>
        {([
          { id: 'apps', label: `Apps (${sortedApps.length})` },
          { id: 'daily', label: `Daily (${dayRows.length}d)` },
          { id: 'patterns', label: 'Patterns' },
          { id: 'alerts', label: `Alerts${activeAlerts.length > 0 ? ` (${activeAlerts.length})` : ''}` },
        ] as const).map((tab) => (
          <button key={tab.id} onClick={() => setActiveTab(tab.id)}
            className="px-4 py-2 text-[10px] font-medium transition-all border-b-2 -mb-px"
            style={{ color: activeTab === tab.id ? colors.accent : colors.textMuted, borderBottomColor: activeTab === tab.id ? colors.accent : 'transparent', background: 'transparent' }}>
            {tab.label}
          </button>
        ))}
        <div className="ml-auto pr-1">
          <TableQuery
            title={activeTab === 'apps' ? 'Apps table' : activeTab === 'daily' ? 'Daily table' : activeTab === 'patterns' ? 'Patterns' : 'Alerts table'}
            summary={
              activeTab === 'apps' ? sortedApps.slice(0, 6).map((a) => `${a.app} ${fmt(a.totalTime)} (${a.pctOfTime}%)`).join(', ')
              : activeTab === 'daily' ? dayRows.map((d) => `${d.day} ${d.score}%`).join(', ')
              : activeTab === 'alerts' ? activeAlerts.slice(0, 6).map((a) => TYPE_LABELS[a.type]).join(', ')
              : `${hourRows.length} hours tracked, longest run ${fmt(streaks.longest)}`
            }
          />
        </div>
      </div>

      {activeTab === 'apps' && (<><AppBarChart rows={sortedApps} /><AppTable rows={sortedApps} toggleSort={toggleSort} SortIcon={SortIcon} /></>)}
      {activeTab === 'daily' && <DailyTable rows={dayRows} />}
      {activeTab === 'patterns' && <PatternsTab hourRows={hourRows} streaks={streaks} sessions={recentSessions} />}
      {activeTab === 'alerts' && <AlertsTable alerts={heuristicAlerts} onDismiss={dismissAlert} />}
      {/* Raw browsing/session data + search history now live on the Activity page. */}
    </div>
   </AskAIProvider>
  )
}

// ── Section header ────────────────────────────────────────────────────────────
function AnalyticsSectionHeader({ label, sub }: { label: string; sub: string }): React.ReactElement {
  return (
    <div className="flex items-center gap-3 pt-1">
      <p className="text-[10px] font-semibold uppercase tracking-wider flex-shrink-0" style={{ color: 'var(--label)', fontFamily: '"Share Tech Mono", monospace' }}>
        {label}
      </p>
      <div className="flex-1 h-px" style={{ background: 'var(--border)' }} />
      <p className="text-[9px] flex-shrink-0" style={{ color: 'var(--text-dim)', fontFamily: '"Share Tech Mono", monospace' }}>
        {sub}
      </p>
    </div>
  )
}

// ── Sub-tables ────────────────────────────────────────────────────────────────

function Th({ children, onClick }: { children: React.ReactNode; onClick?: () => void }): React.ReactElement {
  return (
    <th
      className="px-2.5 py-2 text-left text-[8px] font-bold uppercase whitespace-nowrap"
      onClick={onClick}
      style={{
        cursor: onClick ? 'pointer' : 'default',
        color: 'rgba(99,102,241,0.45)',
        background: 'rgba(2,8,18,0.9)',
        borderBottom: '1px solid rgba(99,102,241,0.1)',
        fontFamily: '"Share Tech Mono", monospace',
        letterSpacing: '0.16em',
      }}
    >
      {children}
    </th>
  )
}

function AppTable({ rows, toggleSort, SortIcon }: { // eslint-disable-line
  rows: AppRow[]
  toggleSort: (col: keyof AppRow) => void
  SortIcon: ({ col }: { col: keyof AppRow }) => React.ReactElement
}): React.ReactElement {
  const { colors } = useTheme()
  if (rows.length === 0) return <EmptyState text="No app activity recorded yet. The tracker populates as you use your device." />
  return (
    <div className="section-panel overflow-hidden">
      <table className="hud-table">
        <thead>
          <tr>
            <Th onClick={() => toggleSort('app')}><span className="flex items-center gap-1">App <SortIcon col="app" /></span></Th>
            <Th>Cat</Th>
            <Th onClick={() => toggleSort('totalTime')}><span className="flex items-center gap-1">Total <SortIcon col="totalTime" /></span></Th>
            <Th onClick={() => toggleSort('pctOfTime')}><span className="flex items-center gap-1">% <SortIcon col="pctOfTime" /></span></Th>
            <Th onClick={() => toggleSort('sessions')}><span className="flex items-center gap-1">Sessions <SortIcon col="sessions" /></span></Th>
            <Th onClick={() => toggleSort('avgDuration')}><span className="flex items-center gap-1">Avg <SortIcon col="avgDuration" /></span></Th>
            <Th>Type</Th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={row.app} style={{ background: i % 2 === 0 ? colors.rowEven : colors.rowOdd }}>
              <td className="px-2.5 py-1.5">
                <p className="text-[11px] font-medium truncate max-w-[140px]" style={{ color: colors.textPrimary }}>{row.app}</p>
              </td>
              <td className="px-2.5 py-1.5">
                <span className="text-[9px] px-1.5 py-0.5 rounded font-semibold uppercase tracking-wide" style={{ background: CAT_COLOR[row.category] + '22', color: CAT_COLOR[row.category] }}>
                  {row.category.slice(0, 4)}
                </span>
              </td>
              <td className="px-2.5 py-1.5 font-mono tabular-nums text-[10px]" style={{ color: 'rgba(180,210,235,0.6)' }}>{fmt(row.totalTime)}</td>
              <td className="px-2.5 py-1.5">
                <div className="flex items-center gap-1.5">
                  <div className="w-10 h-1 overflow-hidden" style={{ background: 'rgba(99,102,241,0.06)' }}>
                    <div className="h-full" style={{ width: `${Math.min(100, row.pctOfTime)}%`, background: row.isDistraction ? '#f87171' : '#6366f1' }} />
                  </div>
                  <span className="text-[10px] tabular-nums" style={{ color: 'rgba(180,210,235,0.6)' }}>{row.pctOfTime}%</span>
                </div>
              </td>
              <td className="px-2.5 py-1.5 tabular-nums text-[10px]" style={{ color: 'rgba(180,210,235,0.6)' }}>{row.sessions}</td>
              <td className="px-2.5 py-1.5 font-mono tabular-nums text-[10px]" style={{ color: 'rgba(180,210,235,0.6)' }}>{fmt(row.avgDuration)}</td>
              <td className="px-2.5 py-1.5">
                {row.isDistraction
                  ? <span className="text-[9px] px-1.5 py-0.5 rounded font-bold uppercase" style={{ background: 'rgba(248,113,113,0.15)', color: '#f87171' }}>DIST</span>
                  : <span className="text-[9px] px-1.5 py-0.5 rounded font-bold uppercase" style={{ background: 'rgba(52,211,153,0.12)', color: '#34d399' }}>FOCUS</span>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function DailyTable({ rows }: { rows: DayRow[] }): React.ReactElement {
  const { colors } = useTheme()
  if (rows.length === 0) return <EmptyState text="No daily data yet. Sessions accumulate here over time." />
  const totals = rows.reduce((acc, r) => ({
    focused: acc.focused + r.focused, distracted: acc.distracted + r.distracted,
    tracked: acc.tracked + r.tracked, sessions: acc.sessions + r.sessions,
  }), { focused: 0, distracted: 0, tracked: 0, sessions: 0 })
  return (
    <div className="section-panel overflow-hidden">
      <table className="hud-table">
        <thead>
          <tr>
            <Th>Day</Th><Th>Date</Th><Th>Tracked</Th><Th>Focused</Th><Th>Distracted</Th>
            <Th>Distract%</Th><Th>Score</Th><Th>Sessions</Th><Th>Top App</Th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => {
            const isToday = row.date === new Date().toISOString().split('T')[0]
            return (
              <tr key={row.date} style={{
                background: isToday ? colors.accentBg : i % 2 === 0 ? colors.rowEven : colors.rowOdd,
                outline: isToday ? '1px solid rgba(99,102,241,0.12)' : 'none',
              }}>
                <td className="px-2.5 py-1.5">
                  <span className="text-white text-[11px] font-semibold">{row.day}</span>
                  {isToday && <span className="ml-1 text-[8px] px-1 py-0.5" style={{ background: 'rgba(99,102,241,0.12)', color: '#6366f1', fontFamily: '"Share Tech Mono", monospace' }}>today</span>}
                </td>
                <td className="px-2.5 py-1.5 text-[10px] font-mono tabular-nums" style={{ color: 'rgba(99,102,241,0.3)' }}>{row.date}</td>
                <td className="px-2.5 py-1.5 font-mono tabular-nums text-[10px]" style={{ color: 'rgba(180,210,235,0.6)' }}>{row.tracked > 0 ? fmt(row.tracked) : '-'}</td>
                <td className="px-2.5 py-1.5 font-mono tabular-nums text-[10px]" style={{ color: row.focused > 0 ? '#34d399' : '#4a6280' }}>{row.focused > 0 ? fmt(row.focused) : '-'}</td>
                <td className="px-2.5 py-1.5 font-mono tabular-nums text-[10px]" style={{ color: row.distracted > 3600000 ? '#f87171' : row.distracted > 0 ? '#fbbf24' : '#4a6280' }}>{row.distracted > 0 ? fmt(row.distracted) : '-'}</td>
                <td className="px-2.5 py-1.5">
                  <span className="text-[10px] tabular-nums" style={{ color: row.distractRate > 50 ? '#f87171' : row.distractRate > 25 ? '#fbbf24' : '#34d399' }}>
                    {row.tracked > 0 ? `${row.distractRate}%` : '-'}
                  </span>
                </td>
                <td className="px-2.5 py-1.5">
                  <div className="flex items-center gap-1.5">
                    <div className="w-12 h-1 overflow-hidden" style={{ background: 'rgba(99,102,241,0.06)' }}>
                      <div className="h-full" style={{ width: `${row.score}%`, background: row.score >= 70 ? '#34d399' : row.score >= 40 ? '#fbbf24' : '#f87171' }} />
                    </div>
                    <span className="text-[10px] tabular-nums font-mono" style={{ color: row.score >= 70 ? '#34d399' : row.score >= 40 ? '#fbbf24' : '#f87171' }}>{row.score}%</span>
                  </div>
                </td>
                <td className="px-2.5 py-1.5 tabular-nums text-[10px]" style={{ color: 'rgba(180,210,235,0.6)' }}>{row.sessions}</td>
                <td className="px-2.5 py-1.5 text-[10px] truncate max-w-[90px]" style={{ color: 'rgba(99,102,241,0.45)' }}>{row.topApp}</td>
              </tr>
            )
          })}
          {/* Totals row */}
          <tr style={{ background: 'rgba(99,102,241,0.04)', borderTop: '1px solid rgba(99,102,241,0.1)' }}>
            <td className="px-2.5 py-1.5 text-[10px] font-bold text-white" colSpan={2}>Total ({rows.length} days)</td>
            <td className="px-2.5 py-1.5 font-mono tabular-nums text-[10px]" style={{ color: 'rgba(180,210,235,0.6)' }}>{fmt(totals.tracked)}</td>
            <td className="px-2.5 py-1.5 font-mono tabular-nums text-[10px]" style={{ color: '#34d399' }}>{fmt(totals.focused)}</td>
            <td className="px-2.5 py-1.5 font-mono tabular-nums text-[10px]" style={{ color: '#f87171' }}>{fmt(totals.distracted)}</td>
            <td className="px-2.5 py-1.5 text-[10px]" style={{ color: totals.tracked > 0 && (totals.distracted / totals.tracked) > 0.5 ? '#f87171' : '#fbbf24' }}>
              {totals.tracked > 0 ? `${Math.round((totals.distracted / totals.tracked) * 100)}%` : '-'}
            </td>
            <td colSpan={3} />
          </tr>
        </tbody>
      </table>
    </div>
  )
}

function PatternsTab({ hourRows, streaks, sessions }: {
  hourRows: HourRow[]
  streaks: { longest: number; current: number; count: number; avgLen: number }
  sessions: ActivitySession[]
}): React.ReactElement {
  const { colors } = useTheme()
  const peakFocusHour = hourRows.length > 0 ? hourRows.filter(r => r.ratio >= 0).reduce((best, r) => r.focused > best.focused ? r : best, hourRows[0]!) : null
  const peakDistractHour = hourRows.length > 0 ? hourRows.filter(r => r.ratio >= 0).reduce((best, r) => r.distracted > best.distracted ? r : best, hourRows[0]!) : null
  const distractApps = sessions.filter((s) => s.isDistraction)
  const distractMap = new Map<string, number>()
  for (const s of distractApps) distractMap.set(s.app, (distractMap.get(s.app) ?? 0) + s.duration)
  const topDistractors = [...distractMap.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6)
  const totalDistracted = topDistractors.reduce((s, [, m]) => s + m, 0)

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-4 gap-2">
        {[
          { label: 'Longest Focus Run', value: streaks.longest > 0 ? fmt(streaks.longest) : '-', icon: <TrendingUp size={12} style={{ color: '#34d399' }} />, color: '#34d399' },
          { label: 'Current Streak', value: streaks.current > 0 ? fmt(streaks.current) : 'None', icon: <Zap size={12} style={{ color: '#34d399' }} />, color: streaks.current > 0 ? '#34d399' : 'rgba(99,102,241,0.25)' },
          { label: 'Avg Focus Run', value: streaks.avgLen > 0 ? fmt(streaks.avgLen) : '-', icon: <Clock size={12} style={{ color: 'rgba(99,102,241,0.5)' }} />, color: '#6366f1' },
          { label: 'Peak Focus Hour', value: peakFocusHour ? fmtHour(peakFocusHour.hour) : '-', icon: <TrendingUp size={12} style={{ color: '#6366f1' }} />, color: '#6366f1' },
        ].map((s) => (
          <div key={s.label} className="hud-panel p-3">
            <div className="flex items-center gap-1.5 mb-1">{s.icon}<p className="hud-label">{s.label}</p></div>
            <p className="text-lg font-black data-value" style={{ color: s.color, textShadow: `0 0 12px ${s.color}55` }}>{s.value}</p>
          </div>
        ))}
      </div>

      {hourRows.length >= 2 && (
        <div className="section-panel p-3">
          <div className="flex items-center justify-between mb-2">
            <p className="hud-label">Hourly Focus Score Today</p>
            {peakDistractHour && (
              <span className="text-[9px]" style={{ color: 'rgba(99,102,241,0.45)' }}>
                Peak distraction: <span style={{ color: '#f87171' }}>{fmtHour(peakDistractHour.hour)}</span>
              </span>
            )}
          </div>
          <FocusLineChart hourRows={hourRows} />
        </div>
      )}

      {streaks.count > 0 && (
        <div className="section-panel p-3">
          <p className="hud-label mb-2">Focus Streak History</p>
          <div className="flex items-center gap-1 flex-wrap">
            {(() => {
              const focusSessions = [...sessions].filter((s) => !s.isDistraction).sort((a, b) => a.startTime - b.startTime)
              const GAP = 5 * 60 * 1000
              const streakBlocks: number[] = []
              let cur = 0, curEnd = 0
              for (const s of focusSessions) {
                if (cur === 0 || s.startTime - curEnd > GAP) { if (cur > 0) streakBlocks.push(cur); cur = s.duration }
                else cur += s.duration
                curEnd = s.endTime
              }
              if (cur > 0) streakBlocks.push(cur)
              const maxBlock = Math.max(...streakBlocks, 1)
              return streakBlocks.slice(-20).map((ms, i) => {
                const h = Math.max(8, Math.round((ms / maxBlock) * 40))
                const color = ms > 3600000 ? '#34d399' : ms > 1800000 ? '#34d399' : ms > 900000 ? '#fbbf24' : '#546e7a'
                return (
                  <div key={i} className="rounded-sm flex-shrink-0" style={{ width: 10, height: h, background: color, opacity: 0.8 }} title={fmt(ms)} />
                )
              })
            })()}
          </div>
          <p className="text-[9px] mt-1.5 hud-label" style={{ color: 'rgba(99,102,241,0.25)' }}>Each bar = one unbroken focus streak · height = duration</p>
        </div>
      )}

      {topDistractors.length > 0 && (
        <div>
          <p className="hud-label mb-1.5">Top Distraction Vectors This Week</p>
          <div className="section-panel overflow-hidden">
            <table className="hud-table">
              <thead><tr><Th>App</Th><Th>Time Lost</Th><Th>Share of Distractions</Th><Th>Impact</Th></tr></thead>
              <tbody>
                {topDistractors.map(([app, ms], i) => {
                  const share = totalDistracted > 0 ? Math.round((ms / totalDistracted) * 100) : 0
                  return (
                    <tr key={app} style={{ background: i % 2 === 0 ? colors.rowEven : colors.rowOdd }}>
                      <td className="px-2.5 py-1.5 text-[11px] font-medium truncate max-w-[160px]" style={{ color: colors.textPrimary }}>{app}</td>
                      <td className="px-2.5 py-1.5 font-mono tabular-nums text-[10px]" style={{ color: '#f87171' }}>{fmt(ms)}</td>
                      <td className="px-2.5 py-1.5">
                        <div className="flex items-center gap-1.5">
                          <div className="w-20 h-1 overflow-hidden" style={{ background: 'rgba(99,102,241,0.06)' }}>
                            <div className="h-full" style={{ width: `${share}%`, background: '#f87171' }} />
                          </div>
                          <span className="text-[10px] tabular-nums" style={{ color: 'rgba(180,210,235,0.6)' }}>{share}%</span>
                        </div>
                      </td>
                      <td className="px-2.5 py-1.5">
                        <span className="text-[9px] px-1.5 py-0.5 rounded font-semibold" style={{
                          background: share > 40 ? 'rgba(248,113,113,0.15)' : share > 20 ? 'rgba(251,191,36,0.12)' : 'rgba(52,211,153,0.1)',
                          color: share > 40 ? '#f87171' : share > 20 ? '#fbbf24' : '#34d399',
                        }}>
                          {share > 40 ? 'HIGH' : share > 20 ? 'MED' : 'LOW'}
                        </span>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {hourRows.length > 0 && (
        <div>
          <p className="hud-label mb-1.5">Hourly Breakdown Today</p>
          <div className="section-panel overflow-hidden">
            <table className="hud-table">
              <thead>
                <tr><Th>Hour</Th><Th>Focused</Th><Th>Distracted</Th><Th>Focus Ratio</Th><Th>Sessions</Th><Th>Switches/h</Th><Th>Top App</Th></tr>
              </thead>
              <tbody>
                {hourRows.map((row, i) => (
                  <tr key={row.hour} style={{ background: i % 2 === 0 ? colors.rowEven : colors.rowOdd }}>
                    <td className="px-2.5 py-1.5 font-mono text-[11px] whitespace-nowrap" style={{ color: colors.textPrimary }}>{fmtHour(row.hour)}</td>
                    <td className="px-2.5 py-1.5 font-mono tabular-nums text-[10px]" style={{ color: row.focused > 0 ? '#34d399' : '#4a6280' }}>{row.focused > 0 ? fmt(row.focused) : '-'}</td>
                    <td className="px-2.5 py-1.5 font-mono tabular-nums text-[10px]" style={{ color: row.distracted > 0 ? '#f87171' : '#4a6280' }}>{row.distracted > 0 ? fmt(row.distracted) : '-'}</td>
                    <td className="px-2.5 py-1.5">
                      {row.ratio >= 0 ? (
                        <div className="flex items-center gap-1.5">
                          <div className="w-14 h-1 overflow-hidden" style={{ background: 'rgba(99,102,241,0.06)' }}>
                            <div className="h-full" style={{ width: `${row.ratio}%`, background: row.ratio >= 70 ? '#34d399' : row.ratio >= 40 ? '#fbbf24' : '#f87171' }} />
                          </div>
                          <span className="text-[10px] tabular-nums" style={{ color: row.ratio >= 70 ? '#34d399' : row.ratio >= 40 ? '#fbbf24' : '#f87171' }}>{row.ratio}%</span>
                        </div>
                      ) : <span style={{ color: 'rgba(99,102,241,0.2)' }}>-</span>}
                    </td>
                    <td className="px-2.5 py-1.5 tabular-nums text-[10px]" style={{ color: 'rgba(180,210,235,0.6)' }}>{row.sessions}</td>
                    <td className="px-2.5 py-1.5 tabular-nums text-[10px]" style={{ color: row.switchRate > 20 ? '#f87171' : row.switchRate > 10 ? '#fbbf24' : '#34d399' }}>{row.switchRate}</td>
                    <td className="px-2.5 py-1.5 text-[10px] truncate max-w-[110px]" style={{ color: 'rgba(180,210,235,0.6)' }}>{row.topApp}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}

function AlertsTable({ alerts, onDismiss }: { alerts: HeuristicAlert[]; onDismiss: (id: string) => void }): React.ReactElement {
  const { colors } = useTheme()
  if (alerts.length === 0) return <EmptyState text="No behavioral anomalies detected this week. Your focus patterns look clean." />
  return (
    <div className="section-panel overflow-hidden">
      <table className="hud-table">
        <thead><tr><Th>Time</Th><Th>Pattern</Th><Th>Sev</Th><Th>Description</Th><Th>App</Th><Th>Action</Th></tr></thead>
        <tbody>
          {[...alerts].reverse().map((alert, i) => {
            const sev = SEV[alert.severity]
            return (
              <tr key={alert.id} style={{ background: alert.dismissed ? colors.panelBg : i % 2 === 0 ? colors.rowEven : colors.rowOdd, opacity: alert.dismissed ? 0.5 : 1 }}>
                <td className="px-2.5 py-1.5 text-[9px] font-mono whitespace-nowrap" style={{ color: 'rgba(99,102,241,0.45)' }}>
                  {fmtTime(alert.detectedAt)}<br /><span style={{ color: 'rgba(99,102,241,0.2)' }}>{fmtDate(alert.detectedAt)}</span>
                </td>
                <td className="px-2.5 py-1.5 text-[11px] font-medium text-white whitespace-nowrap">{TYPE_LABELS[alert.type]}</td>
                <td className="px-2.5 py-1.5">
                  <span className="text-[8px] px-1.5 py-0.5 rounded font-bold" style={{ background: sev.bg, color: sev.text }}>{sev.label}</span>
                </td>
                <td className="px-2.5 py-1.5 text-[10px] max-w-[200px] leading-tight" style={{ color: 'rgba(180,210,235,0.6)' }}>{alert.description}</td>
                <td className="px-2.5 py-1.5 text-[9px] truncate max-w-[80px]" style={{ color: 'rgba(99,102,241,0.45)' }}>{alert.app ?? '-'}</td>
                <td className="px-2.5 py-1.5">
                  {alert.dismissed
                    ? <span className="text-[9px]" style={{ color: 'rgba(99,102,241,0.2)' }}>dismissed</span>
                    : <button onClick={() => onDismiss(alert.id)} className="flex items-center gap-1 text-[9px] px-2 py-1 hover:text-white transition-colors" style={{ background: 'rgba(99,102,241,0.06)', border: '1px solid rgba(99,102,241,0.15)', color: 'rgba(99,102,241,0.5)', fontFamily: '"Share Tech Mono", monospace' }}>
                        <X size={8} /> Dismiss
                      </button>}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

function ActivityLog({ sessions }: { sessions: ActivitySession[] }): React.ReactElement {
  const { colors } = useTheme()
  if (sessions.length === 0) return <EmptyState text="No activity sessions recorded yet." />
  return (
    <div className="section-panel overflow-hidden">
      <table className="hud-table">
        <thead><tr><Th>Start</Th><Th>End</Th><Th>App</Th><Th>Domain / Title</Th><Th>Duration</Th><Th>Cat</Th><Th>Type</Th></tr></thead>
        <tbody>
          {sessions.map((s, i) => {
            const domain = s.url ? extractDomain(s.url) : null
            return (
              <tr key={s.id} style={{ background: s.isDistraction ? 'rgba(248,113,113,0.04)' : i % 2 === 0 ? colors.rowEven : colors.rowOdd }}>
                <td className="px-2.5 py-1 text-[9px] font-mono whitespace-nowrap tabular-nums" style={{ color: colors.textSecondary }}>{fmtTime(s.startTime)}</td>
                <td className="px-2.5 py-1 text-[9px] font-mono whitespace-nowrap tabular-nums" style={{ color: colors.textMuted }}>{fmtTime(s.endTime)}</td>
                <td className="px-2.5 py-1"><p className="text-[10px] font-medium truncate max-w-[90px]" style={{ color: colors.textPrimary }}>{s.app}</p></td>
                <td className="px-2.5 py-1">
                  {domain
                    ? <div><p className="text-[9px] font-mono truncate max-w-[150px]" style={{ color: '#6366f1' }}>{domain}</p><p className="text-[8px] truncate max-w-[150px]" style={{ color: colors.textMuted }}>{s.title}</p></div>
                    : <p className="text-[9px] truncate max-w-[150px]" style={{ color: colors.textSecondary }}>{s.title}</p>}
                </td>
                <td className="px-2.5 py-1 text-[10px] font-mono tabular-nums whitespace-nowrap" style={{ color: s.isDistraction ? '#f87171' : colors.textSecondary }}>{fmt(s.duration)}</td>
                <td className="px-2.5 py-1">
                  <span className="text-[8px] px-1 py-0.5 rounded font-semibold" style={{ background: CAT_COLOR[s.category] + '18', color: CAT_COLOR[s.category] }}>{s.category.slice(0, 4)}</span>
                </td>
                <td className="px-2.5 py-1">
                  {s.isDistraction
                    ? <span className="flex items-center gap-0.5"><AlertTriangle size={8} style={{ color: '#f87171' }} /><span className="text-[9px]" style={{ color: '#f87171' }}>dist</span></span>
                    : <span className="text-[9px]" style={{ color: '#34d399' }}>focus</span>}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

function WebsitesTab({ domains, sessions }: { domains: DomainRow[]; sessions: ActivitySession[] }): React.ReactElement {
  const { colors } = useTheme()

  // Aggregate from sessions' URLs for visit counts and supplement DB domains
  const urlDomainMap = new Map<string, { total_ms: number; visits: number; isDistraction: boolean }>()
  for (const s of sessions) {
    if (!s.url) continue
    const domain = extractDomain(s.url)
    if (!domain) continue
    const cur = urlDomainMap.get(domain) ?? { total_ms: 0, visits: 0, isDistraction: s.isDistraction }
    cur.total_ms += s.duration
    cur.visits++
    if (s.isDistraction) cur.isDistraction = true
    urlDomainMap.set(domain, cur)
  }

  // Merge DB domains with session URL data
  const merged = new Map<string, { total_ms: number; category: string; classification: string; visits: number; isDistraction: boolean }>()
  for (const d of domains) {
    merged.set(d.domain, { total_ms: d.total_ms, category: d.category, classification: d.classification, visits: 0, isDistraction: d.classification === 'distract' })
  }
  for (const [domain, v] of urlDomainMap) {
    const existing = merged.get(domain)
    if (existing) {
      existing.visits = v.visits
      if (v.total_ms > existing.total_ms) existing.total_ms = v.total_ms
    } else {
      merged.set(domain, { total_ms: v.total_ms, category: 'browser', classification: v.isDistraction ? 'distract' : 'neutral', visits: v.visits, isDistraction: v.isDistraction })
    }
  }

  const rows = [...merged.entries()]
    .map(([domain, v]) => ({ domain, ...v }))
    .filter((r) => r.total_ms > 5000)
    .sort((a, b) => b.total_ms - a.total_ms)
    .slice(0, 50)

  const maxMs = rows[0]?.total_ms ?? 1

  if (rows.length === 0) return <EmptyState text="No website visits recorded yet. Website tracking activates when browser URLs are captured via system accessibility APIs." />

  return (
    <div className="section-panel overflow-hidden">
      <table className="hud-table">
        <thead>
          <tr>
            <Th>Domain</Th>
            <Th>Category</Th>
            <Th>Classification</Th>
            <Th>Time</Th>
            <Th>Share</Th>
            <Th>Visits</Th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => {
            const pct = Math.round((row.total_ms / maxMs) * 100)
            const clsColor = row.classification === 'distract' ? '#f87171' : row.classification === 'focus' ? '#34d399' : '#607d8b'
            return (
              <tr key={row.domain} style={{ background: row.classification === 'distract' ? 'rgba(248,113,113,0.03)' : i % 2 === 0 ? colors.rowEven : colors.rowOdd }}>
                <td className="px-2.5 py-1.5">
                  <div className="flex items-center gap-1.5">
                    <Globe size={9} style={{ color: 'rgba(99,102,241,0.35)', flexShrink: 0 }} />
                    <p className="text-[10px] font-mono truncate max-w-[150px]" style={{ color: colors.textPrimary }}>{row.domain}</p>
                  </div>
                </td>
                <td className="px-2.5 py-1.5">
                  <span className="text-[9px] px-1.5 py-0.5 rounded font-semibold capitalize" style={{ background: 'rgba(99,102,241,0.08)', color: 'rgba(99,102,241,0.6)' }}>
                    {row.category}
                  </span>
                </td>
                <td className="px-2.5 py-1.5">
                  <span className="text-[9px] px-1.5 py-0.5 rounded font-bold uppercase" style={{ background: clsColor + '22', color: clsColor }}>
                    {row.classification}
                  </span>
                </td>
                <td className="px-2.5 py-1.5 font-mono tabular-nums text-[10px]" style={{ color: row.classification === 'distract' ? '#f87171' : colors.textSecondary }}>{fmt(row.total_ms)}</td>
                <td className="px-2.5 py-1.5">
                  <div className="flex items-center gap-1.5">
                    <div className="w-16 h-1 overflow-hidden" style={{ background: 'rgba(99,102,241,0.06)' }}>
                      <div className="h-full" style={{ width: `${pct}%`, background: row.classification === 'distract' ? '#f87171' : '#6366f1' }} />
                    </div>
                    <span className="text-[9px] tabular-nums" style={{ color: 'rgba(180,210,235,0.6)' }}>{pct}%</span>
                  </div>
                </td>
                <td className="px-2.5 py-1.5 tabular-nums text-[10px]" style={{ color: 'rgba(180,210,235,0.5)' }}>
                  {row.visits > 0 ? row.visits : '-'}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

function RelapseTracker({ relapses, idlePeriods }: { relapses: Relapse[]; idlePeriods: IdlePeriod[] }): React.ReactElement {
  const { colors } = useTheme()
  return (
    <div className="grid grid-cols-2 gap-2">
      <div className="section-panel p-3">
        <div className="flex items-center gap-1.5 mb-2.5">
          <AlertTriangle size={10} style={{ color: relapses.length > 0 ? '#fbbf24' : '#34d399', flexShrink: 0 }} />
          <p className="hud-label">Relapse Events Today</p>
          <span className="ml-auto text-[10px] font-bold data-value" style={{ color: relapses.length > 3 ? '#f87171' : relapses.length > 0 ? '#fbbf24' : '#34d399' }}>
            {relapses.length}
          </span>
        </div>
        {relapses.length === 0 ? (
          <p className="text-[9px]" style={{ color: colors.textDim, fontFamily: '"Share Tech Mono", monospace' }}>No relapses today. Discipline holding.</p>
        ) : (
          <div className="space-y-1 max-h-28 overflow-y-auto">
            {[...relapses].reverse().slice(0, 6).map((r, i) => (
              <div key={i} className="flex items-center gap-2 py-1 px-1.5" style={{ background: 'rgba(251,191,36,0.04)', border: '1px solid rgba(251,191,36,0.1)' }}>
                <span className="text-[8px] font-mono flex-shrink-0" style={{ color: 'rgba(99,102,241,0.35)' }}>{new Date(r.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                <span className="text-[9px] truncate max-w-[80px]" style={{ color: colors.textPrimary }}>{r.app}</span>
                <span className="text-[8px] flex-shrink-0 ml-auto" style={{ color: colors.textDim }}>+{fmt(r.gapMs)}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="section-panel p-3">
        <div className="flex items-center gap-1.5 mb-2.5">
          <Clock size={10} style={{ color: 'rgba(99,102,241,0.5)', flexShrink: 0 }} />
          <p className="hud-label">Idle Gaps Today</p>
          <span className="ml-auto text-[9px] font-mono" style={{ color: 'rgba(99,102,241,0.45)' }}>
            {idlePeriods.length} gap{idlePeriods.length !== 1 ? 's' : ''}
          </span>
        </div>
        {idlePeriods.length === 0 ? (
          <p className="text-[9px]" style={{ color: colors.textDim, fontFamily: '"Share Tech Mono", monospace' }}>No idle gaps ≥3m detected today.</p>
        ) : (
          <div className="space-y-1 max-h-28 overflow-y-auto">
            {[...idlePeriods].reverse().slice(0, 6).map((ip, i) => (
              <div key={i} className="flex items-center gap-2 py-1 px-1.5" style={{ background: 'rgba(99,102,241,0.03)', border: '1px solid rgba(99,102,241,0.08)' }}>
                <span className="text-[8px] font-mono flex-shrink-0" style={{ color: 'rgba(99,102,241,0.35)' }}>{new Date(ip.start).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                <span className="text-[10px] font-bold data-value flex-shrink-0" style={{ color: ip.duration > 1800000 ? '#fbbf24' : 'rgba(99,102,241,0.7)' }}>{fmt(ip.duration)}</span>
                <span className="text-[8px] truncate" style={{ color: colors.textDim }}>after {ip.prevApp}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function EmptyState({ text }: { text: string }): React.ReactElement {
  return (
    <div className="section-panel py-8 text-center">
      <Activity size={18} style={{ color: 'rgba(99,102,241,0.25)' }} className="mx-auto mb-2" />
      <p className="text-[10px] max-w-sm mx-auto leading-relaxed" style={{ color: 'rgba(99,102,241,0.3)', fontFamily: '"Share Tech Mono", monospace' }}>{text}</p>
    </div>
  )
}

// ── Custom analytics: describe what you want, the AI builds a live card ──────────

const CARD_CAT_COLOR: Record<string, string> = {
  productivity: '#34d399', development: '#34d399', communication: '#fbbf24',
  browser: '#3b9eff', social: '#f87171', entertainment: '#f87171', gaming: '#f87171',
  system: '#64748b', other: '#475569',
}

function cardUnitFmt(value: number, unit: 'ms' | 'count' | 'percent'): string {
  if (unit === 'ms') return fmt(value)
  if (unit === 'percent') return `${value}%`
  return String(value)
}

function CustomAnalyticsSection(): React.ReactElement {
  const { colors } = useTheme()
  const [cards, setCards] = useState<CustomAnalyticsCard[]>([])
  const [sessions, setSessions] = useState<ActivitySession[]>([])
  const [desc, setDesc] = useState('')
  const [building, setBuilding] = useState(false)
  const [error, setError] = useState('')

  const loadCards = useCallback(() => {
    api.getCustomCards().then(setCards).catch(() => setCards([]))
  }, [])

  useEffect(() => {
    loadCards()
    // Cards recompute from a broad window so a "last 30 days" card is accurate.
    api.getTimesheet(31).then((r) => setSessions(r.sessions ?? [])).catch(() => setSessions([]))
    // The card is created in the main process; it emits store:refresh on done.
    const off = api.onStoreRefresh?.(() => { loadCards(); api.getTimesheet(31).then((r) => setSessions(r.sessions ?? [])).catch(() => {}) })
    return () => { off?.() }
  }, [loadCards])

  // Submit the description straight to the builder, no chat redirect, and the user
  // never sees the underlying instructions we send the model.
  const submit = async (): Promise<void> => {
    const q = desc.trim()
    if (!q || building) return
    setBuilding(true); setError('')
    try {
      const res = await api.buildAnalyticsCard(q)
      if (res.ok) { setDesc(''); loadCards(); api.getTimesheet(31).then((r) => setSessions(r.sessions ?? [])).catch(() => {}) }
      else setError(res.error === 'PAYWALL' ? 'Free AI used up. Add your key in Settings.' : (res.error || 'Could not build that. Try rephrasing.'))
    } catch { setError('Could not build that. Try rephrasing.') }
    setBuilding(false)
  }

  const remove = async (id: string): Promise<void> => {
    await api.deleteCustomCard(id)
    loadCards()
  }

  return (
    <div className="section-panel p-3.5">
      <div className="flex items-center gap-2 mb-2.5">
        <div className="w-6 h-6 rounded-lg flex items-center justify-center flex-shrink-0"
          style={{ background: colors.accentBg, border: `1px solid ${colors.border}` }}>
          <Sparkles size={13} style={{ color: colors.accent }} />
        </div>
        <div className="min-w-0">
          <p className="text-[12px] font-semibold" style={{ color: colors.textPrimary }}>Build your own analytics</p>
          <p className="text-[10px]" style={{ color: colors.textMuted }}>Describe any metric. Attentify computes it from your activity and pins it here, live.</p>
        </div>
      </div>

      {/* Prominent input bar */}
      <div className="flex items-center gap-2 px-3 py-2 rounded-xl mb-1"
        style={{ background: colors.inputBg, border: `1px solid ${colors.borderMid}` }}>
        <Sparkles size={13} style={{ color: colors.accent, flexShrink: 0 }} />
        <input
          value={desc}
          onChange={(e) => { setDesc(e.target.value); setError('') }}
          onKeyDown={(e) => { if (e.key === 'Enter') void submit() }}
          disabled={building}
          placeholder="e.g. “time on social media per weekday” or “my top 5 domains in the evening”"
          className="flex-1 bg-transparent text-[12px] outline-none disabled:opacity-60"
          style={{ color: colors.textPrimary, caretColor: colors.accent }}
        />
        <button
          onClick={() => void submit()}
          disabled={!desc.trim() || building}
          className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] font-medium transition-all disabled:opacity-40 flex-shrink-0"
          style={{ background: colors.accentBg, border: `1px solid ${colors.borderMid}`, color: colors.accent }}
        >
          {building ? <><RefreshCw size={12} className="animate-spin" /> Building…</> : <>Build <ArrowRight size={12} /></>}
        </button>
      </div>
      {error && <p className="text-[10px] mt-1" style={{ color: colors.negative }}>{error}</p>}

      {/* Example chips when empty */}
      {cards.length === 0 && (
        <div className="flex flex-wrap gap-1.5 mt-2">
          {['Time per category this week', 'Focus ratio by hour', 'Top distracting domains', 'Sessions by weekday'].map((ex) => (
            <button key={ex} onClick={() => setDesc(ex)}
              className="px-2.5 py-1 rounded-full text-[10px] transition-colors"
              style={{ background: colors.cardBg, border: `1px solid ${colors.border}`, color: colors.textSecondary }}>
              {ex}
            </button>
          ))}
        </div>
      )}

      {/* Saved cards. A canvas the user owns: drag to reorder, ask about any of them. */}
      {cards.length > 0 && (
        <div className="mt-3">
          <CardCanvas
            cards={cards}
            sessions={sessions}
            onReorder={(next) => {
              setCards(next)
              api.reorderAnalyticsCards?.(next.map((c) => c.id)).catch(() => { /* signed out: order is not persisted */ })
            }}
            onRun={(card) => {
              // An action card is one tap from changing the machine, so anything marked
              // confirm asks first. Only the id crosses the bridge; main resolves the
              // action from the store.
              if (card.action?.confirm && !window.confirm(`${card.action.label}?\n\n${card.description ?? card.title}`)) return
              api.runCardAction?.(card.id)
                .then((r) => { if (!r?.ok && r?.error) window.alert(r.error) })
                .catch(() => { /* signed out: the gate already refused it */ })
            }}
            onDelete={(id) => void remove(id)}
          />
        </div>
      )}
    </div>
  )
}

function CustomCard(
  { card, sessions, onDelete }: { card: CustomAnalyticsCard; sessions: ActivitySession[]; onDelete: () => void }
): React.ReactElement {
  const { colors } = useTheme()
  const res = useMemo(() => runAnalyticsQuery(sessions, card.spec), [sessions, card.spec])
  const max = Math.max(1, ...res.rows.map((r) => r.value))

  return (
    <div className="rounded-xl p-3" style={{ background: colors.cardBg, border: `1px solid ${colors.border}` }}>
      <div className="flex items-start justify-between gap-2 mb-2">
        <div className="min-w-0">
          <p className="text-[12px] font-semibold truncate" style={{ color: colors.textPrimary }}>{card.title}</p>
          <p className="text-[9.5px]" style={{ color: colors.textMuted }}>
            {card.description || `${card.spec.metric.replace('_', ' ')} by ${card.spec.groupBy} · last ${card.spec.rangeDays}d`}
          </p>
        </div>
        <button onClick={onDelete} title="Delete card" className="flex-shrink-0 p-1 rounded transition-colors hover:opacity-100 opacity-50" style={{ color: colors.textMuted }}>
          <Trash2 size={12} />
        </button>
      </div>

      {res.matched === 0 ? (
        <p className="text-[10px] py-3 text-center" style={{ color: colors.textMuted }}>No matching activity yet.</p>
      ) : card.viz === 'number' ? (
        <div className="py-1">
          <p className="text-[26px] font-bold leading-none data-value" style={{ color: colors.accent }}>{cardUnitFmt(res.total, res.unit)}</p>
          <p className="text-[9.5px] mt-1" style={{ color: colors.textMuted }}>across {res.matched} sessions</p>
        </div>
      ) : card.viz === 'line' ? (
        <CardLineChart rows={res.rows} unit={res.unit} />
      ) : card.viz === 'table' ? (
        <div className="overflow-x-auto">
          <table className="w-full text-left" style={{ borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th className="text-[9px] font-semibold uppercase tracking-wide py-1 pr-2" style={{ color: colors.textMuted, borderBottom: `1px solid ${colors.border}` }}>{card.spec.groupBy}</th>
                <th className="text-[9px] font-semibold uppercase tracking-wide py-1 px-2 text-right" style={{ color: colors.textMuted, borderBottom: `1px solid ${colors.border}` }}>{res.unit === 'ms' ? 'time' : res.unit === 'percent' ? 'focus' : 'count'}</th>
                <th className="text-[9px] font-semibold uppercase tracking-wide py-1 pl-2 text-right" style={{ color: colors.textMuted, borderBottom: `1px solid ${colors.border}` }}>detail</th>
              </tr>
            </thead>
            <tbody>
              {res.rows.slice(0, 12).map((r) => (
                <tr key={r.label}>
                  <td className="text-[11px] py-1 pr-2 capitalize truncate" style={{ color: colors.textSecondary, maxWidth: 120 }}>{r.label}</td>
                  <td className="text-[11px] py-1 px-2 text-right data-value" style={{ color: colors.textPrimary }}>{cardUnitFmt(r.value, res.unit)}</td>
                  <td className="text-[10px] py-1 pl-2 text-right" style={{ color: colors.textMuted }}>{r.detail ?? '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="space-y-1">
          {res.rows.slice(0, 8).map((r) => (
            <div key={r.label} className="flex items-center gap-2" title={r.detail}>
              <span className="text-[10px] w-24 truncate flex-shrink-0 capitalize" style={{ color: colors.textSecondary }}>{r.label}</span>
              <div className="flex-1 h-3 rounded overflow-hidden" style={{ background: 'rgba(120,130,160,0.08)', minWidth: 0 }}>
                <div className="h-full rounded" style={{ width: `${(r.value / max) * 100}%`, background: CARD_CAT_COLOR[r.label] ?? colors.accent, opacity: 0.9 }} />
              </div>
              <span className="text-[10px] w-14 text-right flex-shrink-0 data-value" style={{ color: colors.textPrimary }}>{cardUnitFmt(r.value, res.unit)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// Compact line/area chart for custom cards (best for hour/weekday trends).
function CardLineChart({ rows, unit }: { rows: { label: string; value: number }[]; unit: 'ms' | 'count' | 'percent' }): React.ReactElement {
  const { colors } = useTheme()
  const W = 260, H = 96, PL = 4, PR = 4, PT = 8, PB = 16
  const iW = W - PL - PR, iH = H - PT - PB
  const pts = rows.slice(0, 24)
  if (pts.length < 2) {
    return <p className="text-[10px] py-3 text-center" style={{ color: colors.textMuted }}>Not enough points to graph.</p>
  }
  const max = Math.max(1, ...pts.map((p) => p.value))
  const toX = (i: number): number => PL + (i / (pts.length - 1)) * iW
  const toY = (v: number): number => PT + iH - (v / max) * iH
  const line = pts.map((p, i) => `${toX(i)},${toY(p.value)}`).join(' ')
  const area = `M${toX(0)},${PT + iH} ${pts.map((p, i) => `L${toX(i)},${toY(p.value)}`).join(' ')} L${toX(pts.length - 1)},${PT + iH}Z`
  const labelEvery = Math.ceil(pts.length / 6)
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ display: 'block' }}>
      <defs>
        <linearGradient id="cardArea" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={colors.accent} stopOpacity="0.28" />
          <stop offset="100%" stopColor={colors.accent} stopOpacity="0.02" />
        </linearGradient>
      </defs>
      <path d={area} fill="url(#cardArea)" />
      <polyline points={line} fill="none" stroke={colors.accent} strokeWidth="1.6" strokeLinejoin="round" strokeLinecap="round" />
      {pts.map((p, i) => <circle key={i} cx={toX(i)} cy={toY(p.value)} r="1.7" fill={colors.accent} />)}
      {pts.map((p, i) => (i % labelEvery === 0 ? (
        <text key={`l${i}`} x={toX(i)} y={H - 4} fontSize="6" fill={colors.textMuted} textAnchor="middle">{p.label}</text>
      ) : null))}
      <text x={PL} y={PT - 1} fontSize="6" fill={colors.textMuted}>{unit === 'ms' ? 'peak ' + fmt(max) : unit === 'percent' ? 'peak ' + max + '%' : 'peak ' + max}</text>
    </svg>
  )
}

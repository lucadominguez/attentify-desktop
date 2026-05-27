import React, { useEffect, useState, useCallback } from 'react'
import {
  BarChart2, Activity, X, AlertTriangle, RefreshCw,
  ChevronUp, ChevronDown, Clock, Zap, TrendingUp, MessageSquare, Lightbulb,
} from 'lucide-react'
import type { HeuristicAlert, ActivitySession, AppCategory } from '@shared/types'

const api = (window as unknown as { electronAPI: Window['electronAPI'] }).electronAPI

// ── Types ─────────────────────────────────────────────────────────────────────

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
}

interface DayRow { day: string; date: string; focused: number; distracted: number; tracked: number; score: number; sessions: number; topApp: string; distractRate: number }
interface AppRow { app: string; category: AppCategory; totalTime: number; sessions: number; avgDuration: number; pctOfTime: number; isDistraction: boolean }
interface HourRow { hour: number; focused: number; distracted: number; ratio: number; sessions: number; topApp: string; switchRate: number }
interface HeatCell { focused: number; distracted: number }
interface Insight { label: string; text: string; color: string }

type SortDir = 'asc' | 'desc'

// ── Formatters ────────────────────────────────────────────────────────────────

function fmt(ms: number): string {
  const h = Math.floor(ms / 3600000), m = Math.floor((ms % 3600000) / 60000), s = Math.floor((ms % 60000) / 1000)
  if (h > 0 && m > 0) return `${h}h ${m}m`
  if (h > 0) return `${h}h`
  if (m > 0) return `${m}m`
  return `${s}s`
}
function fmtTime(ts: number): string { return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) }
function fmtDate(ts: number): string { return new Date(ts).toLocaleDateString([], { month: 'short', day: 'numeric' }) }
function fmtHour(h: number): string { return h === 0 ? '12am' : h < 12 ? `${h}am` : h === 12 ? '12pm' : `${h - 12}pm` }

// ── Color palettes ────────────────────────────────────────────────────────────

const CAT_COLOR: Record<AppCategory, string> = {
  browser: '#2196f3', social: '#ef5350', entertainment: '#ef5350',
  gaming: '#ff6b35', productivity: '#4caf50', communication: '#ffb800',
  development: '#66bb6a', system: '#546e7a', other: '#455a64',
}
const SEV: Record<HeuristicAlert['severity'], { bg: string; text: string; label: string }> = {
  high: { bg: 'rgba(244,67,54,0.15)', text: '#ef5350', label: 'HIGH' },
  medium: { bg: 'rgba(255,184,0,0.15)', text: '#ffb800', label: 'MED' },
  low: { bg: 'rgba(76,175,80,0.15)', text: '#66bb6a', label: 'LOW' },
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
    const topApp = [...v.apps.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? '—'
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
    const topApp = [...v.apps.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? '—'
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
  if (r >= 0.7) return `rgba(76,175,80,${0.35 + r * 0.55})`
  if (r >= 0.4) return `rgba(255,184,0,${0.4 + (1 - r) * 0.35})`
  return `rgba(244,67,54,${0.45 + (1 - r) * 0.4})`
}

// ── Insight generator ─────────────────────────────────────────────────────────

function generateInsights(
  focusPct: number,
  weeklyDistracted: number,
  streaks: { longest: number; current: number; count: number; avgLen: number },
  switchFreq: number,
  appRows: AppRow[],
  hourRows: HourRow[],
  totalWeekly: number,
): Insight[] {
  if (totalWeekly === 0) return []
  const out: Insight[] = []

  if (focusPct >= 70)
    out.push({ label: 'Focus', text: `${Math.round(focusPct)}% focus ratio this week — excellent. You're maintaining deep work discipline.`, color: '#4caf50' })
  else if (focusPct >= 40)
    out.push({ label: 'Focus', text: `${Math.round(focusPct)}% focus ratio — ${fmt(weeklyDistracted)} lost to distractions this week. Room to improve.`, color: '#ffb800' })
  else
    out.push({ label: 'Focus', text: `Only ${Math.round(focusPct)}% focus ratio — attention is heavily fragmented. Start by blocking your top distractor.`, color: '#ef5350' })

  if (streaks.longest > 5400000)
    out.push({ label: 'Streak', text: `Best run: ${fmt(streaks.longest)} unbroken. You reach 90m+ deep work blocks — protect that window.`, color: '#4caf50' })
  else if (streaks.longest > 1200000)
    out.push({ label: 'Streak', text: `Longest run: ${fmt(streaks.longest)}. Work toward 90-minute blocks for compounding deep work gains.`, color: '#66bb6a' })
  else if (streaks.longest > 0)
    out.push({ label: 'Streak', text: `Longest run: ${fmt(streaks.longest)} — heavily fragmented. Start with 25-minute Pomodoro blocks and extend from there.`, color: '#ffb800' })

  const topDist = appRows.find(r => r.isDistraction)
  if (topDist && topDist.pctOfTime >= 3)
    out.push({ label: 'Drain', text: `${topDist.app} took ${topDist.pctOfTime}% of tracked time (${fmt(topDist.totalTime)}). Blocking it is your highest-ROI change.`, color: '#ef5350' })

  if (switchFreq > 20)
    out.push({ label: 'Switching', text: `${switchFreq} context switches/h is fragmented. Each switch delays re-entry into deep focus by up to 23 minutes.`, color: '#ef5350' })
  else if (switchFreq > 10)
    out.push({ label: 'Switching', text: `${switchFreq} switches/h — moderate. Use timed focus sessions to reduce task-switching overhead.`, color: '#ffb800' })
  else if (switchFreq > 0)
    out.push({ label: 'Switching', text: `${switchFreq} switches/h — low context switching. Your focus depth is solid.`, color: '#4caf50' })

  const peak = hourRows.filter(r => r.ratio >= 0 && r.focused > 300000).sort((a, b) => b.focused - a.focused)[0]
  if (peak)
    out.push({ label: 'Peak Hour', text: `Today's strongest hour: ${fmtHour(peak.hour)} — ${fmt(peak.focused)} focused at ${peak.ratio}% ratio. Schedule hard work here.`, color: '#2196f3' })

  return out.slice(0, 4)
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
          <stop offset="0%" stopColor="#2196f3" stopOpacity="0.22" />
          <stop offset="100%" stopColor="#2196f3" stopOpacity="0.01" />
        </linearGradient>
      </defs>
      <line x1={PL} y1={y70} x2={W - PR} y2={y70} stroke="rgba(76,175,80,0.25)" strokeWidth="0.6" strokeDasharray="3,3" />
      <line x1={PL} y1={y40} x2={W - PR} y2={y40} stroke="rgba(244,67,54,0.25)" strokeWidth="0.6" strokeDasharray="3,3" />
      <text x={W - PR + 2} y={y70 + 3} fontSize="5" fill="rgba(76,175,80,0.65)">70%</text>
      <text x={W - PR + 2} y={y40 + 3} fontSize="5" fill="rgba(244,67,54,0.65)">40%</text>
      {[0, 6, 12, 18, 23].map((h) => (
        <text key={h} x={toX(h)} y={H - 1} fontSize="4.5" fill="rgba(107,132,160,0.85)" textAnchor="middle">{fmtHour(h)}</text>
      ))}
      <path d={areaPath} fill="url(#areaGrad)" />
      <polyline points={lineStr} fill="none" stroke="#2196f3" strokeWidth="1.4" strokeLinejoin="round" strokeLinecap="round" />
      {pts.map((p) => (
        <circle key={p.h} cx={toX(p.h)} cy={toY(p.v)} r="1.8"
          fill={p.v >= 70 ? '#4caf50' : p.v >= 40 ? '#ffb800' : '#ef5350'}
          stroke="rgba(8,15,30,0.8)" strokeWidth="0.8"
        />
      ))}
    </svg>
  )
}

// ── SVG: Donut chart ──────────────────────────────────────────────────────────

function DonutChart({ segments }: { segments: { label: string; value: number; color: string }[] }): React.ReactElement | null {
  const total = segments.reduce((s, d) => s + d.value, 0)
  if (total === 0) return null
  const R = 34, sw = 13, cx = 44, cy = 44, size = 88
  const circ = 2 * Math.PI * R
  let cumPct = 0
  return (
    <svg width={size} height={size} style={{ flexShrink: 0 }}>
      <circle cx={cx} cy={cy} r={R} fill="none" stroke="rgba(20,38,60,0.6)" strokeWidth={sw} />
      {segments.map((seg, i) => {
        const pct = seg.value / total
        const dash = pct * circ
        const offset = -(cumPct * circ)
        cumPct += pct
        return (
          <circle key={i} cx={cx} cy={cy} r={R} fill="none"
            stroke={seg.color} strokeWidth={sw}
            strokeDasharray={`${dash} ${circ - dash}`}
            strokeDashoffset={offset}
            transform={`rotate(-90 ${cx} ${cy})`}
            strokeLinecap="butt"
          />
        )
      })}
      <text x={cx} y={cy - 3} textAnchor="middle" fontSize="9" fontWeight="700" fill="white">
        {segments.length}
      </text>
      <text x={cx} y={cx + 8} textAnchor="middle" fontSize="5.5" fill="rgba(107,132,160,0.9)">
        categories
      </text>
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
  return (
    <div className="rounded-xl p-3" style={{ background: '#0d1b2a', border: '1px solid rgba(30,58,95,0.5)' }}>
      <div className="flex items-center justify-between mb-2">
        <p className="text-white text-[11px] font-semibold">Today's Session Timeline</p>
        <div className="flex items-center gap-3">
          <span className="text-[9px] flex items-center gap-1" style={{ color: '#7a9ab5' }}>
            <span className="inline-block w-2 h-2 rounded-sm" style={{ background: 'rgba(76,175,80,0.7)' }} />
            {fmt(focusedMs)} focused
          </span>
          <span className="text-[9px] flex items-center gap-1" style={{ color: '#7a9ab5' }}>
            <span className="inline-block w-2 h-2 rounded-sm" style={{ background: 'rgba(244,67,54,0.7)' }} />
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
                background: s.isDistraction ? 'rgba(244,67,54,0.75)' : 'rgba(76,175,80,0.72)',
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
            <span key={h} className="absolute -translate-x-1/2 text-[7.5px]" style={{ left: `${pct}%`, color: '#546a80' }}>
              {fmtHour(h)}
            </span>
          )
        })}
        <span className="absolute text-[7.5px] right-0" style={{ color: '#7a9ab5' }}>now</span>
      </div>
    </div>
  )
}

// ── Infographic: Hour-of-week heatmap ─────────────────────────────────────────

const DOW_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

function HourOfWeekHeatmap({ matrix }: { matrix: HeatCell[][] }): React.ReactElement {
  const hasData = matrix.some((row) => row.some((c) => c.focused + c.distracted > 0))
  return (
    <div className="rounded-xl p-3" style={{ background: '#0d1b2a', border: '1px solid rgba(30,58,95,0.5)' }}>
      <div className="flex items-center justify-between mb-2">
        <p className="text-white text-[11px] font-semibold">Focus Heatmap — Hour of Week</p>
        <div className="flex items-center gap-3 text-[8.5px]" style={{ color: '#7a9ab5' }}>
          <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm inline-block" style={{ background: 'rgba(76,175,80,0.75)' }} /> focused</span>
          <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm inline-block" style={{ background: 'rgba(255,184,0,0.65)' }} /> mixed</span>
          <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm inline-block" style={{ background: 'rgba(244,67,54,0.7)' }} /> distracted</span>
          <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm inline-block" style={{ background: 'rgba(20,38,60,0.5)' }} /> no data</span>
        </div>
      </div>
      {!hasData ? (
        <p className="text-[10px] text-center py-6" style={{ color: '#6b84a0' }}>No session data yet — heatmap populates after several sessions</p>
      ) : (
        <div className="flex gap-2">
          <div className="flex flex-col gap-0.5 flex-shrink-0" style={{ paddingTop: 14 }}>
            {DOW_LABELS.map((d) => (
              <div key={d} className="text-[8.5px] text-right leading-none" style={{ height: 11, lineHeight: '11px', color: '#7a9ab5' }}>{d}</div>
            ))}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex mb-0.5">
              {Array.from({ length: 24 }, (_, h) => (
                <div key={h} className="flex-1 text-center" style={{ minWidth: 0 }}>
                  {[0, 6, 12, 18].includes(h) && (
                    <span className="text-[7.5px]" style={{ color: '#546a80' }}>{fmtHour(h)}</span>
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
  return (
    <div>
      <div className="flex items-center justify-between mb-1.5">
        <p className="text-white text-[11px] font-semibold">Hourly Focus Map — Today</p>
        <div className="flex items-center gap-3 text-[8.5px]" style={{ color: '#7a9ab5' }}>
          <span className="flex items-center gap-1"><span className="w-2 h-2 rounded inline-block" style={{ background: '#4caf50' }} />focused</span>
          <span className="flex items-center gap-1"><span className="w-2 h-2 rounded inline-block" style={{ background: '#ef5350' }} />distracted</span>
          <span className="flex items-center gap-1"><span className="w-2 h-2 rounded inline-block bg-navy-800" />no data</span>
        </div>
      </div>
      <div className="flex gap-0.5 items-end" style={{ height: 36 }}>
        {Array.from({ length: 24 }, (_, h) => {
          const row = hourRows.find((r) => r.hour === h)
          const total = row ? row.focused + row.distracted : 0
          const ratio = row ? row.ratio : -1
          const bg = ratio === -1 ? 'rgba(30,58,95,0.18)'
            : ratio >= 70 ? `rgba(76,175,80,${0.35 + (ratio / 100) * 0.6})`
            : ratio >= 40 ? `rgba(255,184,0,${0.35 + ((100 - ratio) / 100) * 0.4})`
            : `rgba(244,67,54,${0.45 + ((100 - ratio) / 100) * 0.45})`
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
          <span key={h} className="text-[7.5px]" style={{ color: '#546a80' }}>{fmtHour(h)}</span>
        ))}
      </div>
    </div>
  )
}

// ── Infographic: Category breakdown ──────────────────────────────────────────

function CategoryBreakdown({ sessions }: { sessions: ActivitySession[] }): React.ReactElement {
  const cats = buildCategoryBreakdown(sessions)
  if (cats.length === 0) return <p className="text-[10px] text-center py-4" style={{ color: '#6b84a0' }}>No category data yet</p>
  const donutData = cats.slice(0, 7).map((c) => ({ label: c.cat, value: c.ms, color: c.color }))
  return (
    <div className="flex items-center gap-3">
      <DonutChart segments={donutData} />
      <div className="flex-1 space-y-1 min-w-0">
        {cats.slice(0, 7).map((c) => (
          <div key={c.cat} className="flex items-center gap-1.5">
            <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: c.color }} />
            <span className="text-[9.5px] capitalize flex-1 truncate" style={{ color: '#90a4ae' }}>{c.cat}</span>
            <span className="text-[9.5px] text-white font-mono tabular-nums">{fmt(c.ms)}</span>
            <span className="text-[8.5px] w-7 text-right tabular-nums" style={{ color: '#6b84a0' }}>{Math.round(c.pct)}%</span>
          </div>
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
      <p className="text-white text-[11px] font-semibold mb-2">7-Day Focus Score</p>
      <div className="flex gap-1.5">
        {dayRows.map((d) => {
          const color = d.score >= 70 ? '#4caf50' : d.score >= 40 ? '#ffb800' : '#ef5350'
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
                {d.tracked > 0 ? `${d.score}%` : '—'}
              </div>
              <span className="text-[8.5px]" style={{ color: isToday ? '#64b5f6' : '#6b84a0' }}>{d.day}</span>
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
      <p className="text-[9px] font-semibold uppercase tracking-widest mb-2" style={{ color: '#7a9ab5' }}>Top Apps — Time Distribution</p>
      <div className="space-y-1.5">
        {top.map((row) => (
          <div
            key={row.app}
            className="flex items-center gap-2"
            title={`${row.app} — ${fmt(row.totalTime)} total (${row.pctOfTime}% of tracked time) · ${row.sessions} session${row.sessions !== 1 ? 's' : ''} · avg ${fmt(row.avgDuration)}/session · ${row.isDistraction ? 'classified as distraction' : 'classified as productive'}`}
          >
            <div className="w-24 text-[10px] truncate flex-shrink-0 text-right" style={{ color: '#90a4ae' }}>{row.app}</div>
            <div className="flex-1 h-4 rounded-sm overflow-hidden" style={{ background: 'rgba(20,38,60,0.6)' }}>
              <div
                className="h-full rounded-sm flex items-center px-1.5"
                style={{
                  width: `${(row.totalTime / max) * 100}%`,
                  background: row.isDistraction
                    ? 'linear-gradient(90deg, rgba(244,67,54,0.7), rgba(244,67,54,0.45))'
                    : 'linear-gradient(90deg, rgba(33,150,243,0.65), rgba(33,150,243,0.4))',
                  minWidth: 2,
                }}
              >
                {(row.totalTime / max) > 0.2 && (
                  <span className="text-[8px] text-white/80 font-mono tabular-nums">{fmt(row.totalTime)}</span>
                )}
              </div>
            </div>
            <div className="w-10 text-right text-[9px] font-mono tabular-nums flex-shrink-0" style={{ color: '#7a9ab5' }}>{fmt(row.totalTime)}</div>
          </div>
        ))}
      </div>
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
  const [activeTab, setActiveTab] = useState<'apps' | 'daily' | 'patterns' | 'alerts' | 'log'>('apps')

  const load = useCallback((): void => {
    setLoading(true)
    api.getAnalytics().then((d) => setData(d as AnalyticsData)).catch(() => {}).finally(() => setLoading(false))
  }, [])

  useEffect(() => { load() }, [load])

  const dismissAlert = async (id: string): Promise<void> => {
    await api.dismissHeuristicAlert(id)
    load()
  }

  if (loading || !data) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 border-2 border-accent-blue border-t-transparent rounded-full animate-spin" />
          <p className="text-sm" style={{ color: '#7a9ab5' }}>Loading analytics…</p>
        </div>
      </div>
    )
  }

  const { today, weekly, heuristicAlerts, recentSessions } = data
  const totalWeekly = weekly.focusedTime + weekly.distractedTime
  const focusPct = totalWeekly > 0 ? (weekly.focusedTime / totalWeekly) * 100 : 0
  const activeAlerts = heuristicAlerts.filter((a) => !a.dismissed)
  const dayRows = buildDayRows(recentSessions)
  const totalTracked = recentSessions.reduce((s, r) => s + r.duration, 0)
  const appRows = buildAppRows(recentSessions, totalTracked)
  const hourRows = buildHourRows(recentSessions)
  const matrix = buildHourOfWeekMatrix(recentSessions)
  const streaks = computeStreaks(recentSessions)
  const weeklyAvgScore = dayRows.length > 0 ? Math.round(dayRows.reduce((s, r) => s + r.score, 0) / dayRows.length) : 0
  const todayTracked = today.focusedTime + today.distractedTime + today.neutralTime
  const switchFreq = recentSessions.length > 0 && totalTracked > 0
    ? Math.round((recentSessions.length / (totalTracked / 3600000)) * 10) / 10 : 0

  const topDistractor = appRows.find(r => r.isDistraction)
  const distractDebtMs = weekly.distractedTime
  const avgDailyWastedMs = distractDebtMs > 0 ? Math.round(distractDebtMs / Math.max(dayRows.length, 1)) : 0

  const insights = generateInsights(focusPct, weekly.distractedTime, streaks, switchFreq, appRows, hourRows, totalWeekly)

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
      ? <ChevronUp size={9} style={{ color: '#6b84a0' }} />
      : appSort.dir === 'asc' ? <ChevronUp size={9} className="text-accent-blue" /> : <ChevronDown size={9} className="text-accent-blue" />

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

  return (
    <div className="p-4 space-y-3 animate-fade-in">

      {/* ── Header ───────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-white font-bold text-xl flex items-center gap-2">
            <BarChart2 size={19} className="text-accent-blue" /> Analytics
          </h1>
          <p className="text-[10px] mt-0.5" style={{ color: '#7a9ab5' }}>
            Real-time attention intelligence · {recentSessions.length} sessions tracked this week
          </p>
        </div>
        <div className="flex items-center gap-2">
          {onChatWith && (
            <button
              onClick={handleAskDaemon}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-full text-[11px] font-medium transition-colors"
              style={{ background: 'rgba(33,150,243,0.1)', color: '#64b5f6', border: '1px solid rgba(33,150,243,0.2)' }}
            >
              <MessageSquare size={11} /> Ask AI
            </button>
          )}
          <button onClick={load} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium" style={{ background: 'rgba(33,150,243,0.1)', color: '#64b5f6', border: '1px solid rgba(33,150,243,0.18)' }}>
            <RefreshCw size={10} /> Refresh
          </button>
        </div>
      </div>

      {/* ── Auto-generated insights strip ────────────────────────────────── */}
      {insights.length > 0 && (
        <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${insights.length}, 1fr)` }}>
          {insights.map((ins, i) => (
            <div
              key={i}
              className="rounded-xl px-3 py-2.5 flex flex-col gap-1"
              style={{
                background: '#0d1b2a',
                border: `1px solid ${ins.color}22`,
                borderLeft: `3px solid ${ins.color}`,
              }}
            >
              <div className="flex items-center gap-1.5">
                <Lightbulb size={10} style={{ color: ins.color, flexShrink: 0 }} />
                <span className="text-[9px] font-bold uppercase tracking-widest" style={{ color: ins.color }}>
                  {ins.label}
                </span>
              </div>
              <p className="text-[10px] leading-snug" style={{ color: '#b0c4d8' }}>{ins.text}</p>
            </div>
          ))}
        </div>
      )}

      {/* ── KPI Row: Today ───────────────────────────────────────────────── */}
      <div>
        <p className="text-[9px] font-semibold uppercase tracking-widest mb-1 px-0.5" style={{ color: '#7a9ab5' }}>Today</p>
        <div className="grid grid-cols-6 gap-px rounded-xl overflow-hidden" style={{ border: '1px solid rgba(30,58,95,0.5)' }}>
          {[
            { label: 'Focus Score', value: `${Math.round(today.focusScore)}%`, color: today.focusScore >= 70 ? '#4caf50' : today.focusScore >= 40 ? '#ffb800' : '#ef5350', sub: 'today', tooltip: `${Math.round(today.focusScore)}% focus score — focused vs distracted ratio. 70%+ excellent, 40–70% average, below 40% needs work.` },
            { label: 'Focused', value: today.focusedTime > 0 ? fmt(today.focusedTime) : '—', color: '#2196f3', sub: fmt(todayTracked) + ' tracked', tooltip: `${fmt(today.focusedTime)} on productive apps today out of ${fmt(todayTracked)} total tracked` },
            { label: 'Distracted', value: today.distractedTime > 0 ? fmt(today.distractedTime) : '—', color: today.distractedTime > 3600000 ? '#ef5350' : '#ffb800', sub: todayTracked > 0 ? `${Math.round((today.distractedTime / todayTracked) * 100)}% of day` : 'no data', tooltip: `${fmt(today.distractedTime)} on distracting apps — ${todayTracked > 0 ? Math.round((today.distractedTime / todayTracked) * 100) : 0}% of tracked time` },
            { label: 'Blocked', value: String(today.blockEvents || 0), color: '#2196f3', sub: 'access attempts', tooltip: `${today.blockEvents} blocked attempts today — hosts-file redirects, firewall drops, process kills` },
            { label: 'Switch Rate', value: switchFreq > 0 ? `${switchFreq}/h` : '—', color: switchFreq > 20 ? '#ef5350' : switchFreq > 10 ? '#ffb800' : '#66bb6a', sub: 'context switches', tooltip: `${switchFreq} app switches/h this week. Under 10/h = focused, 10–20/h = moderate, above 20/h = fragmented.` },
            { label: 'Sessions', value: String(today.focusSessions), color: '#2196f3', sub: 'started today', tooltip: `${today.focusSessions} manual focus session${today.focusSessions !== 1 ? 's' : ''} started today` },
          ].map((chip) => (
            <div key={chip.label} className="flex flex-col items-center justify-center py-2.5 px-2" style={{ background: '#0d1b2a' }} title={chip.tooltip}>
              <p className="text-base font-bold leading-none tabular-nums" style={{ color: chip.color }}>{chip.value}</p>
              <p className="text-[10px] text-white font-medium mt-0.5">{chip.label}</p>
              <p className="text-[9px] mt-0.5" style={{ color: '#6b84a0' }}>{chip.sub}</p>
            </div>
          ))}
        </div>
      </div>

      {/* ── KPI Row: Weekly ──────────────────────────────────────────────── */}
      <div>
        <p className="text-[9px] font-semibold uppercase tracking-widest mb-1 px-0.5" style={{ color: '#7a9ab5' }}>This Week</p>
        <div className="grid grid-cols-6 gap-px rounded-xl overflow-hidden" style={{ border: '1px solid rgba(30,58,95,0.5)' }}>
          {[
            { label: 'Focus Time', value: fmt(weekly.focusedTime), color: '#4caf50', sub: `${Math.round(focusPct)}% ratio`, tooltip: `${fmt(weekly.focusedTime)} focused this week — ${Math.round(focusPct)}% of all tracked time` },
            { label: 'Time Lost', value: fmt(weekly.distractedTime), color: weekly.distractedTime > 7 * 3600000 ? '#ef5350' : '#ffb800', sub: `${Math.round(100 - focusPct)}% ratio`, tooltip: `${fmt(weekly.distractedTime)} on distractions this week` },
            { label: 'Avg Daily Score', value: `${weeklyAvgScore}%`, color: weeklyAvgScore >= 70 ? '#4caf50' : weeklyAvgScore >= 40 ? '#ffb800' : '#ef5350', sub: `${dayRows.length} days`, tooltip: `Average focus score across ${dayRows.length} recorded days. Calculated as (focused / total) × 120, capped at 100%.` },
            { label: 'Longest Run', value: streaks.longest > 0 ? fmt(streaks.longest) : '—', color: '#4caf50', sub: 'unbroken focus', tooltip: `Longest unbroken focus streak: ${fmt(streaks.longest)}. A streak breaks after a 5-minute gap.` },
            { label: 'Avg Run', value: streaks.avgLen > 0 ? fmt(streaks.avgLen) : '—', color: '#66bb6a', sub: `${streaks.count} streaks`, tooltip: `Average streak: ${fmt(streaks.avgLen)} across ${streaks.count} individual focus runs` },
            { label: 'Blocked', value: String(weekly.blockEvents), color: '#2196f3', sub: 'this week', tooltip: `${weekly.blockEvents} total block events this week` },
          ].map((chip) => (
            <div key={chip.label} className="flex flex-col items-center justify-center py-2.5 px-2" style={{ background: '#0a1222' }} title={chip.tooltip}>
              <p className="text-base font-bold leading-none tabular-nums" style={{ color: chip.color }}>{chip.value}</p>
              <p className="text-[10px] text-white font-medium mt-0.5">{chip.label}</p>
              <p className="text-[9px] mt-0.5" style={{ color: '#6b84a0' }}>{chip.sub}</p>
            </div>
          ))}
        </div>
      </div>

      {/* ── Distraction cost panel ────────────────────────────────────────── */}
      {totalWeekly > 0 && (
        <div className="grid grid-cols-3 gap-3">
          <div className="rounded-xl p-3" style={{ background: '#0d1b2a', border: '1px solid rgba(244,67,54,0.2)' }}>
            <p className="text-[9px] font-semibold uppercase tracking-widest mb-1.5" style={{ color: '#ef5350' }}>Distraction Debt</p>
            <p className="text-2xl font-black leading-none tabular-nums" style={{ color: '#ef5350' }}>{fmt(distractDebtMs)}</p>
            <p className="text-[10px] mt-1" style={{ color: '#7a9ab5' }}>lost to distractions this week</p>
            {avgDailyWastedMs > 0 && (
              <p className="text-[9px] mt-0.5" style={{ color: '#6b84a0' }}>~{fmt(avgDailyWastedMs)} avg per day</p>
            )}
          </div>
          <div className="rounded-xl p-3" style={{ background: '#0d1b2a', border: '1px solid rgba(255,184,0,0.2)' }}>
            <p className="text-[9px] font-semibold uppercase tracking-widest mb-1.5" style={{ color: '#ffb800' }}>Context Switch Cost</p>
            <p className="text-2xl font-black leading-none tabular-nums" style={{ color: '#ffb800' }}>
              {recentSessions.length > 0 ? fmt(recentSessions.length * 23 * 60000) : '—'}
            </p>
            <p className="text-[10px] mt-1" style={{ color: '#7a9ab5' }}>recovery overhead this week</p>
            <p className="text-[9px] mt-0.5" style={{ color: '#6b84a0' }}>{recentSessions.length} switches × 23 min/switch</p>
          </div>
          <div className="rounded-xl p-3" style={{ background: '#0d1b2a', border: '1px solid rgba(76,175,80,0.2)' }}>
            <p className="text-[9px] font-semibold uppercase tracking-widest mb-1.5" style={{ color: '#4caf50' }}>Reclaim Opportunity</p>
            {topDistractor ? (
              <>
                <p className="text-2xl font-black leading-none tabular-nums" style={{ color: '#4caf50' }}>{fmt(topDistractor.totalTime)}</p>
                <p className="text-[10px] mt-1" style={{ color: '#7a9ab5' }}>if you blocked <span className="text-white font-medium">{topDistractor.app}</span></p>
                <p className="text-[9px] mt-0.5" style={{ color: '#6b84a0' }}>{topDistractor.pctOfTime}% of tracked time this week</p>
              </>
            ) : (
              <p className="text-[10px] mt-1" style={{ color: '#6b84a0' }}>No distracting apps detected yet</p>
            )}
          </div>
        </div>
      )}

      {/* ── Today's session timeline ─────────────────────────────────────── */}
      <SessionTimeline sessions={recentSessions} />

      {/* ── Three-panel row: hourly + category + 7-day scores ────────────── */}
      <div className="grid grid-cols-3 gap-3">
        <div className="col-span-2 rounded-xl p-3 space-y-3" style={{ background: '#0d1b2a', border: '1px solid rgba(30,58,95,0.5)' }}>
          <HourlyHeatmapRow hourRows={hourRows} />
          {hourRows.length >= 2 && (
            <div>
              <p className="text-[9px] font-semibold uppercase tracking-widest mb-1.5" style={{ color: '#7a9ab5' }}>Focus Score Curve — Today</p>
              <FocusLineChart hourRows={hourRows} />
            </div>
          )}
        </div>
        <div className="flex flex-col gap-3">
          <div className="rounded-xl p-3 flex-1" style={{ background: '#0d1b2a', border: '1px solid rgba(30,58,95,0.5)' }}>
            <p className="text-white text-[11px] font-semibold mb-2.5">Time by Category</p>
            <CategoryBreakdown sessions={recentSessions} />
          </div>
          <div className="rounded-xl p-3" style={{ background: '#0d1b2a', border: '1px solid rgba(30,58,95,0.5)' }}>
            <DayScoreStrip dayRows={dayRows} />
          </div>
        </div>
      </div>

      {/* ── 7-day time split bar ─────────────────────────────────────────── */}
      <div className="rounded-xl px-3 py-2.5" style={{ background: '#0d1b2a', border: '1px solid rgba(30,58,95,0.5)' }}>
        <div className="flex items-center justify-between mb-1.5">
          <p className="text-white text-[11px] font-semibold">Weekly Focus vs Distraction</p>
          <div className="flex gap-3 text-[9px]" style={{ color: '#7a9ab5' }}>
            <span className="flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-sm inline-block" style={{ background: '#4caf50' }} />{fmt(weekly.focusedTime)} focused</span>
            <span className="flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-sm inline-block" style={{ background: '#ff6b35' }} />{fmt(weekly.distractedTime)} distracted</span>
          </div>
        </div>
        <div className="flex rounded-md overflow-hidden h-3" style={{ background: 'rgba(30,58,95,0.4)' }}>
          {focusPct > 0 && <div style={{ width: `${focusPct}%`, background: 'linear-gradient(90deg,#1b5e20,#4caf50)' }} />}
          {totalWeekly > 0 && weekly.distractedTime > 0 && <div style={{ width: `${(weekly.distractedTime / totalWeekly) * 100}%`, background: 'linear-gradient(90deg,#bf360c,#ff6b35)' }} />}
          {totalWeekly === 0 && <div className="flex-1 flex items-center justify-center"><p className="text-[9px]" style={{ color: '#6b84a0' }}>No sessions recorded yet</p></div>}
        </div>
        {totalWeekly > 0 && (
          <div className="flex mt-1.5 gap-1">
            {dayRows.map((d) => {
              const focused = d.tracked > 0 ? (d.focused / d.tracked) * 100 : 0
              const distracted = d.tracked > 0 ? (d.distracted / d.tracked) * 100 : 0
              const isToday = d.date === new Date().toISOString().split('T')[0]
              return (
                <div key={d.date} className="flex-1 flex flex-col gap-0.5" title={`${d.day}: ${d.score}% focus score`}>
                  <div className="w-full rounded-sm overflow-hidden flex flex-col-reverse" style={{ height: 18 }}>
                    <div style={{ flex: focused, background: 'rgba(76,175,80,0.55)', minHeight: focused > 0 ? 1 : 0 }} />
                    <div style={{ flex: distracted, background: 'rgba(255,107,53,0.5)', minHeight: distracted > 0 ? 1 : 0 }} />
                    {d.tracked === 0 && <div className="flex-1" style={{ background: 'rgba(30,58,95,0.2)' }} />}
                  </div>
                  <p className={`text-[8px] text-center`} style={{ color: isToday ? '#64b5f6' : '#6b84a0' }}>{d.day.slice(0, 2)}</p>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* ── Hour-of-week heatmap ─────────────────────────────────────────── */}
      <HourOfWeekHeatmap matrix={matrix} />

      {/* ── Tabs ─────────────────────────────────────────────────────────── */}
      <div className="flex gap-0.5" style={{ borderBottom: '1px solid rgba(30,58,95,0.4)' }}>
        {([
          { id: 'apps', label: `App Intel (${sortedApps.length})` },
          { id: 'daily', label: `Daily (${dayRows.length}d)` },
          { id: 'patterns', label: 'Focus Patterns' },
          { id: 'alerts', label: `Alerts${activeAlerts.length > 0 ? ` (${activeAlerts.length})` : ''}` },
          { id: 'log', label: `Activity Log (${Math.min(recentSessions.length, 100)})` },
        ] as const).map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className="px-3.5 py-2 text-[11px] font-medium transition-colors border-b-2 -mb-px"
            style={{ color: activeTab === tab.id ? '#2196f3' : '#7a9ab5', borderBottomColor: activeTab === tab.id ? '#2196f3' : 'transparent' }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === 'apps' && (
        <>
          <AppBarChart rows={sortedApps} />
          <AppTable rows={sortedApps} toggleSort={toggleSort} SortIcon={SortIcon} />
        </>
      )}
      {activeTab === 'daily' && <DailyTable rows={dayRows} />}
      {activeTab === 'patterns' && <PatternsTab hourRows={hourRows} streaks={streaks} sessions={recentSessions} />}
      {activeTab === 'alerts' && <AlertsTable alerts={heuristicAlerts} onDismiss={dismissAlert} />}
      {activeTab === 'log' && <ActivityLog sessions={[...recentSessions].reverse().slice(0, 100)} />}
    </div>
  )
}

// ── Sub-tables ────────────────────────────────────────────────────────────────

function Th({ children, onClick }: { children: React.ReactNode; onClick?: () => void }): React.ReactElement {
  return (
    <th
      className="px-2.5 py-2 text-left text-[9px] font-semibold uppercase tracking-wider whitespace-nowrap"
      onClick={onClick}
      style={{ cursor: onClick ? 'pointer' : 'default', color: '#7a9ab5', background: 'rgba(8,15,30,0.8)', borderBottom: '1px solid rgba(30,58,95,0.5)' }}
    >
      {children}
    </th>
  )
}

function AppTable({ rows, toggleSort, SortIcon }: {
  rows: AppRow[]
  toggleSort: (col: keyof AppRow) => void
  SortIcon: ({ col }: { col: keyof AppRow }) => React.ReactElement
}): React.ReactElement {
  if (rows.length === 0) return <EmptyState text="No app activity recorded yet. The tracker populates as you use your device." />
  return (
    <div className="rounded-xl overflow-hidden" style={{ border: '1px solid rgba(30,58,95,0.5)' }}>
      <table className="w-full text-xs" style={{ borderCollapse: 'collapse' }}>
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
            <tr key={row.app} style={{ background: i % 2 === 0 ? 'rgba(13,27,42,0.7)' : 'rgba(17,34,64,0.45)', borderBottom: '1px solid rgba(30,58,95,0.2)' }}>
              <td className="px-2.5 py-1.5">
                <p className="text-white text-[11px] font-medium truncate max-w-[140px]">{row.app}</p>
              </td>
              <td className="px-2.5 py-1.5">
                <span className="text-[9px] px-1.5 py-0.5 rounded font-semibold uppercase tracking-wide" style={{ background: CAT_COLOR[row.category] + '22', color: CAT_COLOR[row.category] }}>
                  {row.category.slice(0, 4)}
                </span>
              </td>
              <td className="px-2.5 py-1.5 font-mono tabular-nums text-[10px]" style={{ color: '#90a4ae' }}>{fmt(row.totalTime)}</td>
              <td className="px-2.5 py-1.5">
                <div className="flex items-center gap-1.5">
                  <div className="w-10 h-1 rounded-full overflow-hidden" style={{ background: 'rgba(30,58,95,0.5)' }}>
                    <div className="h-full rounded-full" style={{ width: `${Math.min(100, row.pctOfTime)}%`, background: row.isDistraction ? '#ef5350' : '#2196f3' }} />
                  </div>
                  <span className="text-[10px] tabular-nums" style={{ color: '#90a4ae' }}>{row.pctOfTime}%</span>
                </div>
              </td>
              <td className="px-2.5 py-1.5 tabular-nums text-[10px]" style={{ color: '#90a4ae' }}>{row.sessions}</td>
              <td className="px-2.5 py-1.5 font-mono tabular-nums text-[10px]" style={{ color: '#90a4ae' }}>{fmt(row.avgDuration)}</td>
              <td className="px-2.5 py-1.5">
                {row.isDistraction
                  ? <span className="text-[9px] px-1.5 py-0.5 rounded font-bold uppercase" style={{ background: 'rgba(244,67,54,0.15)', color: '#ef5350' }}>DIST</span>
                  : <span className="text-[9px] px-1.5 py-0.5 rounded font-bold uppercase" style={{ background: 'rgba(76,175,80,0.12)', color: '#66bb6a' }}>FOCUS</span>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function DailyTable({ rows }: { rows: DayRow[] }): React.ReactElement {
  if (rows.length === 0) return <EmptyState text="No daily data yet — sessions accumulate here over time." />
  const totals = rows.reduce((acc, r) => ({
    focused: acc.focused + r.focused, distracted: acc.distracted + r.distracted,
    tracked: acc.tracked + r.tracked, sessions: acc.sessions + r.sessions,
  }), { focused: 0, distracted: 0, tracked: 0, sessions: 0 })
  return (
    <div className="rounded-xl overflow-hidden" style={{ border: '1px solid rgba(30,58,95,0.5)' }}>
      <table className="w-full text-xs" style={{ borderCollapse: 'collapse' }}>
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
                background: isToday ? 'rgba(33,150,243,0.06)' : i % 2 === 0 ? 'rgba(13,27,42,0.7)' : 'rgba(17,34,64,0.45)',
                borderBottom: '1px solid rgba(30,58,95,0.2)',
                outline: isToday ? '1px solid rgba(33,150,243,0.15)' : 'none',
              }}>
                <td className="px-2.5 py-1.5">
                  <span className="text-white text-[11px] font-semibold">{row.day}</span>
                  {isToday && <span className="ml-1 text-[8px] px-1 py-0.5 rounded" style={{ background: 'rgba(33,150,243,0.2)', color: '#64b5f6' }}>today</span>}
                </td>
                <td className="px-2.5 py-1.5 text-[10px] font-mono tabular-nums" style={{ color: '#6b84a0' }}>{row.date}</td>
                <td className="px-2.5 py-1.5 font-mono tabular-nums text-[10px]" style={{ color: '#90a4ae' }}>{row.tracked > 0 ? fmt(row.tracked) : '—'}</td>
                <td className="px-2.5 py-1.5 font-mono tabular-nums text-[10px]" style={{ color: row.focused > 0 ? '#66bb6a' : '#4a6280' }}>{row.focused > 0 ? fmt(row.focused) : '—'}</td>
                <td className="px-2.5 py-1.5 font-mono tabular-nums text-[10px]" style={{ color: row.distracted > 3600000 ? '#ef5350' : row.distracted > 0 ? '#ffb800' : '#4a6280' }}>{row.distracted > 0 ? fmt(row.distracted) : '—'}</td>
                <td className="px-2.5 py-1.5">
                  <span className="text-[10px] tabular-nums" style={{ color: row.distractRate > 50 ? '#ef5350' : row.distractRate > 25 ? '#ffb800' : '#66bb6a' }}>
                    {row.tracked > 0 ? `${row.distractRate}%` : '—'}
                  </span>
                </td>
                <td className="px-2.5 py-1.5">
                  <div className="flex items-center gap-1.5">
                    <div className="w-12 h-1.5 rounded-full overflow-hidden" style={{ background: 'rgba(30,58,95,0.6)' }}>
                      <div className="h-full rounded-full" style={{ width: `${row.score}%`, background: row.score >= 70 ? '#4caf50' : row.score >= 40 ? '#ffb800' : '#ef5350' }} />
                    </div>
                    <span className="text-[10px] tabular-nums font-mono" style={{ color: row.score >= 70 ? '#66bb6a' : row.score >= 40 ? '#ffb800' : '#ef5350' }}>{row.score}%</span>
                  </div>
                </td>
                <td className="px-2.5 py-1.5 tabular-nums text-[10px]" style={{ color: '#90a4ae' }}>{row.sessions}</td>
                <td className="px-2.5 py-1.5 text-[10px] truncate max-w-[90px]" style={{ color: '#7a9ab5' }}>{row.topApp}</td>
              </tr>
            )
          })}
          {/* Totals row */}
          <tr style={{ background: 'rgba(30,58,95,0.25)', borderTop: '1px solid rgba(30,58,95,0.5)' }}>
            <td className="px-2.5 py-1.5 text-[10px] font-bold text-white" colSpan={2}>Total ({rows.length} days)</td>
            <td className="px-2.5 py-1.5 font-mono tabular-nums text-[10px]" style={{ color: '#90a4ae' }}>{fmt(totals.tracked)}</td>
            <td className="px-2.5 py-1.5 font-mono tabular-nums text-[10px]" style={{ color: '#66bb6a' }}>{fmt(totals.focused)}</td>
            <td className="px-2.5 py-1.5 font-mono tabular-nums text-[10px]" style={{ color: '#ef5350' }}>{fmt(totals.distracted)}</td>
            <td className="px-2.5 py-1.5 text-[10px]" style={{ color: totals.tracked > 0 && (totals.distracted / totals.tracked) > 0.5 ? '#ef5350' : '#ffb800' }}>
              {totals.tracked > 0 ? `${Math.round((totals.distracted / totals.tracked) * 100)}%` : '—'}
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
          { label: 'Longest Focus Run', value: streaks.longest > 0 ? fmt(streaks.longest) : '—', icon: <TrendingUp size={12} className="text-accent-green" />, color: '#4caf50' },
          { label: 'Current Streak', value: streaks.current > 0 ? fmt(streaks.current) : 'None', icon: <Zap size={12} className="text-accent-green" />, color: streaks.current > 0 ? '#4caf50' : '#546e7a' },
          { label: 'Avg Focus Run', value: streaks.avgLen > 0 ? fmt(streaks.avgLen) : '—', icon: <Clock size={12} style={{ color: '#90a4ae' }} />, color: '#66bb6a' },
          { label: 'Peak Focus Hour', value: peakFocusHour ? fmtHour(peakFocusHour.hour) : '—', icon: <TrendingUp size={12} className="text-accent-blue" />, color: '#2196f3' },
        ].map((s) => (
          <div key={s.label} className="rounded-lg p-3" style={{ background: '#0d1b2a', border: '1px solid rgba(30,58,95,0.5)' }}>
            <div className="flex items-center gap-1.5 mb-1">{s.icon}<p className="text-[10px]" style={{ color: '#90a4ae' }}>{s.label}</p></div>
            <p className="text-lg font-bold" style={{ color: s.color }}>{s.value}</p>
          </div>
        ))}
      </div>

      {hourRows.length >= 2 && (
        <div className="rounded-xl p-3" style={{ background: '#0d1b2a', border: '1px solid rgba(30,58,95,0.5)' }}>
          <div className="flex items-center justify-between mb-2">
            <p className="text-white text-[11px] font-semibold">Hourly Focus Score — Today</p>
            {peakDistractHour && (
              <span className="text-[9px]" style={{ color: '#7a9ab5' }}>
                Peak distraction: <span style={{ color: '#ef5350' }}>{fmtHour(peakDistractHour.hour)}</span>
              </span>
            )}
          </div>
          <FocusLineChart hourRows={hourRows} />
        </div>
      )}

      {streaks.count > 0 && (
        <div className="rounded-xl p-3" style={{ background: '#0d1b2a', border: '1px solid rgba(30,58,95,0.5)' }}>
          <p className="text-white text-[11px] font-semibold mb-2">Focus Streak History</p>
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
                const color = ms > 3600000 ? '#4caf50' : ms > 1800000 ? '#66bb6a' : ms > 900000 ? '#ffb800' : '#546e7a'
                return (
                  <div key={i} className="rounded-sm flex-shrink-0" style={{ width: 10, height: h, background: color, opacity: 0.8 }} title={fmt(ms)} />
                )
              })
            })()}
          </div>
          <p className="text-[9px] mt-1.5" style={{ color: '#6b84a0' }}>Each bar = one unbroken focus streak · height = duration</p>
        </div>
      )}

      {topDistractors.length > 0 && (
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-widest mb-1.5" style={{ color: '#7a9ab5' }}>Top Distraction Vectors — This Week</p>
          <div className="rounded-xl overflow-hidden" style={{ border: '1px solid rgba(30,58,95,0.5)' }}>
            <table className="w-full text-xs" style={{ borderCollapse: 'collapse' }}>
              <thead><tr><Th>App</Th><Th>Time Lost</Th><Th>Share of Distractions</Th><Th>Impact</Th></tr></thead>
              <tbody>
                {topDistractors.map(([app, ms], i) => {
                  const share = totalDistracted > 0 ? Math.round((ms / totalDistracted) * 100) : 0
                  return (
                    <tr key={app} style={{ background: i % 2 === 0 ? 'rgba(13,27,42,0.7)' : 'rgba(17,34,64,0.45)', borderBottom: '1px solid rgba(30,58,95,0.2)' }}>
                      <td className="px-2.5 py-1.5 text-white text-[11px] font-medium truncate max-w-[160px]">{app}</td>
                      <td className="px-2.5 py-1.5 font-mono tabular-nums text-[10px]" style={{ color: '#ef5350' }}>{fmt(ms)}</td>
                      <td className="px-2.5 py-1.5">
                        <div className="flex items-center gap-1.5">
                          <div className="w-20 h-1.5 rounded-full overflow-hidden" style={{ background: 'rgba(30,58,95,0.5)' }}>
                            <div className="h-full rounded-full" style={{ width: `${share}%`, background: '#ef5350' }} />
                          </div>
                          <span className="text-[10px] tabular-nums" style={{ color: '#90a4ae' }}>{share}%</span>
                        </div>
                      </td>
                      <td className="px-2.5 py-1.5">
                        <span className="text-[9px] px-1.5 py-0.5 rounded font-semibold" style={{
                          background: share > 40 ? 'rgba(244,67,54,0.15)' : share > 20 ? 'rgba(255,184,0,0.12)' : 'rgba(76,175,80,0.1)',
                          color: share > 40 ? '#ef5350' : share > 20 ? '#ffb800' : '#66bb6a',
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
          <p className="text-[10px] font-semibold uppercase tracking-widest mb-1.5" style={{ color: '#7a9ab5' }}>Hourly Breakdown — Today</p>
          <div className="rounded-xl overflow-hidden" style={{ border: '1px solid rgba(30,58,95,0.5)' }}>
            <table className="w-full text-xs" style={{ borderCollapse: 'collapse' }}>
              <thead>
                <tr><Th>Hour</Th><Th>Focused</Th><Th>Distracted</Th><Th>Focus Ratio</Th><Th>Sessions</Th><Th>Switches/h</Th><Th>Top App</Th></tr>
              </thead>
              <tbody>
                {hourRows.map((row, i) => (
                  <tr key={row.hour} style={{ background: i % 2 === 0 ? 'rgba(13,27,42,0.7)' : 'rgba(17,34,64,0.45)', borderBottom: '1px solid rgba(30,58,95,0.2)' }}>
                    <td className="px-2.5 py-1.5 font-mono text-[11px] text-white whitespace-nowrap">{fmtHour(row.hour)}</td>
                    <td className="px-2.5 py-1.5 font-mono tabular-nums text-[10px]" style={{ color: row.focused > 0 ? '#66bb6a' : '#4a6280' }}>{row.focused > 0 ? fmt(row.focused) : '—'}</td>
                    <td className="px-2.5 py-1.5 font-mono tabular-nums text-[10px]" style={{ color: row.distracted > 0 ? '#ef5350' : '#4a6280' }}>{row.distracted > 0 ? fmt(row.distracted) : '—'}</td>
                    <td className="px-2.5 py-1.5">
                      {row.ratio >= 0 ? (
                        <div className="flex items-center gap-1.5">
                          <div className="w-14 h-1.5 rounded-full overflow-hidden" style={{ background: 'rgba(30,58,95,0.5)' }}>
                            <div className="h-full rounded-full" style={{ width: `${row.ratio}%`, background: row.ratio >= 70 ? '#4caf50' : row.ratio >= 40 ? '#ffb800' : '#ef5350' }} />
                          </div>
                          <span className="text-[10px] tabular-nums" style={{ color: row.ratio >= 70 ? '#66bb6a' : row.ratio >= 40 ? '#ffb800' : '#ef5350' }}>{row.ratio}%</span>
                        </div>
                      ) : <span style={{ color: '#4a6280' }}>—</span>}
                    </td>
                    <td className="px-2.5 py-1.5 tabular-nums text-[10px]" style={{ color: '#90a4ae' }}>{row.sessions}</td>
                    <td className="px-2.5 py-1.5 tabular-nums text-[10px]" style={{ color: row.switchRate > 20 ? '#ef5350' : row.switchRate > 10 ? '#ffb800' : '#66bb6a' }}>{row.switchRate}</td>
                    <td className="px-2.5 py-1.5 text-[10px] truncate max-w-[110px]" style={{ color: '#90a4ae' }}>{row.topApp}</td>
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
  if (alerts.length === 0) return <EmptyState text="No behavioral anomalies detected this week. Your focus patterns look clean." />
  return (
    <div className="rounded-xl overflow-hidden" style={{ border: '1px solid rgba(30,58,95,0.5)' }}>
      <table className="w-full text-xs" style={{ borderCollapse: 'collapse' }}>
        <thead><tr><Th>Time</Th><Th>Pattern</Th><Th>Sev</Th><Th>Description</Th><Th>App</Th><Th>Action</Th></tr></thead>
        <tbody>
          {[...alerts].reverse().map((alert, i) => {
            const sev = SEV[alert.severity]
            return (
              <tr key={alert.id} style={{ background: alert.dismissed ? 'rgba(13,27,42,0.3)' : i % 2 === 0 ? 'rgba(13,27,42,0.7)' : 'rgba(17,34,64,0.45)', borderBottom: '1px solid rgba(30,58,95,0.2)', opacity: alert.dismissed ? 0.5 : 1 }}>
                <td className="px-2.5 py-1.5 text-[9px] font-mono whitespace-nowrap" style={{ color: '#7a9ab5' }}>
                  {fmtTime(alert.detectedAt)}<br /><span style={{ color: '#546a80' }}>{fmtDate(alert.detectedAt)}</span>
                </td>
                <td className="px-2.5 py-1.5 text-[11px] font-medium text-white whitespace-nowrap">{TYPE_LABELS[alert.type]}</td>
                <td className="px-2.5 py-1.5">
                  <span className="text-[8px] px-1.5 py-0.5 rounded font-bold" style={{ background: sev.bg, color: sev.text }}>{sev.label}</span>
                </td>
                <td className="px-2.5 py-1.5 text-[10px] max-w-[200px] leading-tight" style={{ color: '#90a4ae' }}>{alert.description}</td>
                <td className="px-2.5 py-1.5 text-[9px] truncate max-w-[80px]" style={{ color: '#7a9ab5' }}>{alert.app ?? '—'}</td>
                <td className="px-2.5 py-1.5">
                  {alert.dismissed
                    ? <span className="text-[9px]" style={{ color: '#4a6280' }}>dismissed</span>
                    : <button onClick={() => onDismiss(alert.id)} className="flex items-center gap-1 text-[9px] px-2 py-1 rounded hover:text-white transition-colors" style={{ background: 'rgba(30,58,95,0.4)', color: '#7a9ab5' }}>
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
  if (sessions.length === 0) return <EmptyState text="No activity sessions recorded yet." />
  return (
    <div className="rounded-xl overflow-hidden" style={{ border: '1px solid rgba(30,58,95,0.5)' }}>
      <table className="w-full text-xs" style={{ borderCollapse: 'collapse' }}>
        <thead><tr><Th>Start</Th><Th>End</Th><Th>App</Th><Th>Window Title</Th><Th>Duration</Th><Th>Cat</Th><Th>Type</Th></tr></thead>
        <tbody>
          {sessions.map((s, i) => (
            <tr key={s.id} style={{ background: s.isDistraction ? 'rgba(244,67,54,0.04)' : i % 2 === 0 ? 'rgba(13,27,42,0.7)' : 'rgba(17,34,64,0.45)', borderBottom: '1px solid rgba(30,58,95,0.15)' }}>
              <td className="px-2.5 py-1 text-[9px] font-mono whitespace-nowrap tabular-nums" style={{ color: '#7a9ab5' }}>{fmtTime(s.startTime)}</td>
              <td className="px-2.5 py-1 text-[9px] font-mono whitespace-nowrap tabular-nums" style={{ color: '#546a80' }}>{fmtTime(s.endTime)}</td>
              <td className="px-2.5 py-1"><p className="text-white text-[10px] font-medium truncate max-w-[90px]">{s.app}</p></td>
              <td className="px-2.5 py-1"><p className="text-[9px] truncate max-w-[170px]" style={{ color: '#90a4ae' }}>{s.title}</p></td>
              <td className="px-2.5 py-1 text-[10px] font-mono tabular-nums whitespace-nowrap" style={{ color: s.isDistraction ? '#ef5350' : '#7a9ab5' }}>{fmt(s.duration)}</td>
              <td className="px-2.5 py-1">
                <span className="text-[8px] px-1 py-0.5 rounded font-semibold" style={{ background: CAT_COLOR[s.category] + '18', color: CAT_COLOR[s.category] }}>{s.category.slice(0, 4)}</span>
              </td>
              <td className="px-2.5 py-1">
                {s.isDistraction
                  ? <span className="flex items-center gap-0.5"><AlertTriangle size={8} style={{ color: '#ef5350' }} /><span className="text-[9px]" style={{ color: '#ef5350' }}>dist</span></span>
                  : <span className="text-[9px]" style={{ color: '#66bb6a' }}>focus</span>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function EmptyState({ text }: { text: string }): React.ReactElement {
  return (
    <div className="rounded-xl py-8 text-center" style={{ background: 'rgba(13,27,42,0.5)', border: '1px solid rgba(30,58,95,0.4)' }}>
      <Activity size={22} style={{ color: '#546a80' }} className="mx-auto mb-2" />
      <p className="text-[11px] max-w-sm mx-auto leading-relaxed" style={{ color: '#6b84a0' }}>{text}</p>
    </div>
  )
}

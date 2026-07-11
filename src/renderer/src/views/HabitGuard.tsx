import React, { useEffect, useState } from 'react'
import { BarChart2, RefreshCw, TrendingDown, TrendingUp, Zap, Clock, MessageSquare } from 'lucide-react'
import type { AppStore, ActivitySession } from '@shared/types'
import { useTheme } from '../context/ThemeContext'

const api = (window as unknown as { electronAPI: Window['electronAPI'] }).electronAPI

interface HabitGuardProps {
  store: AppStore
  onChatWith?: (msg: string) => void
}

interface WeeklyData {
  focusedTime: number
  distractedTime: number
  timePerApp: Record<string, number>
  sessionCount: number
  blockEvents: number
}

function fmt(ms: number): string {
  const h = Math.floor(ms / 3600000)
  const m = Math.floor((ms % 3600000) / 60000)
  if (h > 0 && m > 0) return `${h}h ${m}m`
  if (h > 0) return `${h}h`
  if (m > 0) return `${m}m`
  return '0m'
}

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export default function HabitGuard({ store: _store, onChatWith }: HabitGuardProps): React.ReactElement {
  const { colors } = useTheme()
  const [weekly, setWeekly] = useState<WeeklyData | null>(null)
  const [recentSessions, setRecentSessions] = useState<ActivitySession[]>([])
  const [loading, setLoading] = useState(true)

  const load = (): void => {
    setLoading(true)
    api.getAnalytics().then((data) => {
      setWeekly(data.weekly)
      setRecentSessions(data.recentSessions)
    }).catch(() => {}).finally(() => setLoading(false))
  }

  useEffect(() => { load() }, [])

  if (loading || !weekly) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="w-7 h-7 border-2 border-accent-amber border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  const totalTracked = weekly.focusedTime + weekly.distractedTime
  const focusRatio = totalTracked > 0 ? (weekly.focusedTime / totalTracked) * 100 : 0

  // Top distractors
  const distractApps = Object.entries(weekly.timePerApp)
    .filter(([app]) => recentSessions.some((s) => s.app === app && s.isDistraction))
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
  const maxApp = distractApps[0]?.[1] ?? 1

  // Daily breakdown — build from recentSessions
  const dailyMap = new Map<string, { focused: number; distracted: number }>()
  for (const s of recentSessions) {
    const key = new Date(s.startTime).toISOString().split('T')[0]!
    const cur = dailyMap.get(key) ?? { focused: 0, distracted: 0 }
    if (s.isDistraction) cur.distracted += s.duration
    else cur.focused += s.duration
    dailyMap.set(key, cur)
  }
  const last7Keys = Array.from({ length: 7 }, (_, i) => {
    const d = new Date()
    d.setDate(d.getDate() - (6 - i))
    return d.toISOString().split('T')[0]!
  })
  const dailyData = last7Keys.map((key, i) => ({
    day: DAYS[new Date(key + 'T12:00:00').getDay() === 0 ? 6 : new Date(key + 'T12:00:00').getDay() - 1]!,
    focused: dailyMap.get(key)?.focused ?? 0,
    distracted: dailyMap.get(key)?.distracted ?? 0,
  }))
  const maxBar = Math.max(...dailyData.map((d) => d.focused + d.distracted), 1)

  const label = focusRatio >= 70 ? 'Strong focus week' : focusRatio >= 40 ? 'Average focus week' : 'High distraction week'
  const labelColor = focusRatio >= 70 ? '#34d399' : focusRatio >= 40 ? '#fbbf24' : '#f87171'

  const handleAskDaemon = (): void => {
    if (!onChatWith) return
    const topDrain = distractApps[0]?.[0] ?? 'none'
    const topDrainTime = distractApps[0]?.[1] ?? 0
    const topDrainFmt = topDrainTime > 0 ? `${Math.floor(topDrainTime / 60000)}m` : '0m'
    onChatWith(
      `I'm viewing my weekly Summaries. This week: ${Math.round(focusRatio)}% focus ratio, ${fmt(weekly.focusedTime)} focused, ${fmt(weekly.distractedTime)} distracted. ` +
      `Verdict: "${label}". My biggest attention drain is "${topDrain}" at ${topDrainFmt}. ` +
      `Can you analyze my weekly habit patterns and suggest concrete strategies to improve my focus ratio?`
    )
  }

  return (
    <div className="p-4 animate-fade-in space-y-3 overflow-y-auto h-full">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-bold text-xl flex items-center gap-2" style={{ color: colors.textPrimary }}>
            <BarChart2 size={19} className="text-accent-amber" /> Summaries
          </h1>
          <p className="text-[10px] mt-0.5" style={{ color: colors.textSecondary }}>Weekly attention leak report</p>
        </div>
        <div className="flex items-center gap-2">
          {onChatWith && (
            <button
              onClick={handleAskDaemon}
              title="Get AI analysis of your weekly habits and attention patterns"
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-full text-[11px] font-medium transition-colors"
              style={{ background: 'rgba(33,150,243,0.1)', color: '#818cf8', border: '1px solid rgba(33,150,243,0.2)' }}
            >
              <MessageSquare size={11} /> Ask AI
            </button>
          )}
          <button
            onClick={load}
            title="Refresh weekly statistics"
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-colors"
            style={{ background: 'rgba(251,191,36,0.08)', color: '#fbbf24', border: '1px solid rgba(251,191,36,0.18)' }}
          >
            <RefreshCw size={10} /> Refresh
          </button>
        </div>
      </div>

      {/* KPI strip */}
      <div className="grid grid-cols-4 gap-2">
        {[
          {
            label: 'Focus Ratio',
            value: `${Math.round(focusRatio)}%`,
            color: focusRatio >= 70 ? '#34d399' : focusRatio >= 40 ? '#fbbf24' : '#f87171',
            tooltip: `${Math.round(focusRatio)}% of tracked time this week was focused. 70%+ = strong, 40–70% = average, below 40% = high distraction.`,
          },
          {
            label: 'Focused',
            value: totalTracked > 0 ? fmt(weekly.focusedTime) : '—',
            color: '#34d399',
            tooltip: `${fmt(weekly.focusedTime)} spent on productive apps this week`,
          },
          {
            label: 'Distracted',
            value: totalTracked > 0 ? fmt(weekly.distractedTime) : '—',
            color: weekly.distractedTime > 3600000 ? '#f87171' : '#fbbf24',
            tooltip: `${fmt(weekly.distractedTime)} spent on distracting apps this week${weekly.distractedTime > 3600000 ? ' — over 1 hour' : ''}`,
          },
          {
            label: 'Block Events',
            value: weekly.blockEvents.toString(),
            color: '#3b9eff',
            tooltip: `${weekly.blockEvents} access attempts blocked this week by Attentify`,
          },
        ].map((chip) => (
          <div
            key={chip.label}
            className="flex flex-col items-center justify-center py-2.5 rounded-xl"
            title={chip.tooltip}
            style={{ background: colors.cardBg, border: `1px solid ${colors.border}` }}
          >
            <p className="text-base font-bold tabular-nums leading-none" style={{ color: chip.color }}>{chip.value}</p>
            <p className="text-[10px] font-medium mt-0.5" style={{ color: colors.textPrimary }}>{chip.label}</p>
          </div>
        ))}
      </div>

      {/* Weekly verdict + ratio bar */}
      <div
        className="rounded-xl px-4 py-3 flex items-center gap-4"
        title={`Weekly verdict: ${label} — ${Math.round(focusRatio)}% of tracked time was focused`}
        style={{ background: colors.cardBg, border: `1px solid ${colors.border}` }}
      >
        <div className="flex items-center gap-1.5 flex-shrink-0">
          {focusRatio >= 50
            ? <TrendingUp size={14} style={{ color: labelColor }} />
            : <TrendingDown size={14} style={{ color: labelColor }} />}
          <span className="text-xs font-semibold" style={{ color: labelColor }}>{label}</span>
        </div>
        <div className="flex-1 rounded-full overflow-hidden h-2" style={{ background: colors.border }}>
          {totalTracked > 0 ? (
            <>
              <div
                className="h-full float-left rounded-l-full"
                style={{ width: `${focusRatio}%`, background: 'linear-gradient(90deg,#1b5e20,#34d399)' }}
              />
            </>
          ) : (
            <div className="h-full w-full" style={{ background: 'rgba(30,58,95,0.3)' }} />
          )}
        </div>
        <span className="text-[10px] flex-shrink-0 tabular-nums" style={{ color: colors.textMuted }}>{Math.round(focusRatio)}% focused</span>
      </div>

      {/* Daily stacked bar chart */}
      <div className="rounded-xl p-3" style={{ background: colors.cardBg, border: `1px solid ${colors.border}` }}>
        <p className="text-[11px] font-semibold mb-3" style={{ color: colors.textPrimary }}>Daily Breakdown — Last 7 Days</p>
        {dailyData.every((d) => d.focused === 0 && d.distracted === 0) ? (
          <p className="text-[10px] text-center py-4" style={{ color: colors.textMuted }}>No data yet — activity tracker populates over time</p>
        ) : (
          <div className="flex items-end gap-1.5" style={{ height: 72 }}>
            {dailyData.map((day) => {
              const total = day.focused + day.distracted
              const h = total > 0 ? Math.max(6, Math.round((total / maxBar) * 64)) : 4
              const focPct = total > 0 ? (day.focused / total) * 100 : 0
              return (
                <div
                  key={day.day}
                  className="flex-1 flex flex-col items-center gap-1"
                  title={total > 0 ? `${day.day}: ${fmt(day.focused)} focused, ${fmt(day.distracted)} distracted` : `${day.day}: no data`}
                >
                  <div className="w-full rounded-sm overflow-hidden flex flex-col-reverse" style={{ height: h }}>
                    {total > 0 ? (
                      <>
                        <div style={{ flex: focPct, background: 'rgba(52,211,153,0.6)', minHeight: 1 }} />
                        <div style={{ flex: 100 - focPct, background: 'rgba(255,107,53,0.5)', minHeight: day.distracted > 0 ? 1 : 0 }} />
                      </>
                    ) : (
                      <div className="flex-1" style={{ background: colors.border }} />
                    )}
                  </div>
                  <span className="text-[9px]" style={{ color: colors.textMuted }}>{day.day}</span>
                </div>
              )
            })}
          </div>
        )}
        <div className="flex items-center gap-4 mt-2">
          <span className="flex items-center gap-1 text-[9px]" style={{ color: colors.textMuted }}>
            <span className="w-2 h-2 rounded-sm inline-block" style={{ background: 'rgba(52,211,153,0.6)' }} />focused
          </span>
          <span className="flex items-center gap-1 text-[9px]" style={{ color: colors.textMuted }}>
            <span className="w-2 h-2 rounded-sm inline-block" style={{ background: 'rgba(255,107,53,0.5)' }} />distracted
          </span>
        </div>
      </div>

      {/* Top attention drains */}
      <div className="rounded-xl p-3" style={{ background: colors.cardBg, border: `1px solid ${colors.border}` }}>
        <p className="text-[11px] font-semibold mb-3" style={{ color: colors.textPrimary }}>Top Attention Drains</p>
        {distractApps.length === 0 ? (
          <p className="text-accent-green text-[10px] text-center py-2">No distraction apps detected this week</p>
        ) : (
          <div className="space-y-2">
            {distractApps.map(([app, ms], i) => {
              const pct = (ms / maxApp) * 100
              const totalPct = totalTracked > 0 ? Math.round((ms / totalTracked) * 100) : 0
              return (
                <div
                  key={app}
                  className="flex items-center gap-3"
                  title={`${app} — ${fmt(ms)} of distracted time this week (${totalPct}% of all tracked time)${i === 0 ? ' — your biggest attention drain' : ''}`}
                >
                  <div className="flex items-center gap-1.5 w-28 flex-shrink-0">
                    {i === 0 ? <Zap size={10} className="text-accent-orange flex-shrink-0" /> : <span className="w-2.5 h-2.5 flex-shrink-0" />}
                    <span className="text-[11px] font-medium truncate" style={{ color: colors.textPrimary }}>{app}</span>
                  </div>
                  <div className="flex-1 rounded-full overflow-hidden h-1.5" style={{ background: colors.border }}>
                    <div
                      className="h-full rounded-full"
                      style={{
                        width: `${pct}%`,
                        background: i === 0 ? 'linear-gradient(90deg,#bf360c,#ff6b35)' : 'linear-gradient(90deg,#e65100,#ff9800)',
                      }}
                    />
                  </div>
                  <span className="text-[10px] font-mono tabular-nums w-10 text-right flex-shrink-0" style={{ color: colors.textSecondary }}>{fmt(ms)}</span>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

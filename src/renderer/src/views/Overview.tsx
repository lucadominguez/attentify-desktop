import React, { useState, useEffect } from 'react'
import { Shield, Plus, Trash2, Globe, Cpu, Clock, WifiOff, Calendar, BarChart2, Zap, MessageSquare } from 'lucide-react'
import type { AppStore, ActivitySession, AppCategory } from '@shared/types'
import { useTheme } from '../context/ThemeContext'

const api = (window as unknown as { electronAPI: Window['electronAPI'] }).electronAPI

interface OverviewProps {
  store: AppStore
  onRefresh: () => void
  onChatWith?: (msg: string) => void
}

function formatExpiry(ts: number): string {
  const diff = ts - Date.now()
  if (diff <= 0) return 'expired'
  const m = Math.floor(diff / 60000)
  const h = Math.floor(m / 60)
  if (h > 0) return `${h}h ${m % 60}m left`
  return `${m}m left`
}

function formatMs(ms: number): string {
  const h = Math.floor(ms / 3600000)
  const m = Math.floor((ms % 3600000) / 60000)
  if (h > 0 && m > 0) return `${h}h ${m}m`
  if (h > 0) return `${h}h`
  return `${m}m`
}

function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

function relativeDate(ts: number): string {
  const now = new Date()
  const d = new Date(ts)
  const todayStr = now.toISOString().split('T')[0]
  const dStr = d.toISOString().split('T')[0]
  if (dStr === todayStr) return 'Today'
  const yesterday = new Date(now); yesterday.setDate(now.getDate() - 1)
  if (dStr === yesterday.toISOString().split('T')[0]) return 'Yesterday'
  return d.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })
}

const DAY_INITIALS = ['S', 'M', 'T', 'W', 'T', 'F', 'S']

// Common distractions offered as one-tap suggestion chips to seed the blocklist.
const DOMAIN_SUGGESTIONS = ['twitter.com', 'instagram.com', 'reddit.com', 'youtube.com', 'tiktok.com', 'facebook.com']
const PROCESS_SUGGESTIONS = ['Discord', 'Steam', 'Spotify', 'Slack', 'Telegram']

const CAT_COLOR: Record<AppCategory, string> = {
  browser: '#3b9eff', social: '#f87171', entertainment: '#f87171',
  gaming: '#ff6b35', productivity: '#34d399', communication: '#fbbf24',
  development: '#34d399', system: '#546e7a', other: '#455a64',
}

function categoryLabel(cat: AppCategory): string {
  const labels: Record<AppCategory, string> = {
    browser: 'Browser', social: 'Social', entertainment: 'Entertainment',
    gaming: 'Gaming', productivity: 'Productivity', communication: 'Comms',
    development: 'Dev', system: 'System', other: 'Other',
  }
  return labels[cat]
}

function cleanTitle(title: string, app: string): string {
  let t = title
  const appName = app.replace(/\.exe$/i, '')
  t = t.replace(new RegExp(`\\s*[-–|]\\s*${appName}\\s*$`, 'i'), '')
  t = t.replace(/\s*[-–|]\s*(Google Chrome|Firefox|Microsoft Edge|Safari|Opera|Brave)\s*$/i, '')
  return t.trim() || app
}

export default function Overview({ store, onRefresh, onChatWith }: OverviewProps): React.ReactElement {
  const { colors } = useTheme()
  const [newDomain, setNewDomain] = useState('')
  const [newProcess, setNewProcess] = useState('')
  const [adding, setAdding] = useState<'domain' | 'process' | null>(null)
  const [todayStats, setTodayStats] = useState<{ focusScore: number; focusedTime: number; blockEvents: number } | null>(null)
  const [activitySessions, setActivitySessions] = useState<ActivitySession[]>([])
  const [now, setNow] = useState(Date.now())
  const [showAll, setShowAll] = useState(false)

  const activeSession = store.sessions.find((s) => s.active)
  const isShieldOn = !!activeSession || (store.elevation === 'full' && store.blocklist.domains.length > 0)

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 10000)
    return () => clearInterval(id)
  }, [])

  useEffect(() => {
    api.getAnalytics().then((data) => {
      setTodayStats({
        focusScore: data.today.focusScore,
        focusedTime: data.today.focusedTime,
        blockEvents: data.today.blockEvents,
      })
      setActivitySessions([...data.recentSessions].sort((a, b) => b.startTime - a.startTime))
    }).catch(() => {})
  }, [])

  const handleAddDomain = async (): Promise<void> => {
    const d = newDomain.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '')
    if (!d) return
    setAdding('domain')
    await api.addDomain(d)
    setNewDomain('')
    onRefresh()
    setAdding(null)
  }

  const handleAddProcess = async (): Promise<void> => {
    const p = newProcess.trim()
    if (!p) return
    setAdding('process')
    await api.addProcess(p)
    setNewProcess('')
    onRefresh()
    setAdding(null)
  }

  const handleAskDaemon = (): void => {
    if (!onChatWith) return
    const focusScore = todayStats?.focusScore ?? 0
    const topDistractions = activitySessions
      .filter((s) => s.isDistraction)
      .slice(0, 3)
      .map((s) => s.app)
      .join(', ')
    const sitesBlocked = store.blocklist.domains.length
    const appsBlocked = store.blocklist.processes.length
    onChatWith(
      `I'm looking at my Overview page. My current focus score is ${Math.round(focusScore)}% today. ` +
      `I have ${sitesBlocked} sites and ${appsBlocked} apps blocked. ` +
      `My recent distractions include: ${topDistractions || 'none detected yet'}. ` +
      `Can you analyze my protection setup and suggest improvements?`
    )
  }

  const sessionRemaining = activeSession?.endsAt ? Math.max(0, activeSession.endsAt - now) : null
  const activeSchedules = store.schedules.filter((s) => s.active)

  // Suppress sub-minute sessions, a log full of "0m" rows is noise, not signal.
  const loggedSessions = activitySessions.filter((s) => s.duration >= 60000)
  const visibleSessions = showAll ? loggedSessions : loggedSessions.slice(0, 40)
  const grouped = new Map<string, ActivitySession[]>()
  for (const s of visibleSessions) {
    const key = relativeDate(s.startTime)
    if (!grouped.has(key)) grouped.set(key, [])
    grouped.get(key)!.push(s)
  }

  return (
    <div className="p-4 animate-fade-in space-y-3 overflow-y-auto h-full">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <Shield size={18} style={{ color: colors.accent, flexShrink: 0 }} />
          <div>
            <h1 className="font-semibold text-[15px]" style={{ color: colors.textPrimary }}>Protection</h1>
            <p className="text-[11px] mt-0.5" style={{ color: colors.textMuted }}>Blocklists, feed blocks, and activity log</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {onChatWith && (
            <button
              onClick={handleAskDaemon}
              title="Get AI analysis of your current protection setup and activity"
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-full text-[11px] font-medium transition-colors"
              style={{ background: colors.accentBg, color: colors.accent, border: `1px solid ${colors.border}` }}
            >
              <MessageSquare size={11} /> Ask AI
            </button>
          )}
          {/* Passive status badge, not a control. Green (on) or a quiet neutral
              (idle); never red, since "idle" is not an error. */}
          <div
            className="flex items-center gap-2 px-3 py-1.5 rounded-full text-[11px] font-medium"
            title={isShieldOn ? 'Protection layers active' : 'No active session or blocklist yet'}
            style={{
              background: isShieldOn ? 'rgba(52,211,153,0.1)' : 'transparent',
              border: `1px solid ${isShieldOn ? 'rgba(52,211,153,0.25)' : colors.border}`,
              color: isShieldOn ? '#34d399' : colors.textMuted,
            }}
          >
            <div className={`w-1.5 h-1.5 rounded-full ${isShieldOn ? 'bg-accent-green' : ''}`} style={!isShieldOn ? { background: colors.textDim } : undefined} />
            {isShieldOn ? 'Protection active' : 'Protection idle'}
          </div>
        </div>
      </div>

      {/* Elevation warning */}
      {store.elevation !== 'full' && (
        <div
          className="flex items-center gap-2 px-3 py-2 rounded-lg text-xs"
          title="Without admin rights, hosts-file edits cannot be made, so site blocking is unavailable."
          style={{ background: 'rgba(255,107,53,0.08)', border: '1px solid rgba(255,107,53,0.2)' }}
        >
          <WifiOff size={12} className="text-accent-orange flex-shrink-0" />
          <span className="text-accent-orange font-semibold">Hosts-file blocking inactive</span>
          <span className="ml-1" style={{ color: colors.textSecondary }}>admin rights required to enforce site blocks</span>
        </div>
      )}

      {/* KPI strip */}
      <div className="grid grid-cols-4 gap-2">
        {[
          {
            label: 'Sites Blocked',
            value: store.blocklist.domains.length.toString(),
            color: store.blocklist.domains.length > 0 ? '#34d399' : colors.textMuted,
            sub: 'domains',
            icon: <Globe size={12} />,
            tooltip: store.blocklist.domains.length > 0
              ? `${store.blocklist.domains.length} domain${store.blocklist.domains.length > 1 ? 's' : ''} actively blocked`
              : 'No sites blocked, add a domain below to start blocking',
          },
          {
            label: 'Apps Blocked',
            value: store.blocklist.processes.length.toString(),
            color: store.blocklist.processes.length > 0 ? '#34d399' : colors.textMuted,
            sub: 'processes',
            icon: <Cpu size={12} />,
            tooltip: store.blocklist.processes.length > 0
              ? `${store.blocklist.processes.length} process${store.blocklist.processes.length > 1 ? 'es' : ''} monitored`
              : 'No apps blocked',
          },
          {
            label: 'Block Events',
            value: (todayStats?.blockEvents ?? store.blockEventCount ?? 0).toString(),
            color: '#3b9eff',
            sub: 'today',
            icon: <Zap size={12} />,
            tooltip: `${todayStats?.blockEvents ?? store.blockEventCount ?? 0} attempts blocked today`,
          },
          {
            label: activeSession ? 'Session Timer' : 'Focus Score',
            value: activeSession
              ? (sessionRemaining !== null ? formatMs(sessionRemaining) : '∞')
              : `${Math.round(todayStats?.focusScore ?? 0)}%`,
            color: activeSession ? '#34d399' : (todayStats?.focusScore ?? 0) >= 60 ? '#34d399' : '#fbbf24',
            sub: activeSession ? `${activeSession.mode} mode` : 'today',
            icon: <BarChart2 size={12} />,
            tooltip: activeSession
              ? `${activeSession.mode} focus session active`
              : `Today's focus score: ${Math.round(todayStats?.focusScore ?? 0)}%`,
          },
        ].map((chip) => (
          <div
            key={chip.label}
            className="flex flex-col items-center justify-center py-2.5 px-2 rounded-xl gap-0.5"
            title={chip.tooltip}
            style={{ background: colors.cardBg, border: `1px solid ${colors.border}` }}
          >
            <p className="text-base font-bold tabular-nums leading-none" style={{ color: chip.color }}>{chip.value}</p>
            <p className="text-[10px] font-medium" style={{ color: colors.textPrimary }}>{chip.label}</p>
            <p className="text-[9px]" style={{ color: colors.textSecondary }}>{chip.sub}</p>
          </div>
        ))}
      </div>

      {/* Active session banner */}
      {activeSession && (
        <div
          className="flex items-center justify-between px-3 py-2 rounded-lg"
          style={{ background: 'rgba(52,211,153,0.08)', border: '1px solid rgba(52,211,153,0.2)' }}
        >
          <div className="flex items-center gap-2 text-xs">
            <div className="w-2 h-2 rounded-full bg-accent-green animate-pulse" />
            <span className="text-accent-green font-semibold capitalize">{activeSession.mode} focus</span>
            <span style={{ color: colors.textSecondary }}>started {formatTime(activeSession.startedAt)}</span>
            {sessionRemaining !== null && (
              <span style={{ color: colors.textSecondary }}>· {formatMs(sessionRemaining)} remaining</span>
            )}
            {activeSession.allowlist && activeSession.allowlist.length > 0 && (
              <span style={{ color: colors.textSecondary }}>· {activeSession.allowlist.length} sites allowed</span>
            )}
          </div>
          <button
            className="hover:text-accent-orange text-[11px] transition-colors" style={{ color: colors.textSecondary }}
            onClick={async () => { await api.stopSession(activeSession.id); onRefresh() }}
          >
            End session
          </button>
        </div>
      )}

      {/* Two-column blocklist management */}
      <div className="grid grid-cols-2 gap-3">
        {/* Blocked sites */}
        <div className="rounded-xl p-3 flex flex-col gap-2" style={{ background: colors.cardBg, border: `1px solid ${colors.border}` }}>
          <div className="flex items-center gap-1.5">
            <Globe size={12} className="text-accent-blue" />
            <p className="text-[11px] font-semibold" style={{ color: colors.textPrimary }}>Blocked Sites</p>
            <span className="ml-auto text-[9px]" style={{ color: colors.textSecondary }}>{store.blocklist.domains.length} entries</span>
          </div>

          <div className="flex flex-col gap-px max-h-48 overflow-y-auto">
            {store.blocklist.domains.length === 0 ? (
              <p className="text-[10px] text-center py-4" style={{ color: colors.textSecondary }}>No sites blocked yet</p>
            ) : (
              store.blocklist.domains.map((d) => (
                <div
                  key={d.domain}
                  className="flex items-center gap-1.5 px-2 py-1 rounded-md group hover:bg-white/[0.03] transition-colors"
                  title={`${d.domain}${d.expiresAt ? `, expires in ${formatExpiry(d.expiresAt)}` : ', permanent block'}`}
                >
                  <span className="text-[11px] font-medium truncate flex-1" style={{ color: colors.textPrimary }}>{d.domain}</span>
                  {d.expiresAt && (
                    <span className="text-[9px] font-mono tabular-nums flex-shrink-0" style={{ color: colors.textSecondary }}>
                      {formatExpiry(d.expiresAt)}
                    </span>
                  )}
                  <button
                    onClick={async () => { await api.removeDomain(d.domain); onRefresh() }}
                    className="opacity-0 group-hover:opacity-100 hover:text-accent-orange transition-all flex-shrink-0" style={{ color: colors.textSecondary }}
                  >
                    <Trash2 size={10} />
                  </button>
                </div>
              ))
            )}
          </div>

          {/* Tappable suggestions, a friendlier way to seed the blocklist than a
              placeholder that reads like an entered value. */}
          <div className="flex flex-wrap gap-1">
            {DOMAIN_SUGGESTIONS
              .filter((s) => !store.blocklist.domains.some((d) => d.domain === s))
              .slice(0, 4)
              .map((s) => (
                <button
                  key={s}
                  onClick={async () => { await api.addDomain(s); onRefresh() }}
                  className="text-[10px] px-2 py-0.5 rounded-full transition-colors hover:brightness-125"
                  style={{ background: colors.accentBg, color: colors.accent, border: `1px solid ${colors.border}` }}
                >
                  + {s}
                </button>
              ))}
          </div>
          <div className="flex gap-1.5">
            <input
              type="text"
              placeholder="Add a site…"
              value={newDomain}
              onChange={(e) => setNewDomain(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleAddDomain()}
              className="flex-1 text-[11px] px-2 py-1.5 rounded-lg outline-none transition-colors"
              style={{ background: colors.inputBg, border: `1px solid ${colors.border}`, color: colors.textPrimary }}
              onFocus={(e) => { e.target.style.borderColor = 'rgba(33,150,243,0.4)' }}
              onBlur={(e) => { e.target.style.borderColor = colors.border }}
            />
            <button
              onClick={handleAddDomain}
              disabled={!newDomain.trim() || adding === 'domain'}
              className="flex items-center gap-1 text-[11px] font-semibold px-2.5 py-1.5 rounded-lg transition-colors disabled:opacity-50"
              style={{ background: 'rgba(33,150,243,0.15)', color: '#818cf8', border: '1px solid rgba(33,150,243,0.2)' }}
            >
              <Plus size={10} /> Add
            </button>
          </div>
        </div>

        {/* Blocked apps */}
        <div className="rounded-xl p-3 flex flex-col gap-2" style={{ background: colors.cardBg, border: `1px solid ${colors.border}` }}>
          <div className="flex items-center gap-1.5">
            <Cpu size={12} className="text-accent-amber" />
            <p className="text-[11px] font-semibold" style={{ color: colors.textPrimary }}>Blocked Apps</p>
            <span className="ml-auto text-[9px]" style={{ color: colors.textSecondary }}>{store.blocklist.processes.length} entries</span>
          </div>

          <div className="flex flex-col gap-px max-h-48 overflow-y-auto">
            {store.blocklist.processes.length === 0 ? (
              <p className="text-[10px] text-center py-4" style={{ color: colors.textSecondary }}>No apps blocked yet</p>
            ) : (
              store.blocklist.processes.map((p) => (
                <div
                  key={p.name}
                  className="flex items-center gap-1.5 px-2 py-1 rounded-md group hover:bg-white/[0.03] transition-colors"
                  title={`${p.name}${p.expiresAt ? `, expires in ${formatExpiry(p.expiresAt)}` : ', permanent block'}`}
                >
                  <span className="text-[11px] font-medium truncate flex-1" style={{ color: colors.textPrimary }}>{p.name}</span>
                  {p.expiresAt && (
                    <span className="text-[9px] font-mono tabular-nums flex-shrink-0" style={{ color: colors.textSecondary }}>
                      {formatExpiry(p.expiresAt)}
                    </span>
                  )}
                  <button
                    onClick={async () => { await api.removeProcess(p.name); onRefresh() }}
                    className="opacity-0 group-hover:opacity-100 hover:text-accent-orange transition-all flex-shrink-0" style={{ color: colors.textSecondary }}
                  >
                    <Trash2 size={10} />
                  </button>
                </div>
              ))
            )}
          </div>

          <div className="flex flex-wrap gap-1">
            {PROCESS_SUGGESTIONS
              .filter((s) => !store.blocklist.processes.some((p) => p.name.toLowerCase() === s.toLowerCase()))
              .slice(0, 4)
              .map((s) => (
                <button
                  key={s}
                  onClick={async () => { await api.addProcess(s); onRefresh() }}
                  className="text-[10px] px-2 py-0.5 rounded-full transition-colors hover:brightness-125"
                  style={{ background: 'rgba(251,191,36,0.1)', color: '#fbbf24', border: '1px solid rgba(251,191,36,0.2)' }}
                >
                  + {s}
                </button>
              ))}
          </div>
          <div className="flex gap-1.5">
            <input
              type="text"
              placeholder="Add an app…"
              value={newProcess}
              onChange={(e) => setNewProcess(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleAddProcess()}
              className="flex-1 text-[11px] px-2 py-1.5 rounded-lg outline-none transition-colors"
              style={{ background: colors.inputBg, border: `1px solid ${colors.border}`, color: colors.textPrimary }}
              onFocus={(e) => { e.target.style.borderColor = 'rgba(251,191,36,0.3)' }}
              onBlur={(e) => { e.target.style.borderColor = colors.border }}
            />
            <button
              onClick={handleAddProcess}
              disabled={!newProcess.trim() || adding === 'process'}
              className="flex items-center gap-1 text-[11px] font-semibold px-2.5 py-1.5 rounded-lg transition-colors disabled:opacity-50"
              style={{ background: 'rgba(251,191,36,0.12)', color: '#fbbf24', border: '1px solid rgba(251,191,36,0.2)' }}
            >
              <Plus size={10} /> Add
            </button>
          </div>
        </div>
      </div>

      {/* Feed blocks — enforced by the browser extension, not the hosts file */}
      {(store.feedBlocks?.length ?? 0) > 0 && (
        <div className="rounded-xl p-3" style={{ background: colors.cardBg, border: `1px solid ${colors.border}` }}>
          <div className="flex items-center gap-1.5 mb-2">
            <Shield size={12} style={{ color: '#34d399' }} />
            <p className="text-[11px] font-semibold" style={{ color: colors.textPrimary }}>Feed Blocks</p>
            <span className="ml-auto text-[9px]" style={{ color: colors.textSecondary }}>via browser extension</span>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {store.feedBlocks!.map((f) => (
              // A blocked feed is the app doing its job → read as confirmed/green,
              // not red (red is reserved for problems).
              <div
                key={f.domain}
                className="flex items-center gap-1.5 px-2 py-1 rounded-lg"
                title={`${f.displayName} is hidden by the Attentify browser extension`}
                style={{ background: 'rgba(52,211,153,0.08)', border: '1px solid rgba(52,211,153,0.22)' }}
              >
                <Shield size={10} style={{ color: '#34d399' }} />
                <span className="text-[10px] font-medium" style={{ color: colors.textPrimary }}>{f.displayName}</span>
                <span className="text-[8.5px] px-1 py-0.5 rounded" style={{ background: 'rgba(52,211,153,0.15)', color: '#34d399' }}>hidden</span>
              </div>
            ))}
          </div>
          <p className="mt-2 text-[9px]" style={{ color: colors.textSecondary }}>
            Distracting feeds are hidden in your browser. Install the extension and Attentify syncs these automatically.
          </p>
        </div>
      )}

      {/* Schedules */}
      {activeSchedules.length > 0 && (
        <div className="rounded-xl p-3" style={{ background: colors.cardBg, border: `1px solid ${colors.border}` }}>
          <div className="flex items-center gap-1.5 mb-2">
            <Calendar size={12} className="text-accent-blue" />
            <p className="text-[11px] font-semibold" style={{ color: colors.textPrimary }}>Active Schedules</p>
            <span className="ml-auto text-[9px]" style={{ color: colors.textSecondary }}>{activeSchedules.length} running</span>
          </div>
          <div className="grid grid-cols-2 gap-1">
            {activeSchedules.slice(0, 4).map((sched) => (
              <div
                key={sched.id}
                className="flex items-center gap-2 px-2 py-1.5 rounded-lg"
                style={{ background: colors.rowOdd, border: `1px solid ${colors.border}` }}
              >
                <div className="w-1.5 h-1.5 rounded-full bg-accent-green flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-[10px] font-medium truncate" style={{ color: colors.textPrimary }}>{sched.name}</p>
                  <p className="text-[9px] font-mono" style={{ color: colors.textSecondary }}>{sched.startTime}–{sched.endTime} · {sched.days.map((d) => DAY_INITIALS[d]).join('')}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Activity feed */}
      <div className="rounded-xl p-3" style={{ background: colors.cardBg, border: `1px solid ${colors.border}` }}>
        <div className="flex items-center gap-1.5 mb-3">
          <Clock size={12} style={{ color: colors.textSecondary }} />
          <p className="text-[11px] font-semibold" style={{ color: colors.textPrimary }}>Activity Log</p>
          <span className="ml-auto text-[9px]" style={{ color: colors.textSecondary }}>{loggedSessions.length} sessions tracked</span>
        </div>

        {loggedSessions.length === 0 ? (
          <p className="text-[10px] text-center py-6" style={{ color: colors.textSecondary }}>No activity recorded yet, tracking starts automatically in the background</p>
        ) : (
          <div className="space-y-3">
            {[...grouped.entries()].map(([dateLabel, sessions]) => (
              <div key={dateLabel}>
                <p className="text-[9px] font-semibold uppercase tracking-widest mb-1.5" style={{ color: colors.textSecondary }}>{dateLabel}</p>
                <div className="space-y-px">
                  {sessions.map((s) => {
                    const catColor = CAT_COLOR[s.category]
                    const title = cleanTitle(s.title, s.app)
                    const tooltipParts = [
                      `${s.app}: ${s.category}`,
                      title !== s.app ? `"${title}"` : '',
                      s.url ? `URL: ${s.url}` : '',
                      `Duration: ${formatMs(s.duration)}`,
                      `Started: ${formatTime(s.startTime)}`,
                      s.isDistraction ? 'Classified as distraction' : 'Classified as focused',
                    ].filter(Boolean).join('\n')
                    return (
                      <div
                        key={s.id}
                        className="flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-white/[0.03] transition-colors"
                        title={tooltipParts}
                        style={{ borderLeft: `2px solid ${catColor}30` }}
                      >
                        <div
                          className="w-1.5 h-1.5 rounded-full flex-shrink-0"
                          style={{ background: s.isDistraction ? '#f87171' : catColor }}
                        />
                        <span className="text-[11px] font-medium flex-shrink-0 w-24 truncate" style={{ color: colors.textPrimary }}>{s.app}</span>
                        <span className="text-[10px] flex-1 truncate min-w-0" style={{ color: colors.textSecondary }}>{title !== s.app ? title : ''}</span>
                        {s.url && (
                          <span
                            className="text-[9px] truncate flex-shrink-0 max-w-[120px]" style={{ color: colors.textSecondary }}
                            title={s.url}
                          >
                            {s.url.replace(/^https?:\/\/(www\.)?/, '').split('/')[0]}
                          </span>
                        )}
                        <span
                          className="text-[8.5px] px-1 py-0.5 rounded flex-shrink-0"
                          style={{ background: catColor + '18', color: catColor }}
                        >
                          {categoryLabel(s.category)}
                        </span>
                        <span className="text-[9px] font-mono tabular-nums flex-shrink-0 w-8 text-right" style={{ color: colors.textSecondary }}>{formatMs(s.duration)}</span>
                        <span className="text-[9px] font-mono tabular-nums flex-shrink-0 w-10 text-right" style={{ color: colors.textSecondary }}>{formatTime(s.startTime)}</span>
                      </div>
                    )
                  })}
                </div>
              </div>
            ))}

            {loggedSessions.length > 40 && !showAll && (
              <button
                onClick={() => setShowAll(true)}
                className="w-full text-[10px] py-1.5 transition-colors" style={{ color: colors.textSecondary }}
              >
                Show all {loggedSessions.length} sessions →
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

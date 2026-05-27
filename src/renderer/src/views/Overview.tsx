import React, { useState, useEffect } from 'react'
import { Shield, Plus, Trash2, Globe, Cpu, Clock, WifiOff, Calendar, BarChart2, Zap, MessageSquare } from 'lucide-react'
import type { AppStore, ActivitySession, AppCategory } from '@shared/types'

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

const CAT_COLOR: Record<AppCategory, string> = {
  browser: '#2196f3', social: '#ef5350', entertainment: '#ef5350',
  gaming: '#ff6b35', productivity: '#4caf50', communication: '#ffb800',
  development: '#66bb6a', system: '#546e7a', other: '#455a64',
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
  // Strip trailing "- App Name" patterns browsers add
  let t = title
  const appName = app.replace(/\.exe$/i, '')
  t = t.replace(new RegExp(`\\s*[-–|]\\s*${appName}\\s*$`, 'i'), '')
  t = t.replace(/\s*[-–|]\s*(Google Chrome|Firefox|Microsoft Edge|Safari|Opera|Brave)\s*$/i, '')
  return t.trim() || app
}

export default function Overview({ store, onRefresh, onChatWith }: OverviewProps): React.ReactElement {
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

  // Group activity by date
  const visibleSessions = showAll ? activitySessions : activitySessions.slice(0, 40)
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
        <div>
          <h1 className="text-white font-bold text-xl flex items-center gap-2">
            <Shield size={19} className={isShieldOn ? 'text-accent-green' : 'text-navy-500'} />
            Overview
          </h1>
          <p className="text-[10px] mt-0.5" style={{ color: '#8faac4' }}>Protection status · blocklist management · activity log</p>
        </div>
        <div className="flex items-center gap-2">
          {onChatWith && (
            <button
              onClick={handleAskDaemon}
              title="Get AI analysis of your current protection setup and activity"
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-full text-[11px] font-medium transition-colors"
              style={{ background: 'rgba(33,150,243,0.1)', color: '#64b5f6', border: '1px solid rgba(33,150,243,0.2)' }}
            >
              <MessageSquare size={11} /> Ask AI
            </button>
          )}
          <div
            className="flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-semibold"
            title={isShieldOn ? 'Protection layers active — sites and apps are being monitored' : 'No active session — add sites or start a session to enable blocking'}
            style={{
              background: isShieldOn ? 'rgba(76,175,80,0.12)' : 'rgba(30,58,95,0.4)',
              border: `1px solid ${isShieldOn ? 'rgba(76,175,80,0.25)' : 'rgba(30,58,95,0.7)'}`,
              color: isShieldOn ? '#4caf50' : '#546e7a',
            }}
          >
            <div className={`w-1.5 h-1.5 rounded-full ${isShieldOn ? 'bg-accent-green animate-pulse' : 'bg-navy-600'}`} />
            {isShieldOn ? 'Protection Active' : 'Protection Idle'}
          </div>
        </div>
      </div>

      {/* Elevation warning */}
      {store.elevation !== 'full' && (
        <div
          className="flex items-center gap-2 px-3 py-2 rounded-lg text-xs"
          title="Without admin rights, hosts-file edits cannot be made — site blocking is unavailable. Process blocking still works."
          style={{ background: 'rgba(255,107,53,0.08)', border: '1px solid rgba(255,107,53,0.2)' }}
        >
          <WifiOff size={12} className="text-accent-orange flex-shrink-0" />
          <span className="text-accent-orange font-semibold">Hosts-file blocking inactive</span>
          <span className="ml-1" style={{ color: '#8faac4' }}>— admin rights required to enforce site blocks</span>
        </div>
      )}

      {/* KPI strip */}
      <div className="grid grid-cols-4 gap-2">
        {[
          {
            label: 'Sites Blocked',
            value: store.blocklist.domains.length.toString(),
            color: store.blocklist.domains.length > 0 ? '#4caf50' : '#546e7a',
            sub: 'domains',
            icon: <Globe size={12} />,
            tooltip: store.blocklist.domains.length > 0
              ? `${store.blocklist.domains.length} domain${store.blocklist.domains.length > 1 ? 's' : ''} actively blocked via hosts file`
              : 'No sites blocked — add a domain below to start blocking',
          },
          {
            label: 'Apps Blocked',
            value: store.blocklist.processes.length.toString(),
            color: store.blocklist.processes.length > 0 ? '#4caf50' : '#546e7a',
            sub: 'processes',
            icon: <Cpu size={12} />,
            tooltip: store.blocklist.processes.length > 0
              ? `${store.blocklist.processes.length} process${store.blocklist.processes.length > 1 ? 'es' : ''} monitored — will be terminated if launched`
              : 'No apps blocked — add a process name below to terminate it on launch',
          },
          {
            label: 'Block Events',
            value: (todayStats?.blockEvents ?? store.blockEventCount ?? 0).toString(),
            color: '#2196f3',
            sub: 'today',
            icon: <Zap size={12} />,
            tooltip: `${todayStats?.blockEvents ?? store.blockEventCount ?? 0} attempts blocked today by hosts file, firewall, or process termination`,
          },
          {
            label: activeSession ? 'Session Timer' : 'Focus Score',
            value: activeSession
              ? (sessionRemaining !== null ? formatMs(sessionRemaining) : '∞')
              : `${Math.round(todayStats?.focusScore ?? 0)}%`,
            color: activeSession ? '#4caf50' : (todayStats?.focusScore ?? 0) >= 60 ? '#4caf50' : '#ffb800',
            sub: activeSession ? `${activeSession.mode} mode` : 'today',
            icon: <BarChart2 size={12} />,
            tooltip: activeSession
              ? `${activeSession.mode === 'deep' ? 'Deep focus' : 'Normal focus'} session active${sessionRemaining !== null ? ` — ${formatMs(sessionRemaining)} remaining` : ' — no time limit'}`
              : `Today's focus score: ${Math.round(todayStats?.focusScore ?? 0)}% — based on focused vs distracted time ratio`,
          },
        ].map((chip) => (
          <div
            key={chip.label}
            className="flex flex-col items-center justify-center py-2.5 px-2 rounded-xl gap-0.5"
            title={chip.tooltip}
            style={{ background: '#0d1b2a', border: '1px solid rgba(30,58,95,0.5)' }}
          >
            <p className="text-base font-bold tabular-nums leading-none" style={{ color: chip.color }}>{chip.value}</p>
            <p className="text-[10px] text-white font-medium">{chip.label}</p>
            <p className="text-[9px]" style={{ color: '#7a9ab5' }}>{chip.sub}</p>
          </div>
        ))}
      </div>

      {/* Active session banner */}
      {activeSession && (
        <div
          className="flex items-center justify-between px-3 py-2 rounded-lg"
          title={`${activeSession.mode === 'deep' ? 'Deep focus' : 'Normal'} session started at ${formatTime(activeSession.startedAt)}${activeSession.allowlist?.length ? ` — ${activeSession.allowlist.length} sites on allowlist` : ''}`}
          style={{ background: 'rgba(76,175,80,0.08)', border: '1px solid rgba(76,175,80,0.2)' }}
        >
          <div className="flex items-center gap-2 text-xs">
            <div className="w-2 h-2 rounded-full bg-accent-green animate-pulse" />
            <span className="text-accent-green font-semibold capitalize">{activeSession.mode} focus</span>
            <span style={{ color: '#8faac4' }}>started {formatTime(activeSession.startedAt)}</span>
            {sessionRemaining !== null && (
              <span style={{ color: '#8faac4' }}>· {formatMs(sessionRemaining)} remaining</span>
            )}
            {activeSession.allowlist && activeSession.allowlist.length > 0 && (
              <span style={{ color: '#7a9ab5' }}>· {activeSession.allowlist.length} sites allowed</span>
            )}
          </div>
          <button
            className="hover:text-accent-orange text-[11px] transition-colors" style={{ color: '#8faac4' }}
            title="End the current focus session"
            onClick={async () => { await api.stopSession(activeSession.id); onRefresh() }}
          >
            End session
          </button>
        </div>
      )}

      {/* Two-column blocklist management */}
      <div className="grid grid-cols-2 gap-3">
        {/* Blocked sites */}
        <div className="rounded-xl p-3 flex flex-col gap-2" style={{ background: '#0d1b2a', border: '1px solid rgba(30,58,95,0.5)' }}>
          <div className="flex items-center gap-1.5">
            <Globe size={12} className="text-accent-blue" />
            <p className="text-white text-[11px] font-semibold">Blocked Sites</p>
            <span className="ml-auto text-[9px]" style={{ color: '#7a9ab5' }} title={`${store.blocklist.domains.length} total domain entries`}>{store.blocklist.domains.length} entries</span>
          </div>

          <div className="flex flex-col gap-px max-h-48 overflow-y-auto">
            {store.blocklist.domains.length === 0 ? (
              <p className="text-[10px] text-center py-4" style={{ color: '#7a9ab5' }}>No sites blocked yet</p>
            ) : (
              store.blocklist.domains.map((d) => (
                <div
                  key={d.domain}
                  className="flex items-center gap-1.5 px-2 py-1 rounded-md group hover:bg-navy-700/20 transition-colors"
                  title={`${d.domain}${d.expiresAt ? ` — expires in ${formatExpiry(d.expiresAt)}` : ' — permanent block'}`}
                >
                  <span className="text-white text-[11px] font-medium truncate flex-1">{d.domain}</span>
                  {d.expiresAt && (
                    <span className="text-[9px] font-mono tabular-nums flex-shrink-0" style={{ color: '#7a9ab5' }}>
                      {formatExpiry(d.expiresAt)}
                    </span>
                  )}
                  <button
                    onClick={async () => { await api.removeDomain(d.domain); onRefresh() }}
                    title={`Remove ${d.domain} from blocklist`}
                    className="opacity-0 group-hover:opacity-100 hover:text-accent-orange transition-all flex-shrink-0" style={{ color: '#7a9ab5' }}
                  >
                    <Trash2 size={10} />
                  </button>
                </div>
              ))
            )}
          </div>

          <div className="flex gap-1.5">
            <input
              type="text"
              placeholder="twitter.com"
              value={newDomain}
              onChange={(e) => setNewDomain(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleAddDomain()}
              title="Enter a domain to block (e.g. twitter.com)"
              className="flex-1 text-[11px] px-2 py-1.5 rounded-lg outline-none transition-colors"
              style={{ background: 'rgba(17,34,64,0.8)', border: '1px solid rgba(30,58,95,0.6)', color: '#e2e8f0' }}
              onFocus={(e) => { e.target.style.borderColor = 'rgba(33,150,243,0.4)' }}
              onBlur={(e) => { e.target.style.borderColor = 'rgba(30,58,95,0.6)' }}
            />
            <button
              onClick={handleAddDomain}
              disabled={!newDomain.trim() || adding === 'domain'}
              title="Add domain to blocklist"
              className="flex items-center gap-1 text-[11px] font-semibold px-2.5 py-1.5 rounded-lg transition-colors disabled:opacity-50"
              style={{ background: 'rgba(33,150,243,0.15)', color: '#64b5f6', border: '1px solid rgba(33,150,243,0.2)' }}
            >
              <Plus size={10} /> Add
            </button>
          </div>
        </div>

        {/* Blocked apps */}
        <div className="rounded-xl p-3 flex flex-col gap-2" style={{ background: '#0d1b2a', border: '1px solid rgba(30,58,95,0.5)' }}>
          <div className="flex items-center gap-1.5">
            <Cpu size={12} className="text-accent-amber" />
            <p className="text-white text-[11px] font-semibold">Blocked Apps</p>
            <span className="ml-auto text-[9px]" style={{ color: '#7a9ab5' }} title={`${store.blocklist.processes.length} process names monitored — terminated on launch`}>{store.blocklist.processes.length} entries</span>
          </div>

          <div className="flex flex-col gap-px max-h-48 overflow-y-auto">
            {store.blocklist.processes.length === 0 ? (
              <p className="text-[10px] text-center py-4" style={{ color: '#7a9ab5' }}>No apps blocked yet</p>
            ) : (
              store.blocklist.processes.map((p) => (
                <div
                  key={p.name}
                  className="flex items-center gap-1.5 px-2 py-1 rounded-md group hover:bg-navy-700/20 transition-colors"
                  title={`${p.name}${p.expiresAt ? ` — expires in ${formatExpiry(p.expiresAt)}` : ' — permanent block'} — will be killed within 2 seconds of launch`}
                >
                  <span className="text-white text-[11px] font-medium truncate flex-1">{p.name}</span>
                  {p.expiresAt && (
                    <span className="text-[9px] font-mono tabular-nums flex-shrink-0" style={{ color: '#7a9ab5' }}>
                      {formatExpiry(p.expiresAt)}
                    </span>
                  )}
                  <button
                    onClick={async () => { await api.removeProcess(p.name); onRefresh() }}
                    title={`Remove ${p.name} from process blocklist`}
                    className="opacity-0 group-hover:opacity-100 hover:text-accent-orange transition-all flex-shrink-0" style={{ color: '#7a9ab5' }}
                  >
                    <Trash2 size={10} />
                  </button>
                </div>
              ))
            )}
          </div>

          <div className="flex gap-1.5">
            <input
              type="text"
              placeholder="Discord"
              value={newProcess}
              onChange={(e) => setNewProcess(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleAddProcess()}
              title="Enter an app name to block (e.g. Discord, Spotify). The process will be terminated within 2 seconds of launch."
              className="flex-1 text-[11px] px-2 py-1.5 rounded-lg outline-none transition-colors"
              style={{ background: 'rgba(17,34,64,0.8)', border: '1px solid rgba(30,58,95,0.6)', color: '#e2e8f0' }}
              onFocus={(e) => { e.target.style.borderColor = 'rgba(255,184,0,0.3)' }}
              onBlur={(e) => { e.target.style.borderColor = 'rgba(30,58,95,0.6)' }}
            />
            <button
              onClick={handleAddProcess}
              disabled={!newProcess.trim() || adding === 'process'}
              title="Add app to process blocklist"
              className="flex items-center gap-1 text-[11px] font-semibold px-2.5 py-1.5 rounded-lg transition-colors disabled:opacity-50"
              style={{ background: 'rgba(255,184,0,0.12)', color: '#ffb800', border: '1px solid rgba(255,184,0,0.2)' }}
            >
              <Plus size={10} /> Add
            </button>
          </div>
        </div>
      </div>

      {/* Schedules */}
      {activeSchedules.length > 0 && (
        <div className="rounded-xl p-3" style={{ background: '#0d1b2a', border: '1px solid rgba(30,58,95,0.5)' }}>
          <div className="flex items-center gap-1.5 mb-2">
            <Calendar size={12} className="text-accent-blue" />
            <p className="text-white text-[11px] font-semibold">Active Schedules</p>
            <span className="ml-auto text-[9px]" style={{ color: '#7a9ab5' }}>{activeSchedules.length} running</span>
          </div>
          <div className="grid grid-cols-2 gap-1">
            {activeSchedules.slice(0, 4).map((sched) => (
              <div
                key={sched.id}
                className="flex items-center gap-2 px-2 py-1.5 rounded-lg"
                title={`${sched.name} — ${sched.startTime} to ${sched.endTime} — ${sched.days.length} day(s)/week — blocks ${sched.domains.length + sched.processes.length} items`}
                style={{ background: 'rgba(17,34,64,0.6)', border: '1px solid rgba(30,58,95,0.4)' }}
              >
                <div className="w-1.5 h-1.5 rounded-full bg-accent-green flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-white text-[10px] font-medium truncate">{sched.name}</p>
                  <p className="text-[9px] font-mono" style={{ color: '#7a9ab5' }}>{sched.startTime}–{sched.endTime} · {sched.days.map((d) => DAY_INITIALS[d]).join('')}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Activity feed */}
      <div className="rounded-xl p-3" style={{ background: '#0d1b2a', border: '1px solid rgba(30,58,95,0.5)' }}>
        <div className="flex items-center gap-1.5 mb-3">
          <Clock size={12} style={{ color: '#8faac4' }} />
          <p className="text-white text-[11px] font-semibold">Activity Log</p>
          <span className="ml-auto text-[9px]" style={{ color: '#7a9ab5' }} title="All tracked activity sessions from the past 7 days">{activitySessions.length} sessions tracked</span>
        </div>

        {activitySessions.length === 0 ? (
          <p className="text-[10px] text-center py-6" style={{ color: '#7a9ab5' }}>No activity recorded yet — tracking starts automatically in the background</p>
        ) : (
          <div className="space-y-3">
            {[...grouped.entries()].map(([dateLabel, sessions]) => (
              <div key={dateLabel}>
                <p className="text-[9px] font-semibold uppercase tracking-widest mb-1.5" style={{ color: '#7a9ab5' }}>{dateLabel}</p>
                <div className="space-y-px">
                  {sessions.map((s) => {
                    const catColor = CAT_COLOR[s.category]
                    const title = cleanTitle(s.title, s.app)
                    const tooltipParts = [
                      `${s.app} — ${s.category}`,
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
                          style={{ background: s.isDistraction ? '#ef5350' : catColor }}
                        />
                        <span className="text-white text-[11px] font-medium flex-shrink-0 w-24 truncate">{s.app}</span>
                        <span className="text-[10px] flex-1 truncate min-w-0" style={{ color: '#8faac4' }}>{title !== s.app ? title : ''}</span>
                        {s.url && (
                          <span
                            className="text-[9px] truncate flex-shrink-0 max-w-[120px]" style={{ color: '#7a9ab5' }}
                            title={s.url}
                          >
                            {s.url.replace(/^https?:\/\/(www\.)?/, '').split('/')[0]}
                          </span>
                        )}
                        <span
                          className="text-[8.5px] px-1 py-0.5 rounded flex-shrink-0"
                          title={`Category: ${categoryLabel(s.category)}`}
                          style={{ background: catColor + '18', color: catColor }}
                        >
                          {categoryLabel(s.category)}
                        </span>
                        <span className="text-[9px] font-mono tabular-nums flex-shrink-0 w-8 text-right" style={{ color: '#7a9ab5' }}>{formatMs(s.duration)}</span>
                        <span className="text-[9px] font-mono tabular-nums flex-shrink-0 w-10 text-right" style={{ color: '#7a9ab5' }}>{formatTime(s.startTime)}</span>
                      </div>
                    )
                  })}
                </div>
              </div>
            ))}

            {activitySessions.length > 40 && !showAll && (
              <button
                onClick={() => setShowAll(true)}
                className="w-full text-[10px] hover:text-white py-1.5 transition-colors" style={{ color: '#7a9ab5' }}
                title={`Show all ${activitySessions.length} sessions`}
              >
                Show all {activitySessions.length} sessions →
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

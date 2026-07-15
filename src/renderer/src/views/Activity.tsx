import React, { useEffect, useMemo, useState, useCallback } from 'react'
import {
  Activity as ActivityIcon, Search, Globe, AppWindow, RefreshCw, ExternalLink,
  Filter, Terminal, FolderOpen, ChevronRight, MessageSquare, LayoutGrid,
} from 'lucide-react'
import type { ActivitySession, AppCategory } from '@shared/types'
import { detectPrivacyMode, privacyLabel } from '@shared/privacyMode'
import { useTheme } from '../context/ThemeContext'

const api = (window as unknown as { electronAPI: Window['electronAPI'] }).electronAPI

// The Activity page is the raw local log of what you did, but consolidated. Recording
// every 15–60s window change is noise, so consecutive activity in the same app is merged
// into one readable "session" (what you were doing, where, for how long, how many page
// changes) that you can expand to see the underlying events. Everything stays on device.

// ── App / kind classification ────────────────────────────────────────────────────
const BROWSERS = new Set(['chrome', 'msedge', 'firefox', 'brave', 'opera', 'operagx', 'vivaldi', 'safari', 'arc', 'tor', 'torbrowser', 'chromium', 'yandex', 'duckduckgo', 'librewolf', 'waterfox', 'floorp', 'thorium', 'zen', 'whale', 'epic'])
const TERMINALS = new Set(['windowsterminal', 'wt', 'cmd', 'powershell', 'pwsh', 'conhost', 'terminal', 'iterm2', 'iterm', 'alacritty', 'wezterm', 'bash', 'zsh', 'kitty', 'tabby', 'hyper'])
const FILE_APPS = new Set(['explorer', 'finder', 'nautilus', 'files', 'dolphin', 'thunar', 'pcmanfm'])
const APP_NAMES: Record<string, string> = {
  chrome: 'Chrome', msedge: 'Edge', firefox: 'Firefox', brave: 'Brave', opera: 'Opera', vivaldi: 'Vivaldi', arc: 'Arc',
  code: 'VS Code', cursor: 'Cursor', devenv: 'Visual Studio', idea64: 'IntelliJ', pycharm64: 'PyCharm',
  windowsterminal: 'Windows Terminal', wt: 'Windows Terminal', pwsh: 'PowerShell', powershell: 'PowerShell', cmd: 'Command Prompt',
  explorer: 'File Explorer', discord: 'Discord', slack: 'Slack', teams: 'Teams', spotify: 'Spotify', steam: 'Steam',
  notion: 'Notion', figma: 'Figma', obsidian: 'Obsidian', zoom: 'Zoom',
}
type Kind = 'app' | 'website' | 'terminal' | 'files'
function kindOf(app: string): Kind {
  if (BROWSERS.has(app)) return 'website'
  if (TERMINALS.has(app)) return 'terminal'
  if (FILE_APPS.has(app)) return 'files'
  return 'app'
}
function prettyApp(app: string): string {
  return APP_NAMES[app] ?? app.charAt(0).toUpperCase() + app.slice(1)
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function domainOf(url?: string): string {
  if (!url) return ''
  try { return new URL(url).hostname.replace(/^www\./, '') } catch { return '' }
}
function fmtDur(ms: number): string {
  const h = Math.floor(ms / 3600000), m = Math.floor((ms % 3600000) / 60000), s = Math.floor((ms % 60000) / 1000)
  if (h > 0) return m > 0 ? `${h}h ${m}m` : `${h}h`
  if (m > 0) return s > 0 && m < 10 ? `${m}m ${s}s` : `${m}m`
  return `${s}s`
}
function fmtTime(ts: number): string { return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) }
function dayLabel(ts: number): string {
  const d = new Date(ts), today = new Date()
  const y = new Date(today); y.setDate(today.getDate() - 1)
  if (d.toDateString() === today.toDateString()) return 'Today'
  if (d.toDateString() === y.toDateString()) return 'Yesterday'
  return d.toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric' })
}

// Strip the app name / noise from a window title so the ACTIVITY is the label, not the host.
const TITLE_SUFFIX = /\s*[-–—|]\s*(Google Chrome|Mozilla Firefox|Microsoft Edge|Brave|Opera|Vivaldi|Chromium|Safari|Arc|Visual Studio Code|VS Code|Visual Studio|Discord|Slack|Notion|Figma|Obsidian|.+? Browser)\s*$/i
function cleanTitle(app: string, title: string): string {
  if (!title || !title.trim()) return prettyApp(app)
  let t = title.replace(/^\(\d+\)\s*/, '')                                  // "(3) " unread badge
  t = t.replace(TITLE_SUFFIX, '')
  t = t.replace(/\s*[-–—]\s*(Private Browsing|InPrivate|Incognito)\s*$/i, '')
  t = t.trim()
  return t || prettyApp(app)
}

// ── Session merging ─────────────────────────────────────────────────────────────
interface MergedSession {
  id: string
  app: string
  category: AppCategory
  kind: Kind
  title: string
  domains: string[]
  start: number
  end: number
  duration: number
  events: ActivitySession[]
  isDistraction: boolean
  privacy?: ReturnType<typeof detectPrivacyMode>
}

function mergeSessions(events: ActivitySession[]): MergedSession[] {
  const GAP = 3 * 60 * 1000 // consecutive same-app activity within 3m is one session
  const asc = [...events].filter((e) => e.duration >= 3000).sort((a, b) => a.startTime - b.startTime)
  type Acc = Omit<MergedSession, 'title' | 'isDistraction' | 'kind'> & { distractMs: number }
  const groups: Acc[] = []
  for (const e of asc) {
    const last = groups[groups.length - 1]
    const dom = domainOf(e.url)
    if (last && last.app === e.app && e.startTime - last.end <= GAP) {
      last.events.push(e)
      last.end = e.endTime
      last.duration += e.duration
      if (e.isDistraction) last.distractMs += e.duration
      if (dom && !last.domains.includes(dom)) last.domains.push(dom)
      if (!last.privacy && e.privacy) last.privacy = e.privacy
    } else {
      groups.push({
        id: e.id, app: e.app, category: e.category, start: e.startTime, end: e.endTime,
        duration: e.duration, events: [e], domains: dom ? [dom] : [], distractMs: e.isDistraction ? e.duration : 0,
        privacy: e.privacy ?? detectPrivacyMode(e.app, e.title),
      })
    }
  }
  return groups.map((g) => {
    const longest = g.events.reduce((a, b) => (b.duration > a.duration ? b : a), g.events[0]!)
    return {
      ...g, kind: kindOf(g.app), title: cleanTitle(longest.app, longest.title),
      isDistraction: g.distractMs > g.duration / 2,
    }
  })
}

// ── Filters ─────────────────────────────────────────────────────────────────────
type PrimaryFilter = 'all' | 'app' | 'website' | 'search' | 'terminal' | 'files'
const PRIMARY: { id: PrimaryFilter; label: string; icon: React.ReactNode }[] = [
  { id: 'all', label: 'All activity', icon: <LayoutGrid size={12} /> },
  { id: 'app', label: 'Apps', icon: <AppWindow size={12} /> },
  { id: 'website', label: 'Websites', icon: <Globe size={12} /> },
  { id: 'search', label: 'Searches', icon: <Search size={12} /> },
  { id: 'terminal', label: 'Terminal', icon: <Terminal size={12} /> },
  { id: 'files', label: 'Files', icon: <FolderOpen size={12} /> },
]

type SearchItem = { ts: number; query: string; url?: string }
type FeedRow =
  | { type: 'session'; ts: number; s: MergedSession }
  | { type: 'search'; ts: number; q: SearchItem }

export default function Activity({ onChatWith }: { onChatWith?: (msg: string) => void }): React.ReactElement {
  const { colors } = useTheme()
  const [searches, setSearches] = useState<SearchItem[]>([])
  const [sessions, setSessions] = useState<ActivitySession[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<PrimaryFilter>('all')
  const [query, setQuery] = useState('')
  const [todayOnly, setTodayOnly] = useState(false)
  const [distractOnly, setDistractOnly] = useState(false)
  const [longOnly, setLongOnly] = useState(false)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

  const load = useCallback(() => {
    setLoading(true)
    api.getActivity(14)
      .then((d) => { setSearches(d.searches ?? []); setSessions(d.sessions ?? []) })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])
  useEffect(() => { load() }, [load])
  useEffect(() => { const off = api.onStoreRefresh?.(() => load()); return () => { off?.() } }, [load])

  const merged = useMemo(() => mergeSessions(sessions), [sessions])

  // Honest unit counts, each labelled with what it actually is.
  const stats = useMemo(() => {
    const events = sessions.filter((s) => s.duration >= 3000).length
    const apps = new Set(merged.map((m) => m.app)).size
    const sites = new Set(merged.filter((m) => m.kind === 'website').flatMap((m) => m.domains)).size
    return { events, apps, sites, searches: searches.length }
  }, [sessions, merged, searches])

  const kindCounts = useMemo(() => ({
    all: merged.length + searches.length,
    app: merged.filter((m) => m.kind === 'app').length,
    website: merged.filter((m) => m.kind === 'website').length,
    search: searches.length,
    terminal: merged.filter((m) => m.kind === 'terminal').length,
    files: merged.filter((m) => m.kind === 'files').length,
  }), [merged, searches])

  const rows = useMemo<FeedRow[]>(() => {
    const q = query.trim().toLowerCase()
    const todayStart = new Date().setHours(0, 0, 0, 0)
    const out: FeedRow[] = []
    const wantSessions = filter !== 'search'
    const wantSearches = filter === 'all' || filter === 'search'
    if (wantSessions) {
      for (const s of merged) {
        if (filter !== 'all' && s.kind !== filter) continue
        if (todayOnly && s.start < todayStart) continue
        if (distractOnly && !s.isDistraction) continue
        if (longOnly && s.duration < 60000) continue
        if (q && !s.title.toLowerCase().includes(q) && !s.app.toLowerCase().includes(q) && !s.domains.some((d) => d.includes(q))) continue
        out.push({ type: 'session', ts: s.start, s })
      }
    }
    if (wantSearches && !distractOnly) {
      for (const q2 of searches) {
        if (todayOnly && q2.ts < todayStart) continue
        if (q && !q2.query.toLowerCase().includes(q)) continue
        out.push({ type: 'search', ts: q2.ts, q: q2 })
      }
    }
    return out.sort((a, b) => b.ts - a.ts).slice(0, 800)
  }, [merged, searches, filter, query, todayOnly, distractOnly, longOnly])

  const groups = useMemo(() => {
    const out: { day: string; items: FeedRow[] }[] = []
    for (const it of rows) {
      const day = dayLabel(it.ts)
      const last = out[out.length - 1]
      if (last && last.day === day) last.items.push(it)
      else out.push({ day, items: [it] })
    }
    return out
  }, [rows])

  const toggleExpand = (id: string): void =>
    setExpanded((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n })

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex-shrink-0 px-5 pt-5 pb-3 max-w-4xl mx-auto w-full">
        <div className="flex items-center justify-between mb-2.5">
          <div className="flex items-center gap-2.5">
            <ActivityIcon size={16} style={{ color: colors.accent }} />
            <div>
              <h1 className="text-[14px] font-semibold" style={{ color: colors.textPrimary }}>Activity</h1>
              <p className="text-[9px] mt-0.5" style={{ color: colors.textMuted, fontFamily: '"Share Tech Mono", monospace' }}>
                {stats.events} events · {stats.apps} application{stats.apps !== 1 ? 's' : ''} · {stats.sites} website{stats.sites !== 1 ? 's' : ''} · {stats.searches} search{stats.searches !== 1 ? 'es' : ''} · last 14 days
              </p>
            </div>
          </div>
          <button onClick={load} className="p-1.5 rounded-lg" style={{ border: `1px solid ${colors.border}`, color: colors.textMuted }} title="Refresh">
            <RefreshCw size={13} />
          </button>
        </div>

        {/* Search */}
        <div className="flex items-center gap-2 px-3 py-2 rounded-xl mb-2" style={{ background: colors.inputBg, border: `1px solid ${colors.border}` }}>
          <Filter size={13} style={{ color: colors.textMuted, flexShrink: 0 }} />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search your activity…"
            className="flex-1 bg-transparent text-[12px] outline-none" style={{ color: colors.textPrimary, caretColor: colors.accent }} />
        </div>

        {/* Primary filters */}
        <div className="flex items-center gap-1 flex-wrap">
          {PRIMARY.map((f) => {
            const n = kindCounts[f.id]
            const active = filter === f.id
            return (
              <button key={f.id} onClick={() => setFilter(f.id)}
                className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-medium transition-colors"
                style={{
                  background: active ? colors.accentBg : 'transparent',
                  border: `1px solid ${active ? colors.borderMid : colors.border}`,
                  color: active ? colors.accent : colors.textMuted,
                }}>
                <span style={{ color: active ? colors.accent : colors.textDim }}>{f.icon}</span>
                {f.label}
                <span className="data-value" style={{ color: active ? colors.accent : colors.textDim, opacity: 0.75 }}>{n}</span>
              </button>
            )
          })}
        </div>

        {/* Secondary filter chips */}
        <div className="flex items-center gap-1.5 mt-2">
          {([
            ['Today', todayOnly, () => setTodayOnly((v) => !v)],
            ['Distractions', distractOnly, () => setDistractOnly((v) => !v)],
            ['≥ 1m', longOnly, () => setLongOnly((v) => !v)],
          ] as const).map(([label, on, fn]) => (
            <button key={label} onClick={fn}
              className="px-2 py-0.5 rounded-full text-[10px] transition-colors"
              style={{
                background: on ? colors.accentBg : 'transparent',
                border: `1px solid ${on ? colors.borderMid : colors.border}`,
                color: on ? colors.accent : colors.textMuted,
              }}>
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Feed */}
      <div className="flex-1 overflow-y-auto px-5 pb-6">
        <div className="max-w-4xl mx-auto">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <div className="w-5 h-5 rounded-full animate-spin" style={{ border: `2px solid ${colors.border}`, borderTopColor: colors.accent }} />
            </div>
          ) : rows.length === 0 ? (
            <p className="text-center text-[12px] py-12" style={{ color: colors.textMuted }}>
              {sessions.length === 0 && searches.length === 0 ? 'No activity recorded yet. Keep Attentify running and it fills in here.' : 'Nothing matches those filters.'}
            </p>
          ) : (
            groups.map((g) => (
              <div key={g.day} className="mb-4">
                <p className="text-[10px] font-semibold uppercase tracking-wide mb-1 sticky top-0 py-1 z-10" style={{ color: colors.textMuted, background: colors.mainBg, fontFamily: '"Share Tech Mono", monospace' }}>{g.day}</p>
                <div className="rounded-xl overflow-hidden" style={{ border: `1px solid ${colors.border}` }}>
                  {g.items.map((it, idx) => it.type === 'search' ? (
                    <SearchRow key={`s${idx}`} q={it.q} first={idx === 0} />
                  ) : (
                    <SessionRow key={it.s.id} s={it.s} first={idx === 0}
                      open={expanded.has(it.s.id)} onToggle={() => toggleExpand(it.s.id)} onChatWith={onChatWith} />
                  ))}
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  )
}

// ── One merged session row (activity is the headline; app/site is secondary) ──────
function SessionRow({ s, first, open, onToggle, onChatWith }: {
  s: MergedSession; first: boolean; open: boolean; onToggle: () => void; onChatWith?: (m: string) => void
}): React.ReactElement {
  const { colors } = useTheme()
  const multi = s.events.length > 1
  const domainStr = s.domains.length > 0 ? `${s.domains[0]}${s.domains.length > 1 ? ` +${s.domains.length - 1}` : ''}` : ''
  const secondaryParts = [
    domainStr,
    prettyApp(s.app),
    multi ? `${s.events.length} events` : '',
    s.privacy ? privacyLabel(s.privacy) : '',
  ].filter(Boolean)
  const accent = s.kind === 'website' ? colors.brand : s.kind === 'terminal' ? colors.positive : s.isDistraction ? colors.negative : colors.textMuted
  const icon = s.kind === 'website' ? <Globe size={13} /> : s.kind === 'terminal' ? <Terminal size={13} /> : s.kind === 'files' ? <FolderOpen size={13} /> : <AppWindow size={13} />

  return (
    <div style={{ borderTop: first ? 'none' : `1px solid ${colors.border}`, background: colors.cardBg }}>
      <button onClick={onToggle} className="w-full flex items-center gap-2.5 px-3 py-1.5 text-left transition-colors hover:opacity-90">
        {/* time (single column, not split across two lines) */}
        <span className="text-[10px] flex-shrink-0 data-value tabular-nums" style={{ color: colors.textDim, width: multi ? 84 : 46 }}>
          {multi ? `${fmtTime(s.start)}–${fmtTime(s.end)}` : fmtTime(s.start)}
        </span>
        <span className="flex-shrink-0" style={{ color: accent }}>{icon}</span>
        {/* activity title primary, app/domain secondary */}
        <div className="flex-1 min-w-0">
          <p className="text-[12px] truncate" style={{ color: colors.textPrimary }}>{s.title}</p>
          {secondaryParts.length > 0 && (
            <p className="text-[10px] truncate" style={{ color: colors.textMuted }}>{secondaryParts.join(' · ')}</p>
          )}
        </div>
        {s.privacy && (
          <span className="text-[8.5px] px-1.5 py-0.5 rounded flex-shrink-0" style={{ background: colors.warningBg, color: colors.warning }}>private</span>
        )}
        {/* duration, right-aligned for scanning */}
        <span className="text-[11px] flex-shrink-0 data-value tabular-nums text-right" style={{ color: s.isDistraction ? colors.negative : colors.textSecondary, width: 56 }}>{fmtDur(s.duration)}</span>
        {multi && <ChevronRight size={13} className="flex-shrink-0 transition-transform" style={{ color: colors.textDim, transform: open ? 'rotate(90deg)' : 'none' }} />}
        {!multi && <span style={{ width: 13 }} className="flex-shrink-0" />}
      </button>

      {/* Expanded raw events */}
      {open && multi && (
        <div className="px-3 pb-2" style={{ background: colors.inputBg }}>
          <div className="pl-[74px] pr-1 py-1 space-y-0.5">
            {s.events.map((e) => {
              const dom = domainOf(e.url)
              return (
                <div key={e.id} className="flex items-center gap-2 py-0.5">
                  <span className="text-[9px] flex-shrink-0 data-value tabular-nums" style={{ color: colors.textDim, width: 42 }}>{fmtTime(e.startTime)}</span>
                  <span className="text-[10.5px] flex-1 truncate" style={{ color: colors.textSecondary }}>{cleanTitle(e.app, e.title)}</span>
                  {dom && <span className="text-[9px] flex-shrink-0 truncate max-w-[120px]" style={{ color: colors.brand }}>{dom}</span>}
                  <span className="text-[9.5px] flex-shrink-0 data-value tabular-nums" style={{ color: colors.textMuted, width: 44, textAlign: 'right' }}>{fmtDur(e.duration)}</span>
                </div>
              )
            })}
            {onChatWith && (
              <button onClick={() => onChatWith(`On the Activity page I'm looking at a ${fmtDur(s.duration)} session in ${prettyApp(s.app)}${s.domains.length ? ` across ${s.domains.join(', ')}` : ''} ("${s.title}"). What was I doing and was it productive?`)}
                className="mt-1 flex items-center gap-1.5 text-[10px] transition-opacity hover:opacity-80" style={{ color: colors.accent }}>
                <MessageSquare size={10} /> Ask AI about this session
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

// ── One search row ────────────────────────────────────────────────────────────
function SearchRow({ q, first }: { q: SearchItem; first: boolean }): React.ReactElement {
  const { colors } = useTheme()
  const dom = domainOf(q.url)
  return (
    <div className="flex items-center gap-2.5 px-3 py-1.5" style={{ borderTop: first ? 'none' : `1px solid ${colors.border}`, background: colors.cardBg }}>
      <span className="text-[10px] flex-shrink-0 data-value tabular-nums" style={{ color: colors.textDim, width: 46 }}>{fmtTime(q.ts)}</span>
      <span className="flex-shrink-0" style={{ color: colors.accent }}><Search size={13} /></span>
      <div className="flex-1 min-w-0">
        <p className="text-[12px] truncate" style={{ color: colors.textPrimary }}>{q.query}</p>
        <p className="text-[10px] truncate" style={{ color: colors.textMuted }}>Search{dom ? ` · ${dom}` : ''}</p>
      </div>
      {q.url && (
        <button onClick={() => api.openExternal?.(q.url!)} className="flex-shrink-0 p-1 opacity-50 hover:opacity-100" style={{ color: colors.textMuted }} title="Open">
          <ExternalLink size={11} />
        </button>
      )}
    </div>
  )
}

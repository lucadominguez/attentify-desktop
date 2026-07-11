import React, { useState, useEffect, useCallback } from 'react'
import {
  Shield, Lock, Activity, RefreshCw, Key, X, Eye, EyeOff,
  MessageSquare, AlertTriangle, ChevronRight, ScanLine, BarChart2, Clock,
} from 'lucide-react'
import type { AppStore, ScanResult, ViewName, HeuristicAlert } from '@shared/types'
import { useTheme } from '../context/ThemeContext'

const api = (window as unknown as { electronAPI: Window['electronAPI'] }).electronAPI

interface HomeProps {
  store: AppStore
  onNavigate: (view: ViewName) => void
  onScanComplete: (results: ScanResult) => void
  onRefresh: () => void
  latestAlert?: HeuristicAlert | null
  onChatWith?: (msg: string) => void
}

interface TodayStats {
  focusScore: number
  focusedTime: number
  distractedTime: number
  blockEvents: number
  switchRate: number
  topDrains: { app: string; ms: number }[]
}

// Below this much tracked time, a "focus score" is statistical noise — we show a
// "keep tracking" state instead of a falsely precise number.
const MIN_TRACKED_MS = 10 * 60 * 1000

function fmtMs(ms: number): string {
  const h = Math.floor(ms / 3600000)
  const m = Math.floor((ms % 3600000) / 60000)
  if (h > 0 && m > 0) return `${h}h ${m}m`
  if (h > 0) return `${h}h`
  if (m > 0) return `${m}m`
  return '0m'
}

// ── Focus score ring ────────────────────────────────────────────────────────────
function ScoreRing({ score, color, size = 96 }: { score: number; color: string; size?: number }): React.ReactElement {
  const { colors } = useTheme()
  const stroke = 8
  const r = (size - stroke) / 2
  const circ = 2 * Math.PI * r
  const off = circ * (1 - score / 100)
  return (
    <svg width={size} height={size} style={{ flexShrink: 0 }}>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={colors.border} strokeWidth={stroke} />
      <circle
        cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={stroke}
        strokeDasharray={circ} strokeDashoffset={off} strokeLinecap="round"
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
        style={{ transition: 'stroke-dashoffset 0.7s ease' }}
      />
      <text x="50%" y="48%" textAnchor="middle" dominantBaseline="middle" className="data-value" style={{ fontSize: 26, fontWeight: 700, fill: color }}>{score}</text>
      <text x="50%" y="66%" textAnchor="middle" dominantBaseline="middle" style={{ fontSize: 9, fill: colors.textMuted, letterSpacing: '0.08em' }}>SCORE</text>
    </svg>
  )
}

export default function Home({ store, onNavigate, onScanComplete, onRefresh, latestAlert, onChatWith }: HomeProps): React.ReactElement {
  const { colors } = useTheme()
  const [stats, setStats] = useState<TodayStats | null>(null)
  const [hasApiKey, setHasApiKey] = useState<boolean | null>(null)
  const [showApiKeyModal, setShowApiKeyModal] = useState(false)
  const [relaunching, setRelaunching] = useState(false)
  const [scanning, setScanning] = useState(false)

  const activeSession = store.sessions.find((s) => s.active)
  const isProtected = store.elevation === 'full'

  const loadStats = useCallback(() => {
    api.getAnalytics().then((data) => {
      const sessions = data.recentSessions ?? []
      const cutoff = Date.now() - 8 * 3600000
      const today = sessions.filter((s) => s.startTime > cutoff)
      const totalMs = today.reduce((s, r) => s + r.duration, 0)
      const hours = totalMs / 3600000
      const rate = hours > 0.05 ? Math.round(today.length / hours) : 0
      const byApp = new Map<string, number>()
      for (const s of sessions.filter((s) => s.isDistraction))
        byApp.set(s.app, (byApp.get(s.app) ?? 0) + s.duration)
      const topDrains = [...byApp.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([app, ms]) => ({ app, ms }))
      setStats({
        focusScore: data.today.focusScore,
        focusedTime: data.today.focusedTime,
        distractedTime: data.today.distractedTime,
        blockEvents: data.today.blockEvents,
        switchRate: rate,
        topDrains,
      })
    }).catch(() => {})
  }, [])

  useEffect(() => { loadStats() }, [loadStats])
  useEffect(() => {
    const off = api.onStoreRefresh?.(() => loadStats())
    return () => { off?.() }
  }, [loadStats])
  useEffect(() => {
    api.getApiKeyStatus().then(({ hasKey }) => setHasApiKey(hasKey)).catch(() => setHasApiKey(false))
  }, [])

  const trackedMs = (stats?.focusedTime ?? 0) + (stats?.distractedTime ?? 0)
  const hasData = trackedMs >= MIN_TRACKED_MS
  const score = Math.round(stats?.focusScore ?? 0)
  const scoreColor = score >= 70 ? colors.positive : score >= 40 ? colors.warning : colors.negative
  const focusedPct = trackedMs > 0 ? Math.round(((stats?.focusedTime ?? 0) / trackedMs) * 100) : 0

  const handleRescan = async (): Promise<void> => {
    setScanning(true)
    try { const results = await api.runScan(); onScanComplete(results) } catch { /* ignore */ }
    setScanning(false)
  }

  const today = new Date().toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' })

  // ── KPI card ──────────────────────────────────────────────────────────────────
  const Kpi = ({ label, value, sub, color }: { label: string; value: string; sub?: string; color?: string }): React.ReactElement => (
    <div className="rounded-xl p-3.5" style={{ background: colors.cardBg, border: `1px solid ${colors.border}` }}>
      <p className="text-[11px]" style={{ color: colors.textMuted }}>{label}</p>
      <p className="text-[20px] font-semibold leading-tight mt-1 data-value truncate" title={value} style={{ color: color ?? colors.textPrimary }}>{value}</p>
      {sub && <p className="text-[10px] mt-0.5" style={{ color: colors.textDim }}>{sub}</p>}
    </div>
  )

  return (
    <div className="h-full overflow-y-auto">
      {showApiKeyModal && (
        <ApiKeyModal
          onSave={async (key) => { await api.setApiKey(key); setHasApiKey(true); setShowApiKeyModal(false) }}
          onClose={() => setShowApiKeyModal(false)}
        />
      )}

      <div className="max-w-4xl mx-auto px-6 py-6 flex flex-col gap-5">
        {/* Header */}
        <div className="flex items-end justify-between gap-4">
          <div>
            <h1 className="text-[19px] font-semibold" style={{ color: colors.textPrimary }}>Dashboard</h1>
            <p className="text-[12px] mt-0.5" style={{ color: colors.textMuted }}>{today}</p>
          </div>
          <div className="flex items-center gap-2">
            <div
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-medium"
              style={{
                background: isProtected ? colors.positiveBg : 'transparent',
                border: `1px solid ${isProtected ? 'rgba(52,211,153,0.3)' : colors.border}`,
                color: isProtected ? colors.positive : colors.textMuted,
              }}
              title={isProtected ? 'Full protection active' : 'Limited — admin rights needed'}
            >
              <Shield size={12} /> {isProtected ? 'Protected' : 'Limited'}
            </div>
            <button onClick={loadStats} className="p-1.5 rounded-lg transition-colors" style={{ border: `1px solid ${colors.border}`, color: colors.textMuted }} title="Refresh">
              <RefreshCw size={13} />
            </button>
          </div>
        </div>

        {/* Soft-mode banner */}
        {(store.elevation === 'soft' || store.elevation === 'unknown') && (
          <div className="flex items-center justify-between gap-3 px-4 py-2.5 rounded-xl" style={{ background: colors.warningBg, border: '1px solid rgba(251,191,36,0.25)' }}>
            <div className="flex items-center gap-2 min-w-0">
              <Activity size={14} style={{ color: colors.warning, flexShrink: 0 }} />
              <span className="text-[12px]" style={{ color: colors.textSecondary }}>Site blocking is off — it needs administrator rights.</span>
            </div>
            <button
              onClick={async () => { setRelaunching(true); try { await api.relaunchAsAdmin() } catch { setRelaunching(false) } }}
              disabled={relaunching}
              className="flex-shrink-0 flex items-center gap-1.5 px-3 py-1.5 text-[12px] font-medium rounded-lg transition-all disabled:opacity-60"
              style={{ background: colors.accentBg, color: colors.accent, border: `1px solid ${colors.borderMid}` }}
            >
              {relaunching ? <><RefreshCw size={12} className="animate-spin" /> Relaunching…</> : <><Shield size={12} /> Enable</>}
            </button>
          </div>
        )}

        {/* Focus panel */}
        <div className="rounded-2xl p-5" style={{ background: colors.cardBg, border: `1px solid ${colors.border}` }}>
          {hasData ? (
            <div className="flex items-center gap-6">
              <ScoreRing score={score} color={scoreColor} />
              <div className="flex-1 min-w-0">
                <p className="text-[13px] leading-relaxed mb-3" style={{ color: colors.textSecondary }}>
                  {score >= 70 ? `Strong focus — ${fmtMs(stats!.focusedTime)} of deep work across ${fmtMs(trackedMs)} tracked today.`
                    : score >= 40 ? `Mixed focus — ${fmtMs(stats!.focusedTime)} focused, ${fmtMs(stats!.distractedTime)} lost to distractions.`
                    : `Fragmented — only ${fmtMs(stats!.focusedTime)} focused out of ${fmtMs(trackedMs)} tracked.`}
                </p>
                {/* focused vs distracted split */}
                <div className="h-2.5 rounded-full overflow-hidden flex" style={{ background: colors.negative }}>
                  <div style={{ width: `${focusedPct}%`, background: colors.positive, transition: 'width 0.6s ease' }} />
                </div>
                <div className="flex items-center gap-4 mt-2">
                  <span className="flex items-center gap-1.5 text-[11px]" style={{ color: colors.textMuted }}>
                    <span className="w-2 h-2 rounded-sm" style={{ background: colors.positive }} /> Focused {fmtMs(stats!.focusedTime)}
                  </span>
                  <span className="flex items-center gap-1.5 text-[11px]" style={{ color: colors.textMuted }}>
                    <span className="w-2 h-2 rounded-sm" style={{ background: colors.negative }} /> Distracted {fmtMs(stats!.distractedTime)}
                  </span>
                </div>
              </div>
            </div>
          ) : (
            <div className="flex items-center gap-4">
              <div className="w-14 h-14 rounded-2xl flex items-center justify-center flex-shrink-0" style={{ background: colors.accentBg, border: `1px solid ${colors.border}` }}>
                <Activity size={24} style={{ color: colors.accent }} />
              </div>
              <div>
                <p className="text-[15px] font-medium" style={{ color: colors.textPrimary }}>Building your picture</p>
                <p className="text-[12px] mt-0.5" style={{ color: colors.textMuted }}>Your focus score appears after about 10 minutes of tracked activity.</p>
              </div>
            </div>
          )}
        </div>

        {/* KPI row */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <Kpi label="Focused" value={fmtMs(stats?.focusedTime ?? 0)} sub={hasData ? `of ${fmtMs(trackedMs)}` : 'today'} color={colors.positive} />
          <Kpi label="Distracted" value={fmtMs(stats?.distractedTime ?? 0)} sub="today" color={(stats?.distractedTime ?? 0) > 0 ? colors.negative : colors.textMuted} />
          <Kpi label="Switches / hr" value={hasData && stats ? `${stats.switchRate}` : '—'} sub={hasData ? (stats!.switchRate < 20 ? 'steady' : 'fragmented') : 'today'} color={!hasData ? colors.textMuted : stats!.switchRate < 20 ? colors.positive : stats!.switchRate < 60 ? colors.warning : colors.negative} />
          <Kpi label="Blocked" value={`${stats?.blockEvents ?? store.blockEventCount ?? 0}`} sub="attempts today" color={colors.accent} />
        </div>

        {/* Top drains + Latest alert */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="rounded-xl p-4" style={{ background: colors.cardBg, border: `1px solid ${colors.border}` }}>
            <p className="text-[11px] font-medium mb-2.5" style={{ color: colors.textMuted }}>Top distractions today</p>
            {stats && stats.topDrains.length > 0 ? (
              <div className="space-y-2">
                {stats.topDrains.map((d) => {
                  const max = stats.topDrains[0]!.ms || 1
                  return (
                    <div key={d.app} className="flex items-center gap-2.5">
                      <span className="text-[12px] w-28 truncate" style={{ color: colors.textSecondary }}>{d.app}</span>
                      <div className="flex-1 h-2 rounded-full overflow-hidden" style={{ background: colors.border }}>
                        <div className="h-full rounded-full" style={{ width: `${(d.ms / max) * 100}%`, background: colors.negative, opacity: 0.85 }} />
                      </div>
                      <span className="text-[11px] w-12 text-right data-value" style={{ color: colors.textPrimary }}>{fmtMs(d.ms)}</span>
                    </div>
                  )
                })}
              </div>
            ) : (
              <p className="text-[12px]" style={{ color: colors.textDim }}>No distractions detected yet — nice.</p>
            )}
          </div>

          {latestAlert && !latestAlert.dismissed ? (
            <div className="rounded-xl p-4 flex flex-col" style={{ background: colors.warningBg, border: '1px solid rgba(251,191,36,0.25)' }}>
              <div className="flex items-start gap-2.5">
                <AlertTriangle size={15} style={{ color: colors.warning, flexShrink: 0, marginTop: 1 }} />
                <div className="min-w-0">
                  <p className="text-[12px] font-medium" style={{ color: colors.textPrimary }}>{latestAlert.title}</p>
                  <p className="text-[11px] mt-0.5 leading-relaxed" style={{ color: colors.textMuted }}>{latestAlert.description}</p>
                </div>
              </div>
              {onChatWith && (
                <button
                  onClick={() => onChatWith(`About the "${latestAlert.title}" pattern — ${latestAlert.description}. What should I do?`)}
                  className="mt-auto pt-2 flex items-center gap-1.5 text-[11px] font-medium self-start" style={{ color: colors.accent }}
                >
                  <MessageSquare size={12} /> Ask Attentify
                </button>
              )}
            </div>
          ) : (
            <div className="rounded-xl p-4" style={{ background: colors.cardBg, border: `1px solid ${colors.border}` }}>
              <p className="text-[11px] font-medium mb-2.5" style={{ color: colors.textMuted }}>Attention</p>
              <p className="text-[12px]" style={{ color: colors.textDim }}>No attention alerts right now. Keep it up.</p>
            </div>
          )}
        </div>

        {/* Quick actions */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
          <QuickAction icon={<Lock size={15} />} label={activeSession ? 'Session running' : 'Deep Focus'} onClick={() => onNavigate('deep-focus')} />
          <QuickAction icon={<MessageSquare size={15} />} label="Ask Attentify" onClick={() => onNavigate('home')} />
          <QuickAction icon={<BarChart2 size={15} />} label="Analytics" onClick={() => onNavigate('analytics')} />
          <QuickAction icon={<Clock size={15} />} label="Timesheets" onClick={() => onNavigate('timesheets')} />
        </div>

        {/* Secondary: scan + API key */}
        <div className="flex flex-wrap items-center gap-2.5">
          <button
            onClick={() => { if (!scanning) void handleRescan() }}
            className="flex items-center gap-1.5 px-3 py-1.5 text-[12px] rounded-lg transition-colors"
            style={{ background: colors.cardBg, border: `1px solid ${colors.border}`, color: colors.textSecondary }}
          >
            {scanning ? <><RefreshCw size={12} className="animate-spin" /> Scanning…</> : <><ScanLine size={12} /> Run a device scan</>}
          </button>
          {hasApiKey === false && (
            <button
              onClick={() => setShowApiKeyModal(true)}
              className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-[12px] transition-colors"
              style={{ background: colors.accentBg, border: `1px solid ${colors.border}`, color: colors.textSecondary }}
            >
              <Key size={12} style={{ color: colors.accent }} /> Add your own AI key
              <ChevronRight size={12} style={{ color: colors.textMuted }} />
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Quick action ────────────────────────────────────────────────────────────────
function QuickAction({ icon, label, onClick }: { icon: React.ReactNode; label: string; onClick: () => void }): React.ReactElement {
  const { colors } = useTheme()
  return (
    <button
      onClick={onClick}
      className="flex items-center gap-2.5 px-3.5 py-3 rounded-xl text-left transition-all hover:brightness-110"
      style={{ background: colors.cardBg, border: `1px solid ${colors.border}` }}
    >
      <span style={{ color: colors.accent }}>{icon}</span>
      <span className="text-[12.5px] font-medium truncate" style={{ color: colors.textPrimary }}>{label}</span>
    </button>
  )
}

// ── API Key Modal ─────────────────────────────────────────────────────────────
function ApiKeyModal({ onSave, onClose }: { onSave: (key: string) => Promise<void>; onClose: () => void }): React.ReactElement {
  const [key, setKey] = useState('')
  const [show, setShow] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const { colors } = useTheme()

  const handleSave = async (): Promise<void> => {
    const trimmed = key.trim()
    if (!trimmed.startsWith('sk-ant-') && !trimmed.startsWith('sk-or-')) {
      setError('Key must start with sk-ant- (Anthropic) or sk-or- (OpenRouter)')
      return
    }
    setSaving(true)
    try { await onSave(key.trim()) } catch { setError('Failed to save key'); setSaving(false) }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)' }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="w-full max-w-md mx-4 p-6 relative rounded-2xl" style={{ background: colors.cardBg, border: `1px solid ${colors.borderMid}` }}>
        <button onClick={onClose} className="absolute top-4 right-4 opacity-50 hover:opacity-100" style={{ color: colors.textMuted }}>
          <X size={16} />
        </button>
        <div className="flex items-center gap-3 mb-4">
          <div className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0" style={{ background: colors.accentBg, border: `1px solid ${colors.border}` }}>
            <Key size={16} style={{ color: colors.accent }} />
          </div>
          <div>
            <p className="text-[14px] font-semibold" style={{ color: colors.textPrimary }}>Add your API key</p>
            <p className="text-[12px]" style={{ color: colors.textMuted }}>Anthropic or OpenRouter</p>
          </div>
        </div>
        <p className="text-[12px] mb-4 leading-relaxed" style={{ color: colors.textSecondary }}>
          Your key is encrypted on this device and never leaves your machine. Get an Anthropic key at{' '}
          <span style={{ color: colors.accent }}>console.anthropic.com</span>, or an OpenRouter key at{' '}
          <span style={{ color: colors.accent }}>openrouter.ai/keys</span>.
        </p>
        <div className="flex items-center gap-2 px-3 py-2.5 mb-1 rounded-lg" style={{ background: colors.inputBg, border: `1px solid ${colors.border}` }}>
          <input
            type={show ? 'text' : 'password'}
            placeholder="sk-ant-api03-… or sk-or-v1-…"
            value={key}
            onChange={(e) => { setKey(e.target.value); setError('') }}
            onKeyDown={(e) => { if (e.key === 'Enter') handleSave() }}
            className="flex-1 bg-transparent text-[13px] outline-none"
            style={{ color: colors.textPrimary, caretColor: colors.accent, fontFamily: 'monospace' }}
            autoFocus
          />
          <button onClick={() => setShow((v) => !v)} className="opacity-50 hover:opacity-100 flex-shrink-0" style={{ color: colors.textMuted }}>
            {show ? <EyeOff size={13} /> : <Eye size={13} />}
          </button>
        </div>
        {error && <p className="text-[11px] mb-2" style={{ color: colors.negative }}>{error}</p>}
        <button
          onClick={handleSave}
          disabled={!key.trim() || saving}
          className="w-full py-2.5 mt-3 text-[13px] font-medium rounded-lg transition-all disabled:opacity-40"
          style={{ background: colors.accentBg, border: `1px solid ${colors.borderMid}`, color: colors.accent }}
        >
          {saving ? 'Saving…' : 'Save & activate'}
        </button>
      </div>
    </div>
  )
}

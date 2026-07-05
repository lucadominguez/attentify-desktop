import React, { useState, useEffect, useCallback } from 'react'
import {
  Shield, Lock, Activity, Zap, RefreshCw, Key, X, Eye, EyeOff,
  MessageSquare, TrendingDown, AlertTriangle, ChevronRight, ScanLine,
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
  topDistractor: string | null
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

function greeting(): string {
  const h = new Date().getHours()
  if (h < 5) return 'Still up'
  if (h < 12) return 'Good morning'
  if (h < 18) return 'Good afternoon'
  return 'Good evening'
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
      const top = [...byApp.entries()].sort((a, b) => b[1] - a[1])[0]
      setStats({
        focusScore: data.today.focusScore,
        focusedTime: data.today.focusedTime,
        distractedTime: data.today.distractedTime,
        blockEvents: data.today.blockEvents,
        switchRate: rate,
        topDistractor: top?.[0] ?? null,
      })
    }).catch(() => {})
  }, [])

  useEffect(() => { loadStats() }, [loadStats])
  useEffect(() => {
    api.getApiKeyStatus().then(({ hasKey }) => setHasApiKey(hasKey)).catch(() => setHasApiKey(false))
  }, [])

  const trackedMs = (stats?.focusedTime ?? 0) + (stats?.distractedTime ?? 0)
  const hasData = trackedMs >= MIN_TRACKED_MS
  const score = Math.round(stats?.focusScore ?? 0)
  const scoreColor = score >= 70 ? '#4caf50' : score >= 40 ? '#ffb800' : '#ef5350'

  const handleRescan = async (): Promise<void> => {
    setScanning(true)
    try {
      const results = await api.runScan()
      onScanComplete(results)
    } catch { /* ignore */ }
    setScanning(false)
  }

  // Calm status pill — icon + value + label in a rounded container. Reused as the
  // dashboard's stat row (the component the onboarding "capability" chips inspired).
  const StatPill = ({ icon, value, label, color, sub }: {
    icon: React.ReactNode; value: string; label: string; color?: string; sub?: string
  }): React.ReactElement => (
    <div
      className="flex flex-col gap-1.5 p-3.5 rounded-xl"
      style={{ background: colors.cardBg, border: `1px solid ${colors.border}` }}
    >
      <div className="flex items-center gap-1.5" style={{ color: colors.textMuted }}>
        {icon}
        <span className="text-[11px] font-medium">{label}</span>
      </div>
      <span className="text-[22px] font-semibold leading-none data-value truncate" title={value} style={{ color: color ?? colors.textPrimary }}>
        {value}
      </span>
      {sub && <span className="text-[11px]" style={{ color: colors.textMuted }}>{sub}</span>}
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

      <div className="max-w-3xl mx-auto px-6 py-6 flex flex-col gap-5">

        {/* ── Header ─────────────────────────────────────────────────────── */}
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-[22px] font-semibold" style={{ color: colors.textPrimary }}>
              {greeting()}
            </h1>
            <p className="text-[13px] mt-1" style={{ color: colors.textMuted }}>
              {activeSession
                ? `You're in a ${activeSession.mode} focus session.`
                : hasData
                  ? "Here's how your attention is holding up today."
                  : "Tracking your focus — insights build up as you work."}
            </p>
          </div>
          {/* Passive protection status */}
          <div
            className="flex items-center gap-2 px-3 py-1.5 rounded-full text-[12px] font-medium flex-shrink-0"
            style={{
              background: isProtected ? 'rgba(76,175,80,0.1)' : 'transparent',
              border: `1px solid ${isProtected ? 'rgba(76,175,80,0.25)' : colors.border}`,
              color: isProtected ? '#4caf50' : colors.textMuted,
            }}
            title={isProtected ? 'Full protection active' : 'Limited protection — admin rights needed'}
          >
            <Shield size={13} />
            {isProtected ? 'Protected' : 'Limited'}
          </div>
        </div>

        {/* ── Soft-mode banner ───────────────────────────────────────────── */}
        {(store.elevation === 'soft' || store.elevation === 'unknown') && (
          <div
            className="flex items-center justify-between gap-3 px-4 py-2.5 rounded-xl"
            style={{ background: 'rgba(255,184,0,0.06)', border: '1px solid rgba(255,184,0,0.2)' }}
          >
            <div className="flex items-center gap-2 min-w-0">
              <Activity size={14} style={{ color: '#ffb800', flexShrink: 0 }} />
              <span className="text-[12px]" style={{ color: colors.textSecondary }}>
                Site blocking is off — it needs administrator rights.
              </span>
            </div>
            <button
              onClick={async () => { setRelaunching(true); try { await api.relaunchAsAdmin() } catch { setRelaunching(false) } }}
              disabled={relaunching}
              className="flex-shrink-0 flex items-center gap-1.5 px-3 py-1.5 text-[12px] font-medium rounded-lg transition-all disabled:opacity-60"
              style={{ background: colors.accentBg, color: colors.accent, border: `1px solid ${colors.border}` }}
            >
              {relaunching ? <><RefreshCw size={12} className="animate-spin" /> Relaunching…</> : <><Shield size={12} /> Enable</>}
            </button>
          </div>
        )}

        {/* ── Focal element: today's Focus Score ─────────────────────────── */}
        <div
          className="rounded-2xl p-6 flex items-center gap-6"
          style={{ background: colors.cardBg, border: `1px solid ${colors.border}` }}
        >
          {hasData ? (
            <>
              <div className="flex flex-col items-center justify-center flex-shrink-0" style={{ minWidth: 120 }}>
                <span className="text-[56px] font-bold leading-none data-value" style={{ color: scoreColor }}>{score}</span>
                <span className="text-[12px] mt-1" style={{ color: colors.textMuted }}>Focus score</span>
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-[14px] leading-relaxed" style={{ color: colors.textSecondary }}>
                  {score >= 70
                    ? `Strong focus today — ${fmtMs(stats!.focusedTime)} of deep work across ${fmtMs(trackedMs)} tracked.`
                    : score >= 40
                      ? `Mixed focus — ${fmtMs(stats!.focusedTime)} focused, but ${fmtMs(stats!.distractedTime)} lost to distractions.`
                      : `Attention is fragmented — only ${fmtMs(stats!.focusedTime)} focused out of ${fmtMs(trackedMs)} tracked.`}
                </p>
                <div className="mt-3 h-2 rounded-full overflow-hidden" style={{ background: colors.border }}>
                  <div className="h-full rounded-full" style={{ width: `${score}%`, background: scoreColor, transition: 'width 0.6s ease' }} />
                </div>
              </div>
            </>
          ) : (
            <div className="flex items-center gap-4 w-full">
              <div
                className="w-14 h-14 rounded-2xl flex items-center justify-center flex-shrink-0"
                style={{ background: colors.accentBg, border: `1px solid ${colors.border}` }}
              >
                <Activity size={24} style={{ color: colors.accent }} />
              </div>
              <div>
                <p className="text-[15px] font-medium" style={{ color: colors.textPrimary }}>Not enough data yet</p>
                <p className="text-[13px] mt-0.5" style={{ color: colors.textMuted }}>
                  Keep working with Attentify running — your focus score appears after about 10 minutes of activity.
                </p>
              </div>
            </div>
          )}
        </div>

        {/* ── Stat row ───────────────────────────────────────────────────── */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <StatPill
            icon={<Zap size={13} />}
            label="Focused"
            value={fmtMs(stats?.focusedTime ?? 0)}
            color="#4caf50"
            sub={hasData ? `of ${fmtMs(trackedMs)} tracked` : 'today'}
          />
          <StatPill
            icon={<Activity size={13} />}
            label="Switches"
            value={hasData && stats ? `${stats.switchRate}/h` : '—'}
            color={!hasData ? colors.textMuted : (stats!.switchRate < 20 ? '#4caf50' : stats!.switchRate < 60 ? '#ffb800' : '#ef5350')}
            sub={hasData ? (stats!.switchRate < 20 ? 'steady' : 'fragmented') : 'today'}
          />
          <StatPill
            icon={<Shield size={13} />}
            label="Blocked"
            value={`${stats?.blockEvents ?? store.blockEventCount ?? 0}`}
            color={colors.accent}
            sub="attempts today"
          />
          <StatPill
            icon={<TrendingDown size={13} />}
            label="Top drain"
            value={stats?.topDistractor ?? '—'}
            color={stats?.topDistractor ? '#ef5350' : colors.textMuted}
            sub={stats?.topDistractor ? 'most time lost' : 'none detected'}
          />
        </div>

        {/* ── Latest attention alert ─────────────────────────────────────── */}
        {latestAlert && !latestAlert.dismissed && (
          <div
            className="rounded-xl p-4 flex items-start gap-3"
            style={{ background: 'rgba(255,184,0,0.06)', border: '1px solid rgba(255,184,0,0.2)' }}
          >
            <AlertTriangle size={16} style={{ color: '#ffb800', flexShrink: 0, marginTop: 2 }} />
            <div className="flex-1 min-w-0">
              <p className="text-[13px] font-medium" style={{ color: colors.textPrimary }}>{latestAlert.title}</p>
              <p className="text-[12px] mt-0.5 leading-relaxed" style={{ color: colors.textMuted }}>{latestAlert.description}</p>
              {onChatWith && (
                <button
                  onClick={() => onChatWith(`About the "${latestAlert.title}" pattern — ${latestAlert.description}. What should I do?`)}
                  className="mt-2 flex items-center gap-1.5 text-[12px] font-medium transition-colors hover:opacity-80"
                  style={{ color: colors.accent }}
                >
                  <MessageSquare size={12} /> Ask Attentify about this
                </button>
              )}
            </div>
          </div>
        )}

        {/* ── Quick actions ──────────────────────────────────────────────── */}
        <div>
          <p className="text-[11px] font-medium mb-2" style={{ color: colors.textMuted }}>Quick actions</p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <ActionCard
              icon={<Lock size={16} />}
              title={activeSession ? 'Focus session running' : 'Enter Deep Focus'}
              desc={activeSession ? 'Lock is active' : 'Block everything for a set time'}
              accent={colors.accent}
              onClick={() => onNavigate('deep-focus')}
            />
            <ActionCard
              icon={<MessageSquare size={16} />}
              title="Ask Attentify"
              desc="Block a site, start a session, or ask about your focus"
              accent={colors.accent}
              onClick={() => onChatWith?.('')}
            />
            <ActionCard
              icon={scanning ? <RefreshCw size={16} className="animate-spin" /> : <ScanLine size={16} />}
              title={scanning ? 'Scanning…' : 'Run a scan'}
              desc="Check this device for new attention leaks"
              accent={colors.accent}
              onClick={() => { if (!scanning) void handleRescan() }}
            />
          </div>
        </div>

        {/* ── API key hint ───────────────────────────────────────────────── */}
        {hasApiKey === false && (
          <button
            onClick={() => setShowApiKeyModal(true)}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-left transition-colors hover:brightness-110"
            style={{ background: colors.accentBg, border: `1px solid ${colors.border}` }}
          >
            <Key size={13} style={{ color: colors.accent, flexShrink: 0 }} />
            <span className="text-[12px]" style={{ color: colors.textSecondary }}>
              Using included free AI — add your own key for unlimited use
            </span>
            <ChevronRight size={13} style={{ color: colors.textMuted, marginLeft: 'auto' }} />
          </button>
        )}
      </div>
    </div>
  )
}

// ── Action card ───────────────────────────────────────────────────────────────
function ActionCard({ icon, title, desc, accent, onClick }: {
  icon: React.ReactNode; title: string; desc: string; accent: string; onClick: () => void
}): React.ReactElement {
  const { colors } = useTheme()
  return (
    <button
      onClick={onClick}
      className="flex flex-col gap-2 p-4 rounded-xl text-left transition-all hover:brightness-110"
      style={{ background: colors.cardBg, border: `1px solid ${colors.border}` }}
    >
      <span style={{ color: accent }}>{icon}</span>
      <span className="text-[13px] font-medium" style={{ color: colors.textPrimary }}>{title}</span>
      <span className="text-[11px] leading-snug" style={{ color: colors.textMuted }}>{desc}</span>
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
        {error && <p className="text-[11px] mb-2" style={{ color: '#ef5350' }}>{error}</p>}
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

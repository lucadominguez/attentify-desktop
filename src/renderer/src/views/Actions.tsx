import React, { useState, useEffect, useCallback } from 'react'
import { Shield, AlertTriangle, CheckCircle, XCircle, Clock, Zap, Search, Eye, RefreshCw, ChevronDown, ChevronUp } from 'lucide-react'
import { useTheme } from '../context/ThemeContext'

const api = (window as unknown as { electronAPI: Window['electronAPI'] }).electronAPI

interface Inference {
  id: string
  type: 'domain' | 'app'
  value: string
  confidence: number
  reasoning?: string
  evidence?: { source?: string }
  status: 'pending' | 'confirmed' | 'rejected' | 'auto_applied'
  action?: 'auto_block' | 'suggest' | 'ignore'
  created_at: number
  resolved_at?: number
}

interface LiveEvent {
  id: string
  kind: 'auto_block' | 'guard_alert' | 'search_alert'
  domain: string
  category?: string
  confidence?: number
  message?: string
  searchQuery?: string
  ts: number
}

interface ActionsProps {
  onChatWith?: (msg: string) => void
  liveAutoBlocks?: { domain: string; confidence: number; ts: number }[]
}

function timeAgo(ts: number): string {
  const s = Math.floor((Date.now() - ts) / 1000)
  if (s < 60) return `${s}s ago`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

function ConfidenceBar({ value }: { value: number }): React.ReactElement {
  const pct = Math.round(value * 100)
  const color = pct >= 85 ? '#f87171' : pct >= 65 ? '#fbbf24' : '#6366f1'
  return (
    <div className="flex items-center gap-1.5">
      <div className="flex-1 h-1" style={{ background: 'rgba(255,255,255,0.06)', borderRadius: 1 }}>
        <div style={{ width: `${pct}%`, height: '100%', background: color, borderRadius: 1, transition: 'width 0.4s ease' }} />
      </div>
      <span className="text-[9px] font-bold" style={{ color, fontFamily: '"Share Tech Mono", monospace', minWidth: 26 }}>
        {pct}%
      </span>
    </div>
  )
}

function SourceBadge({ source }: { source?: string }): React.ReactElement | null {
  if (!source) return null
  const map: Record<string, { label: string; color: string }> = {
    url_visit: { label: 'URL', color: '#6366f1' },
    search_prediction: { label: 'SEARCH', color: '#fbbf24' },
    ai_url: { label: 'AI', color: '#a78bfa' },
    sweep: { label: 'SWEEP', color: '#818cf8' },
    session: { label: 'SESSION', color: '#81c784' },
  }
  const m = Object.entries(map).find(([k]) => source.includes(k))
  if (!m) return null
  return (
    <span
      className="text-[8px] font-bold uppercase tracking-widest px-1 py-0.5"
      style={{
        color: m[1].color,
        background: `${m[1].color}18`,
        border: `1px solid ${m[1].color}30`,
        fontFamily: '"Share Tech Mono", monospace',
      }}
    >
      {m[1].label}
    </span>
  )
}

export default function Actions({ onChatWith, liveAutoBlocks = [] }: ActionsProps): React.ReactElement {
  const { colors } = useTheme()
  const [inferences, setInferences] = useState<Inference[]>([])
  const [loading, setLoading] = useState(true)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [resolving, setResolving] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const rows = await api.getInferences() as Inference[]
      setInferences(rows)
    } catch { /* noop */ }
    setLoading(false)
  }, [])

  useEffect(() => {
    void load()

    // Refresh when a new suggestion comes in
    const off = api.onInferenceSuggest(() => void load())
    return off
  }, [load])

  // Re-load when a live auto-block arrives
  useEffect(() => {
    if (liveAutoBlocks.length > 0) void load()
  }, [liveAutoBlocks, load])

  const resolve = async (id: string, status: 'confirmed' | 'rejected'): Promise<void> => {
    setResolving(id)
    await api.resolveInference(id, status)
    await load()
    setResolving(null)
  }

  const pending = inferences.filter((i) => i.status === 'pending')
  const autoBlocked = inferences.filter((i) => i.status === 'auto_applied')
  const history = inferences.filter((i) => i.status === 'confirmed' || i.status === 'rejected')

  return (
    <div className="flex flex-col h-full overflow-hidden" style={{ background: colors.mainBg }}>
      {/* Header */}
      <div
        className="flex-shrink-0 flex items-center justify-between px-6 py-4"
        style={{ borderBottom: '1px solid rgba(99,102,241,0.08)' }}
      >
        <div>
          <h1
            className="text-[13px] font-bold uppercase tracking-widest"
            style={{ color: colors.textPrimary, fontFamily: '"Share Tech Mono", monospace', letterSpacing: '0.2em' }}
          >
            Actions
          </h1>
          <p className="text-[10px] mt-0.5" style={{ color: colors.textMuted }}>
            AI inference decisions · {pending.length} pending review
          </p>
        </div>
        <button
          onClick={() => void load()}
          className="flex items-center gap-1.5 px-3 py-1.5 transition-all hover:scale-105"
          style={{
            background: 'rgba(99,102,241,0.06)',
            border: '1px solid rgba(99,102,241,0.18)',
            color: 'rgba(99,102,241,0.7)',
            fontSize: 9,
            fontFamily: '"Share Tech Mono", monospace',
            letterSpacing: '0.15em',
          }}
        >
          {loading ? <RefreshCw size={9} className="animate-spin" /> : <RefreshCw size={9} />}
          Refresh
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-6 py-4 space-y-6">

        {/* ── Pending Review ────────────────────────────────────────────── */}
        <section>
          <div className="flex items-center gap-2 mb-3">
            <AlertTriangle size={11} style={{ color: '#fbbf24' }} />
            <span className="hud-label" style={{ color: '#fbbf24' }}>Pending Review</span>
            {pending.length > 0 && (
              <span
                className="text-[8px] font-bold px-1.5 py-0.5"
                style={{
                  background: 'rgba(251,191,36,0.15)',
                  border: '1px solid rgba(251,191,36,0.4)',
                  color: '#fbbf24',
                  fontFamily: '"Share Tech Mono", monospace',
                }}
              >
                {pending.length}
              </span>
            )}
            <div className="flex-1 h-px" style={{ background: 'rgba(251,191,36,0.12)' }} />
          </div>

          {pending.length === 0 ? (
            <div
              className="flex items-center gap-3 px-4 py-3"
              style={{ background: 'rgba(251,191,36,0.03)', border: '1px solid rgba(251,191,36,0.08)' }}
            >
              <CheckCircle size={13} style={{ color: 'rgba(251,191,36,0.3)' }} />
              <p className="text-[10px]" style={{ color: colors.textMuted }}>No pending suggestions. AI hasn't flagged anything new.</p>
            </div>
          ) : (
            <div className="space-y-2">
              {pending.map((inf) => (
                <div
                  key={inf.id}
                  className="hud-panel"
                  style={{ padding: '12px 14px', borderColor: 'rgba(251,191,36,0.2)' }}
                >
                  <div className="flex items-start justify-between gap-3 mb-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <span
                        className="text-[9px] font-bold uppercase tracking-widest px-1.5 py-0.5 flex-shrink-0"
                        style={{
                          background: 'rgba(251,191,36,0.12)',
                          border: '1px solid rgba(251,191,36,0.3)',
                          color: '#fbbf24',
                          fontFamily: '"Share Tech Mono", monospace',
                        }}
                      >
                        {inf.type}
                      </span>
                      <span className="text-[12px] font-bold truncate" style={{ color: colors.textPrimary }}>
                        {inf.value}
                      </span>
                    </div>
                    <span className="text-[9px] flex-shrink-0" style={{ color: colors.textMuted, fontFamily: '"Share Tech Mono", monospace' }}>
                      {timeAgo(inf.created_at)}
                    </span>
                  </div>

                  <ConfidenceBar value={inf.confidence} />

                  {inf.reasoning && (
                    <p className="text-[10px] mt-2 leading-relaxed" style={{ color: colors.textSecondary }}>
                      {inf.reasoning}
                    </p>
                  )}

                  <div className="flex items-center gap-2 mt-3">
                    <SourceBadge source={inf.evidence?.source ?? ''} />
                    <div className="flex-1" />
                    <button
                      onClick={() => void resolve(inf.id, 'rejected')}
                      disabled={resolving === inf.id}
                      className="flex items-center gap-1 px-3 py-1.5 text-[9px] font-bold uppercase tracking-widest transition-all hover:scale-105 disabled:opacity-50"
                      style={{
                        background: 'rgba(255,255,255,0.03)',
                        border: '1px solid rgba(255,255,255,0.1)',
                        color: colors.textMuted,
                        fontFamily: '"Share Tech Mono", monospace',
                      }}
                    >
                      <XCircle size={9} />
                      Dismiss
                    </button>
                    <button
                      onClick={() => void resolve(inf.id, 'confirmed')}
                      disabled={resolving === inf.id}
                      className="flex items-center gap-1 px-3 py-1.5 text-[9px] font-bold uppercase tracking-widest transition-all hover:scale-105 disabled:opacity-50"
                      style={{
                        background: 'rgba(248,113,113,0.1)',
                        border: '1px solid rgba(248,113,113,0.3)',
                        color: '#f87171',
                        fontFamily: '"Share Tech Mono", monospace',
                      }}
                    >
                      <Shield size={9} />
                      Block Now
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* ── Auto-Blocked by AI ─────────────────────────────────────────── */}
        <section>
          <div className="flex items-center gap-2 mb-3">
            <Zap size={11} style={{ color: '#f87171' }} />
            <span className="hud-label" style={{ color: '#f87171' }}>Auto-Blocked by AI</span>
            {autoBlocked.length > 0 && (
              <span
                className="text-[8px] font-bold px-1.5 py-0.5"
                style={{
                  background: 'rgba(248,113,113,0.15)',
                  border: '1px solid rgba(248,113,113,0.4)',
                  color: '#f87171',
                  fontFamily: '"Share Tech Mono", monospace',
                }}
              >
                {autoBlocked.length}
              </span>
            )}
            <div className="flex-1 h-px" style={{ background: 'rgba(248,113,113,0.12)' }} />
          </div>

          {autoBlocked.length === 0 && liveAutoBlocks.length === 0 ? (
            <div
              className="flex items-center gap-3 px-4 py-3"
              style={{ background: 'rgba(248,113,113,0.03)', border: '1px solid rgba(248,113,113,0.08)' }}
            >
              <Shield size={13} style={{ color: 'rgba(248,113,113,0.3)' }} />
              <p className="text-[10px]" style={{ color: colors.textMuted }}>No auto-blocks yet. Inference engine is monitoring.</p>
            </div>
          ) : (
            <div className="space-y-2">
              {/* Live events that haven't persisted yet */}
              {liveAutoBlocks.map((evt) => (
                <div
                  key={`live-${evt.ts}`}
                  className="hud-panel"
                  style={{ padding: '10px 14px', borderColor: 'rgba(248,113,113,0.3)', background: 'rgba(248,113,113,0.04)' }}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ background: '#f87171' }} />
                      <span className="text-[11px] font-bold" style={{ color: '#f87171' }}>{evt.domain}</span>
                      <span className="text-[8px] font-bold px-1 py-0.5" style={{ background: 'rgba(248,113,113,0.15)', color: '#f87171', border: '1px solid rgba(248,113,113,0.3)', fontFamily: 'monospace' }}>
                        LIVE
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-[9px] font-bold" style={{ color: '#f87171', fontFamily: '"Share Tech Mono", monospace' }}>
                        {Math.round(evt.confidence * 100)}%
                      </span>
                      <span className="text-[9px]" style={{ color: colors.textMuted, fontFamily: '"Share Tech Mono", monospace' }}>
                        {timeAgo(evt.ts)}
                      </span>
                    </div>
                  </div>
                </div>
              ))}

              {autoBlocked.map((inf) => (
                <div
                  key={inf.id}
                  className="hud-panel"
                  style={{ padding: '10px 14px', borderColor: 'rgba(248,113,113,0.15)' }}
                >
                  <div className="flex items-start justify-between gap-3 mb-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <Shield size={11} style={{ color: '#f87171', flexShrink: 0 }} />
                      <span className="text-[12px] font-bold truncate" style={{ color: colors.textPrimary }}>{inf.value}</span>
                      <span
                        className="text-[8px] font-bold px-1.5 py-0.5 flex-shrink-0"
                        style={{
                          background: 'rgba(248,113,113,0.1)',
                          border: '1px solid rgba(248,113,113,0.25)',
                          color: '#f87171',
                          fontFamily: '"Share Tech Mono", monospace',
                        }}
                      >
                        BLOCKED
                      </span>
                    </div>
                    <span className="text-[9px] flex-shrink-0" style={{ color: colors.textMuted, fontFamily: '"Share Tech Mono", monospace' }}>
                      {timeAgo(inf.created_at)}
                    </span>
                  </div>

                  <ConfidenceBar value={inf.confidence} />

                  {inf.reasoning && (
                    <p className="text-[10px] mt-2 leading-relaxed" style={{ color: colors.textSecondary }}>
                      {inf.reasoning}
                    </p>
                  )}

                  {onChatWith && (
                    <button
                      onClick={() => onChatWith(`Why was ${inf.value} auto-blocked by the AI?`)}
                      className="mt-2 text-[9px] uppercase tracking-widest transition-colors hover:text-white"
                      style={{ color: 'rgba(99,102,241,0.5)', fontFamily: '"Share Tech Mono", monospace' }}
                    >
                      Ask AI why →
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </section>

        {/* ── How Inference Works ───────────────────────────────────────── */}
        <section>
          <div className="flex items-center gap-2 mb-3">
            <Eye size={11} style={{ color: 'rgba(99,102,241,0.5)' }} />
            <span className="hud-label">What AI Monitors</span>
            <div className="flex-1 h-px" style={{ background: 'rgba(99,102,241,0.08)' }} />
          </div>
          <div
            className="hud-panel grid grid-cols-2 gap-px"
            style={{ padding: 0, overflow: 'hidden', borderColor: 'rgba(99,102,241,0.1)' }}
          >
            {[
              { icon: <Search size={10} />, label: 'Search queries', desc: 'Predicts destination sites from what you search', color: '#fbbf24' },
              { icon: <Eye size={10} />, label: 'URL visits', desc: 'Instant match against 200+ distraction domains', color: '#6366f1' },
              { icon: <Zap size={10} />, label: 'AI reasoning', desc: 'Haiku evaluates unknown sites against your goals', color: '#a78bfa' },
              { icon: <Clock size={10} />, label: 'Usage sweeps', desc: 'Periodic scan of 7-day browsing history', color: '#818cf8' },
            ].map((item) => (
              <div key={item.label} className="p-3" style={{ borderRight: '1px solid rgba(99,102,241,0.06)', borderBottom: '1px solid rgba(99,102,241,0.06)' }}>
                <div className="flex items-center gap-1.5 mb-1">
                  <span style={{ color: item.color }}>{item.icon}</span>
                  <span className="text-[9px] font-bold uppercase tracking-widest" style={{ color: item.color, fontFamily: '"Share Tech Mono", monospace' }}>{item.label}</span>
                </div>
                <p className="text-[9px] leading-relaxed" style={{ color: colors.textMuted }}>{item.desc}</p>
              </div>
            ))}
          </div>
        </section>

        {/* ── History ───────────────────────────────────────────────────── */}
        {history.length > 0 && (
          <section>
            <button
              onClick={() => setHistoryOpen((p) => !p)}
              className="flex items-center gap-2 w-full mb-3 group"
            >
              <Clock size={11} style={{ color: colors.textMuted }} />
              <span className="hud-label group-hover:text-white transition-colors">History</span>
              <span className="text-[9px]" style={{ color: colors.textMuted, fontFamily: '"Share Tech Mono", monospace' }}>
                ({history.length})
              </span>
              <div className="flex-1 h-px" style={{ background: 'rgba(99,102,241,0.08)' }} />
              {historyOpen ? <ChevronUp size={10} style={{ color: colors.textMuted }} /> : <ChevronDown size={10} style={{ color: colors.textMuted }} />}
            </button>

            {historyOpen && (
              <div className="space-y-1.5">
                {history.slice(0, 20).map((inf) => (
                  <div
                    key={inf.id}
                    className="flex items-center gap-3 px-3 py-2"
                    style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.05)' }}
                  >
                    {inf.status === 'confirmed'
                      ? <CheckCircle size={11} style={{ color: '#34d399', flexShrink: 0 }} />
                      : <XCircle size={11} style={{ color: colors.textMuted, flexShrink: 0 }} />
                    }
                    <span className="flex-1 text-[10px] truncate" style={{ color: inf.status === 'confirmed' ? colors.textPrimary : colors.textMuted }}>
                      {inf.value}
                    </span>
                    <span
                      className="text-[8px] font-bold uppercase px-1.5 py-0.5 flex-shrink-0"
                      style={{
                        background: inf.status === 'confirmed' ? 'rgba(52,211,153,0.1)' : 'rgba(255,255,255,0.05)',
                        border: `1px solid ${inf.status === 'confirmed' ? 'rgba(52,211,153,0.25)' : 'rgba(255,255,255,0.08)'}`,
                        color: inf.status === 'confirmed' ? '#34d399' : colors.textMuted,
                        fontFamily: '"Share Tech Mono", monospace',
                      }}
                    >
                      {inf.status}
                    </span>
                    <span className="text-[9px] flex-shrink-0" style={{ color: colors.textMuted, fontFamily: '"Share Tech Mono", monospace' }}>
                      {timeAgo(inf.resolved_at ?? inf.created_at)}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </section>
        )}

      </div>
    </div>
  )
}

import React, { useState, useEffect, useCallback } from 'react'
import {
  Brain, ChevronDown, ChevronRight, Target, Lightbulb, Sparkles,
  Check, X, Trash2, User, ArrowDown, Zap, RefreshCw,
} from 'lucide-react'
import type { HeuristicAlert, UserContextNote } from '@shared/types'
import { useTheme } from '../context/ThemeContext'

const api = (window as unknown as { electronAPI: Window['electronAPI'] }).electronAPI

// The Logic page makes Attentify's reasoning visible: the context it has inferred from
// the user's behavior, shown as collapsible flow-charts, plus a bar to add your own
// context (stored verbatim and injected into the assistant's system prompt).

interface Inference { id: string; type: string; value: string; confidence: number; reasoning?: string; status: string; action?: string }
interface Goal { id: string; text: string; priority: number }
interface Pref { key: string; value: string; scope: string; confidence: number; source: string }

// ── Collapsible section ─────────────────────────────────────────────────────────
function Section({ icon, title, count, defaultOpen = true, children }: {
  icon: React.ReactNode; title: string; count?: number; defaultOpen?: boolean; children: React.ReactNode
}): React.ReactElement {
  const { colors } = useTheme()
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className="rounded-xl overflow-hidden" style={{ background: colors.cardBg, border: `1px solid ${colors.border}` }}>
      <button onClick={() => setOpen((v) => !v)} className="w-full flex items-center gap-2 px-3.5 py-2.5">
        <span style={{ color: colors.accent }}>{icon}</span>
        <span className="text-[12.5px] font-semibold flex-1 text-left" style={{ color: colors.textPrimary }}>{title}</span>
        {count !== undefined && (
          <span className="text-[10px] px-1.5 py-0.5 rounded-full" style={{ background: colors.accentBg, color: colors.textMuted }}>{count}</span>
        )}
        {open ? <ChevronDown size={14} style={{ color: colors.textMuted }} /> : <ChevronRight size={14} style={{ color: colors.textMuted }} />}
      </button>
      {open && <div className="px-3.5 pb-3.5 pt-0.5">{children}</div>}
    </div>
  )
}

// ── Flow node + connector ───────────────────────────────────────────────────────
function FlowNode({ label, text, tone = 'neutral', confidence }: {
  label: string; text: React.ReactNode; tone?: 'neutral' | 'accent' | 'muted' | 'positive' | 'warning' | 'negative'; confidence?: number
}): React.ReactElement {
  const { colors } = useTheme()
  const toneColor = tone === 'accent' ? colors.accent : tone === 'positive' ? colors.positive : tone === 'warning' ? colors.warning : tone === 'negative' ? colors.negative : colors.textMuted
  return (
    <div className="rounded-lg px-3 py-2" style={{ background: colors.inputBg, borderLeft: `2px solid ${toneColor}`, border: `1px solid ${colors.border}`, borderLeftWidth: 2, borderLeftColor: toneColor }}>
      <div className="flex items-center justify-between gap-2">
        <span className="text-[8.5px] font-bold uppercase tracking-widest" style={{ color: toneColor, fontFamily: '"Share Tech Mono", monospace' }}>{label}</span>
        {confidence !== undefined && (
          <div className="flex items-center gap-1.5">
            <div className="h-1.5 rounded-full overflow-hidden" style={{ width: 44, background: colors.border }}>
              <div className="h-full rounded-full" style={{ width: `${Math.round(confidence * 100)}%`, background: toneColor }} />
            </div>
            <span className="text-[9px] data-value" style={{ color: colors.textMuted }}>{Math.round(confidence * 100)}%</span>
          </div>
        )}
      </div>
      <p className="text-[12px] leading-snug mt-0.5" style={{ color: colors.textSecondary }}>{text}</p>
    </div>
  )
}

function Connector(): React.ReactElement {
  const { colors } = useTheme()
  return (
    <div className="flex justify-center" style={{ height: 16 }}>
      <ArrowDown size={12} style={{ color: colors.textDim }} />
    </div>
  )
}

// ── One inference rendered as a collapsible reasoning flow ──────────────────────
function ReasoningChain({ inf, onResolve }: { inf: Inference; onResolve: (id: string, action: 'confirmed' | 'rejected') => void }): React.ReactElement {
  const { colors } = useTheme()
  const [open, setOpen] = useState(false)
  const kind = inf.type === 'domain' ? 'site' : 'app'
  return (
    <div className="rounded-lg mb-2" style={{ border: `1px solid ${colors.border}` }}>
      {/* Header = the conclusion */}
      <button onClick={() => setOpen((v) => !v)} className="w-full flex items-center gap-2 px-3 py-2 text-left">
        <Zap size={12} style={{ color: colors.accent, flexShrink: 0 }} />
        <span className="text-[12px] flex-1" style={{ color: colors.textPrimary }}>
          <span className="font-semibold">{inf.value}</span> is likely a distraction {kind}
        </span>
        <span className="text-[9px] data-value flex-shrink-0" style={{ color: colors.textMuted }}>{Math.round(inf.confidence * 100)}%</span>
        {open ? <ChevronDown size={13} style={{ color: colors.textMuted }} /> : <ChevronRight size={13} style={{ color: colors.textMuted }} />}
      </button>
      {open && (
        <div className="px-3 pb-3">
          <FlowNode label="Signal" text={<>Attentify observed activity on <b>{inf.value}</b> in your tracked behavior.</>} tone="neutral" />
          <Connector />
          <FlowNode label="Inferred" text={<><b>{inf.value}</b> is likely a distraction {kind} for you.</>} tone="accent" confidence={inf.confidence} />
          <Connector />
          <FlowNode label="Because" text={inf.reasoning || 'It matches patterns of distraction seen in your activity.'} tone="muted" />
          {inf.status === 'pending' && (
            <>
              <Connector />
              <FlowNode label="Suggested" text={<>Block <b>{inf.value}</b> to protect your focus.</>} tone="warning" />
              <div className="flex gap-2 mt-2">
                <button onClick={() => onResolve(inf.id, 'confirmed')} className="flex-1 flex items-center justify-center gap-1.5 py-1.5 text-[11px] font-medium rounded-lg transition-all"
                  style={{ background: colors.positiveBg, color: colors.positive, border: `1px solid rgba(52,211,153,0.3)` }}>
                  <Check size={12} /> Confirm &amp; block
                </button>
                <button onClick={() => onResolve(inf.id, 'rejected')} className="flex-1 flex items-center justify-center gap-1.5 py-1.5 text-[11px] font-medium rounded-lg transition-all"
                  style={{ background: colors.cardBg, color: colors.textMuted, border: `1px solid ${colors.border}` }}>
                  <X size={12} /> Not a distraction
                </button>
              </div>
            </>
          )}
          {inf.status !== 'pending' && (
            <p className="text-[10px] mt-2" style={{ color: colors.textDim }}>Resolved: {inf.status}</p>
          )}
        </div>
      )}
    </div>
  )
}

// ── Behavioral pattern as a compact flow ────────────────────────────────────────
function PatternChain({ alert }: { alert: HeuristicAlert }): React.ReactElement {
  const { colors } = useTheme()
  const [open, setOpen] = useState(false)
  const tone = alert.severity === 'high' ? 'negative' : alert.severity === 'medium' ? 'warning' : 'positive'
  const toneColor = tone === 'negative' ? colors.negative : tone === 'warning' ? colors.warning : colors.positive
  return (
    <div className="rounded-lg mb-2" style={{ border: `1px solid ${colors.border}` }}>
      <button onClick={() => setOpen((v) => !v)} className="w-full flex items-center gap-2 px-3 py-2 text-left">
        <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: toneColor }} />
        <span className="text-[12px] flex-1 font-medium" style={{ color: colors.textPrimary }}>{alert.title}</span>
        {open ? <ChevronDown size={13} style={{ color: colors.textMuted }} /> : <ChevronRight size={13} style={{ color: colors.textMuted }} />}
      </button>
      {open && (
        <div className="px-3 pb-3">
          <FlowNode label="Pattern detected" text={alert.title} tone={tone} />
          <Connector />
          <FlowNode label="What it means" text={alert.description} tone="muted" />
        </div>
      )}
    </div>
  )
}

export default function Logic(): React.ReactElement {
  const { colors } = useTheme()
  const [inferences, setInferences] = useState<Inference[]>([])
  const [goals, setGoals] = useState<Goal[]>([])
  const [prefs, setPrefs] = useState<Pref[]>([])
  const [context, setContext] = useState<UserContextNote[]>([])
  const [alerts, setAlerts] = useState<HeuristicAlert[]>([])
  const [topDistractor, setTopDistractor] = useState<string | null>(null)
  const [input, setInput] = useState('')
  const [adding, setAdding] = useState(false)
  const [loading, setLoading] = useState(true)

  const load = useCallback(() => {
    Promise.all([
      api.getInferences().then((r) => setInferences(r as Inference[])).catch(() => {}),
      api.getGoals().then((r) => setGoals(r as Goal[])).catch(() => {}),
      api.getPreferences().then(setPrefs).catch(() => {}),
      api.getUserContext().then(setContext).catch(() => {}),
      api.getAnalytics().then((d) => {
        setAlerts((d.heuristicAlerts ?? []).filter((a) => !a.dismissed))
        const byApp = new Map<string, number>()
        for (const s of (d.recentSessions ?? []).filter((s) => s.isDistraction)) byApp.set(s.app, (byApp.get(s.app) ?? 0) + s.duration)
        setTopDistractor([...byApp.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null)
      }).catch(() => {}),
    ]).finally(() => setLoading(false))
  }, [])

  useEffect(() => { load() }, [load])
  useEffect(() => { const off = api.onStoreRefresh?.(() => load()); return () => { off?.() } }, [load])

  const resolve = async (id: string, action: 'confirmed' | 'rejected'): Promise<void> => {
    await api.resolveInference(id, action).catch(() => {})
    load()
  }

  const addContext = async (): Promise<void> => {
    const t = input.trim()
    if (!t || adding) return
    setAdding(true)
    try {
      const res = await api.addUserContext(t)
      if (res.ok && res.note) { setContext((prev) => [res.note!, ...prev]); setInput('') }
    } catch { /* ignore */ }
    setAdding(false)
  }

  const delContext = async (id: string): Promise<void> => {
    await api.deleteUserContext(id).catch(() => {})
    setContext((prev) => prev.filter((c) => c.id !== id))
  }

  const pending = inferences.filter((i) => i.status === 'pending')
  const activeInf = pending.length > 0 ? pending : inferences.slice(0, 6)

  const chip = (label: string, value: string | number, color?: string): React.ReactElement => (
    <div className="rounded-lg px-3 py-2 flex-1 min-w-[90px]" style={{ background: colors.cardBg, border: `1px solid ${colors.border}` }}>
      <p className="text-[16px] font-bold leading-none data-value" style={{ color: color ?? colors.textPrimary }}>{value}</p>
      <p className="text-[9.5px] mt-1" style={{ color: colors.textMuted }}>{label}</p>
    </div>
  )

  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-3xl mx-auto px-5 py-5 space-y-3.5">
          {/* Header */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <Brain size={17} style={{ color: colors.accent }} />
              <div>
                <h1 className="text-[15px] font-semibold" style={{ color: colors.textPrimary }}>Logic</h1>
                <p className="text-[11px]" style={{ color: colors.textMuted }}>How Attentify reasons about your attention — and what it's working from.</p>
              </div>
            </div>
            <button onClick={load} className="p-1.5 rounded-lg" style={{ border: `1px solid ${colors.border}`, color: colors.textMuted }} title="Refresh">
              <RefreshCw size={13} />
            </button>
          </div>

          {/* Summary strip */}
          <div className="flex flex-wrap gap-2.5">
            {chip('Goals', goals.length, colors.accent)}
            {chip('Learned prefs', prefs.length)}
            {chip('Live signals', pending.length, pending.length ? colors.warning : colors.textMuted)}
            {chip('Patterns', alerts.length, alerts.length ? colors.negative : colors.textMuted)}
            {chip('Top drain', topDistractor ?? '—', topDistractor ? colors.negative : colors.textMuted)}
          </div>

          {loading ? (
            <div className="flex items-center justify-center py-10">
              <div className="w-5 h-5 rounded-full animate-spin" style={{ border: `2px solid ${colors.border}`, borderTopColor: colors.accent }} />
            </div>
          ) : (
            <>
              {/* Context I'm using */}
              <Section icon={<Target size={14} />} title="Context I'm using" count={goals.length + prefs.length + context.length}>
                {goals.length === 0 && prefs.length === 0 && context.length === 0 ? (
                  <p className="text-[11px]" style={{ color: colors.textMuted }}>Nothing yet. Set a goal in chat, or add context below — it sharpens my reasoning.</p>
                ) : (
                  <div className="space-y-3">
                    {goals.length > 0 && (
                      <div>
                        <p className="text-[9.5px] font-semibold uppercase tracking-wide mb-1.5" style={{ color: colors.textMuted }}>Your goals</p>
                        <div className="flex flex-wrap gap-1.5">
                          {goals.map((g) => (
                            <span key={g.id} className="text-[11px] px-2 py-1 rounded-lg" style={{ background: colors.accentBg, color: colors.textSecondary, border: `1px solid ${colors.border}` }}>{g.text}</span>
                          ))}
                        </div>
                      </div>
                    )}
                    {context.length > 0 && (
                      <div>
                        <p className="text-[9.5px] font-semibold uppercase tracking-wide mb-1.5" style={{ color: colors.textMuted }}>Context you gave me</p>
                        <div className="space-y-1">
                          {context.map((c) => (
                            <div key={c.id} className="group flex items-center gap-2 px-2.5 py-1.5 rounded-lg" style={{ background: colors.inputBg, border: `1px solid ${colors.border}` }}>
                              <User size={11} style={{ color: colors.accent, flexShrink: 0 }} />
                              <span className="text-[11.5px] flex-1" style={{ color: colors.textSecondary }}>{c.text}</span>
                              <button onClick={() => void delContext(c.id)} className="opacity-0 group-hover:opacity-100 transition-opacity" style={{ color: colors.textMuted }} title="Remove">
                                <Trash2 size={11} />
                              </button>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                    {prefs.length > 0 && (
                      <div>
                        <p className="text-[9.5px] font-semibold uppercase tracking-wide mb-1.5" style={{ color: colors.textMuted }}>Learned about you</p>
                        <div className="space-y-1">
                          {prefs.slice(0, 12).map((p, i) => (
                            <div key={i} className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg" style={{ background: colors.inputBg, border: `1px solid ${colors.border}` }}>
                              <span className="text-[11px] flex-1" style={{ color: colors.textSecondary }}><b style={{ color: colors.textPrimary }}>{p.key}</b>: {p.value}</span>
                              <span className="text-[8.5px] px-1.5 py-0.5 rounded" style={{ background: colors.accentBg, color: colors.textMuted }}>{p.source === 'user' ? 'you told me' : 'inferred'} · {p.scope}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </Section>

              {/* Live reasoning */}
              <Section icon={<Zap size={14} />} title="Live reasoning" count={activeInf.length} defaultOpen={activeInf.length > 0}>
                {activeInf.length === 0 ? (
                  <p className="text-[11px]" style={{ color: colors.textMuted }}>No active signals. As you work, Attentify surfaces reasoning about what's pulling your focus here.</p>
                ) : (
                  <>
                    <p className="text-[10px] mb-2" style={{ color: colors.textMuted }}>Each chain shows how a signal in your behavior becomes a conclusion. Click to expand.</p>
                    {activeInf.map((inf) => <ReasoningChain key={inf.id} inf={inf} onResolve={resolve} />)}
                  </>
                )}
              </Section>

              {/* Behavioral patterns */}
              <Section icon={<Lightbulb size={14} />} title="Behavioral patterns" count={alerts.length} defaultOpen={alerts.length > 0}>
                {alerts.length === 0 ? (
                  <p className="text-[11px]" style={{ color: colors.textMuted }}>No patterns detected recently.</p>
                ) : (
                  alerts.slice(0, 12).map((a) => <PatternChain key={a.id} alert={a} />)
                )}
              </Section>
            </>
          )}
        </div>
      </div>

      {/* Sticky context bar */}
      <div className="flex-shrink-0 px-5 py-3" style={{ borderTop: `1px solid ${colors.border}`, background: colors.mainBg }}>
        <div className="max-w-3xl mx-auto">
          <div className="flex items-center gap-2 px-3 py-2 rounded-xl" style={{ background: colors.inputBg, border: `1px solid ${colors.borderMid}` }}>
            <Sparkles size={13} style={{ color: colors.accent, flexShrink: 0 }} />
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') void addContext() }}
              disabled={adding}
              placeholder="Tell Attentify something to inform it — e.g. “Reddit is for work” or “I do night shifts”"
              className="flex-1 bg-transparent text-[12px] outline-none disabled:opacity-60"
              style={{ color: colors.textPrimary, caretColor: colors.accent }}
            />
            <button onClick={() => void addContext()} disabled={!input.trim() || adding}
              className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] font-medium transition-all disabled:opacity-40 flex-shrink-0"
              style={{ background: colors.accentBg, border: `1px solid ${colors.borderMid}`, color: colors.accent }}>
              {adding ? 'Adding…' : 'Add context'}
            </button>
          </div>
          <p className="text-[9.5px] mt-1.5 text-center" style={{ color: colors.textDim }}>Stored on your device and used to inform how Attentify reasons about you.</p>
        </div>
      </div>
    </div>
  )
}

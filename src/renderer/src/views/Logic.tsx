import React, { useState, useEffect, useCallback } from 'react'
import {
  Brain, ChevronDown, ChevronRight, Target, Lightbulb, Sparkles,
  Check, X, Trash2, User, ArrowDown, Zap, RefreshCw,
} from 'lucide-react'
import type { HeuristicAlert, UserContextNote } from '@shared/types'
import { MetricDrill, TableQuery, AskAIProvider, type DrillSpec } from '../components/MetricDrill'
import PageCanvas from '../components/cards/PageCanvas'
import { useTheme } from '../context/ThemeContext'

const api = (window as unknown as { electronAPI: Window['electronAPI'] }).electronAPI

// The Logic page makes Attentify's reasoning visible: the context it has inferred from
// the user's behavior, shown as collapsible flow-charts, plus a bar to add your own
// context (stored verbatim and injected into the assistant's system prompt).

interface Inference { id: string; type: string; value: string; confidence: number; reasoning?: string; status: string; action?: string }
interface Goal { id: string; text: string; priority: number }
interface Pref { key: string; value: string; scope: string; confidence: number; source: string }

// ── Section header — mono label + rule, matching the Analytics page ────────────
function SectionHeader({ label, sub }: { label: string; sub?: string }): React.ReactElement {
  const { colors } = useTheme()
  return (
    <div className="flex items-center gap-3 pt-1">
      <p className="text-[10px] font-semibold uppercase tracking-wider flex-shrink-0" style={{ color: 'var(--label)', fontFamily: '"Share Tech Mono", monospace' }}>{label}</p>
      <div className="flex-1 h-px" style={{ background: colors.border }} />
      {sub && <p className="text-[9px] flex-shrink-0" style={{ color: colors.textDim, fontFamily: '"Share Tech Mono", monospace' }}>{sub}</p>}
    </div>
  )
}

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

export default function Logic({ onChatWith }: { onChatWith?: (msg: string) => void }): React.ReactElement {
  const { colors } = useTheme()
  const [inferences, setInferences] = useState<Inference[]>([])
  const [goals, setGoals] = useState<Goal[]>([])
  const [prefs, setPrefs] = useState<Pref[]>([])
  const [context, setContext] = useState<UserContextNote[]>([])
  const [alerts, setAlerts] = useState<HeuristicAlert[]>([])
  const [distractors, setDistractors] = useState<{ app: string; ms: number }[]>([])
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
        setDistractors([...byApp.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([app, ms]) => ({ app, ms })))
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
  const topDistractor = distractors[0]?.app ?? null
  const fmtMs = (ms: number): string => { const h = Math.floor(ms / 3600000), m = Math.round((ms % 3600000) / 60000); return h > 0 ? `${h}h ${m}m` : `${m}m` }

  // Summary metrics, each clickable to reveal the detail behind it + Ask AI.
  const summary: { label: string; value: string; color?: string; drill: DrillSpec }[] = [
    {
      label: 'Goals', value: String(goals.length), color: goals.length ? colors.accent : colors.textMuted,
      drill: {
        title: 'Your goals', subtitle: `${goals.length} active`,
        rows: goals.map((g) => ({ label: g.text })), empty: 'No goals set yet, tell the assistant what you want to achieve.',
        askPrompt: 'What are my current goals and how well is my activity aligned with them?',
      },
    },
    {
      label: 'Learned', value: String(prefs.length),
      drill: {
        title: 'Learned about you', subtitle: `${prefs.length} preferences`,
        rows: prefs.slice(0, 14).map((p) => ({ label: p.key, sub: p.source === 'user' ? 'you told me' : 'inferred', value: p.value })),
        empty: 'Nothing learned yet. This fills in as you use Attentify.',
        askPrompt: 'What have you learned about my habits and preferences so far?',
      },
    },
    {
      label: 'Live signals', value: String(pending.length), color: pending.length ? colors.warning : colors.textMuted,
      drill: {
        title: 'Live reasoning signals', subtitle: `${pending.length} awaiting your call`,
        rows: pending.map((i) => ({ label: i.value, sub: i.type, value: `${Math.round(i.confidence * 100)}%`, tone: 'warning' as const })),
        empty: 'No open signals right now.',
        askPrompt: 'Walk me through the signals you are currently reasoning about.',
      },
    },
    {
      label: 'Patterns', value: String(alerts.length), color: alerts.length ? colors.negative : colors.textMuted,
      drill: {
        title: 'Behavioral patterns', subtitle: `${alerts.length} detected recently`,
        rows: alerts.slice(0, 12).map((a) => ({ label: a.title, sub: a.severity, tone: a.severity === 'high' ? 'negative' as const : a.severity === 'medium' ? 'warning' as const : 'positive' as const })),
        empty: 'No patterns detected recently.',
        askPrompt: 'What behavioral patterns have you noticed in how I work, and what should I do about them?',
      },
    },
    {
      label: 'Top drain', value: topDistractor ?? '-', color: topDistractor ? colors.negative : colors.textMuted,
      drill: {
        title: 'Top distractions', subtitle: 'Where distracted time goes',
        rows: distractors.map((d) => ({ label: d.app, value: fmtMs(d.ms), tone: 'negative' as const })),
        empty: 'No distractions recorded yet.',
        askPrompt: `My biggest distraction lately is ${topDistractor ?? 'unclear'}. How do I bring it under control?`,
      },
    },
  ]

  return (
   <AskAIProvider value={onChatWith}>
    <div className="flex flex-col h-full">
      {/* The AI's working memory, as cards. These read non-activity sources (goals,
          preferences, inferences, patterns) resolved in main, not the session log. */}
      <PageCanvas page="logic" onChatWith={onChatWith} columns={2} emptyHint="What have you learned about me?" />
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-4xl mx-auto px-4 py-4 space-y-4">
          {/* Header */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <Brain size={16} style={{ color: colors.accent }} />
              <div>
                <h1 className="text-[14px] font-semibold" style={{ color: colors.textPrimary }}>Logic</h1>
                <p className="text-[9px] mt-0.5" style={{ color: colors.textMuted, fontFamily: '"Share Tech Mono", monospace' }}>How Attentify reasons about your attention, and what it's working from.</p>
              </div>
            </div>
            <button onClick={load} className="p-1.5 rounded-lg" style={{ border: `1px solid ${colors.border}`, color: colors.textMuted }} title="Refresh">
              <RefreshCw size={13} />
            </button>
          </div>

          {/* KPI strip — click any metric for the detail behind it + Ask AI */}
          <div className="section-panel flex items-stretch overflow-x-auto">
            {summary.map((m, i) => (
              <div key={m.label} className="flex-1 flex" style={{ minWidth: 96, borderLeft: i === 0 ? 'none' : `1px solid ${colors.border}` }}>
                <MetricDrill spec={m.drill} onAskAI={onChatWith} full width={320}
                  render={
                    <div className="px-3 py-2.5">
                      <p className="hud-label mb-1" style={{ color: colors.textMuted }}>{m.label}</p>
                      <p className="text-[15px] font-semibold data-value truncate" style={{ color: m.color ?? colors.textPrimary }}>{m.value}</p>
                    </div>
                  }
                />
              </div>
            ))}
          </div>

          {loading ? (
            <div className="flex items-center justify-center py-10">
              <div className="w-5 h-5 rounded-full animate-spin" style={{ border: `2px solid ${colors.border}`, borderTopColor: colors.accent }} />
            </div>
          ) : (
            <>
              {/* Context I'm using */}
              <SectionHeader label="Context I'm using" sub={`${goals.length + prefs.length + context.length} items`} />
              <div className="section-panel p-3.5">
                {goals.length === 0 && prefs.length === 0 && context.length === 0 ? (
                  <p className="text-[11px]" style={{ color: colors.textMuted }}>Nothing yet. Set a goal in chat, or add context below, it sharpens my reasoning.</p>
                ) : (
                  <div className="space-y-3">
                    {goals.length > 0 && (
                      <div>
                        <p className="hud-label mb-1.5" style={{ color: colors.textMuted }}>Your goals</p>
                        <div className="flex flex-wrap gap-1.5">
                          {goals.map((g) => (
                            <span key={g.id} className="text-[11px] px-2 py-1 rounded-lg" style={{ background: colors.accentBg, color: colors.textSecondary, border: `1px solid ${colors.border}` }}>{g.text}</span>
                          ))}
                        </div>
                      </div>
                    )}
                    {context.length > 0 && (
                      <div>
                        <p className="hud-label mb-1.5" style={{ color: colors.textMuted }}>Context you gave me</p>
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
                        <p className="hud-label mb-1.5" style={{ color: colors.textMuted }}>Learned about you</p>
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
              </div>

              {/* Live reasoning */}
              <SectionHeader label="Live reasoning" sub={`${activeInf.length} signal${activeInf.length !== 1 ? 's' : ''}`} />
              <div className="section-panel p-3.5">
                {activeInf.length === 0 ? (
                  <p className="text-[11px]" style={{ color: colors.textMuted }}>No active signals. As you work, Attentify surfaces reasoning about what's pulling your focus here.</p>
                ) : (
                  <>
                    <p className="text-[10px] mb-2" style={{ color: colors.textMuted }}>Each chain shows how a signal in your behavior becomes a conclusion. Click to expand.</p>
                    {activeInf.map((inf) => <ReasoningChain key={inf.id} inf={inf} onResolve={resolve} />)}
                  </>
                )}
              </div>

              {/* Behavioral patterns */}
              <div className="flex items-center gap-3">
                <div className="flex-1"><SectionHeader label="Behavioral patterns" sub={`${alerts.length} detected`} /></div>
                {alerts.length > 0 && <TableQuery title="Behavioral patterns" summary={alerts.slice(0, 6).map((a) => a.title).join('; ')} />}
              </div>
              <div className="section-panel p-3.5">
                {alerts.length === 0 ? (
                  <p className="text-[11px]" style={{ color: colors.textMuted }}>No patterns detected recently.</p>
                ) : (
                  alerts.slice(0, 12).map((a) => <PatternChain key={a.id} alert={a} />)
                )}
              </div>
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
              placeholder="Tell Attentify something to inform it, e.g. “Reddit is for work” or “I do night shifts”"
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
   </AskAIProvider>
  )
}

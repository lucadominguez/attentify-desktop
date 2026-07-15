import React, { createContext, useContext, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { MessageSquare, X, ArrowRight, Sparkles } from 'lucide-react'
import { useTheme } from '../context/ThemeContext'

// Ambient "ask the assistant" handler so any metric/table on a page can offer Ask-AI
// without every intermediate component threading an onChatWith prop. A page wraps its
// tree in <AskAIProvider value={onChatWith}> once; drill-downs consume it by default.
const AskAIContext = createContext<((prompt: string) => void) | undefined>(undefined)
export function AskAIProvider({ value, children }: { value?: (p: string) => void; children: React.ReactNode }): React.ReactElement {
  return <AskAIContext.Provider value={value}>{children}</AskAIContext.Provider>
}
export function useAskAI(): ((prompt: string) => void) | undefined { return useContext(AskAIContext) }

// Drill-downs for key metrics. A metric is no longer just a number to look at, the
// user can click it and get the detail behind it (the actual events, the breakdown)
// plus a one-tap "Ask AI about this". Same idea as the build-your-own-analytics bar,
// but attached directly to every headline figure.

export interface DrillRow {
  label: string
  value?: string
  sub?: string
  tone?: 'default' | 'negative' | 'positive' | 'warning' | 'accent'
}

export interface DrillSpec {
  title: string
  subtitle?: string
  rows?: DrillRow[]
  note?: string
  empty?: string
  askPrompt?: string
}

// Generic click-to-open popover anchored to its trigger, portalled to <body> so it is
// never clipped by an overflow-scroll ancestor. Closes on outside-click / Escape, and
// flips above the trigger when there isn't room below.
export function Popover({ trigger, children, width = 320, anchorClassName = 'inline-flex' }: {
  trigger: (o: { open: boolean; toggle: () => void }) => React.ReactNode
  children: (close: () => void) => React.ReactNode
  width?: number
  anchorClassName?: string
}): React.ReactElement {
  const anchorRef = useRef<HTMLSpanElement>(null)
  const popRef = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState<{ left: number; top?: number; bottom?: number } | null>(null)

  const place = (): void => {
    const r = anchorRef.current?.getBoundingClientRect()
    if (!r) return
    let left = r.left
    if (left + width > window.innerWidth - 12) left = window.innerWidth - 12 - width
    if (left < 12) left = 12
    const spaceBelow = window.innerHeight - r.bottom
    if (spaceBelow < 280 && r.top > 280) setPos({ left, bottom: window.innerHeight - r.top + 8 })
    else setPos({ left, top: r.bottom + 8 })
  }

  useLayoutEffect(() => { if (open) place() }, [open]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent): void => {
      if (!popRef.current?.contains(e.target as Node) && !anchorRef.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent): void => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    window.addEventListener('resize', place)
    window.addEventListener('scroll', place, true)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onKey)
      window.removeEventListener('resize', place)
      window.removeEventListener('scroll', place, true)
    }
  }, [open]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <span ref={anchorRef} className={anchorClassName}>
      {trigger({ open, toggle: () => setOpen((o) => !o) })}
      {open && pos && createPortal(
        <div ref={popRef} style={{ position: 'fixed', left: pos.left, top: pos.top, bottom: pos.bottom, width, zIndex: 1000 }}>
          {children(() => setOpen(false))}
        </div>,
        document.body,
      )}
    </span>
  )
}

// The popover body: a titled card of detail rows (or custom content) with an optional
// "Ask AI about this" action.
export function DrilldownCard({ spec, onAskAI, close, children }: {
  spec: DrillSpec
  onAskAI?: (prompt: string) => void
  close: () => void
  children?: React.ReactNode
}): React.ReactElement {
  const { colors } = useTheme()
  const ctxAsk = useAskAI()
  const ask = onAskAI ?? ctxAsk
  const toneColor = (t?: DrillRow['tone']): string =>
    t === 'negative' ? colors.negative : t === 'positive' ? colors.positive
    : t === 'warning' ? colors.warning : t === 'accent' ? colors.accent : colors.textPrimary
  return (
    <div className="rounded-xl overflow-hidden animate-fade-in" style={{ background: colors.panelBg, border: `1px solid ${colors.borderMid}`, boxShadow: '0 12px 40px rgba(0,0,0,0.45)' }}>
      <div className="flex items-start justify-between gap-2 px-3 py-2.5" style={{ borderBottom: `1px solid ${colors.border}` }}>
        <div className="min-w-0">
          <p className="text-[12px] font-semibold" style={{ color: colors.textPrimary }}>{spec.title}</p>
          {spec.subtitle && <p className="text-[10px] mt-0.5" style={{ color: colors.textMuted }}>{spec.subtitle}</p>}
        </div>
        <button onClick={close} className="p-0.5 rounded flex-shrink-0 hover:opacity-70" style={{ color: colors.textMuted }} title="Close"><X size={13} /></button>
      </div>
      <div className="px-3 py-2.5 max-h-[300px] overflow-y-auto">
        {children}
        {spec.rows && spec.rows.length > 0 ? (
          <div className="space-y-1.5">
            {spec.rows.map((r, i) => (
              <div key={i} className="flex items-baseline justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <span className="text-[11px]" style={{ color: colors.textSecondary }}>{r.label}</span>
                  {r.sub && <span className="text-[9.5px] ml-1.5" style={{ color: colors.textDim }}>{r.sub}</span>}
                </div>
                {r.value && <span className="text-[11px] data-value flex-shrink-0" style={{ color: toneColor(r.tone) }}>{r.value}</span>}
              </div>
            ))}
          </div>
        ) : !children ? (
          <p className="text-[10.5px] py-1" style={{ color: colors.textMuted }}>{spec.empty ?? 'No details available.'}</p>
        ) : null}
        {spec.note && <p className="text-[9.5px] mt-2 leading-snug" style={{ color: colors.textDim }}>{spec.note}</p>}
      </div>
      {ask && (
        <div className="px-3 py-2.5" style={{ borderTop: `1px solid ${colors.border}` }}>
          <AskBox
            placeholder={`Ask about ${spec.title.toLowerCase()}…`}
            onSubmit={(q) => {
              const prompt = q ? `Regarding "${spec.title}"${spec.subtitle ? ` (${spec.subtitle})` : ''} on my Analytics: ${q}` : (spec.askPrompt ?? `Tell me about "${spec.title}" What stands out and what should I do?`)
              ask(prompt); close()
            }}
          />
        </div>
      )}
    </div>
  )
}

// Free-text "ask the AI" box used inside drill-downs and table-query popovers. Empty
// submit = a sensible default question; typed submit = the user's own question.
function AskBox({ placeholder, onSubmit }: { placeholder: string; onSubmit: (q: string) => void }): React.ReactElement {
  const { colors } = useTheme()
  const [q, setQ] = useState('')
  return (
    <div className="flex items-center gap-1.5 px-2 py-1.5 rounded-lg" style={{ background: colors.inputBg, border: `1px solid ${colors.border}` }}>
      <Sparkles size={12} style={{ color: colors.accent, flexShrink: 0 }} />
      <input
        value={q}
        autoFocus
        onChange={(e) => setQ(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') onSubmit(q.trim()) }}
        placeholder={placeholder}
        className="flex-1 bg-transparent text-[11px] outline-none"
        style={{ color: colors.textPrimary, caretColor: colors.accent }}
      />
      <button onClick={() => onSubmit(q.trim())} title={q.trim() ? 'Ask' : 'Ask AI about this'}
        className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium flex-shrink-0 transition-opacity hover:opacity-90"
        style={{ background: colors.accentBg, color: colors.accent }}>
        {q.trim() ? <>Ask <ArrowRight size={10} /></> : <><MessageSquare size={10} /> Ask AI</>}
      </button>
    </div>
  )
}

// One query affordance for a whole table or chart, a compact "Ask AI" button that
// opens a box to ask a free-text question about that table's data (per the request:
// the table itself is queryable, not each cell).
export function TableQuery({ title, summary, onAskAI, className }: {
  title: string
  summary?: string
  onAskAI?: (prompt: string) => void
  className?: string
}): React.ReactElement | null {
  const { colors } = useTheme()
  const ctxAsk = useAskAI()
  const ask = onAskAI ?? ctxAsk
  if (!ask) return null
  return (
    <Popover
      width={300}
      trigger={({ toggle }) => (
        <button type="button" onClick={toggle}
          className={`flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-medium drill-hit ${className ?? ''}`}
          style={{ color: colors.accent, border: `1px solid ${colors.border}` }} title={`Ask AI about ${title}`}>
          <MessageSquare size={9} /> Ask AI
        </button>
      )}
    >
      {(close) => (
        <div className="rounded-xl overflow-hidden animate-fade-in" style={{ background: colors.panelBg, border: `1px solid ${colors.borderMid}`, boxShadow: '0 12px 40px rgba(0,0,0,0.45)' }}>
          <div className="flex items-start justify-between gap-2 px-3 py-2.5" style={{ borderBottom: `1px solid ${colors.border}` }}>
            <div className="min-w-0">
              <p className="text-[12px] font-semibold" style={{ color: colors.textPrimary }}>{title}</p>
              {summary && <p className="text-[10px] mt-0.5" style={{ color: colors.textMuted }}>{summary}</p>}
            </div>
            <button onClick={close} className="p-0.5 rounded flex-shrink-0 hover:opacity-70" style={{ color: colors.textMuted }} title="Close"><X size={13} /></button>
          </div>
          <div className="px-3 py-2.5">
            <AskBox
              placeholder={`Ask about this table…`}
              onSubmit={(q) => {
                const prompt = q ? `Regarding the "${title}" table${summary ? ` (${summary})` : ''}: ${q}` : `Analyze the "${title}" table${summary ? ` (${summary})` : ''} What stands out and what should I change?`
                ask(prompt); close()
              }}
            />
          </div>
        </div>
      )}
    </Popover>
  )
}

// Convenience wrapper: a clickable metric region that opens a DrilldownCard. `render`
// draws the visible metric; the whole area gets the `drill-hit` hover treatment.
export function MetricDrill({ spec, onAskAI, width, className, render, children, full }: {
  spec: DrillSpec
  onAskAI?: (prompt: string) => void
  width?: number
  className?: string
  render?: React.ReactNode
  children?: React.ReactNode
  full?: boolean
}): React.ReactElement {
  return (
    <Popover
      width={width}
      anchorClassName={full ? 'flex w-full h-full' : 'inline-flex'}
      trigger={({ toggle }) => (
        <button type="button" onClick={toggle} className={`drill-hit text-left ${full ? 'w-full' : ''} ${className ?? ''}`}>
          {render}
        </button>
      )}
    >
      {(close) => <DrilldownCard spec={spec} onAskAI={onAskAI} close={close}>{children}</DrilldownCard>}
    </Popover>
  )
}

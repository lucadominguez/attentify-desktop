import React, { useEffect, useMemo } from 'react'
import { X } from 'lucide-react'
import { useTheme } from '../../context/ThemeContext'
import { useAskAI } from '../MetricDrill'
import { runAnalyticsQuery, runHeatmapQuery, runRankedQuery } from '@shared/analyticsQuery'
import type { ActivitySession, CustomAnalyticsCard } from '@shared/types'

// Clicking a card opens it. A card on the canvas is a glance; this is the answer.
//
// Same liquid glass as the overlay and interstitial, centred and floating, so it reads
// as the AI holding something up rather than a page you navigated to. The card's own
// visual gets more room, and the numbers behind it are listed underneath, because a
// chart you cannot interrogate is just a decoration.

function fmtMs(ms: number): string {
  const m = Math.round(ms / 60000)
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  const r = m % 60
  return r ? `${h}h ${r}m` : `${h}h`
}
const fmt = (v: number, unit: 'ms' | 'count' | 'percent'): string =>
  unit === 'ms' ? fmtMs(v) : unit === 'percent' ? `${Math.round(v)}%` : String(Math.round(v))

const WEEKDAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

export default function CardDetail({
  card, sessions = [], items, onClose,
}: {
  card: CustomAnalyticsCard
  sessions?: ActivitySession[]
  items?: { label: string; detail?: string }[]
  onClose: () => void
}): React.ReactElement {
  const { colors } = useTheme()
  const askAI = useAskAI()

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const data = useMemo(() => {
    if (card.kind === 'action') return null
    if (card.viz === 'heatmap') return { heatmap: runHeatmapQuery(sessions, card.spec) }
    if (card.viz === 'ranked') return { ranked: runRankedQuery(sessions, card.spec) }
    return { flat: runAnalyticsQuery(sessions, card.spec) }
  }, [card, sessions])

  // The rows under the visual: every number the card is standing on.
  const rows: { label: string; value: string; detail?: string }[] = useMemo(() => {
    if (items) return items.map((i) => ({ label: i.label, value: '', detail: i.detail }))
    if (data?.heatmap) {
      return data.heatmap.cells
        .filter((c) => c.value > 0)
        .sort((a, b) => b.value - a.value)
        .map((c) => ({
          label: `${WEEKDAY[c.day]} ${String(c.hour).padStart(2, '0')}:00`,
          value: fmt(c.value, data.heatmap.unit),
        }))
    }
    if (data?.ranked) {
      return data.ranked.rows.map((r) => ({
        label: r.label,
        value: fmt(r.value, data.ranked.unit),
        detail: r.deltaPct === null ? 'new' : `${r.delta > 0 ? '+' : ''}${r.deltaPct}% vs previous`,
      }))
    }
    if (data?.flat) {
      return data.flat.rows.map((r) => ({ label: r.label, value: fmt(r.value, data.flat.unit), detail: r.detail }))
    }
    return []
  }, [data, items])

  // The raw sessions this card's spec actually matched, filtered exactly the way
  // runAnalyticsQuery filters them, so the list and the chart can never disagree.
  const { raw, rawTotal } = useMemo(() => {
    if (card.kind === 'action' || (card.spec.source ?? 'activity') !== 'activity') return { raw: [], rawTotal: 0 }
    const cutoff = Date.now() - Math.max(1, card.spec.rangeDays) * 86400000
    const matched = sessions.filter((s) => {
      if (s.startTime < cutoff) return false
      if (card.spec.distraction === 'only' && !s.isDistraction) return false
      if (card.spec.distraction === 'exclude' && s.isDistraction) return false
      return true
    })
    // Longest first: the sessions that actually moved the number come first. Capped so a
    // month of tracking cannot render 9,000 rows into the DOM.
    const sorted = [...matched].sort((a, b) => b.duration - a.duration)
    return { raw: sorted.slice(0, 200), rawTotal: matched.length }
  }, [card, sessions])

  const spec = card.spec
  const provenance = card.kind === 'action'
    ? `runs ${card.action?.tool}`
    : `${(spec.source ?? 'activity')} · ${spec.metric.replace('_', ' ')} by ${spec.groupBy} · last ${spec.rangeDays}d${spec.distraction !== 'all' ? ` · ${spec.distraction} distractions` : ''}`

  return (
    <>
      <div className="fixed inset-0 z-[80]" style={{ background: 'rgba(0,0,0,0.45)' }} onClick={onClose} />
      <div className="fixed z-[81] left-1/2 top-1/2 flex flex-col"
        style={{ transform: 'translate(-50%,-50%)', width: 'min(760px, 92vw)', maxHeight: '86vh' }}>
        <div className="rounded-2xl overflow-hidden flex flex-col" style={{
          // Liquid glass, same language as the overlay: floating, not navigated to.
          background: colors.glassHigh,
          backdropFilter: colors.blurLg,
          WebkitBackdropFilter: colors.blurLg,
          border: `1px solid ${colors.glassEdge}`,
          boxShadow: `${colors.elevHigh}, ${colors.glassTopLight}`,
          maxHeight: '86vh',
        }}>
          {/* Header */}
          <div className="flex items-start justify-between gap-3 px-5 pt-4 pb-3 flex-shrink-0">
            <div className="min-w-0">
              <p className="text-[15px] font-semibold" style={{ color: colors.textPrimary }}>{card.title}</p>
              {card.description && <p className="text-[11px] mt-0.5" style={{ color: colors.textMuted }}>{card.description}</p>}
              {/* Provenance: the card is a spec, so show the spec. This is what makes it
                  honest that the user could have asked for it. */}
              <p className="text-[9px] mt-1.5 data-value" style={{ color: colors.textDim }}>{provenance}</p>
            </div>
            <div className="flex items-center gap-1.5 flex-shrink-0">
              {askAI && (
                <button
                  onClick={() => { askAI(`About my "${card.title}" card (${provenance}): walk me through what this data shows and what I should do about it.`); onClose() }}
                  className="text-[10px] px-2.5 py-1.5 rounded-lg transition-all hover:brightness-110"
                  style={{ background: colors.accentBg, border: `1px solid ${colors.borderMid}`, color: colors.accent }}>
                  Ask about this
                </button>
              )}
              <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-white/5" title="Close (Esc)">
                <X size={14} style={{ color: colors.textMuted }} />
              </button>
            </div>
          </div>

          <div className="overflow-y-auto px-5 pb-5" style={{ minHeight: 0 }}>
            {/* The visual, with room to actually be read. */}
            <div className="rounded-xl p-4 mb-3" style={{ background: colors.glassMid, border: `1px solid ${colors.glassEdge}` }}>
              <BigViz card={card} data={data} />
            </div>

            {/* The aggregate the chart is drawn from. */}
            <div className="flex items-center justify-between mb-1.5">
              <p className="text-[9px] font-bold uppercase tracking-widest" style={{ color: colors.labelDim }}>Grouped by {card.spec.groupBy}</p>
              <p className="text-[9px] data-value" style={{ color: colors.textDim }}>{rows.length} rows</p>
            </div>
            {rows.length === 0 ? (
              <p className="text-[11px] py-6 text-center" style={{ color: colors.textMuted }}>Nothing recorded for this yet.</p>
            ) : (
              <div className="rounded-lg overflow-hidden" style={{ border: `1px solid ${colors.glassEdge}` }}>
                {rows.map((r, i) => (
                  <div key={`${r.label}-${i}`} className="flex items-center gap-3 px-3 py-1.5"
                    style={{ background: i % 2 ? 'transparent' : colors.glassMid }}>
                    <span className="text-[11px] flex-1 truncate capitalize" style={{ color: colors.textSecondary }}>{r.label}</span>
                    {r.detail && <span className="text-[9px] flex-shrink-0" style={{ color: colors.textDim }}>{r.detail}</span>}
                    {r.value && <span className="text-[11px] data-value flex-shrink-0" style={{ color: colors.textPrimary, width: 64, textAlign: 'right' }}>{r.value}</span>}
                  </div>
                ))}
              </div>
            )}

            {/* The raw rows the aggregate is built from. "All the underlying data" means
                the actual sessions, not just the grouped totals: the aggregate is already
                a summary, and summarising a summary is not showing your work. */}
            {raw.length > 0 && (
              <>
                <div className="flex items-center justify-between mb-1.5 mt-4">
                  <p className="text-[9px] font-bold uppercase tracking-widest" style={{ color: colors.labelDim }}>Every session behind it</p>
                  <p className="text-[9px] data-value" style={{ color: colors.textDim }}>
                    {raw.length}{rawTotal > raw.length ? ` of ${rawTotal}` : ''} sessions
                  </p>
                </div>
                <div className="rounded-lg overflow-hidden" style={{ border: `1px solid ${colors.glassEdge}` }}>
                  <div className="flex items-center gap-3 px-3 py-1" style={{ background: colors.glassMid, borderBottom: `1px solid ${colors.glassEdge}` }}>
                    <span className="text-[8px] uppercase tracking-wider" style={{ color: colors.textDim, width: 96 }}>when</span>
                    <span className="text-[8px] uppercase tracking-wider" style={{ color: colors.textDim, width: 84 }}>app</span>
                    <span className="text-[8px] uppercase tracking-wider flex-1" style={{ color: colors.textDim }}>what</span>
                    <span className="text-[8px] uppercase tracking-wider" style={{ color: colors.textDim, width: 44, textAlign: 'right' }}>time</span>
                  </div>
                  {raw.map((s, i) => (
                    <div key={s.id ?? i} className="flex items-center gap-3 px-3 py-1"
                      style={{ background: i % 2 ? 'transparent' : colors.glassMid }}>
                      <span className="text-[9.5px] data-value flex-shrink-0" style={{ color: colors.textDim, width: 96 }}>
                        {new Date(s.startTime).toLocaleString([], { weekday: 'short', hour: '2-digit', minute: '2-digit' })}
                      </span>
                      <span className="text-[10px] truncate flex-shrink-0" style={{ color: colors.textSecondary, width: 84 }}>{s.app}</span>
                      <span className="text-[10px] truncate flex-1" style={{ color: colors.textMuted }}>{s.title || s.url || ''}</span>
                      <span className="text-[10px] data-value flex-shrink-0"
                        style={{ color: s.isDistraction ? colors.negative : colors.textPrimary, width: 44, textAlign: 'right' }}>
                        {fmtMs(s.duration)}
                      </span>
                    </div>
                  ))}
                </div>
                {rawTotal > raw.length && (
                  <p className="text-[9px] mt-1.5 text-center" style={{ color: colors.textDim }}>
                    Showing the {raw.length} longest. Ask Attentify to see the rest.
                  </p>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </>
  )
}

/** The card's visual again, but at a size where the detail is legible. */
function BigViz({ card, data }: { card: CustomAnalyticsCard; data: ReturnType<typeof Object> | null }): React.ReactElement {
  const { colors } = useTheme()
  const d = data as { flat?: ReturnType<typeof runAnalyticsQuery>; heatmap?: ReturnType<typeof runHeatmapQuery>; ranked?: ReturnType<typeof runRankedQuery> } | null

  if (card.kind === 'action') {
    return (
      <div className="py-6 text-center">
        <p className="text-[12px]" style={{ color: colors.textSecondary }}>{card.action?.label}</p>
        <p className="text-[9px] mt-1 data-value" style={{ color: colors.textDim }}>
          {card.action?.tool}({JSON.stringify(card.action?.params ?? {})})
        </p>
      </div>
    )
  }

  if (d?.heatmap) {
    const { cells, max, unit } = d.heatmap
    const byDay: Record<number, typeof cells> = {}
    for (const c of cells) (byDay[c.day] ||= []).push(c)
    return (
      <div>
        {[0, 1, 2, 3, 4, 5, 6].map((day) => (
          <div key={day} className="flex items-center gap-1 mb-[3px]">
            <span className="text-[9px] flex-shrink-0" style={{ color: colors.textMuted, width: 24 }}>{WEEKDAY[day]}</span>
            <div className="flex gap-[3px] flex-1">
              {(byDay[day] ?? []).sort((a, b) => a.hour - b.hour).map((c) => (
                <div key={c.hour} title={`${WEEKDAY[day]} ${c.hour}:00 · ${fmt(c.value, unit)}`}
                  style={{
                    flex: 1, height: 18, borderRadius: 3,
                    background: c.value === 0 ? colors.glassEdge : colors.accent,
                    opacity: c.value === 0 ? 1 : 0.18 + (c.value / Math.max(1, max)) * 0.82,
                  }} />
              ))}
            </div>
          </div>
        ))}
        <div className="flex justify-between mt-1" style={{ paddingLeft: 28 }}>
          {['12am', '6am', '12pm', '6pm', '11pm'].map((h) => (
            <span key={h} className="text-[8px]" style={{ color: colors.textDim }}>{h}</span>
          ))}
        </div>
      </div>
    )
  }

  const rows = d?.ranked?.rows ?? d?.flat?.rows ?? []
  const unit = d?.ranked?.unit ?? d?.flat?.unit ?? 'ms'
  const max = Math.max(1, ...rows.map((r) => r.value))

  if (card.viz === 'line') {
    const pts = rows.map((r, i) => `${(i / Math.max(1, rows.length - 1)) * 100},${100 - (r.value / max) * 92}`).join(' ')
    return (
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" style={{ width: '100%', height: 180 }}>
        <polyline points={pts} fill="none" stroke={colors.accent} strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
      </svg>
    )
  }

  return (
    <div className="flex flex-col gap-2">
      {rows.slice(0, 14).map((r) => (
        <div key={r.label} className="flex items-center gap-3">
          <span className="text-[11px] truncate capitalize" style={{ color: colors.textSecondary, width: 130 }}>{r.label}</span>
          <div className="flex-1 h-3 rounded-full overflow-hidden" style={{ background: colors.glassEdge }}>
            <div style={{ width: `${(r.value / max) * 100}%`, height: '100%', background: colors.accent, borderRadius: 999 }} />
          </div>
          <span className="text-[11px] data-value flex-shrink-0" style={{ color: colors.textPrimary, width: 56, textAlign: 'right' }}>
            {fmt(r.value, unit)}
          </span>
        </div>
      ))}
    </div>
  )
}

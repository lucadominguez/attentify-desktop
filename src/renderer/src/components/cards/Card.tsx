import React, { useMemo } from 'react'
import { GripVertical, Trash2, Play } from 'lucide-react'
import { useTheme } from '../../context/ThemeContext'
import { useAskAI } from '../MetricDrill'
import { runAnalyticsQuery, runHeatmapQuery, runRankedQuery } from '@shared/analyticsQuery'
import { niceTicks, fmtTick } from './Axes'
import type { ActivitySession, CustomAnalyticsCard } from '@shared/types'

// The unit every page is built from.
//
// A card is a saved spec plus a viz, recomputed locally on every render. Generation
// happens ONCE, when the user asks for it; opening a page must never cost an LLM call,
// or every page view would spend money and take seconds.
//
// Seeded cards are ordinary cards. They carry real specs the AI genuinely could have
// produced, which is the whole promise: anything shipped here, you could have asked for.

// ── formatting ────────────────────────────────────────────────────────────────

function fmtMs(ms: number): string {
  const m = Math.round(ms / 60000)
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  const r = m % 60
  return r ? `${h}h ${r}m` : `${h}h`
}

export function fmtValue(v: number, unit: 'ms' | 'count' | 'percent'): string {
  if (unit === 'ms') return fmtMs(v)
  if (unit === 'percent') return `${Math.round(v)}%`
  return String(Math.round(v))
}

const WEEKDAY_SHORT = ['S', 'M', 'T', 'W', 'T', 'F', 'S']

// ── viz: the grown vocabulary ─────────────────────────────────────────────────

// Ranked rows. Every bar is directly labelled with its own value, so no axis is needed,
// but the scale footer states what full width means: a bar with no reference is a ratio
// with no denominator.
function BarViz({ rows, unit }: { rows: { label: string; value: number; detail?: string }[]; unit: 'ms' | 'count' | 'percent' }): React.ReactElement {
  const { colors } = useTheme()
  const shown = rows.slice(0, 8)
  const max = Math.max(1, ...shown.map((r) => r.value))
  return (
    <div className="flex flex-col gap-1.5">
      {shown.map((r) => (
        <div key={r.label} className="flex items-center gap-2" title={`${r.label}: ${fmtValue(r.value, unit)}${r.detail ? ` · ${r.detail}` : ''}`}>
          <span className="text-[10px] truncate capitalize" style={{ color: colors.textSecondary, width: 92 }}>{r.label}</span>
          <div className="flex-1 h-2 rounded-full overflow-hidden" style={{ background: colors.glassEdge }}>
            <div style={{ width: `${(r.value / max) * 100}%`, height: '100%', background: colors.accent, borderRadius: 999, transition: 'width 0.3s ease' }} />
          </div>
          <span className="text-[10px] data-value flex-shrink-0" style={{ color: colors.textPrimary, width: 46, textAlign: 'right' }}>
            {fmtValue(r.value, unit)}
          </span>
        </div>
      ))}
      <div className="flex justify-end pt-0.5" style={{ borderTop: `1px solid ${colors.glassEdge}` }}>
        <span className="text-[8px] data-value" style={{ color: colors.textDim }}>full width = {fmtValue(max, unit)}</span>
      </div>
    </div>
  )
}

// Parts of a whole, as one bar. What the hand-built focused/distracted/idle bar did.
function ProgressViz({ rows, unit, total }: { rows: { label: string; value: number }[]; unit: 'ms' | 'count' | 'percent'; total: number }): React.ReactElement {
  const { colors } = useTheme()
  const palette = [colors.positive, colors.negative, colors.warning, colors.accent, colors.brand]
  const sum = Math.max(1, rows.reduce((a, r) => a + r.value, 0))
  return (
    <div>
      <div className="flex h-2.5 rounded-full overflow-hidden" style={{ background: colors.glassEdge }}>
        {rows.slice(0, 5).map((r, i) => (
          <div key={r.label} title={`${r.label}: ${fmtValue(r.value, unit)}`}
            style={{ width: `${(r.value / sum) * 100}%`, background: palette[i % palette.length], transition: 'width 0.4s ease' }} />
        ))}
      </div>
      <div className="flex flex-wrap gap-x-3 gap-y-1 mt-2">
        {rows.slice(0, 5).map((r, i) => (
          <div key={r.label} className="flex items-center gap-1.5">
            <span className="rounded-full" style={{ width: 6, height: 6, background: palette[i % palette.length] }} />
            <span className="text-[9.5px] capitalize" style={{ color: colors.textMuted }}>{r.label}</span>
            <span className="text-[9.5px] data-value" style={{ color: colors.textSecondary }}>{fmtValue(r.value, unit)}</span>
          </div>
        ))}
      </div>
      <p className="text-[9px] mt-1.5" style={{ color: colors.textMuted }}>of {fmtValue(total, unit)} tracked</p>
    </div>
  )
}

// Headline figure plus the breakdown behind it.
function SummaryViz({ rows, unit, total }: { rows: { label: string; value: number }[]; unit: 'ms' | 'count' | 'percent'; total: number }): React.ReactElement {
  const { colors } = useTheme()
  return (
    <div className="flex items-center gap-4">
      <div className="flex-shrink-0">
        <p className="text-[30px] font-bold leading-none data-value" style={{ color: colors.accent }}>{fmtValue(total, unit)}</p>
      </div>
      <div className="flex-1 min-w-0 flex flex-col gap-0.5">
        {rows.slice(0, 4).map((r) => (
          <div key={r.label} className="flex items-center justify-between gap-2">
            <span className="text-[10px] capitalize truncate" style={{ color: colors.textMuted }}>{r.label}</span>
            <span className="text-[10px] data-value flex-shrink-0" style={{ color: colors.textSecondary }}>{fmtValue(r.value, unit)}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

// hour x weekday grid. Cells arrive complete (all 168), so nothing is filled in here.
function HeatmapViz({ cells, max, unit }: { cells: { day: number; hour: number; value: number }[]; max: number; unit: 'ms' | 'count' | 'percent' }): React.ReactElement {
  const { colors } = useTheme()
  const byDay = useMemo(() => {
    const g: Record<number, { day: number; hour: number; value: number }[]> = {}
    for (const c of cells) (g[c.day] ||= []).push(c)
    for (const d of Object.keys(g)) g[Number(d)]!.sort((a, b) => a.hour - b.hour)
    return g
  }, [cells])

  return (
    <div className="overflow-x-auto">
      <div className="flex flex-col gap-[2px]" style={{ minWidth: 240 }}>
        {[0, 1, 2, 3, 4, 5, 6].map((day) => (
          <div key={day} className="flex items-center gap-[3px]">
            <span className="text-[8px] flex-shrink-0" style={{ color: colors.textMuted, width: 8 }}>{WEEKDAY_SHORT[day]}</span>
            <div className="flex gap-[2px] flex-1">
              {(byDay[day] ?? []).map((c) => (
                <div
                  key={c.hour}
                  title={`${WEEKDAY_SHORT[day]} ${c.hour}:00 — ${fmtValue(c.value, unit)}`}
                  style={{
                    flex: 1, height: 10, borderRadius: 2,
                    // Intensity, not hue: the grid should read at a glance without a legend.
                    background: c.value === 0 ? colors.glassEdge : colors.accent,
                    opacity: c.value === 0 ? 1 : 0.18 + (c.value / Math.max(1, max)) * 0.82,
                  }}
                />
              ))}
            </div>
          </div>
        ))}
      </div>
      <div className="flex items-center justify-end gap-1 mt-1.5">
        <span className="text-[8px]" style={{ color: colors.textMuted }}>less</span>
        {[0.2, 0.45, 0.7, 1].map((o) => (
          <span key={o} style={{ width: 8, height: 8, borderRadius: 2, background: colors.accent, opacity: o }} />
        ))}
        <span className="text-[8px]" style={{ color: colors.textMuted }}>more</span>
      </div>
    </div>
  )
}

// Ranked rows carrying what changed, not just what happened.
function RankedViz({ rows, unit, hasBaseline }: {
  rows: { label: string; value: number; baseline: number; delta: number; deltaPct: number | null }[]
  unit: 'ms' | 'count' | 'percent'
  hasBaseline: boolean
}): React.ReactElement {
  const { colors } = useTheme()
  return (
    <div>
      <div className="flex items-center gap-2 pb-1 mb-1" style={{ borderBottom: `1px solid ${colors.glassEdge}` }}>
        <span className="text-[8px] font-semibold uppercase tracking-wider flex-1" style={{ color: colors.textMuted }}>signal</span>
        <span className="text-[8px] font-semibold uppercase tracking-wider" style={{ color: colors.textMuted, width: 48, textAlign: 'right' }}>now</span>
        {hasBaseline && <span className="text-[8px] font-semibold uppercase tracking-wider" style={{ color: colors.textMuted, width: 56, textAlign: 'right' }}>change</span>}
      </div>
      {rows.slice(0, 8).map((r) => {
        const worse = r.delta > 0
        return (
          <div key={r.label} className="flex items-center gap-2 py-[3px]">
            <span className="text-[10.5px] capitalize truncate flex-1" style={{ color: colors.textSecondary }}>{r.label}</span>
            <span className="text-[10.5px] data-value" style={{ color: colors.textPrimary, width: 48, textAlign: 'right' }}>{fmtValue(r.value, unit)}</span>
            {hasBaseline && (
              <span className="text-[10px] data-value" style={{ width: 56, textAlign: 'right', color: r.deltaPct === null ? colors.textMuted : worse ? colors.negative : colors.positive }}>
                {r.deltaPct === null ? 'new' : `${worse ? '+' : ''}${r.deltaPct}%`}
              </span>
            )}
          </div>
        )
      })}
    </div>
  )
}

// A line with no scale is a decoration. Real axes, nice round ticks, recessive grid,
// and a hover layer, because an HTML chart IS interactive and should behave like it.
function LineViz({ rows, unit }: { rows: { label: string; value: number }[]; unit: 'ms' | 'count' | 'percent' }): React.ReactElement {
  const { colors } = useTheme()
  const [hover, setHover] = React.useState<number | null>(null)
  const H = 96, PAD_L = 34, PAD_B = 14
  const ticks = niceTicks(Math.max(...rows.map((r) => r.value), 0), unit)
  const max = ticks[ticks.length - 1] || 1
  const plotH = H - PAD_B

  const pts = rows.map((r, i) => ({ x: (i / Math.max(1, rows.length - 1)) * 100, y: plotH - (r.value / max) * (plotH - 4), r, i }))

  // Axis text is HTML, never SVG. The plot uses preserveAspectRatio="none" to stretch to
  // the card's width, and that scaling applies to glyphs too: putting <text> in there
  // smears the labels into each other. Only the path lives in the stretched SVG.
  const xLabels = rows.map((r) => r.label)
  const xStep = Math.max(1, Math.ceil(xLabels.length / 5))

  return (
    <div style={{ position: 'relative', paddingLeft: PAD_L, paddingBottom: PAD_B }}>
      {/* y ticks + gridlines */}
      {ticks.map((t) => {
        const pct = 100 - (t / max) * 100
        return (
          <div key={t} style={{ position: 'absolute', left: 0, right: 0, top: `calc(${pct}% - ${(pct / 100) * PAD_B}px)`, pointerEvents: 'none' }}>
            <div style={{ position: 'absolute', left: PAD_L, right: 0, borderTop: `1px solid ${colors.glassEdge}` }} />
            <span className="data-value" style={{
              position: 'absolute', left: 0, top: -5, width: PAD_L - 5, textAlign: 'right',
              fontSize: 8, color: colors.textDim,
            }}>{fmtTick(t, unit)}</span>
          </div>
        )
      })}

      <svg viewBox={`0 0 100 ${plotH}`} preserveAspectRatio="none"
        style={{ width: '100%', height: plotH, display: 'block' }}>
        <polyline
          points={pts.map((p) => `${p.x},${p.y}`).join(' ')}
          fill="none" stroke={colors.accent} strokeWidth={2}
          vectorEffect="non-scaling-stroke" strokeLinejoin="round" strokeLinecap="round"
        />
        {hover !== null && pts[hover] && (
          <circle cx={pts[hover]!.x} cy={pts[hover]!.y} r={2.5} fill={colors.accent}
            stroke={colors.glassHigh} strokeWidth={2} vectorEffect="non-scaling-stroke" />
        )}
      </svg>

      {/* x ticks, thinned so they never collide */}
      <div style={{ position: 'relative', height: PAD_B }}>
        {xLabels.map((l, i) => {
          if (i % xStep !== 0 && i !== xLabels.length - 1) return null
          const pct = (i / Math.max(1, xLabels.length - 1)) * 100
          return (
            <span key={`${l}-${i}`} className="data-value" style={{
              position: 'absolute', left: `${pct}%`,
              transform: i === 0 ? 'none' : i === xLabels.length - 1 ? 'translateX(-100%)' : 'translateX(-50%)',
              top: 2, fontSize: 8, color: colors.textDim, whiteSpace: 'nowrap',
            }}>{l}</span>
          )
        })}
      </div>

      {/* Hit targets bigger than the marks. */}
      <div style={{ position: 'absolute', left: PAD_L, right: 0, top: 0, height: plotH, display: 'flex' }}>
        {rows.map((_, i) => (
          <div key={i} style={{ flex: 1 }} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)} />
        ))}
      </div>

      {hover !== null && rows[hover] && (
        <div className="rounded-md px-2 py-1 pointer-events-none" style={{
          position: 'absolute', left: `calc(${PAD_L}px + ${(hover / Math.max(1, rows.length - 1)) * 100}%)`,
          top: -2, transform: 'translate(-50%,-100%)',
          background: colors.glassHigh, border: `1px solid ${colors.glassEdge}`,
          backdropFilter: colors.blurSm, boxShadow: colors.elevLow, whiteSpace: 'nowrap', zIndex: 2,
        }}>
          <span className="text-[9px]" style={{ color: colors.textMuted }}>{rows[hover]!.label} </span>
          <span className="text-[9px] data-value" style={{ color: colors.textPrimary }}>{fmtValue(rows[hover]!.value, unit)}</span>
        </div>
      )}
    </div>
  )
}

function TableViz({ rows, unit }: { rows: { label: string; value: number; detail?: string }[]; unit: 'ms' | 'count' | 'percent' }): React.ReactElement {
  const { colors } = useTheme()
  return (
    <div className="overflow-x-auto">
      {rows.slice(0, 12).map((r) => (
        <div key={r.label} className="flex items-center gap-2 py-[3px]">
          <span className="text-[10.5px] capitalize truncate flex-1" style={{ color: colors.textSecondary }}>{r.label}</span>
          <span className="text-[10.5px] data-value" style={{ color: colors.textPrimary }}>{fmtValue(r.value, unit)}</span>
          {r.detail && <span className="text-[9px] flex-shrink-0" style={{ color: colors.textMuted, width: 66, textAlign: 'right' }}>{r.detail}</span>}
        </div>
      ))}
    </div>
  )
}

/** Plain items. The viz for non-activity sources (goals, preferences, schedules). */
function ListViz({ items }: { items: { label: string; detail?: string }[] }): React.ReactElement {
  const { colors } = useTheme()
  if (!items.length) return <p className="text-[10px] py-3 text-center" style={{ color: colors.textMuted }}>Nothing here yet.</p>
  return (
    <div className="flex flex-col gap-1">
      {items.slice(0, 10).map((i, idx) => (
        <div key={`${i.label}-${idx}`} className="flex items-start gap-2">
          <span className="rounded-full flex-shrink-0" style={{ width: 4, height: 4, background: colors.accent, marginTop: 6 }} />
          <div className="min-w-0 flex-1">
            <p className="text-[11px] leading-snug" style={{ color: colors.textSecondary }}>{i.label}</p>
            {i.detail && <p className="text-[9px]" style={{ color: colors.textMuted }}>{i.detail}</p>}
          </div>
        </div>
      ))}
    </div>
  )
}

// ── the card ──────────────────────────────────────────────────────────────────

export interface CardProps {
  card: CustomAnalyticsCard
  /** Activity log, for data cards on the 'activity' source. */
  sessions?: ActivitySession[]
  /** Pre-resolved items for non-activity sources (goals, preferences, schedules...). */
  items?: { label: string; detail?: string }[]
  onDelete?: () => void
  onRun?: () => void
  /** Clicking the card body opens its detail. */
  onOpen?: () => void
  /** Drag-to-reorder wiring, supplied by CardCanvas. */
  dragHandlers?: React.HTMLAttributes<HTMLDivElement> & { draggable?: boolean }
  isDragging?: boolean
}

export default function Card({ card, sessions = [], items, onDelete, onRun, onOpen, dragHandlers, isDragging }: CardProps): React.ReactElement {
  const { colors } = useTheme()
  const askAI = useAskAI()

  // Recomputed locally every render: the card stores a spec, never a result.
  const data = useMemo(() => {
    if (card.kind === 'action') return null
    if (card.viz === 'heatmap') return { heatmap: runHeatmapQuery(sessions, card.spec) }
    if (card.viz === 'ranked') return { ranked: runRankedQuery(sessions, card.spec) }
    return { flat: runAnalyticsQuery(sessions, card.spec) }
  }, [card, sessions])

  const subtitle = card.description
    || (card.kind === 'action' ? card.action?.label : `${card.spec.metric.replace('_', ' ')} by ${card.spec.groupBy} · last ${card.spec.rangeDays}d`)

  const ask = (): void => {
    if (!askAI) return
    askAI(`About my "${card.title}" card (${subtitle}): what stands out and what should I do about it?`)
  }

  const empty = data?.flat ? data.flat.matched === 0
    : data?.heatmap ? data.heatmap.matched === 0
    : data?.ranked ? data.ranked.matched === 0
    : false

  return (
    <div
      {...dragHandlers}
      onClick={(e) => {
        // Buttons inside the card own their clicks; only the body opens the detail.
        if (onOpen && !(e.target as HTMLElement).closest('button')) onOpen()
      }}
      className="rounded-xl p-3 group"
      style={{
        // glassMid: cards float on the app's backdrop, so the ambient state reads through.
        background: colors.glassMid,
        backdropFilter: colors.blurMd,
        WebkitBackdropFilter: colors.blurMd,
        border: `1px solid ${colors.glassEdge}`,
        boxShadow: isDragging ? colors.elevHigh : colors.elevLow,
        cursor: onOpen ? 'pointer' : undefined,
        opacity: isDragging ? 0.6 : 1,
        transition: 'box-shadow 0.15s ease, opacity 0.15s ease',
      }}
    >
      <div className="flex items-start justify-between gap-2 mb-2">
        <div className="flex items-start gap-1.5 min-w-0">
          {dragHandlers && (
            <span className="flex-shrink-0 cursor-grab active:cursor-grabbing opacity-0 group-hover:opacity-60 transition-opacity"
              style={{ color: colors.textMuted, marginTop: 1 }} title="Drag to reorder">
              <GripVertical size={12} />
            </span>
          )}
          <div className="min-w-0">
            <p className="text-[12px] font-semibold truncate" style={{ color: colors.textPrimary }}>{card.title}</p>
            <p className="text-[9.5px] truncate" style={{ color: colors.textMuted }}>{subtitle}</p>
          </div>
        </div>
        <div className="flex items-center gap-1 flex-shrink-0">
          {askAI && (
            <button onClick={ask} title="Ask Attentify about this"
              className="text-[9px] px-1.5 py-0.5 rounded transition-opacity opacity-0 group-hover:opacity-100"
              style={{ border: `1px solid ${colors.borderMid}`, color: colors.accent }}>
              Ask
            </button>
          )}
          {onDelete && (
            <button onClick={onDelete} title="Delete card"
              className="p-1 rounded transition-opacity opacity-0 group-hover:opacity-60" style={{ color: colors.textMuted }}>
              <Trash2 size={12} />
            </button>
          )}
        </div>
      </div>

      {card.kind === 'action' ? (
        <button onClick={onRun}
          className="w-full flex items-center justify-center gap-1.5 py-2 rounded-lg text-[11px] font-medium transition-all hover:brightness-110"
          style={{ background: colors.accentBg, border: `1px solid ${colors.borderMid}`, color: colors.accent }}>
          <Play size={11} /> {card.action?.label ?? 'Run'}
        </button>
      ) : card.viz === 'list' ? (
        <ListViz items={items ?? []} />
      ) : empty ? (
        <p className="text-[10px] py-3 text-center" style={{ color: colors.textMuted }}>No matching activity yet.</p>
      ) : card.viz === 'heatmap' && data?.heatmap ? (
        <HeatmapViz cells={data.heatmap.cells} max={data.heatmap.max} unit={data.heatmap.unit} />
      ) : card.viz === 'ranked' && data?.ranked ? (
        <RankedViz rows={data.ranked.rows} unit={data.ranked.unit} hasBaseline={data.ranked.hasBaseline} />
      ) : data?.flat ? (
        card.viz === 'number' ? (
          <div className="py-1">
            <p className="text-[26px] font-bold leading-none data-value" style={{ color: colors.accent }}>{fmtValue(data.flat.total, data.flat.unit)}</p>
            <p className="text-[9.5px] mt-1" style={{ color: colors.textMuted }}>across {data.flat.matched} sessions</p>
          </div>
        ) : card.viz === 'progress' ? (
          <ProgressViz rows={data.flat.rows} unit={data.flat.unit} total={data.flat.total} />
        ) : card.viz === 'summary' ? (
          <SummaryViz rows={data.flat.rows} unit={data.flat.unit} total={data.flat.total} />
        ) : card.viz === 'line' ? (
          <LineViz rows={data.flat.rows} unit={data.flat.unit} />
        ) : card.viz === 'table' ? (
          <TableViz rows={data.flat.rows} unit={data.flat.unit} />
        ) : (
          <BarViz rows={data.flat.rows} unit={data.flat.unit} />
        )
      ) : null}
    </div>
  )
}

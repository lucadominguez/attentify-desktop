import React from 'react'
import { useTheme } from '../../context/ThemeContext'

// Chart furniture: the axes, ticks and gridlines every plot needs to be readable.
//
// A line with no scale is a decoration, not a chart. These were missing, so a card
// showed a shape with no way to know what it was worth. Rules used here:
//   - grid and axes are recessive; the data is the only thing with contrast
//   - tick labels wear text tokens, never the series colour
//   - "nice" round ticks, not raw data maxima
//   - selective labels: a value on every point is noise

/** Round a max up to a human tick step, so the axis reads 0/15m/30m, not 0/17m/34m. */
export function niceTicks(max: number, unit: 'ms' | 'count' | 'percent', count = 4): number[] {
  if (max <= 0) return [0]
  if (unit === 'percent') return [0, 25, 50, 75, 100]
  const raw = max / count
  const mag = Math.pow(10, Math.floor(Math.log10(raw)))
  const norm = raw / mag
  // Minutes read naturally in 1/2/5/10 steps; ms needs the same logic on a minute base.
  const step = (norm >= 5 ? 5 : norm >= 2 ? 2 : 1) * mag
  const top = Math.ceil(max / step) * step
  const out: number[] = []
  for (let v = 0; v <= top + 1e-9; v += step) out.push(v)
  return out
}

export function fmtTick(v: number, unit: 'ms' | 'count' | 'percent'): string {
  if (unit === 'percent') return `${Math.round(v)}%`
  if (unit === 'count') return String(Math.round(v))
  const m = Math.round(v / 60000)
  if (m < 60) return `${m}m`
  const h = m / 60
  return Number.isInteger(h) ? `${h}h` : `${h.toFixed(1)}h`
}

/** Horizontal gridlines + y tick labels, drawn behind the plot. */
export function YAxis({
  ticks, unit, height, labelWidth = 34,
}: { ticks: number[]; unit: 'ms' | 'count' | 'percent'; height: number; labelWidth?: number }): React.ReactElement {
  const { colors } = useTheme()
  const max = ticks[ticks.length - 1] || 1
  return (
    <>
      {ticks.map((t) => {
        const y = height - (t / max) * height
        return (
          <g key={t}>
            <line
              x1={labelWidth} x2="100%" y1={y} y2={y}
              stroke={colors.glassEdge} strokeWidth={1} shapeRendering="crispEdges"
            />
            <text
              x={labelWidth - 5} y={y + 3} textAnchor="end"
              style={{ fontSize: 8, fill: colors.textDim, fontFamily: '"Share Tech Mono", monospace' }}
            >
              {fmtTick(t, unit)}
            </text>
          </g>
        )
      })}
    </>
  )
}

/** X tick labels under the plot. Thinned so they never collide. */
export function XAxis({
  labels, width, labelWidth = 34, max = 6,
}: { labels: string[]; width: number; labelWidth?: number; max?: number }): React.ReactElement {
  const { colors } = useTheme()
  if (!labels.length) return <></>
  const step = Math.max(1, Math.ceil(labels.length / max))
  const plot = width - labelWidth
  return (
    <>
      {labels.map((l, i) => {
        if (i % step !== 0 && i !== labels.length - 1) return null
        const x = labelWidth + (i / Math.max(1, labels.length - 1)) * plot
        return (
          <text
            key={`${l}-${i}`} x={x} y="100%" textAnchor={i === 0 ? 'start' : i === labels.length - 1 ? 'end' : 'middle'}
            style={{ fontSize: 8, fill: colors.textDim, fontFamily: '"Share Tech Mono", monospace' }}
          >
            {l}
          </text>
        )
      })}
    </>
  )
}

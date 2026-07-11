import React from 'react'

interface ProgressArcProps {
  percentage: number
  color?: string
  trackColor?: string
  size?: number
  strokeWidth?: number
  children?: React.ReactNode
}

export default function ProgressArc({
  percentage,
  color = '#34d399',
  trackColor = '#1e3a5f',
  size = 160,
  strokeWidth = 10,
  children,
}: ProgressArcProps): React.ReactElement {
  const cx = size / 2
  const cy = size / 2 + 10
  const radius = (size - strokeWidth * 2 - 8) / 2

  // Semicircle from -180 to 0 (left to right, bottom arc)
  const startAngle = -180
  const endAngle = 0
  const circumference = Math.PI * radius

  const clampedPct = Math.max(0, Math.min(100, percentage))
  const filledLength = (clampedPct / 100) * circumference

  function polarToCartesian(angle: number): { x: number; y: number } {
    const rad = ((angle - 90) * Math.PI) / 180
    return {
      x: cx + radius * Math.cos(rad),
      y: cy + radius * Math.sin(rad),
    }
  }

  function describeArc(start: number, end: number): string {
    const s = polarToCartesian(start)
    const e = polarToCartesian(end)
    const largeArc = end - start > 180 ? 1 : 0
    return `M ${s.x} ${s.y} A ${radius} ${radius} 0 ${largeArc} 1 ${e.x} ${e.y}`
  }

  const arcPath = describeArc(startAngle + 90, endAngle + 90)

  return (
    <div className="relative flex items-end justify-center" style={{ width: size, height: size / 2 + 20 }}>
      <svg
        width={size}
        height={size / 2 + 20}
        viewBox={`0 0 ${size} ${size / 2 + 20}`}
        className="absolute inset-0"
      >
        {/* Track */}
        <path
          d={arcPath}
          fill="none"
          stroke={trackColor}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
        />
        {/* Progress */}
        <path
          d={arcPath}
          fill="none"
          stroke={color}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeDasharray={`${filledLength} ${circumference}`}
          style={{
            transition: 'stroke-dasharray 1.2s ease-out',
            filter: `drop-shadow(0 0 6px ${color}60)`,
          }}
        />
      </svg>
      {/* Center content */}
      <div className="relative z-10 flex flex-col items-center pb-2">{children}</div>
    </div>
  )
}

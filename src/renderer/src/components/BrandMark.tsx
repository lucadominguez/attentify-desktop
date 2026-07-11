import React from 'react'
import logoUrl from '../assets/logo.png'

// The Attentify mark — the real brand logo (friendly robot). The source art sits on a
// white field, so we render it inside a rounded tile: on the dark UI this reads as a
// crisp app-icon badge rather than a raw white rectangle. Scales cleanly from the
// titlebar (18px) to onboarding (160px).
export default function BrandMark({
  size = 28,
  className,
  style,
  rounded = true,
}: {
  size?: number
  className?: string
  style?: React.CSSProperties
  rounded?: boolean
}): React.ReactElement {
  return (
    <div
      className={className}
      style={{
        width: size,
        height: size,
        borderRadius: rounded ? Math.max(4, size * 0.22) : 0,
        overflow: 'hidden',
        background: '#fff',
        flexShrink: 0,
        boxShadow: rounded ? '0 0 0 1px rgba(255,255,255,0.06)' : 'none',
        ...style,
      }}
    >
      <img
        src={logoUrl}
        alt="Attentify"
        width={size}
        height={size}
        style={{ display: 'block', width: '100%', height: '100%', objectFit: 'cover' }}
        draggable={false}
      />
    </div>
  )
}

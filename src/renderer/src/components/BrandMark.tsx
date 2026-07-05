import React from 'react'

// The Attentify shield mark — a gradient shield with a circuit/target core, echoing
// the brand logo. Rendered inline as SVG so it stays crisp at every size (sidebar
// 26px → onboarding 160px) and can glow via the accent gradient on dark backgrounds.
//
// The gradient needs a DOM-unique id when several marks appear on one page, so each
// instance derives one from `idSuffix` (default random-ish per mount).
let _seq = 0

export default function BrandMark({
  size = 28,
  className,
  style,
}: {
  size?: number
  className?: string
  style?: React.CSSProperties
}): React.ReactElement {
  const gid = React.useMemo(() => `attentify-grad-${_seq++}`, [])
  return (
    <svg viewBox="0 0 32 32" width={size} height={size} className={className} style={style} aria-label="Attentify">
      <defs>
        <linearGradient id={gid} x1="4" y1="4" x2="28" y2="30" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#3fd6c8" />
          <stop offset="0.5" stopColor="#2aa8ea" />
          <stop offset="1" stopColor="#2b6fff" />
        </linearGradient>
      </defs>
      <path
        d="M16 2.5 L27 6.5 L27 15.5 C27 22 22.5 26.5 16 29.5 C9.5 26.5 5 22 5 15.5 L5 6.5 Z"
        fill="none" stroke={`url(#${gid})`} strokeWidth="1.7" strokeLinejoin="round"
      />
      <line x1="16" y1="6.5" x2="16" y2="25.5" stroke={`url(#${gid})`} strokeWidth="1" />
      <line x1="9" y1="16" x2="23" y2="16" stroke={`url(#${gid})`} strokeWidth="1" />
      <circle cx="16" cy="16" r="4.2" fill="none" stroke={`url(#${gid})`} strokeWidth="1.3" />
      <circle cx="16" cy="16" r="2" fill={`url(#${gid})`} />
      <circle cx="16" cy="9" r="1.2" fill="none" stroke={`url(#${gid})`} strokeWidth="1" />
      <circle cx="16" cy="23" r="1.2" fill="none" stroke={`url(#${gid})`} strokeWidth="1" />
      <circle cx="9" cy="16" r="1.2" fill="none" stroke={`url(#${gid})`} strokeWidth="1" />
      <circle cx="23" cy="16" r="1.2" fill="none" stroke={`url(#${gid})`} strokeWidth="1" />
    </svg>
  )
}

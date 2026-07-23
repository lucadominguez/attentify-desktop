import React from 'react'
import logoUrl from '../assets/logo.png'

// The Attentify mark, the real brand logo (the "A" monogram on its dark field).
//
// The art carries its own dark field, so this does not force a white tile behind it. It
// used to (the earlier robot source sat on a white field and needed one to read as a
// badge); with the current art a white tile would ring the dark icon. `rounded` just
// clips the corners of the square art.
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
        flexShrink: 0,
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

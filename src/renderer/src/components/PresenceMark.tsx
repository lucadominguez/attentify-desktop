import React from 'react'
import BrandMark from './BrandMark'
import { usePresence } from '../context/PresenceContext'

// The AI's body: the real logo art with a state-coloured aura behind it.
//
// This is the one place in the app allowed to move, and it barely does. The aura
// breathes on a ~5s cycle at low amplitude, which reads as alive in peripheral vision
// and is invisible when looked at directly. That is the point: a thing watching over
// you is mostly still.
//
// The art is the real file (never a redrawn SVG), and the mark keeps its own colour
// identity while the aura carries the app's state.
export default function PresenceMark({ size = 26 }: { size?: number }): React.ReactElement {
  const { color, state } = usePresence()

  // Guarding is the resting state and should be almost imperceptible.
  const intensity = state === 'intervening' ? 0.55 : state === 'drifting' ? 0.4 : state === 'focused' ? 0.34 : 0.22

  return (
    <div style={{ position: 'relative', width: size, height: size, flexShrink: 0 }}>
      {/* Aura. Sits behind the mark and bleeds past its edges. */}
      <div
        aria-hidden
        className="presence-breathe"
        style={{
          position: 'absolute',
          inset: -size * 0.42,
          borderRadius: '50%',
          background: `radial-gradient(circle, ${color} 0%, transparent 68%)`,
          opacity: intensity,
          filter: 'blur(6px)',
          transition: 'opacity 2.4s ease, background 2.4s ease',
          pointerEvents: 'none',
        }}
      />
      <BrandMark size={size} style={{ position: 'relative', zIndex: 1 }} />
    </div>
  )
}

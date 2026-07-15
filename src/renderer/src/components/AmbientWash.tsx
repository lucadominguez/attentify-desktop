import React from 'react'
import { usePresence } from '../context/PresenceContext'

// The app's ambient response to your state. A very low opacity wash behind everything
// that shifts hue as the presence changes: calm indigo while guarding, warmth creeping
// in as you drift, a brief coral bloom when it steps in.
//
// This is the "sentient" signal, and it is deliberately almost subliminal. It sits
// behind all content, never animates on a loop, and transitions over seconds rather
// than milliseconds, so it is felt at the edge of vision instead of watched. If you
// can catch it moving, it is too strong.
export default function AmbientWash(): React.ReactElement {
  const { color, state } = usePresence()

  // Drifting and intervening are the states worth feeling; guarding stays near-invisible.
  const strength = state === 'intervening' ? 0.16 : state === 'drifting' ? 0.10 : state === 'focused' ? 0.07 : 0.05

  return (
    <div
      aria-hidden
      style={{
        position: 'fixed',
        inset: 0,
        pointerEvents: 'none',
        zIndex: 0,
        // Corners, not centre: the wash frames the content rather than sitting under it.
        background: `
          radial-gradient(ellipse 80% 60% at 8% 0%, ${color} 0%, transparent 60%),
          radial-gradient(ellipse 70% 50% at 100% 100%, ${color} 0%, transparent 62%)
        `,
        opacity: strength,
        // Slow enough to feel like a mood changing, not a state flipping.
        transition: 'opacity 2.4s ease, background 2.4s ease',
      }}
    />
  )
}

import React from 'react'
import { usePresence } from '../context/PresenceContext'
import { useTheme } from '../context/ThemeContext'

// The breathing field. An experiment, behind the Settings toggle: opt-in, and off by
// default.
//
// The brief was "sentient, like it's breathing or has an electric pulse, but not super
// in your face", and that last clause is the whole design. Two things are running:
//
//   1. A dot mesh that breathes. It swells and fades on a 7s cycle, which is slow human
//      breathing, not a UI animation. This is the "alive" part.
//   2. A pulse that travels the mesh every ~13s. This is the "electric" part: a soft
//      band of light crossing the field, closer to a heartbeat on a monitor than to a
//      loading shimmer. Long gaps matter as much as the pulse does; something that
//      pulses constantly reads as a progress indicator, not a presence.
//
// Both obey the standing rule of this app: presence at the periphery, stillness at the
// centre. A radial mask empties the middle 45% entirely, so the field never runs under
// the text you are reading, only around it. The centre is where a previous attempt put
// a pulsing sphere; it was cut, and the reason it was cut applies here too.
//
// Costs: opacity and transform only, both compositor-driven, on two fixed layers that
// never reflow. Nothing here reads layout. This app runs 24/7, so an animation that
// forced paint would be unacceptable regardless of how it looked.
//
// It sits out under glass, for the same reason AmbientWash does: animated colour over a
// see-through window painted on the user's live desktop is exactly the psychedelia the
// glass experiment was archived for.
export default function PulseField(): React.ReactElement | null {
  const { color, state } = usePresence()
  const { pulse, glass } = useTheme()

  if (!pulse || glass) return null

  // The presence still leads. Drifting and intervening breathe harder; guarding is
  // barely a signal, which is correct: nothing is wrong, so nothing should draw the eye.
  //
  // These numbers were measured, not guessed. The first pass ran the mesh at ~0.09 and
  // diffed to a mean of 0.12/255 against the dark surface: invisible, not subtle. The
  // dots carry the whole effect and they cover ~2% of the field, so the layer opacity has
  // to be far higher than it intuitively "should" be for the mesh to read at all.
  const strength = state === 'intervening' ? 0.62 : state === 'drifting' ? 0.48 : state === 'focused' ? 0.38 : 0.32
  // Intervening quickens. A body under stress breathes faster, and this is the one
  // moment the app is allowed to be noticed.
  const breathSecs = state === 'intervening' ? 4.5 : 7

  return (
    <>
      <div
        aria-hidden
        className="pulse-field"
        style={{
          position: 'fixed',
          inset: 0,
          pointerEvents: 'none',
          zIndex: 0,
          // 18px dot mesh, 1.2px dots. Tight enough to read as one texture rather than
          // as a set of dots, loose enough not to become a grid you notice.
          backgroundImage: `radial-gradient(circle at center, ${color} 1.2px, transparent 1.2px)`,
          backgroundSize: '18px 18px',
          opacity: strength,
          // Empty centre, so it frames the content instead of sitting under it.
          maskImage: 'radial-gradient(ellipse 75% 75% at 50% 50%, transparent 45%, black 100%)',
          WebkitMaskImage: 'radial-gradient(ellipse 75% 75% at 50% 50%, transparent 45%, black 100%)',
          animation: `pulse-breathe ${breathSecs}s ease-in-out infinite`,
          transition: 'opacity 2.4s ease',
        }}
      />
      <div
        aria-hidden
        className="pulse-field"
        style={{
          position: 'fixed',
          inset: '-40% -10%',
          pointerEvents: 'none',
          zIndex: 0,
          // The travelling band, dimmed by the same mesh so the pulse looks like it is
          // moving THROUGH the field rather than floating over it.
          backgroundImage: `linear-gradient(100deg, transparent 42%, ${color} 50%, transparent 58%)`,
          maskImage: `radial-gradient(circle at center, black 1.2px, transparent 1.2px),
                      radial-gradient(ellipse 75% 75% at 50% 50%, transparent 45%, black 100%)`,
          WebkitMaskImage: `radial-gradient(circle at center, black 1.2px, transparent 1.2px),
                            radial-gradient(ellipse 75% 75% at 50% 50%, transparent 45%, black 100%)`,
          maskSize: '18px 18px, 100% 100%',
          WebkitMaskSize: '18px 18px, 100% 100%',
          maskComposite: 'intersect',
          WebkitMaskComposite: 'source-in',
          opacity: strength * 0.9,
          animation: 'pulse-travel 13s cubic-bezier(0.45, 0, 0.2, 1) infinite',
          transition: 'opacity 2.4s ease',
        }}
      />
    </>
  )
}

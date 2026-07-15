import React, { createContext, useContext, useMemo } from 'react'
import { useTheme } from './ThemeContext'

// ── Presence ──────────────────────────────────────────────────────────────────
//
// Attentify should read as a sentient thing protecting your attention, not an
// application dashboard. The design rule that follows from that: an app whose whole
// purpose is protecting attention must never compete for it. So presence is expressed
// as slow ambient response, never as motion in the middle of the screen.
//
// "Presence at the periphery, stillness at the centre."
//
// This derives one state for the whole app from what it already knows. Everything
// ambient (the aura behind the mark, the backdrop wash) reads from here, so the app
// feels like it is noticing you before you read a single number.
//
// NOTE: deliberately NOT a PulsingSphere. A big animated orb was built here once and
// cut, and "sentient AI" pulls straight back toward it. The presence lives in the
// sidebar anchor and in the backdrop, never as a centrepiece performing at the user.

export type PresenceState =
  | 'guarding'    // default: watching, nothing wrong
  | 'focused'     // a focus session is running
  | 'drifting'    // attention is slipping, or something is waiting to be reviewed
  | 'intervening' // it just stepped in

export interface Presence {
  state: PresenceState
  /** Hue for the aura + ambient wash. */
  color: string
  /** One short line in the AI's own voice. Headline moments only, never table copy. */
  line: string
}

const PresenceCtx = createContext<Presence>({ state: 'guarding', color: '#6366f1', line: 'Watching over your attention.' })

export function usePresence(): Presence {
  return useContext(PresenceCtx)
}

export function PresenceProvider({
  hasActiveSession, alertCount, pendingCount, intervening, children,
}: {
  hasActiveSession?: boolean
  alertCount?: number
  pendingCount?: number
  /** True briefly right after a block fires. */
  intervening?: boolean
  children: React.ReactNode
}): React.ReactElement {
  const { colors } = useTheme()

  const value = useMemo<Presence>(() => {
    // Order matters: the most urgent true thing wins.
    if (intervening) {
      return { state: 'intervening', color: colors.negative, line: 'I stepped in.' }
    }
    if ((alertCount ?? 0) > 0 || (pendingCount ?? 0) > 0) {
      return { state: 'drifting', color: colors.warning, line: "Something's pulling at you." }
    }
    if (hasActiveSession) {
      return { state: 'focused', color: colors.positive, line: "You're in. I'll hold the door." }
    }
    return { state: 'guarding', color: colors.accent, line: 'Watching over your attention.' }
  }, [intervening, alertCount, pendingCount, hasActiveSession, colors])

  return <PresenceCtx.Provider value={value}>{children}</PresenceCtx.Provider>
}

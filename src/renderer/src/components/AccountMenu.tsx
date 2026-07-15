import React, { useEffect, useRef, useState, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { User } from 'lucide-react'
import type { AuthState } from '@shared/types'
import { useTheme } from '../context/ThemeContext'
import AuthPanel from './AuthPanel'

const api = (window as unknown as { electronAPI: Window['electronAPI'] }).electronAPI

const PANEL_W = 320

// The account entry point, always on screen rather than buried in Settings. Shows an
// avatar, a generic person when signed out, or the account's initial once signed in —
// and opens a popover with the full sign-in surface (social providers + email/password)
// or the signed-in account card.
//
// `variant` controls where the popover is anchored, which cannot be inferred from the
// button alone: in the left sidebar it must open to the RIGHT of the button (anchoring to
// the window's right edge, as the old title-bar cluster did, would push a 320px panel off
// the left of the screen).
export default function AccountMenu({
  onChange, variant = 'sidebar',
}: { onChange?: () => void; variant?: 'titlebar' | 'sidebar' }): React.ReactElement {
  const { colors } = useTheme()
  const [auth, setAuth] = useState<AuthState | null>(null)
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState<{ top: number; left?: number; right?: number }>({ top: 44, right: 12 })
  const btnRef = useRef<HTMLButtonElement>(null)

  const load = useCallback(() => { api.getAuth?.().then(setAuth).catch(() => setAuth(null)) }, [])
  useEffect(() => { load() }, [load])

  const toggle = (): void => {
    if (!open && btnRef.current) {
      const r = btnRef.current.getBoundingClientRect()
      if (variant === 'sidebar') {
        // Open beside the button, and flip upward when it would overflow the bottom.
        const top = Math.min(Math.round(r.top), Math.max(8, window.innerHeight - 360))
        setPos({ top, left: Math.min(Math.round(r.right + 8), Math.max(8, window.innerWidth - PANEL_W - 8)) })
      } else {
        setPos({ top: Math.round(r.bottom + 6), right: Math.max(8, Math.round(window.innerWidth - r.right)) })
      }
    }
    setOpen((v) => !v)
  }

  // Close on Escape for keyboard users.
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent): void => { if (e.key === 'Escape') setOpen(false) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  const signedIn = !!auth?.signedIn
  const initial = auth?.email ? auth.email[0]!.toUpperCase() : ''
  const size = variant === 'sidebar' ? 26 : 22

  return (
    <>
      <button
        ref={btnRef}
        onClick={toggle}
        className={`${variant === 'titlebar' ? 'titlebar-nodrag ' : ''}flex items-center justify-center rounded-full transition-all`}
        title={signedIn ? `Signed in as ${auth?.email}` : 'Sign in to your account'}
        style={{
          width: size, height: size,
          background: signedIn ? colors.accent : 'transparent',
          border: `1px solid ${signedIn ? colors.accent : 'rgba(99,102,241,0.3)'}`,
          color: signedIn ? '#fff' : colors.textMuted,
          fontSize: variant === 'sidebar' ? 12 : 11, fontWeight: 600,
          boxShadow: signedIn ? `0 0 0 2px ${colors.accentBg}` : 'none',
        }}
      >
        {signedIn ? initial : <User size={variant === 'sidebar' ? 14 : 12} />}
      </button>

      {/* Portalled to <body> deliberately. The sidebar sets backdrop-filter, and a
          backdrop-filter creates a containing block for position:fixed descendants, so
          rendering the popover in place trapped it inside the sidebar's stacking context
          and the main pane painted over it. MetricDrill portals for the same reason. */}
      {open && createPortal(
        <>
          {/* click-away backdrop */}
          <div className="fixed inset-0 z-[90]" onClick={() => setOpen(false)} />
          <div
            className="fixed z-[91]"
            style={{ top: pos.top, left: pos.left, right: pos.right, width: PANEL_W }}
            onClick={(e) => e.stopPropagation()}
          >
            <div
              className="rounded-xl overflow-hidden"
              style={{
                background: colors.glassHigh,
                backdropFilter: colors.blurLg,
                WebkitBackdropFilter: colors.blurLg,
                border: `1px solid ${colors.glassEdge}`,
                boxShadow: `${colors.elevHigh}, ${colors.glassTopLight}`,
              }}
            >
              <div className="px-4 pt-3 pb-1">
                <p className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: colors.textMuted }}>Account</p>
              </div>
              <div className="p-3 pt-1">
                <AuthPanel onChange={() => { load(); onChange?.() }} />
              </div>
            </div>
          </div>
        </>,
        document.body,
      )}
    </>
  )
}

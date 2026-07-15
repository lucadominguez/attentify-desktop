import React, { useState, useEffect, useRef } from 'react'
import { X, Shield, AlertTriangle, Brain, Eye, Zap } from 'lucide-react'

const api = (window as unknown as { electronAPI: Window['electronAPI'] }).electronAPI

export interface OverlayAction {
  label: string
  type: 'block' | 'break' | 'dismiss' | 'chat' | 'view-actions'
  domain?: string
  durationMs?: number
  chatMsg?: string
}

export interface OverlayNotification {
  id: string
  type: 'auto-block' | 'suggest' | 'heuristic' | 'guard' | 'proactive'
  title: string
  rawMessage: string
  aiMessage?: string
  actions: OverlayAction[]
  domain?: string
  confidence?: number
}

const DISMISS_AFTER = 12_000

const TYPE_CONFIG = {
  'auto-block': { color: '#f87171', dimColor: 'rgba(248,113,113,0.12)', border: 'rgba(248,113,113,0.35)', icon: Shield, label: 'BLOCKED' },
  'suggest':    { color: '#fbbf24', dimColor: 'rgba(251,191,36,0.10)', border: 'rgba(251,191,36,0.35)', icon: AlertTriangle, label: 'FLAGGED' },
  'heuristic':  { color: '#a78bfa', dimColor: 'rgba(167,139,250,0.10)', border: 'rgba(167,139,250,0.35)', icon: Brain, label: 'PATTERN' },
  'guard':      { color: '#6366f1', dimColor: 'rgba(99,102,241,0.08)', border: 'rgba(99,102,241,0.30)', icon: Eye, label: 'GUARD' },
  'proactive':  { color: '#34d399', dimColor: 'rgba(52,211,153,0.08)', border: 'rgba(52,211,153,0.30)', icon: Zap, label: 'DAEMON' },
}

const ACTION_STYLE = {
  block:        { bg: 'rgba(248,113,113,0.12)', border: 'rgba(248,113,113,0.35)', color: '#f87171' },
  break:        { bg: 'rgba(251,191,36,0.10)', border: 'rgba(251,191,36,0.30)', color: '#fcd34d' },
  chat:         { bg: 'rgba(99,102,241,0.08)', border: 'rgba(99,102,241,0.25)', color: '#6366f1' },
  'view-actions': { bg: 'rgba(99,102,241,0.06)', border: 'rgba(99,102,241,0.18)', color: 'rgba(99,102,241,0.7)' },
  dismiss:      { bg: 'rgba(255,255,255,0.04)', border: 'rgba(255,255,255,0.10)', color: 'rgba(255,255,255,0.35)' },
}

export default function OverlayCard(): React.ReactElement | null {
  const [notif, setNotif] = useState<OverlayNotification | null>(null)
  const [progress, setProgress] = useState(1)
  const [acting, setActing] = useState(false)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const startRef = useRef<number>(0)

  const dismiss = (id: string): void => {
    if (timerRef.current) clearInterval(timerRef.current)
    api.overlayDismiss(id)
    setNotif(null)
    setProgress(1)
  }

  const handleAction = async (action: OverlayAction): Promise<void> => {
    if (!notif || acting) return
    setActing(true)
    if (timerRef.current) clearInterval(timerRef.current)

    switch (action.type) {
      case 'block':
        if (action.domain) await api.addDomain(action.domain)
        break
      case 'break':
        await api.startBreak(action.durationMs ?? 300_000)
        break
      case 'chat':
        api.overlayAction(notif.id, action)
        break
      case 'view-actions':
        api.overlayAction(notif.id, action)
        break
    }

    api.overlayDismiss(notif.id)
    setNotif(null)
    setProgress(1)
    setActing(false)
  }

  useEffect(() => {
    const offShow = api.onOverlayShow((n: OverlayNotification) => {
      if (timerRef.current) clearInterval(timerRef.current)
      setNotif(n)
      setProgress(1)
      setActing(false)
      startRef.current = Date.now()

      timerRef.current = setInterval(() => {
        const elapsed = Date.now() - startRef.current
        const remaining = 1 - elapsed / DISMISS_AFTER
        if (remaining <= 0) {
          if (timerRef.current) clearInterval(timerRef.current)
          api.overlayDismiss(n.id)
          setNotif(null)
          setProgress(1)
        } else {
          setProgress(remaining)
        }
      }, 80)
    })

    const offUpdate = api.onOverlayUpdate((update: { id: string; aiMessage: string }) => {
      setNotif((prev) => prev?.id === update.id ? { ...prev, aiMessage: update.aiMessage } : prev)
    })

    // Tell main the overlay is mounted and listening — main waits for this before
    // flushing a queued notification, so one can never arrive before we can render it.
    api.overlayReady?.()

    return () => { offShow(); offUpdate(); if (timerRef.current) clearInterval(timerRef.current) }
  }, [])

  // Once a notification is actually in the DOM, tell main it's safe to reveal the
  // window. Until this fires, main keeps the window hidden, so it can never appear
  // blank in the corner. useLayoutEffect runs after paint of this notification.
  React.useLayoutEffect(() => {
    if (notif) api.overlayShown?.(notif.id)
  }, [notif])

  if (!notif) return null

  const cfg = TYPE_CONFIG[notif.type] ?? TYPE_CONFIG['guard']
  const Icon = cfg.icon
  const displayMessage = notif.aiMessage ?? notif.rawMessage
  const isLoading = !notif.aiMessage

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        display: 'flex',
        alignItems: 'flex-end',
        justifyContent: 'flex-end',
        padding: 0,
        pointerEvents: 'none',
      }}
    >
      {/* Liquid glass. The window is already transparent (NotificationQueue sets
          transparent:true + #00000000), so this floats directly on the user's desktop —
          the AI present on the machine rather than a window that opened.
          The blur was previously defeated: backdropFilter was set but the background sat
          at 0.97 alpha, so nothing could show through it. The alpha is what makes it glass;
          the blur only keeps whatever shows through from turning into noise behind text. */}
      <div
        style={{
          width: 400,
          borderRadius: 18,
          overflow: 'hidden',
          background: `linear-gradient(160deg, rgba(10,18,34,0.62), rgba(4,10,20,0.72))`,
          // Hairline edge, brightest at the top where light would catch it.
          border: '1px solid rgba(255,255,255,0.10)',
          backdropFilter: 'blur(28px) saturate(160%)',
          WebkitBackdropFilter: 'blur(28px) saturate(160%)',
          boxShadow: [
            '0 24px 64px rgba(0,0,0,0.55)',           // lift off the desktop
            `0 0 0 1px ${cfg.border}`,                 // state colour, as an edge not a frame
            'inset 0 1px 0 rgba(255,255,255,0.14)',    // top light catch
            `inset 0 0 60px ${cfg.dimColor}`,          // state bleed from within
          ].join(', '),
          pointerEvents: 'all',
          userSelect: 'none',
          animation: 'slideIn 0.22s cubic-bezier(0.34,1.56,0.64,1)',
        }}
      >
        {/* Top accent line */}
        <div style={{ height: 2, background: `linear-gradient(90deg, ${cfg.color}, transparent)` }} />

        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 12px 8px' }}>
          <div style={{
            width: 22, height: 22, display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: cfg.dimColor, border: `1px solid ${cfg.border}`, flexShrink: 0,
          }}>
            <Icon size={12} style={{ color: cfg.color }} />
          </div>
          <span style={{
            fontSize: 9, fontWeight: 700, letterSpacing: '0.22em', textTransform: 'uppercase',
            color: cfg.color, fontFamily: '"Share Tech Mono", monospace', flex: 1,
          }}>
            {cfg.label}
            {notif.domain && <span style={{ color: 'rgba(255,255,255,0.35)', marginLeft: 6 }}>· {notif.domain}</span>}
          </span>
          <button
            onClick={() => dismiss(notif.id)}
            style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 2, color: 'rgba(255,255,255,0.25)', display: 'flex' }}
          >
            <X size={12} />
          </button>
        </div>

        {/* Message */}
        <div style={{ padding: '0 12px 10px', minHeight: 40 }}>
          {isLoading ? (
            <div style={{ display: 'flex', gap: 3, alignItems: 'center', paddingTop: 4 }}>
              {[0, 1, 2].map((i) => (
                <div key={i} style={{
                  width: 4, height: 4, borderRadius: '50%',
                  background: 'rgba(255,255,255,0.2)',
                  animation: `pulse 1s ${i * 0.2}s ease-in-out infinite`,
                }} />
              ))}
            </div>
          ) : (
            <p style={{
              fontSize: 12, lineHeight: 1.5, color: 'rgba(255,255,255,0.82)',
              margin: 0, fontWeight: 400,
            }}>
              {displayMessage}
            </p>
          )}
        </div>

        {/* Action buttons */}
        <div style={{ display: 'flex', gap: 6, padding: '0 12px 10px', flexWrap: 'wrap' }}>
          {notif.actions.map((action) => {
            const s = ACTION_STYLE[action.type] ?? ACTION_STYLE.dismiss
            return (
              <button
                key={action.label}
                onClick={() => void handleAction(action)}
                disabled={acting}
                style={{
                  fontSize: 9, fontWeight: 700, letterSpacing: '0.14em', textTransform: 'uppercase',
                  padding: '5px 10px', cursor: acting ? 'default' : 'pointer', opacity: acting ? 0.5 : 1,
                  background: s.bg, border: `1px solid ${s.border}`, color: s.color,
                  fontFamily: '"Share Tech Mono", monospace', transition: 'opacity 0.15s',
                }}
              >
                {action.label}
              </button>
            )
          })}
        </div>

        {/* Progress bar */}
        <div style={{ height: 2, background: 'rgba(255,255,255,0.06)' }}>
          <div style={{
            height: '100%',
            width: `${progress * 100}%`,
            background: cfg.color,
            opacity: 0.5,
            transition: 'width 0.08s linear',
          }} />
        </div>
      </div>

      <style>{`
        @keyframes slideIn {
          from { opacity: 0; transform: translateX(24px) translateY(8px); }
          to   { opacity: 1; transform: none; }
        }
        @keyframes pulse {
          0%, 100% { opacity: 0.2; } 50% { opacity: 0.7; }
        }
      `}</style>
    </div>
  )
}

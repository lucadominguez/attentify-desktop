import React, { useState } from 'react'
import { Lock, Play, Square, Plus, X, ChevronRight } from 'lucide-react'
import type { AppStore } from '@shared/types'
import { useTheme } from '../context/ThemeContext'

const api = (window as unknown as { electronAPI: Window['electronAPI'] }).electronAPI

interface DeepFocusModeProps {
  store: AppStore
  onRefresh: () => void
}

const PRESETS = [
  { label: '25 min — Pomodoro', ms: 25 * 60 * 1000 },
  { label: '90 min — Flow state', ms: 90 * 60 * 1000 },
  { label: '3 hours — Deep work', ms: 3 * 60 * 60 * 1000 },
  { label: '4 hours — Half-day', ms: 4 * 60 * 60 * 1000 },
]

export default function DeepFocusMode({ store, onRefresh }: DeepFocusModeProps): React.ReactElement {
  const { colors } = useTheme()
  const [duration, setDuration] = useState<number>(90 * 60 * 1000)
  const [allowlistItem, setAllowlistItem] = useState('')
  const [allowlist, setAllowlist] = useState<string[]>(['github.com', 'notion.so', 'localhost'])
  const [starting, setStarting] = useState(false)
  const activeSession = store.sessions.find((s) => s.active && s.mode === 'deep')

  const handleStart = async (): Promise<void> => {
    setStarting(true)
    await api.startSession('deep', duration, allowlist)
    onRefresh()
    setStarting(false)
  }

  const handleStop = async (): Promise<void> => {
    const session = store.sessions.find((s) => s.active)
    if (session) await api.stopSession(session.id)
    onRefresh()
  }

  const addAllowlistItem = (): void => {
    const item = allowlistItem.trim().toLowerCase()
    if (item && !allowlist.includes(item)) {
      setAllowlist([...allowlist, item])
      setAllowlistItem('')
    }
  }

  return (
    <div className="p-6 animate-fade-in space-y-5">
      <div>
        <h1 className="font-bold text-xl flex items-center gap-2" style={{ color: colors.textPrimary }}>
          <Lock size={20} className="text-accent-amber" /> Deep Focus Mode
        </h1>
        <p className="text-sm mt-0.5" style={{ color: colors.textSecondary }}>Hardcore lockdown — blocks everything except your allowlist</p>
      </div>

      {activeSession ? (
        <div
          className="card flex flex-col items-center py-10 text-center"
          style={{ border: '1px solid rgba(76,175,80,0.3)', background: 'rgba(76,175,80,0.05)' }}
        >
          <div className="w-16 h-16 rounded-full bg-accent-green/10 border border-accent-green/30 flex items-center justify-center mb-4"
               style={{ boxShadow: '0 0 30px rgba(76,175,80,0.15)' }}>
            <Lock size={28} className="text-accent-green" />
          </div>
          <p className="text-accent-green font-bold text-xl mb-1">Deep Focus Active</p>
          {activeSession.endsAt && (
            <p className="text-sm mb-6" style={{ color: colors.textSecondary }}>
              Until {new Date(activeSession.endsAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </p>
          )}
          {activeSession.endsAt && Date.now() < activeSession.endsAt ? (
            <div
              className="flex items-center gap-2 text-sm font-semibold px-6 py-2.5 rounded-full"
              style={{ background: 'rgba(255,184,0,0.08)', color: '#ffb800', border: '1px solid rgba(255,184,0,0.25)' }}
            >
              <Lock size={14} /> Locked until it ends
            </div>
          ) : (
            <button
              onClick={handleStop}
              className="flex items-center gap-2 text-sm font-semibold px-6 py-2.5 rounded-full transition-colors"
              style={{ background: colors.cardBg, color: colors.textPrimary, border: `1px solid ${colors.border}` }}
            >
              <Square size={14} /> End session
            </button>
          )}
        </div>
      ) : (
        <>
          {/* Duration selector */}
          <div className="card">
            <p className="text-sm font-semibold mb-3" style={{ color: colors.textPrimary }}>Session duration</p>
            <div className="grid grid-cols-2 gap-2 mb-3">
              {PRESETS.map((p) => (
                <button
                  key={p.ms}
                  onClick={() => setDuration(p.ms)}
                  className="px-3 py-2.5 rounded-lg text-xs font-medium transition-all"
                  style={{
                    background: duration === p.ms ? 'rgba(33,150,243,0.15)' : colors.cardBg,
                    border: `1px solid ${duration === p.ms ? 'rgba(33,150,243,0.4)' : colors.border}`,
                    color: duration === p.ms ? colors.textPrimary : colors.textSecondary,
                  }}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>

          {/* Allowlist */}
          <div className="card">
            <p className="text-sm font-semibold mb-1" style={{ color: colors.textPrimary }}>Allowlist</p>
            <p className="text-xs mb-3" style={{ color: colors.textSecondary }}>Only these sites/apps are accessible during the session</p>
            <div className="flex flex-wrap gap-2 mb-3">
              {allowlist.map((item) => (
                <div
                  key={item}
                  className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs"
                  style={{ background: colors.cardBg, border: `1px solid ${colors.border}`, color: colors.textPrimary }}
                >
                  {item}
                  <button
                    onClick={() => setAllowlist(allowlist.filter((i) => i !== item))}
                    className="hover:text-accent-orange transition-colors"
                    style={{ color: colors.textSecondary }}
                  >
                    <X size={11} />
                  </button>
                </div>
              ))}
            </div>
            <div className="flex gap-2">
              <input
                type="text"
                placeholder="github.com"
                value={allowlistItem}
                onChange={(e) => setAllowlistItem(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && addAllowlistItem()}
                className="flex-1 text-xs px-3 py-2 rounded-lg outline-none transition-colors"
                style={{ background: colors.inputBg, border: `1px solid ${colors.border}`, color: colors.textPrimary }}
              />
              <button
                onClick={addAllowlistItem}
                className="text-xs px-3 py-2 rounded-lg transition-colors"
                style={{ background: colors.cardBg, border: `1px solid ${colors.border}`, color: colors.textPrimary }}
              >
                <Plus size={13} />
              </button>
            </div>
          </div>

          <button
            onClick={handleStart}
            disabled={starting}
            className="w-full flex items-center justify-center gap-2 bg-accent-blue hover:bg-accent-blue-light disabled:opacity-60 text-white font-bold py-3.5 rounded-full text-base transition-all"
            style={{ boxShadow: '0 0 20px rgba(33,150,243,0.2)' }}
          >
            {starting ? <div className="w-4 h-4 border border-white border-t-transparent rounded-full animate-spin" /> : <Play size={16} fill="currentColor" />}
            {starting ? 'Activating…' : 'Enter Deep Focus Mode'}
          </button>
          <p className="text-xs text-center" style={{ color: colors.textSecondary }}>Once started, you'll need to wait for the session to end to disable it.</p>
        </>
      )}
    </div>
  )
}

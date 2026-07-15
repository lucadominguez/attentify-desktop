import React, { useState, useEffect, useCallback } from 'react'
import { Bug, X, Check, AlertTriangle } from 'lucide-react'
import { useTheme } from '../context/ThemeContext'

const api = (window as unknown as { electronAPI: Window['electronAPI'] }).electronAPI

// Bug-report button + modal, plus an automatic prompt when the app detects it froze or
// crashed. Everything is captured with context (version, view, recent logs + chat) into
// the local issue log and uploaded (if diagnostics sharing is on). The modal is centred,
// so unlike AccountMenu this works wherever the trigger lives; `variant` only sizes the
// trigger to match its surroundings.
export default function BugReporter({
  currentView, variant = 'sidebar',
}: { currentView: string; variant?: 'titlebar' | 'sidebar' }): React.ReactElement {
  const { colors } = useTheme()
  const [open, setOpen] = useState(false)
  const [title, setTitle] = useState('')
  const [desc, setDesc] = useState('')
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(false)
  const [incident, setIncident] = useState<{ id: string; title: string } | null>(null)

  useEffect(() => {
    const off = api.onDiagnosticsIncident?.((evt) => setIncident({ id: evt.id, title: evt.title }))
    return () => { off?.() }
  }, [])

  const openModal = useCallback((prefillTitle = '') => {
    setTitle(prefillTitle); setDesc(''); setDone(false); setOpen(true); setIncident(null)
  }, [])

  const submit = async (): Promise<void> => {
    if (busy) return
    setBusy(true)
    try {
      await api.reportBug({ title: title.trim() || 'Bug report', description: desc.trim(), view: currentView })
      setDone(true)
      setTimeout(() => { setOpen(false); setDone(false) }, 1400)
    } catch { /* ignore */ }
    setBusy(false)
  }

  return (
    <>
      {/* Trigger */}
      <button
        onClick={() => openModal()}
        className={`${variant === 'titlebar' ? 'titlebar-nodrag ' : ''}flex items-center justify-center rounded transition-colors hover:bg-white/5`}
        style={{
          width: variant === 'sidebar' ? 26 : 22,
          height: variant === 'sidebar' ? 26 : 22,
          color: colors.textMuted,
        }}
        title="Report a bug"
      >
        <Bug size={variant === 'sidebar' ? 14 : 12} />
      </button>

      {/* Auto-incident toast */}
      {incident && !open && (
        <div className="fixed z-[60] bottom-4 right-4 flex items-center gap-3 px-4 py-3 rounded-xl shadow-xl"
          style={{ background: colors.panelBg, border: `1px solid ${colors.borderMid}`, maxWidth: 360 }}>
          <AlertTriangle size={15} style={{ color: colors.warning, flexShrink: 0 }} />
          <div className="flex-1 min-w-0">
            <p className="text-[12px] font-medium" style={{ color: colors.textPrimary }}>{incident.title}</p>
            <p className="text-[10px]" style={{ color: colors.textMuted }}>It's already logged. Add a note so we can fix it faster?</p>
          </div>
          <button onClick={() => openModal('Freeze / crash')} className="text-[11px] px-2.5 py-1.5 rounded-lg font-medium flex-shrink-0"
            style={{ background: colors.accentBg, color: colors.accent, border: `1px solid ${colors.borderMid}` }}>Add note</button>
          <button onClick={() => setIncident(null)} className="p-1 flex-shrink-0" style={{ color: colors.textMuted }}><X size={13} /></button>
        </div>
      )}

      {/* Report modal */}
      {open && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(3px)' }}
          onClick={(e) => { if (e.target === e.currentTarget) setOpen(false) }}>
          <div className="w-full max-w-md mx-4 p-5 rounded-2xl" style={{ background: colors.cardBg, border: `1px solid ${colors.borderMid}` }}>
            {done ? (
              <div className="flex items-center gap-3 py-4">
                <Check size={18} style={{ color: colors.positive }} />
                <p className="text-[13px]" style={{ color: colors.textPrimary }}>Thanks, reported. It helps make Attentify better.</p>
              </div>
            ) : (
              <>
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <Bug size={15} style={{ color: colors.accent }} />
                    <p className="text-[14px] font-semibold" style={{ color: colors.textPrimary }}>Report a bug</p>
                  </div>
                  <button onClick={() => setOpen(false)} style={{ color: colors.textMuted }}><X size={16} /></button>
                </div>
                <input
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="Short summary (e.g. froze when I pressed Always-On)"
                  className="w-full text-[12px] px-3 py-2 mb-2 rounded-lg outline-none"
                  style={{ background: colors.inputBg, border: `1px solid ${colors.border}`, color: colors.textPrimary }}
                  autoFocus
                />
                <textarea
                  value={desc}
                  onChange={(e) => setDesc(e.target.value)}
                  placeholder="What happened, and what were you doing?"
                  rows={4}
                  className="w-full text-[12px] px-3 py-2 rounded-lg outline-none resize-none"
                  style={{ background: colors.inputBg, border: `1px solid ${colors.border}`, color: colors.textPrimary }}
                />
                <p className="text-[10px] mt-2" style={{ color: colors.textDim }}>
                  Attaches app version, the current screen, recent logs and the last few chat turns. No passwords or keys.
                </p>
                <div className="flex justify-end gap-2 mt-3">
                  <button onClick={() => setOpen(false)} className="text-[12px] px-3 py-1.5 rounded-lg" style={{ color: colors.textMuted, border: `1px solid ${colors.border}` }}>Cancel</button>
                  <button onClick={() => void submit()} disabled={busy} className="text-[12px] px-3 py-1.5 rounded-lg font-medium disabled:opacity-50"
                    style={{ background: colors.accentBg, color: colors.accent, border: `1px solid ${colors.borderMid}` }}>
                    {busy ? 'Sending…' : 'Send report'}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </>
  )
}

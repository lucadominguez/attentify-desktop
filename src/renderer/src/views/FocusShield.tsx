import React, { useState } from 'react'
import { Shield, Plus, Trash2, Globe, Cpu, ToggleLeft, ToggleRight } from 'lucide-react'
import type { AppStore } from '@shared/types'
import { useTheme } from '../context/ThemeContext'

const api = (window as unknown as { electronAPI: Window['electronAPI'] }).electronAPI

interface FocusShieldProps {
  store: AppStore
  onRefresh: () => void
}

export default function FocusShield({ store, onRefresh }: FocusShieldProps): React.ReactElement {
  const { colors } = useTheme()
  const [newDomain, setNewDomain] = useState('')
  const [newProcess, setNewProcess] = useState('')
  const [adding, setAdding] = useState<'domain' | 'process' | null>(null)
  // Shield is "on" when a session is active, or when elevated with blocks in place
  const [shieldActive, setShieldActive] = useState(
    store.sessions.some((s) => s.active) ||
    (store.elevation === 'full' && store.blocklist.domains.length > 0)
  )

  const handleAddDomain = async (): Promise<void> => {
    const d = newDomain.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '')
    if (!d) return
    setAdding('domain')
    await api.addDomain(d)
    setNewDomain('')
    onRefresh()
    setAdding(null)
  }

  const handleRemoveDomain = async (domain: string): Promise<void> => {
    await api.removeDomain(domain)
    onRefresh()
  }

  const handleAddProcess = async (): Promise<void> => {
    const p = newProcess.trim()
    if (!p) return
    setAdding('process')
    await api.addProcess(p)
    setNewProcess('')
    onRefresh()
    setAdding(null)
  }

  const handleRemoveProcess = async (name: string): Promise<void> => {
    await api.removeProcess(name)
    onRefresh()
  }

  const toggleShield = async (): Promise<void> => {
    if (shieldActive) {
      const active = store.sessions.find((s) => s.active)
      if (active) await api.stopSession(active.id)
      setShieldActive(false)
    } else {
      await api.startSession('normal')
      setShieldActive(true)
    }
    onRefresh()
  }

  return (
    <div className="p-6 animate-fade-in space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-bold text-xl flex items-center gap-2" style={{ color: colors.textPrimary }}>
            <Shield size={20} className="text-accent-blue" /> Focus Shield
          </h1>
          <p className="text-sm mt-0.5" style={{ color: colors.textSecondary }}>Manage your active blocklists and protection shields</p>
        </div>
        <button
          onClick={toggleShield}
          className="flex items-center gap-2 px-4 py-2 rounded-full text-sm font-semibold transition-colors"
          style={{ background: shieldActive ? 'rgba(76,175,80,0.15)' : colors.cardBg, border: `1px solid ${shieldActive ? 'rgba(76,175,80,0.3)' : colors.border}`, color: shieldActive ? '#4caf50' : colors.textSecondary }}
        >
          {shieldActive ? <ToggleRight size={18} /> : <ToggleLeft size={18} />}
          {shieldActive ? 'Shield ON' : 'Shield OFF'}
        </button>
      </div>

      {/* Blocked domains */}
      <div className="card">
        <div className="flex items-center gap-2 mb-4">
          <Globe size={16} className="text-accent-blue" />
          <h2 className="font-semibold text-sm" style={{ color: colors.textPrimary }}>Blocked Websites</h2>
          <span className="ml-auto text-xs" style={{ color: colors.textMuted }}>{store.blocklist.domains.length} entries</span>
        </div>
        {store.blocklist.domains.length === 0 ? (
          <p className="text-xs text-center py-4" style={{ color: colors.textMuted }}>No domains blocked yet. Add one below.</p>
        ) : (
          <div className="space-y-1 mb-4 max-h-48 overflow-y-auto">
            {store.blocklist.domains.map((d) => (
              <div key={d.domain} className="flex items-center justify-between px-3 py-2 rounded-lg group" style={{ background: colors.rowEven }}>
                <span className="text-xs font-medium" style={{ color: colors.textPrimary }}>{d.domain}</span>
                <div className="flex items-center gap-2">
                  {d.expiresAt && (
                    <span className="text-xs" style={{ color: colors.textMuted }}>
                      until {new Date(d.expiresAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  )}
                  <button
                    onClick={() => handleRemoveDomain(d.domain)}
                    className="opacity-0 group-hover:opacity-100 transition-all"
                    style={{ color: colors.textMuted }}
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
        <div className="flex gap-2">
          <input
            type="text"
            placeholder="twitter.com"
            value={newDomain}
            onChange={(e) => setNewDomain(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleAddDomain()}
            className="flex-1 text-xs px-3 py-2 rounded-lg outline-none transition-colors"
            style={{ background: colors.inputBg, border: `1px solid ${colors.border}`, color: colors.textPrimary }}
          />
          <button
            onClick={handleAddDomain}
            disabled={!newDomain.trim() || adding === 'domain'}
            className="flex items-center gap-1.5 bg-accent-blue hover:bg-accent-blue-light disabled:opacity-50 text-white text-xs font-semibold px-4 py-2 rounded-lg transition-colors"
          >
            <Plus size={13} /> Add
          </button>
        </div>
      </div>

      {/* Blocked processes */}
      <div className="card">
        <div className="flex items-center gap-2 mb-4">
          <Cpu size={16} className="text-accent-amber" />
          <h2 className="font-semibold text-sm" style={{ color: colors.textPrimary }}>Blocked Applications</h2>
          <span className="ml-auto text-xs" style={{ color: colors.textMuted }}>{store.blocklist.processes.length} entries</span>
        </div>
        {store.blocklist.processes.length === 0 ? (
          <p className="text-xs text-center py-4" style={{ color: colors.textMuted }}>No applications blocked yet.</p>
        ) : (
          <div className="space-y-1 mb-4 max-h-48 overflow-y-auto">
            {store.blocklist.processes.map((p) => (
              <div key={p.name} className="flex items-center justify-between px-3 py-2 rounded-lg group" style={{ background: colors.rowEven }}>
                <span className="text-xs font-medium" style={{ color: colors.textPrimary }}>{p.name}</span>
                <button
                  onClick={() => handleRemoveProcess(p.name)}
                  className="opacity-0 group-hover:opacity-100 transition-all"
                  style={{ color: colors.textMuted }}
                >
                  <Trash2 size={13} />
                </button>
              </div>
            ))}
          </div>
        )}
        <div className="flex gap-2">
          <input
            type="text"
            placeholder="Discord (process name)"
            value={newProcess}
            onChange={(e) => setNewProcess(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleAddProcess()}
            className="flex-1 text-xs px-3 py-2 rounded-lg outline-none transition-colors"
            style={{ background: colors.inputBg, border: `1px solid ${colors.border}`, color: colors.textPrimary }}
          />
          <button
            onClick={handleAddProcess}
            disabled={!newProcess.trim() || adding === 'process'}
            className="flex items-center gap-1.5 bg-accent-blue hover:bg-accent-blue-light disabled:opacity-50 text-white text-xs font-semibold px-4 py-2 rounded-lg transition-colors"
          >
            <Plus size={13} /> Add
          </button>
        </div>
      </div>

      {store.elevation === 'soft' && (
        <div className="p-4 rounded-xl flex items-start gap-3" style={{ background: 'rgba(255,184,0,0.08)', border: '1px solid rgba(255,184,0,0.2)' }}>
          <span className="text-xl" style={{ color: '#ffb800' }}>⚠</span>
          <div>
            <p className="font-semibold text-sm" style={{ color: '#ffb800' }}>Soft mode active</p>
            <p className="text-xs mt-0.5" style={{ color: colors.textSecondary }}>
              Hosts file editing is disabled. Blocks are tracked but not enforced. Grant admin access from the onboarding screen to enable full protection.
            </p>
          </div>
        </div>
      )}
    </div>
  )
}

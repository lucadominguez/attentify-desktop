import React, { useState } from 'react'
import { Globe, Play, Square, Shield, Info } from 'lucide-react'
import type { AppStore } from '@shared/types'

const api = (window as unknown as { electronAPI: Window['electronAPI'] }).electronAPI

interface FocusBrowserProps {
  store: AppStore
}

export default function FocusBrowser({ store }: FocusBrowserProps): React.ReactElement {
  const [duration, setDuration] = useState(60)
  const [launching, setLaunching] = useState(false)
  const active = store.sessions.some((s) => s.active)

  const handleLaunch = async (): Promise<void> => {
    setLaunching(true)
    await api.startSession('normal', duration * 60 * 1000)
    setLaunching(false)
  }

  return (
    <div className="p-6 animate-fade-in space-y-5">
      <div>
        <h1 className="text-white font-bold text-xl flex items-center gap-2">
          <Globe size={20} className="text-accent-blue" /> Focus Browser
        </h1>
        <p className="text-navy-400 text-sm mt-0.5">Launch your browser with strict blocklists active for a chosen duration</p>
      </div>

      <div className="card flex flex-col items-center py-8 text-center">
        <div className="w-20 h-20 rounded-full bg-accent-blue/10 border border-accent-blue/20 flex items-center justify-center mb-5"
             style={{ boxShadow: '0 0 30px rgba(33,150,243,0.1)' }}>
          <Globe size={36} className="text-accent-blue" />
        </div>
        <h2 className="text-white font-bold text-lg mb-1">Strict browsing mode</h2>
        <p className="text-navy-400 text-sm leading-relaxed max-w-xs mb-6">
          Activates your full blocklist and starts a focus session before opening your default browser.
        </p>

        <div className="flex items-center gap-4 mb-6">
          <label className="text-navy-400 text-sm">Duration:</label>
          <div className="flex items-center gap-2">
            {[30, 60, 90, 120].map((mins) => (
              <button key={mins}
                onClick={() => setDuration(mins)}
                className="px-3 py-1.5 rounded-full text-xs font-semibold transition-all"
                style={{
                  background: duration === mins ? 'rgba(33,150,243,0.15)' : '#112240',
                  border: `1px solid ${duration === mins ? 'rgba(33,150,243,0.4)' : 'rgba(30,58,95,0.8)'}`,
                  color: duration === mins ? '#e2e8f0' : '#94a3b8',
                }}
              >{mins}m</button>
            ))}
          </div>
        </div>

        <button
          onClick={handleLaunch}
          disabled={launching || active}
          className="flex items-center gap-2 bg-accent-blue hover:bg-accent-blue-light disabled:opacity-60 text-white font-semibold px-8 py-3 rounded-full transition-colors"
        >
          {launching ? <div className="w-4 h-4 border border-white border-t-transparent rounded-full animate-spin" /> : <Play size={15} fill="currentColor" />}
          {active ? 'Session already active' : launching ? 'Activating…' : `Launch with ${duration}m focus`}
        </button>
      </div>

      <div className="card flex items-start gap-3 bg-navy-750/50">
        <Info size={15} className="text-navy-400 flex-shrink-0 mt-0.5" />
        <p className="text-navy-400 text-xs leading-relaxed">
          Focus Browser activates your blocklist via the hosts file and starts a session timer.
          Your default browser opens normally — the blocking happens at the network layer,
          so it works in any browser.
          {store.elevation === 'soft' && ' Admin access is required for actual site blocking.'}
        </p>
      </div>

      <div className="card">
        <div className="flex items-center gap-2 mb-3">
          <Shield size={14} className="text-accent-green" />
          <p className="text-white text-sm font-semibold">What gets blocked</p>
        </div>
        {store.blocklist.domains.length === 0 ? (
          <p className="text-navy-500 text-xs">No domains in your blocklist yet. Add them in Focus Shield.</p>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {store.blocklist.domains.slice(0, 12).map((d) => (
              <span key={d.domain} className="px-2 py-0.5 rounded-full bg-navy-700 border border-navy-600 text-xs text-navy-400">
                {d.domain}
              </span>
            ))}
            {store.blocklist.domains.length > 12 && (
              <span className="px-2 py-0.5 rounded-full bg-navy-700 border border-navy-600 text-xs text-navy-500">
                +{store.blocklist.domains.length - 12} more
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

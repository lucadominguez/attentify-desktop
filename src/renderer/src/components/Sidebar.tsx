import React, { useState } from 'react'
import {
  Home, Shield, Zap, Lock, Calendar, TrendingUp,
  MessageSquare, Activity, RefreshCw, Brain,
} from 'lucide-react'
import type { ViewName, FocusSession, ElevationStatus } from '@shared/types'
import PulsingSphere from './PulsingSphere'

const api = (window as unknown as { electronAPI: Window['electronAPI'] }).electronAPI

interface SidebarProps {
  currentView: ViewName
  onNavigate: (view: ViewName) => void
  onChatOpen: () => void
  activeSession?: FocusSession
  elevation: ElevationStatus
  alertCount?: number
}

interface NavItem {
  id: ViewName
  label: string
  icon: React.ReactNode
}

const mainNav: NavItem[] = [
  { id: 'home',          label: 'Home',       icon: <Home size={14} /> },
  { id: 'focus-shield',  label: 'Overview',   icon: <Shield size={14} /> },
  { id: 'deep-clean',    label: 'Deep Clean', icon: <Zap size={14} /> },
  { id: 'analytics',     label: 'Analytics',  icon: <Activity size={14} /> },
  { id: 'patterns',      label: 'Patterns',   icon: <Brain size={14} /> },
]

const toolsNav: NavItem[] = [
  { id: 'deep-focus',        label: 'Deep Focus',     icon: <Lock size={14} /> },
  { id: 'schedule-manager',  label: 'Scheduler',      icon: <Calendar size={14} /> },
  { id: 'algo-track',        label: 'AlgoTrack',      icon: <TrendingUp size={14} /> },
]

export default function Sidebar({
  currentView, onNavigate, onChatOpen, activeSession, elevation, alertCount = 0,
}: SidebarProps): React.ReactElement {
  const [relaunching, setRelaunching] = useState(false)

  const handleRelaunch = async (): Promise<void> => {
    setRelaunching(true)
    try { await api.relaunchAsAdmin() } catch { setRelaunching(false) }
  }

  return (
    <aside
      className="flex flex-col flex-shrink-0 h-full overflow-hidden"
      style={{
        width: 220,
        background: 'linear-gradient(180deg, #020a16 0%, #030d1c 100%)',
        borderRight: '1px solid rgba(0,200,255,0.1)',
      }}
    >
      {/* ── Logo ──────────────────────────────────────────────────────────── */}
      <div
        className="flex items-center gap-3 px-4 flex-shrink-0"
        style={{ height: 52, borderBottom: '1px solid rgba(0,200,255,0.08)' }}
      >
        {/* Diamond icon */}
        <div className="flex-shrink-0 relative" style={{ width: 28, height: 28 }}>
          <svg viewBox="0 0 28 28" width={28} height={28}>
            <polygon
              points="14,2 26,14 14,26 2,14"
              fill="none"
              stroke="rgba(0,200,255,0.9)"
              strokeWidth="1.5"
            />
            <polygon
              points="14,6 22,14 14,22 6,14"
              fill="rgba(0,200,255,0.12)"
              stroke="rgba(0,200,255,0.45)"
              strokeWidth="1"
            />
            <circle cx="14" cy="14" r="2.5" fill="rgba(0,200,255,0.85)" />
          </svg>
        </div>

        <div className="min-w-0 flex-1">
          <div
            className="text-[11px] font-bold leading-tight tracking-widest uppercase"
            style={{ color: '#cce8ff', letterSpacing: '0.2em' }}
          >
            Productivity
          </div>
          <div
            className="text-[9px] tracking-widest uppercase"
            style={{ color: 'rgba(0,200,255,0.55)', fontFamily: '"Share Tech Mono", monospace', letterSpacing: '0.25em' }}
          >
            Daemon
          </div>
        </div>

        {/* Status indicator */}
        {elevation === 'full' && activeSession && (
          <div
            className="flex-shrink-0 w-1.5 h-1.5 rounded-full animate-glow-pulse"
            style={{ background: '#00e676', boxShadow: '0 0 6px #00e676' }}
            title="Full protection active"
          />
        )}
        {(elevation === 'soft' || elevation === 'unknown') && (
          <div
            className="flex-shrink-0 w-1.5 h-1.5 rounded-full"
            style={{ background: '#ffaa00', boxShadow: '0 0 6px #ffaa00' }}
            title="Soft mode — limited protection"
          />
        )}
      </div>

      {/* ── Elevation warning ─────────────────────────────────────────────── */}
      {(elevation === 'soft' || elevation === 'unknown') && (
        <div
          className="mx-3 mt-2.5 flex-shrink-0"
          style={{
            background: 'rgba(255,107,53,0.06)',
            border: '1px solid rgba(255,107,53,0.25)',
            borderRadius: 2,
            padding: '8px 10px',
          }}
        >
          <div className="flex items-center gap-1.5 mb-1">
            <div className="w-1 h-1 rounded-full" style={{ background: '#ff6b35' }} />
            <p className="text-[9px] font-bold uppercase tracking-widest" style={{ color: '#ff6b35' }}>
              Blocking Disabled
            </p>
          </div>
          <p className="text-[9px] leading-relaxed mb-2" style={{ color: '#5a7a94' }}>
            Admin rights required for site blocking.
          </p>
          <button
            onClick={handleRelaunch}
            disabled={relaunching}
            className="w-full flex items-center justify-center gap-1.5 py-1.5 text-[9px] font-bold uppercase tracking-widest transition-all disabled:opacity-60"
            style={{
              background: 'rgba(255,107,53,0.12)',
              color: '#ff6b35',
              border: '1px solid rgba(255,107,53,0.25)',
              letterSpacing: '0.15em',
            }}
          >
            {relaunching
              ? <><RefreshCw size={8} className="animate-spin" /> Relaunching…</>
              : <><Shield size={8} /> Enable Full</>}
          </button>
        </div>
      )}

      {/* ── Navigation ────────────────────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto py-3">

        {/* Main nav */}
        <div className="mb-1">
          <div className="px-4 mb-2 flex items-center gap-2">
            <span className="hud-label">Command Center</span>
            <div className="flex-1 h-px" style={{ background: 'rgba(0,200,255,0.12)' }} />
          </div>

          {mainNav.map((item) => {
            const isActive = currentView === item.id
            return (
              <button
                key={item.id}
                onClick={() => onNavigate(item.id)}
                className={`sidebar-item w-full text-left ${isActive ? 'active' : ''}`}
              >
                <span
                  className="flex-shrink-0"
                  style={{ color: isActive ? '#00c8ff' : '#3a5a74', transition: 'color 0.15s' }}
                >
                  {item.icon}
                </span>
                <span className="flex-1">{item.label}</span>
                {item.id === 'patterns' && alertCount > 0 && (
                  <span
                    className="flex-shrink-0 flex items-center justify-center text-[8px] font-bold"
                    style={{
                      width: 16, height: 16,
                      background: 'rgba(255,68,68,0.2)',
                      border: '1px solid rgba(255,68,68,0.5)',
                      color: '#ff4444',
                      fontFamily: '"Share Tech Mono", monospace',
                    }}
                  >
                    {alertCount > 9 ? '9+' : alertCount}
                  </span>
                )}
                {isActive && (
                  <span
                    className="flex-shrink-0 text-[8px] animate-bracket-in"
                    style={{ color: 'rgba(0,200,255,0.5)', fontFamily: 'monospace' }}
                  >
                    ◆
                  </span>
                )}
              </button>
            )
          })}
        </div>

        {/* Tools nav */}
        <div className="mt-4">
          <div className="px-4 mb-2 flex items-center gap-2">
            <span className="hud-label">Tools</span>
            <div className="flex-1 h-px" style={{ background: 'rgba(0,200,255,0.12)' }} />
          </div>

          {toolsNav.map((item) => {
            const isActive = currentView === item.id
            return (
              <button
                key={item.id}
                onClick={() => onNavigate(item.id)}
                className={`sidebar-item w-full text-left ${isActive ? 'active' : ''}`}
              >
                <span
                  className="flex-shrink-0"
                  style={{ color: isActive ? '#00c8ff' : 'rgba(255,170,0,0.45)', transition: 'color 0.15s' }}
                >
                  {item.icon}
                </span>
                <span className="flex-1">{item.label}</span>
                {isActive && (
                  <span
                    className="flex-shrink-0 text-[8px] animate-bracket-in"
                    style={{ color: 'rgba(0,200,255,0.5)', fontFamily: 'monospace' }}
                  >
                    ◆
                  </span>
                )}
              </button>
            )
          })}
        </div>
      </div>

      {/* ── Sphere + chat button ───────────────────────────────────────────── */}
      <div
        className="flex-shrink-0 flex flex-col items-center pb-5 pt-3"
        style={{ borderTop: '1px solid rgba(0,200,255,0.08)' }}
      >
        {/* Outer ring decoration */}
        <div
          className="relative cursor-pointer mb-2"
          onClick={onChatOpen}
          title="Open Daemon Assistant"
        >
          {/* Outer decorative ring */}
          <div
            className="absolute inset-0 rounded-full pointer-events-none"
            style={{
              margin: -8,
              border: '1px solid rgba(0,200,255,0.15)',
              borderRadius: '50%',
            }}
          />
          {/* Second ring */}
          <div
            className="absolute inset-0 rounded-full pointer-events-none animate-pulse-slow"
            style={{
              margin: -4,
              border: '1px solid rgba(0,200,255,0.08)',
              borderRadius: '50%',
            }}
          />
          <PulsingSphere mode={activeSession ? 'active' : 'idle'} size={100} />
        </div>

        <button
          onClick={onChatOpen}
          className="flex items-center gap-1.5 px-4 py-1.5 transition-all duration-200 hover:scale-105"
          style={{
            background: 'rgba(0,200,255,0.06)',
            border: '1px solid rgba(0,200,255,0.2)',
            color: 'rgba(0,200,255,0.8)',
            fontSize: 9,
            fontFamily: '"Share Tech Mono", monospace',
            letterSpacing: '0.2em',
            textTransform: 'uppercase',
          }}
        >
          <MessageSquare size={10} />
          Ask Daemon
        </button>
      </div>
    </aside>
  )
}

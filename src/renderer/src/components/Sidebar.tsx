import React, { useState } from 'react'
import {
  Home, Shield, Zap, Lock, Calendar, TrendingUp,
  MessageSquare, Wifi, WifiOff, Activity, RefreshCw, Brain,
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
  badge?: string
}

const mainNav: NavItem[] = [
  { id: 'home', label: 'Home', icon: <Home size={17} /> },
  { id: 'focus-shield', label: 'Overview', icon: <Shield size={17} /> },
  { id: 'deep-clean', label: 'Deep Clean', icon: <Zap size={17} /> },
  { id: 'analytics', label: 'Analytics', icon: <Activity size={17} /> },
  { id: 'patterns', label: 'Patterns', icon: <Brain size={17} /> },
]

const premiumNav: NavItem[] = [
  { id: 'deep-focus', label: 'Deep Focus Mode', icon: <Lock size={17} /> },
  { id: 'schedule-manager', label: 'Schedule Manager', icon: <Calendar size={17} /> },
  { id: 'algo-track', label: 'AlgoTrack', icon: <TrendingUp size={17} /> },
]

export default function Sidebar({
  currentView, onNavigate, onChatOpen, activeSession, elevation, alertCount = 0,
}: SidebarProps): React.ReactElement {
  const [relaunching, setRelaunching] = useState(false)

  const handleRelaunch = async (): Promise<void> => {
    setRelaunching(true)
    try {
      await api.relaunchAsAdmin()
      // App will quit and reopen elevated — nothing more to do here
    } catch {
      setRelaunching(false)
    }
  }

  return (
    <aside
      className="flex flex-col w-[260px] flex-shrink-0 h-full overflow-hidden"
      style={{ background: '#080f1e', borderRight: '1px solid rgba(30,58,95,0.5)' }}
    >
      {/* Logo */}
      <div className="flex items-center gap-3 px-5 py-5 flex-shrink-0">
        <div className="w-8 h-8 rounded-lg bg-accent-blue flex items-center justify-center flex-shrink-0">
          <Shield size={18} className="text-white" fill="currentColor" />
        </div>
        <div>
          <div className="text-white font-bold text-sm leading-tight">Productivity</div>
          <div className="text-xs" style={{ color: '#8faac4' }}>Daemon</div>
        </div>
        {elevation === 'soft' && (
          <div className="ml-auto" title="Running in soft mode (limited protection)">
            <WifiOff size={14} className="text-accent-amber" />
          </div>
        )}
        {elevation === 'full' && activeSession && (
          <div className="ml-auto" title="Fully protected">
            <Wifi size={14} className="text-accent-green" />
          </div>
        )}
      </div>

      {/* Elevation warning — clickable */}
      {(elevation === 'soft' || elevation === 'unknown') && (
        <div
          className="mx-3 mb-3 rounded-lg flex-shrink-0 overflow-hidden"
          style={{ border: '1px solid rgba(255,107,53,0.3)' }}
        >
          <div className="p-2.5" style={{ background: 'rgba(255,107,53,0.08)' }}>
            <div className="flex items-center gap-1.5 mb-1">
              <WifiOff size={11} className="text-accent-orange" />
              <p className="text-accent-orange text-[11px] font-semibold">Blocking disabled</p>
            </div>
            <p className="text-[10px] leading-relaxed mb-2" style={{ color: '#8faac4' }}>
              Admin rights required to edit the hosts file. Sites cannot be blocked without them.
            </p>
            <button
              onClick={handleRelaunch}
              disabled={relaunching}
              className="w-full flex items-center justify-center gap-1.5 py-1.5 rounded-md text-[11px] font-semibold transition-all disabled:opacity-60"
              style={{ background: 'rgba(255,107,53,0.2)', color: '#ff6b35', border: '1px solid rgba(255,107,53,0.3)' }}
            >
              {relaunching
                ? <><RefreshCw size={10} className="animate-spin" /> Relaunching…</>
                : <><Shield size={10} /> Enable Full Protection</>}
            </button>
          </div>
        </div>
      )}

      <div className="flex-1 overflow-y-auto px-3">
        {/* Main navigation */}
        <nav className="mb-4">
          {mainNav.map((item) => (
            <button
              key={item.id}
              onClick={() => onNavigate(item.id)}
              className={`sidebar-item w-full text-left mb-0.5 ${currentView === item.id ? 'active' : ''}`}
            >
              <span className={currentView === item.id ? 'text-accent-blue' : ''}>{item.icon}</span>
              <span className="flex-1">{item.label}</span>
              {item.id === 'patterns' && alertCount > 0 && (
                <span className="w-4 h-4 rounded-full bg-accent-orange flex items-center justify-center text-[9px] font-bold text-white flex-shrink-0">
                  {alertCount > 9 ? '9+' : alertCount}
                </span>
              )}
            </button>
          ))}
        </nav>

        {/* Divider + premium section */}
        <div className="mb-3">
          <p className="px-4 text-[10px] font-semibold uppercase tracking-widest mb-2" style={{ color: '#7a9ab5' }}>
            More from Productivity Daemon
          </p>
          {premiumNav.map((item) => (
            <button
              key={item.id}
              onClick={() => onNavigate(item.id)}
              className={`sidebar-item w-full text-left mb-0.5 ${currentView === item.id ? 'active' : ''}`}
            >
              <span className={currentView === item.id ? 'text-accent-blue' : 'text-accent-amber'}>{item.icon}</span>
              <span className="flex-1">{item.label}</span>
            </button>
          ))}
        </div>

      </div>

      {/* Sphere + open chat */}
      <div className="flex-shrink-0 flex flex-col items-center pb-4 pt-2 gap-2">
        <div className="cursor-pointer" onClick={onChatOpen} title="Open Daemon Assistant">
          <PulsingSphere mode={activeSession ? 'active' : 'idle'} size={112} />
        </div>
        <button
          onClick={onChatOpen}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[11px] font-semibold transition-all hover:scale-105"
          style={{ background: 'rgba(33,150,243,0.1)', border: '1px solid rgba(33,150,243,0.22)', color: '#64b5f6' }}
        >
          <MessageSquare size={11} />
          Ask Daemon
        </button>
      </div>
    </aside>
  )
}

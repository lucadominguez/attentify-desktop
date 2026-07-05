import React, { useState } from 'react'
import {
  Home, Shield, Lock, Calendar, Zap,
  MessageSquare, Activity, RefreshCw, ListChecks, Settings,
} from 'lucide-react'
import type { ViewName, FocusSession, ElevationStatus } from '@shared/types'
import BrandMark from './BrandMark'

const api = (window as unknown as { electronAPI: Window['electronAPI'] }).electronAPI

interface SidebarProps {
  currentView: ViewName
  onNavigate: (view: ViewName) => void
  onChatOpen: () => void
  activeSession?: FocusSession
  elevation: ElevationStatus
  alertCount?: number
  pendingActionCount?: number
}

interface NavItem {
  id: ViewName
  label: string
  icon: React.ReactNode
  desc: string   // plain-language tooltip so every menu item explains itself
}

// Primary features — the everyday surfaces of a focus app.
const mainNav: NavItem[] = [
  { id: 'home',         label: 'Home',       icon: <Home size={15} />,      desc: 'Your dashboard — today\'s focus at a glance' },
  { id: 'insights',     label: 'Insights',   icon: <Activity size={15} />,  desc: 'Where your time went and the habits behind it' },
  { id: 'focus-shield', label: 'Protection', icon: <Shield size={15} />,    desc: 'Blocklists, feed blocks, and the activity log' },
  { id: 'deep-focus',   label: 'Deep Focus', icon: <Lock size={15} />,      desc: 'Lock out distractions for a set time' },
  { id: 'actions',      label: 'Actions',    icon: <ListChecks size={15} />,desc: 'Review and approve flagged distractions' },
]

// Secondary utilities.
const utilityNav: NavItem[] = [
  { id: 'deep-clean',       label: 'Deep Clean', icon: <Zap size={15} />,      desc: 'Scan this device for installed distractions' },
  { id: 'schedule-manager', label: 'Scheduler',  icon: <Calendar size={15} />, desc: 'Block automatically on a recurring schedule' },
  { id: 'settings',         label: 'Settings',   icon: <Settings size={15} />, desc: 'Blocking mode, AI key, and preferences' },
]

export default function Sidebar({
  currentView, onNavigate, onChatOpen, activeSession, elevation, alertCount = 0, pendingActionCount = 0,
}: SidebarProps): React.ReactElement {
  const [relaunching, setRelaunching] = useState(false)

  const handleRelaunch = async (): Promise<void> => {
    setRelaunching(true)
    try { await api.relaunchAsAdmin() } catch { setRelaunching(false) }
  }

  const renderItem = (item: NavItem): React.ReactElement => {
    const isActive = currentView === item.id
    const badge =
      item.id === 'insights' && alertCount > 0 ? { n: alertCount, color: '#ffaa00' } :
      item.id === 'actions' && pendingActionCount > 0 ? { n: pendingActionCount, color: '#ffaa00' } :
      null
    return (
      <button
        key={item.id}
        onClick={() => onNavigate(item.id)}
        title={item.desc}
        className={`sidebar-item w-full text-left ${isActive ? 'active' : ''}`}
      >
        <span
          className="flex-shrink-0"
          style={{ color: isActive ? '#00c8ff' : '#4a6a86', transition: 'color 0.15s' }}
        >
          {item.icon}
        </span>
        <span className="flex-1">{item.label}</span>
        {badge && (
          <span
            className="flex-shrink-0 flex items-center justify-center text-[9px] font-bold rounded-full"
            style={{
              minWidth: 16, height: 16, padding: '0 4px',
              background: `${badge.color}22`,
              border: `1px solid ${badge.color}80`,
              color: badge.color,
            }}
          >
            {badge.n > 9 ? '9+' : badge.n}
          </span>
        )}
      </button>
    )
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
        className="flex items-center gap-2.5 px-4 flex-shrink-0"
        style={{ height: 56, borderBottom: '1px solid rgba(0,200,255,0.08)' }}
      >
        {/* Attentify shield mark */}
        <div className="flex-shrink-0 relative" style={{ width: 26, height: 26 }}>
          <BrandMark size={26} />
        </div>

        <div className="min-w-0 flex-1">
          <div
            className="text-[15px] font-semibold leading-none"
            style={{ color: '#e8f4ff', letterSpacing: '0.01em' }}
          >
            Attentify
          </div>
        </div>

        {/* Protection status dot */}
        {elevation === 'full' && activeSession && (
          <div
            className="flex-shrink-0 w-1.5 h-1.5 rounded-full"
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
          className="mx-3 mt-2.5 flex-shrink-0 rounded-lg"
          style={{
            background: 'rgba(255,170,0,0.06)',
            border: '1px solid rgba(255,170,0,0.22)',
            padding: '8px 10px',
          }}
        >
          <div className="flex items-center gap-1.5 mb-1">
            <div className="w-1 h-1 rounded-full" style={{ background: '#ffaa00' }} />
            <p className="text-[10px] font-semibold" style={{ color: '#ffaa00' }}>
              Blocking disabled
            </p>
          </div>
          <p className="text-[10px] leading-relaxed mb-2" style={{ color: '#6a89a6' }}>
            Admin rights are required for site blocking.
          </p>
          <button
            onClick={handleRelaunch}
            disabled={relaunching}
            className="w-full flex items-center justify-center gap-1.5 py-1.5 text-[11px] font-medium rounded-md transition-all disabled:opacity-60"
            style={{
              background: 'rgba(0,200,255,0.10)',
              color: '#00c8ff',
              border: '1px solid rgba(0,200,255,0.28)',
            }}
          >
            {relaunching
              ? <><RefreshCw size={11} className="animate-spin" /> Relaunching…</>
              : <><Shield size={11} /> Enable protection</>}
          </button>
        </div>
      )}

      {/* ── Navigation ────────────────────────────────────────────────────── */}
      <nav className="flex-1 overflow-y-auto pt-3 pb-2">
        <div className="mb-1">
          {mainNav.map(renderItem)}
        </div>

        <div className="mt-4">
          <div className="px-4 mb-1.5 flex items-center gap-2">
            <span className="hud-label">Utilities</span>
            <div className="flex-1 h-px" style={{ background: 'rgba(0,200,255,0.10)' }} />
          </div>
          {utilityNav.map(renderItem)}
        </div>
      </nav>

      {/* ── Assistant ─────────────────────────────────────────────────────── */}
      <div className="flex-shrink-0 p-3" style={{ borderTop: '1px solid rgba(0,200,255,0.08)' }}>
        <button
          onClick={onChatOpen}
          className="w-full flex items-center justify-center gap-2 py-2 rounded-lg text-[12px] font-medium transition-all hover:brightness-110"
          style={{
            background: 'rgba(0,200,255,0.08)',
            border: '1px solid rgba(0,200,255,0.22)',
            color: '#7fd6ff',
          }}
          title="Ask the Attentify assistant"
        >
          <MessageSquare size={13} />
          Ask Attentify
        </button>
      </div>
    </aside>
  )
}

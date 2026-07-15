import React, { useState } from 'react'
import {
  Shield, Lock, Calendar, Zap, Clock, BarChart2, Brain, Activity as ActivityIcon,
  MessageSquare, RefreshCw, ListChecks, Settings, Sun, Moon,
} from 'lucide-react'
import type { ViewName, FocusSession, ElevationStatus } from '@shared/types'
import BrandMark from './BrandMark'
import BugReporter from './BugReporter'
import AccountMenu from './AccountMenu'
import { useTheme } from '../context/ThemeContext'

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

// Primary features, the everyday surfaces of a focus app. Home is the chat-first
// assistant (Attentify's core surface); the dashboard and analytics sit alongside it.
const mainNav: NavItem[] = [
  { id: 'home',         label: 'Assistant',  icon: <MessageSquare size={15} />, desc: 'Chat with Attentify, block sites, start focus, ask about your day' },
  { id: 'analytics',    label: 'Analytics',  icon: <BarChart2 size={15} />, desc: 'Charts, patterns, alerts, and describe any custom analytics you want' },
  { id: 'logic',        label: 'Logic',      icon: <Brain size={15} />,     desc: 'How Attentify reasons about you, and add your own context' },
  { id: 'activity',     label: 'Activity',   icon: <ActivityIcon size={15} />, desc: 'Your searches, browsing and app activity, the raw log' },
  { id: 'timesheets',   label: 'Timesheets', icon: <Clock size={15} />,     desc: 'Time logged per app and category, day by day' },
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
  const { colors, theme, toggle: toggleTheme } = useTheme()
  const [relaunching, setRelaunching] = useState(false)

  const handleRelaunch = async (): Promise<void> => {
    setRelaunching(true)
    try { await api.relaunchAsAdmin() } catch { setRelaunching(false) }
  }

  const renderItem = (item: NavItem): React.ReactElement => {
    const isActive = currentView === item.id
    const badge =
      item.id === 'analytics' && alertCount > 0 ? { n: alertCount, color: '#fbbf24' } :
      item.id === 'actions' && pendingActionCount > 0 ? { n: pendingActionCount, color: '#fbbf24' } :
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
          style={{ color: isActive ? colors.accent : colors.textMuted, transition: 'color 0.15s' }}
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
        background: colors.panelBg,
        borderRight: `1px solid ${colors.border}`,
        transition: 'background 0.2s ease',
      }}
    >
      {/* ── Logo ──────────────────────────────────────────────────────────── */}
      <div
        className="flex items-center gap-2.5 px-4 flex-shrink-0"
        style={{ height: 56, borderBottom: `1px solid ${colors.border}` }}
      >
        {/* Attentify shield mark */}
        <div className="flex-shrink-0 relative" style={{ width: 26, height: 26 }}>
          <BrandMark size={26} />
        </div>

        <div className="min-w-0 flex-1">
          <div
            className="text-[15px] font-semibold leading-none"
            style={{ color: colors.textPrimary, letterSpacing: '0.01em' }}
          >
            Attentify
          </div>
        </div>

        {/* Protection status dot */}
        {elevation === 'full' && activeSession && (
          <div
            className="flex-shrink-0 w-1.5 h-1.5 rounded-full"
            style={{ background: '#34d399', boxShadow: '0 0 6px #34d399' }}
            title="Full protection active"
          />
        )}
        {(elevation === 'soft' || elevation === 'unknown') && (
          <div
            className="flex-shrink-0 w-1.5 h-1.5 rounded-full"
            style={{ background: '#fbbf24', boxShadow: '0 0 6px #fbbf24' }}
            title="Soft mode, limited protection"
          />
        )}
      </div>

      {/* ── Elevation warning ─────────────────────────────────────────────── */}
      {(elevation === 'soft' || elevation === 'unknown') && (
        <div
          className="mx-3 mt-2.5 flex-shrink-0 rounded-lg"
          style={{
            background: 'rgba(251,191,36,0.06)',
            border: '1px solid rgba(251,191,36,0.22)',
            padding: '8px 10px',
          }}
        >
          <div className="flex items-center gap-1.5 mb-1">
            <div className="w-1 h-1 rounded-full" style={{ background: '#fbbf24' }} />
            <p className="text-[10px] font-semibold" style={{ color: '#fbbf24' }}>
              Blocking disabled
            </p>
          </div>
          <p className="text-[10px] leading-relaxed mb-2" style={{ color: colors.textMuted }}>
            Admin rights are required for site blocking.
          </p>
          <button
            onClick={handleRelaunch}
            disabled={relaunching}
            className="w-full flex items-center justify-center gap-1.5 py-1.5 text-[11px] font-medium rounded-md transition-all disabled:opacity-60"
            style={{
              background: colors.accentBg,
              color: colors.accent,
              border: `1px solid ${colors.borderMid}`,
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
            <div className="flex-1 h-px" style={{ background: colors.border }} />
          </div>
          {utilityNav.map(renderItem)}
        </div>
      </nav>

      {/* ── Utility row ───────────────────────────────────────────────────────
          Theme, bug report and account. These used to sit in a cluster in the title
          bar; they live here so the title bar is window chrome only. */}
      <div
        className="flex-shrink-0 flex items-center gap-1.5 px-3 py-2"
        style={{ borderTop: `1px solid ${colors.border}` }}
      >
        <button
          onClick={toggleTheme}
          className="flex items-center justify-center rounded transition-colors hover:bg-white/5"
          style={{ width: 26, height: 26, color: colors.textMuted }}
          title={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
        >
          {theme === 'dark' ? <Sun size={14} /> : <Moon size={14} />}
        </button>
        <BugReporter currentView={currentView} variant="sidebar" />
        <div className="flex-1" />
        <AccountMenu variant="sidebar" />
      </div>

      {/* ── Assistant ─────────────────────────────────────────────────────── */}
      <div className="flex-shrink-0 p-3" style={{ borderTop: `1px solid ${colors.border}` }}>
        <button
          onClick={() => onNavigate('home')}
          className="w-full flex items-center justify-center gap-2 py-2 rounded-lg text-[12px] font-medium transition-all hover:brightness-110"
          style={{
            background: colors.accentBg,
            border: `1px solid ${colors.borderMid}`,
            color: colors.accent,
          }}
          title="Open the Attentify assistant"
        >
          <MessageSquare size={13} />
          Ask Attentify
        </button>
      </div>
    </aside>
  )
}

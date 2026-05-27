import React, { useState, useEffect, useCallback } from 'react'
import Sidebar from './components/Sidebar'
import Home from './views/Home'
import Overview from './views/Overview'
import DeepClean from './views/DeepClean'
import DeepFocusMode from './views/DeepFocusMode'
import ScheduleManager from './views/ScheduleManager'
import AlgoTrack from './views/AlgoTrack'
import Analytics from './views/Analytics'
import FocusScanResults from './views/FocusScanResults'
import Patterns from './views/Patterns'
import Onboarding from './views/Onboarding'
import ChatPanel from './chat/ChatPanel'
import type { ViewName, AppStore, ScanResult, HeuristicAlert } from '@shared/types'
import { Minus, Square, X, AlertTriangle } from 'lucide-react'

const api = (window as unknown as { electronAPI: Window['electronAPI'] }).electronAPI

export default function App(): React.ReactElement {
  const [store, setStore] = useState<AppStore | null>(null)
  const [view, setView] = useState<ViewName>('home')
  const [chatOpen, setChatOpen] = useState(false)
  const [chatPreFill, setChatPreFill] = useState('')
  const [scanResults, setScanResults] = useState<ScanResult | null>(null)
  const [heuristicAlerts, setHeuristicAlerts] = useState<HeuristicAlert[]>([])
  const [toastAlert, setToastAlert] = useState<HeuristicAlert | null>(null)

  useEffect(() => {
    api.getStore().then(setStore)
  }, [])

  // Listen for heuristic alert push events from main process
  useEffect(() => {
    api.onHeuristicAlert((alerts) => {
      setHeuristicAlerts(alerts)
      const newAlert = alerts.find((a) => !a.dismissed)
      if (newAlert) {
        setToastAlert(newAlert)
        setTimeout(() => setToastAlert(null), 6000)
      }
    })
  }, [])

  const handleNavigate = useCallback((v: ViewName) => {
    setView(v)
  }, [])

  const handleScanComplete = useCallback((results: ScanResult) => {
    setScanResults(results)
    setView('focus-scan-results')
    api.getStore().then(setStore)
  }, [])

  const handleOnboardingComplete = useCallback(() => {
    api.setStore({ onboardingComplete: true }).then(setStore)
  }, [])

  const refreshStore = useCallback(() => {
    api.getStore().then(setStore)
  }, [])

  if (!store) {
    return (
      <div className="flex items-center justify-center h-screen w-screen bg-navy-850">
        <div className="flex flex-col items-center gap-4">
          <div className="w-12 h-12 rounded-full border-2 border-accent-blue border-t-transparent animate-spin" />
          <p className="text-navy-400 text-sm">Loading Productivity Daemon…</p>
        </div>
      </div>
    )
  }

  if (!store.onboardingComplete) {
    return <Onboarding onComplete={handleOnboardingComplete} />
  }

  const activeSession = store.sessions.find((s) => s.active)
  const activeAlerts = heuristicAlerts.filter((a) => !a.dismissed)
  const activeAlertCount = activeAlerts.length
  const latestAlert = activeAlerts[activeAlerts.length - 1] ?? null

  const renderView = (): React.ReactElement => {
    switch (view) {
      case 'home': return <Home store={store} onNavigate={handleNavigate} onScanComplete={handleScanComplete} onRefresh={refreshStore} latestAlert={latestAlert} onChatWith={(msg) => { setChatPreFill(msg); setChatOpen(true) }} />
      case 'focus-shield': return <Overview store={store} onRefresh={refreshStore} onChatWith={(msg) => { setChatPreFill(msg); setChatOpen(true) }} />
      case 'deep-clean': return <DeepClean store={store} onChatWith={(msg) => { setChatPreFill(msg); setChatOpen(true) }} />
      case 'analytics': return <Analytics onChatWith={(msg) => { setChatPreFill(msg); setChatOpen(true) }} />
      case 'deep-focus': return <DeepFocusMode store={store} onRefresh={refreshStore} />
      case 'schedule-manager': return <ScheduleManager store={store} onRefresh={refreshStore} />
      case 'algo-track': return <AlgoTrack store={store} onChatWith={(msg) => { setChatPreFill(msg); setChatOpen(true) }} />
      case 'patterns': return <Patterns heuristicAlerts={heuristicAlerts} onChatWith={(msg) => { setChatPreFill(msg); setChatOpen(true) }} />
      case 'focus-scan-results': return <FocusScanResults results={scanResults} store={store} onNavigate={handleNavigate} onRefresh={refreshStore} onChatWith={(msg) => { setChatPreFill(msg); setChatOpen(true) }} />
      default: return <Home store={store} onNavigate={handleNavigate} onScanComplete={handleScanComplete} onRefresh={refreshStore} />
    }
  }

  return (
    <div className="flex flex-col h-screen w-full overflow-hidden" style={{ background: '#020912' }}>
      {/* Custom title bar */}
      <div
        className="titlebar-drag flex items-center justify-between px-4 flex-shrink-0"
        style={{
          height: 32,
          background: 'rgba(2,9,18,0.98)',
          borderBottom: '1px solid rgba(0,200,255,0.1)',
        }}
      >
        {/* Left: corner bracket accent + traffic lights */}
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5">
            <div className="w-2.5 h-2.5 rounded-full bg-[#ff5f57]" style={{ boxShadow: '0 0 4px rgba(255,95,87,0.4)' }} />
            <div className="w-2.5 h-2.5 rounded-full bg-[#febc2e]" style={{ boxShadow: '0 0 4px rgba(254,188,46,0.3)' }} />
            <div className="w-2.5 h-2.5 rounded-full bg-[#28c840]" style={{ boxShadow: '0 0 4px rgba(40,200,64,0.3)' }} />
          </div>
          <div className="w-px h-3" style={{ background: 'rgba(0,200,255,0.15)' }} />
        </div>

        {/* Center: monospace title */}
        <div className="flex items-center gap-2">
          <div className="w-1 h-1 rounded-full" style={{ background: 'rgba(0,200,255,0.5)' }} />
          <span
            style={{
              fontFamily: '"Share Tech Mono", monospace',
              fontSize: 10,
              letterSpacing: '0.25em',
              color: 'rgba(0,200,255,0.55)',
              textTransform: 'uppercase',
            }}
          >
            Productivity Daemon
          </span>
          <div className="w-1 h-1 rounded-full" style={{ background: 'rgba(0,200,255,0.5)' }} />
        </div>

        {/* Right: window controls */}
        <div className="titlebar-nodrag flex items-center">
          <button
            onClick={() => api.minimizeWindow()}
            className="flex items-center justify-center transition-colors hover:bg-white/5"
            style={{ width: 32, height: 32, color: 'rgba(0,200,255,0.35)' }}
          >
            <Minus size={11} />
          </button>
          <button
            onClick={() => api.maximizeWindow()}
            className="flex items-center justify-center transition-colors hover:bg-white/5"
            style={{ width: 32, height: 32, color: 'rgba(0,200,255,0.35)' }}
          >
            <Square size={10} />
          </button>
          <button
            onClick={() => api.closeWindow()}
            className="flex items-center justify-center transition-colors hover:bg-red-500/15"
            style={{ width: 32, height: 32, color: 'rgba(0,200,255,0.35)' }}
          >
            <X size={11} />
          </button>
        </div>
      </div>

      {/* Main layout */}
      <div className="flex flex-1 overflow-hidden">
        <Sidebar
          currentView={view}
          onNavigate={handleNavigate}
          onChatOpen={() => setChatOpen(true)}
          activeSession={activeSession}
          elevation={store.elevation}
          alertCount={activeAlertCount}
        />
        <main
          className="flex-1 overflow-hidden relative flex flex-col"
          style={{ background: '#030c1a' }}
        >
          {activeSession && (
            <div
              className="flex-shrink-0 flex items-center justify-between px-5 py-1.5"
              style={{
                background: 'rgba(0,230,118,0.04)',
                borderBottom: '1px solid rgba(0,230,118,0.15)',
              }}
            >
              <div className="flex items-center gap-2.5">
                <div
                  className="w-1.5 h-1.5 rounded-full animate-pulse"
                  style={{ background: '#00e676', boxShadow: '0 0 6px #00e676' }}
                />
                <span
                  className="text-[10px] font-bold uppercase tracking-widest"
                  style={{ color: '#00e676', fontFamily: '"Share Tech Mono", monospace', letterSpacing: '0.2em' }}
                >
                  Focus Session Active
                </span>
                {activeSession.endsAt && (
                  <span className="text-[10px]" style={{ color: 'rgba(0,200,255,0.45)', fontFamily: '"Share Tech Mono", monospace' }}>
                    · ends {new Date(activeSession.endsAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </span>
                )}
              </div>
              <button
                className="text-[10px] uppercase tracking-widest transition-colors hover:text-white"
                style={{ color: 'rgba(0,200,255,0.4)', fontFamily: '"Share Tech Mono", monospace' }}
                onClick={async () => { await api.stopSession(activeSession.id); refreshStore() }}
              >
                End
              </button>
            </div>
          )}
          <div className={`flex-1 min-h-0 animate-fade-in ${view === 'home' ? 'overflow-hidden' : 'overflow-y-auto'}`}>
            {renderView()}
          </div>
        </main>

        {chatOpen && (
          <ChatPanel store={store} onClose={() => { setChatOpen(false); setChatPreFill('') }} onRefresh={refreshStore} initialMessage={chatPreFill} />
        )}
      </div>

      {/* Heuristic alert toast */}
      {toastAlert && (
        <div
          className="fixed bottom-5 right-5 max-w-[320px] z-50 animate-fade-in hud-panel"
          style={{
            background: 'rgba(8,14,26,0.98)',
            boxShadow: '0 8px 40px rgba(0,0,0,0.6), 0 0 1px rgba(255,170,0,0.3)',
            padding: '14px 16px',
          }}
        >
          {/* TL corner accent override color for amber */}
          <div className="absolute top-0 left-0 w-3 h-3 pointer-events-none" style={{ borderTop: '2px solid rgba(255,170,0,0.8)', borderLeft: '2px solid rgba(255,170,0,0.8)' }} />
          <div className="absolute bottom-0 right-0 w-3 h-3 pointer-events-none" style={{ borderBottom: '2px solid rgba(255,170,0,0.5)', borderRight: '2px solid rgba(255,170,0,0.5)' }} />

          <div className="flex items-start gap-3">
            <div
              className="flex-shrink-0 w-7 h-7 flex items-center justify-center"
              style={{ border: '1px solid rgba(255,170,0,0.3)', background: 'rgba(255,170,0,0.08)' }}
            >
              <AlertTriangle size={13} style={{ color: '#ffaa00' }} />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-[11px] font-bold uppercase tracking-widest" style={{ color: '#ffaa00', fontFamily: '"Share Tech Mono", monospace' }}>
                {toastAlert.title}
              </p>
              <p className="text-[10px] mt-1 leading-relaxed" style={{ color: '#5a7a94' }}>
                {toastAlert.description}
              </p>
              <button
                onClick={() => { setToastAlert(null); handleNavigate('patterns') }}
                className="mt-2 text-[9px] uppercase tracking-widest hover:text-white transition-colors"
                style={{ color: 'rgba(0,200,255,0.6)', fontFamily: '"Share Tech Mono", monospace' }}
              >
                View Patterns →
              </button>
            </div>
            <button
              onClick={() => setToastAlert(null)}
              className="flex-shrink-0 transition-colors"
              style={{ color: 'rgba(0,200,255,0.3)' }}
            >
              <X size={12} />
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

declare global {
  interface Window {
    electronAPI: {
      getStore: () => Promise<import('@shared/types').AppStore>
      setStore: (patch: Partial<import('@shared/types').AppStore>) => Promise<import('@shared/types').AppStore>
      runScan: () => Promise<import('@shared/types').ScanResult>
      addDomain: (domain: string, expiresInMs?: number) => Promise<{ ok: boolean; error?: string }>
      removeDomain: (domain: string) => Promise<void>
      addProcess: (name: string, expiresInMs?: number) => Promise<void>
      removeProcess: (name: string) => Promise<void>
      getElevationCheck: () => Promise<{ elevated: boolean; writable: boolean }>
      startSession: (mode: 'normal' | 'deep', durationMs?: number, allowlist?: string[]) => Promise<import('@shared/types').FocusSession>
      stopSession: (id: string) => Promise<void>
      sendMessage: (text: string) => Promise<{ reply: string; actions: unknown[] }>
      checkIntent: (site: string, reason: string) => Promise<import('@shared/types').IntentCheckResult>
      getElevationStatus: () => Promise<import('@shared/types').ElevationStatus>
      requestElevation: () => Promise<import('@shared/types').ElevationStatus>
      relaunchAsAdmin: () => Promise<boolean>
      registerStartupDaemon: () => Promise<boolean>
      unregisterStartupDaemon: () => Promise<boolean>
      getStartupStatus: () => Promise<boolean>
      getPlatform: () => Promise<'windows' | 'mac' | 'linux'>
      getAnalytics: () => Promise<{
        today: import('@shared/types').DailyStats
        weekly: { focusedTime: number; distractedTime: number; timePerApp: Record<string, number>; sessionCount: number; blockEvents: number }
        heuristicAlerts: import('@shared/types').HeuristicAlert[]
        recentSessions: import('@shared/types').ActivitySession[]
      }>
      dismissHeuristicAlert: (id: string) => Promise<void>
      hideInterstitial: () => Promise<void>
      proceedAnyway: () => Promise<void>
      onInterstitialData: (cb: (data: { blocked: string; type: string; endsAt?: number }) => void) => void
      onHeuristicAlert: (cb: (alerts: import('@shared/types').HeuristicAlert[]) => void) => void
      minimizeWindow: () => void
      maximizeWindow: () => void
      closeWindow: () => void
    }
  }
}

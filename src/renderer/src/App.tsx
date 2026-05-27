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
    <div className="flex flex-col h-screen w-full overflow-hidden bg-navy-850">
      {/* Custom title bar */}
      <div className="titlebar-drag flex items-center justify-between h-8 bg-navy-900 px-4 flex-shrink-0">
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 rounded-full bg-[#ff5f57]" />
          <div className="w-3 h-3 rounded-full bg-[#febc2e]" />
          <div className="w-3 h-3 rounded-full bg-[#28c840]" />
        </div>
        <span className="text-navy-400 text-xs font-medium">Productivity Daemon</span>
        <div className="titlebar-nodrag flex items-center gap-1">
          <button onClick={() => api.minimizeWindow()} className="p-1 hover:text-white text-navy-400 transition-colors">
            <Minus size={12} />
          </button>
          <button onClick={() => api.maximizeWindow()} className="p-1 hover:text-white text-navy-400 transition-colors">
            <Square size={11} />
          </button>
          <button onClick={() => api.closeWindow()} className="p-1 hover:text-red-400 text-navy-400 transition-colors">
            <X size={12} />
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
        <main className="flex-1 overflow-hidden bg-navy-800 relative flex flex-col">
          {activeSession && (
            <div className="flex-shrink-0 flex items-center justify-between px-6 py-2 bg-accent-blue/10 border-b border-accent-blue/20">
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-accent-green animate-pulse" />
                <span className="text-xs text-accent-green font-medium">Focus session active</span>
                {activeSession.endsAt && (
                  <span className="text-xs text-navy-400">
                    · ends {new Date(activeSession.endsAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </span>
                )}
              </div>
              <button
                className="text-xs text-navy-400 hover:text-white transition-colors"
                onClick={async () => {
                  await api.stopSession(activeSession.id)
                  refreshStore()
                }}
              >
                End session
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
          className="fixed bottom-6 right-6 max-w-[340px] rounded-2xl p-4 z-50 animate-fade-in"
          style={{
            background: 'rgba(12,20,35,0.96)',
            border: '1px solid rgba(255,184,0,0.3)',
            boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
          }}
        >
          <div className="flex items-start gap-3">
            <div className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0" style={{ background: 'rgba(255,184,0,0.15)' }}>
              <AlertTriangle size={15} className="text-accent-amber" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-white text-xs font-semibold">{toastAlert.title}</p>
              <p className="text-navy-400 text-xs mt-0.5 leading-relaxed">{toastAlert.description}</p>
              <button
                onClick={() => { setToastAlert(null); handleNavigate('patterns') }}
                className="mt-2 text-accent-blue text-xs hover:underline"
              >
                View in Analytics →
              </button>
            </div>
            <button onClick={() => setToastAlert(null)} className="text-navy-600 hover:text-navy-400 transition-colors flex-shrink-0">
              <X size={13} />
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

import React, { useState, useEffect, useCallback } from 'react'
import { useTheme } from './context/ThemeContext'
import Sidebar from './components/Sidebar'
import Home from './views/Home'
import Overview from './views/Overview'
import DeepClean from './views/DeepClean'
import DeepFocusMode from './views/DeepFocusMode'
import ScheduleManager from './views/ScheduleManager'
import AlgoTrack from './views/AlgoTrack'
import Analytics from './views/Analytics'
import Insights from './views/Insights'
import FocusScanResults from './views/FocusScanResults'
import Patterns from './views/Patterns'
import Actions from './views/Actions'
import SettingsView from './views/Settings'
import Onboarding from './views/Onboarding'
import ChatPanel from './chat/ChatPanel'
import type { ViewName, AppStore, ScanResult, HeuristicAlert } from '@shared/types'
import { Minus, Square, X, Coffee } from 'lucide-react'

const api = (window as unknown as { electronAPI: Window['electronAPI'] }).electronAPI

export default function App(): React.ReactElement {
  const [store, setStore] = useState<AppStore | null>(null)
  const [view, setView] = useState<ViewName>('home')
  const [chatOpen, setChatOpen] = useState(false)
  const [chatPreFill, setChatPreFill] = useState('')
  const [scanResults, setScanResults] = useState<ScanResult | null>(null)
  const [heuristicAlerts, setHeuristicAlerts] = useState<HeuristicAlert[]>([])
  const [liveAutoBlocks, setLiveAutoBlocks] = useState<{ domain: string; confidence: number; ts: number }[]>([])
  const [pendingActionCount, setPendingActionCount] = useState(0)
  const [breakMode, setBreakMode] = useState<{ endsAt: number; reason?: string } | null>(null)
  const [alwaysOn, setAlwaysOn] = useState(false)
  const [platform, setPlatform] = useState<'windows' | 'mac' | 'linux'>('windows')

  const { colors } = useTheme()

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

  useEffect(() => {
    api.getStore().then((s) => {
      setStore(s)
      // Restore break mode if it's still active after a renderer reload
      if (s.breakMode && Date.now() < s.breakMode.endsAt) {
        setBreakMode(s.breakMode)
      }
    })
  }, [])

  useEffect(() => {
    api.getAlwaysOn().then((r) => setAlwaysOn(r.enabled)).catch(() => {})
  }, [])

  useEffect(() => {
    api.getPlatform().then(setPlatform).catch(() => {})
  }, [])

  const toggleAlwaysOn = useCallback(async (): Promise<void> => {
    const next = !alwaysOn
    setAlwaysOn(next)
    try { await api.setAlwaysOn(next) } catch { setAlwaysOn(!next) }
  }, [alwaysOn])

  useEffect(() => {
    const offStart = api.onBreakStarted((evt) => setBreakMode(evt))
    const offEnd = api.onBreakEnded(() => { setBreakMode(null); api.getStore().then(setStore) })
    return () => { offStart(); offEnd() }
  }, [])

  // Heuristic alerts — update patterns view, overlay handles the notification
  useEffect(() => {
    api.onHeuristicAlert((alerts) => setHeuristicAlerts(alerts))
  }, [])

  // Guard and auto-block — overlay handles notifications; update live data for Actions tab
  useEffect(() => {
    const offGuard = api.onGuardAlert(() => { /* overlay handles it */ })
    const offBlock = api.onInferenceAutoBlocked((evt) => {
      setLiveAutoBlocks((prev) => [{ ...evt, ts: Date.now() }, ...prev].slice(0, 20))
    })
    return () => { offGuard(); offBlock() }
  }, [])

  // Overlay action routing + extension "open rules" request
  useEffect(() => {
    api.onOverlayOpenChat?.((msg: string) => { setChatPreFill(msg); setChatOpen(true) })
    api.onOverlayNavigate?.((view: string) => handleNavigate(view as import('@shared/types').ViewName))
    // Browser extension calls /daemon/focus-rules → daemon sends 'navigate' IPC to renderer
    const off = api.onNavigate?.((view: string) => handleNavigate(view as import('@shared/types').ViewName))
    return () => { off?.() }
  }, [handleNavigate])

  // Load pending inference count on mount and on new suggestions
  useEffect(() => {
    const loadPending = (): void => {
      api.getInferences('pending').then((rows: unknown) => {
        setPendingActionCount((rows as unknown[]).length)
      }).catch(() => {/* noop */})
    }
    loadPending()
    const off = api.onInferenceSuggest(() => loadPending())
    return off
  }, [])

  if (!store) {
    return (
      <div className="flex items-center justify-center h-screen w-screen bg-navy-850">
        <div className="flex flex-col items-center gap-4">
          <div className="w-12 h-12 rounded-full border-2 border-accent-blue border-t-transparent animate-spin" />
          <p className="text-navy-400 text-sm">Loading Attentify…</p>
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
      case 'insights': return <Insights heuristicAlerts={heuristicAlerts} onChatWith={(msg) => { setChatPreFill(msg); setChatOpen(true) }} />
      case 'analytics': return <Analytics onChatWith={(msg) => { setChatPreFill(msg); setChatOpen(true) }} />
      case 'deep-focus': return <DeepFocusMode store={store} onRefresh={refreshStore} />
      case 'schedule-manager': return <ScheduleManager store={store} onRefresh={refreshStore} />
      case 'algo-track': return <AlgoTrack store={store} onChatWith={(msg) => { setChatPreFill(msg); setChatOpen(true) }} />
      case 'patterns': return <Patterns heuristicAlerts={heuristicAlerts} onChatWith={(msg) => { setChatPreFill(msg); setChatOpen(true) }} />
      case 'actions': return <Actions onChatWith={(msg) => { setChatPreFill(msg); setChatOpen(true) }} liveAutoBlocks={liveAutoBlocks} />
      case 'settings': return <SettingsView store={store} onRefresh={refreshStore} onNavigate={handleNavigate} />
      case 'focus-scan-results': return <FocusScanResults results={scanResults} store={store} onNavigate={handleNavigate} onRefresh={refreshStore} onChatWith={(msg) => { setChatPreFill(msg); setChatOpen(true) }} />
      default: return <Home store={store} onNavigate={handleNavigate} onScanComplete={handleScanComplete} onRefresh={refreshStore} />
    }
  }

  return (
    <div className="flex flex-col h-screen w-full overflow-hidden" style={{ background: colors.rootBg, transition: 'background 0.2s ease' }}>
      {/* Custom title bar */}
      <div
        className="titlebar-drag flex items-center justify-between px-4 flex-shrink-0"
        style={{
          height: 32,
          background: 'rgba(2,9,18,0.98)',
          borderBottom: '1px solid rgba(0,200,255,0.1)',
        }}
      >
        {/* Left: macOS traffic lights (macOS only — Windows uses the right-side
            controls). Rendering only the current platform's controls avoids the
            "two sets of window buttons" look. */}
        <div className="flex items-center gap-3">
          {platform === 'mac' && (
            <>
              <div className="titlebar-nodrag flex items-center gap-2">
                <button
                  onClick={() => api.closeWindow()}
                  className="w-3 h-3 rounded-full bg-[#ff5f57] hover:brightness-90 transition-all"
                  title="Close"
                />
                <button
                  onClick={() => api.minimizeWindow()}
                  className="w-3 h-3 rounded-full bg-[#febc2e] hover:brightness-90 transition-all"
                  title="Minimize"
                />
                <button
                  onClick={() => api.maximizeWindow()}
                  className="w-3 h-3 rounded-full bg-[#28c840] hover:brightness-90 transition-all"
                  title="Zoom"
                />
              </div>
              <div className="w-px h-3" style={{ background: 'rgba(0,200,255,0.15)' }} />
            </>
          )}
          <button
            onClick={() => void toggleAlwaysOn()}
            className="titlebar-nodrag flex items-center gap-1.5 rounded-full transition-all"
            title={alwaysOn
              ? 'Always-On is enabled: protection keeps running in the background (and at login) even when this window is closed. Click to turn off.'
              : 'Turn on Always-On: protection stays active at all times like an antivirus, even when the app is closed, and starts automatically at login.'}
            style={{
              padding: '2px 8px',
              border: `1px solid ${alwaysOn ? 'rgba(0,230,118,0.45)' : 'rgba(0,200,255,0.15)'}`,
              background: alwaysOn ? 'rgba(0,230,118,0.10)' : 'transparent',
            }}
          >
            <span
              className="rounded-full"
              style={{
                width: 6, height: 6,
                background: alwaysOn ? '#00e676' : 'rgba(0,200,255,0.3)',
                boxShadow: alwaysOn ? '0 0 6px #00e676' : 'none',
              }}
            />
            <span style={{ fontFamily: '"Share Tech Mono", monospace', fontSize: 9, letterSpacing: '0.15em', color: alwaysOn ? '#00e676' : 'rgba(0,200,255,0.4)' }}>
              ALWAYS&nbsp;ON
            </span>
          </button>
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
            Attentify
          </span>
          <div className="w-1 h-1 rounded-full" style={{ background: 'rgba(0,200,255,0.5)' }} />
        </div>

        {/* Right: Windows / Linux window controls (hidden on macOS, which uses the
            traffic lights on the left). */}
        {platform !== 'mac' ? (
          <div className="titlebar-nodrag flex items-center">
            <button
              onClick={() => api.minimizeWindow()}
              className="flex items-center justify-center transition-colors hover:bg-white/5"
              style={{ width: 32, height: 32, color: 'rgba(0,200,255,0.5)' }}
            >
              <Minus size={11} />
            </button>
            <button
              onClick={() => api.maximizeWindow()}
              className="flex items-center justify-center transition-colors hover:bg-white/5"
              style={{ width: 32, height: 32, color: 'rgba(0,200,255,0.5)' }}
            >
              <Square size={10} />
            </button>
            <button
              onClick={() => api.closeWindow()}
              className="flex items-center justify-center transition-colors hover:bg-[#e81123]"
              style={{ width: 32, height: 32, color: 'rgba(0,200,255,0.5)' }}
            >
              <X size={11} />
            </button>
          </div>
        ) : (
          <div style={{ width: 60 }} />
        )}
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
          pendingActionCount={pendingActionCount}
        />
        <main
          className="flex-1 overflow-hidden relative flex flex-col"
          style={{ background: colors.mainBg, transition: 'background 0.2s ease' }}
        >
          {breakMode && Date.now() < breakMode.endsAt && (
            <div
              className="flex-shrink-0 flex items-center justify-between px-5 py-1.5"
              style={{ background: 'rgba(255,170,0,0.05)', borderBottom: '1px solid rgba(255,170,0,0.18)' }}
            >
              <div className="flex items-center gap-2.5">
                <Coffee size={12} style={{ color: '#ffaa00' }} />
                <span
                  className="text-[10px] font-bold uppercase tracking-widest"
                  style={{ color: '#ffaa00', fontFamily: '"Share Tech Mono", monospace', letterSpacing: '0.2em' }}
                >
                  Break Mode Active
                </span>
                <span className="text-[10px]" style={{ color: colors.textMuted, fontFamily: '"Share Tech Mono", monospace' }}>
                  · resumes {new Date(breakMode.endsAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </span>
              </div>
              <button
                className="text-[10px] uppercase tracking-widest transition-colors hover:text-white"
                style={{ color: colors.textMuted, fontFamily: '"Share Tech Mono", monospace' }}
                onClick={async () => { await api.endBreak(); setBreakMode(null) }}
              >
                End Break
              </button>
            </div>
          )}

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
                  <span className="text-[10px]" style={{ color: colors.textMuted, fontFamily: '"Share Tech Mono", monospace' }}>
                    · ends {new Date(activeSession.endsAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </span>
                )}
              </div>
              {activeSession.mode === 'deep' && activeSession.endsAt && Date.now() < activeSession.endsAt ? (
                <span
                  className="text-[10px] uppercase tracking-widest"
                  style={{ color: '#ffaa00', fontFamily: '"Share Tech Mono", monospace' }}
                  title="Deep Focus is locked until its timer ends."
                >
                  Locked
                </span>
              ) : (
                <button
                  className="text-[10px] uppercase tracking-widest transition-colors hover:text-white"
                  style={{ color: colors.textMuted, fontFamily: '"Share Tech Mono", monospace' }}
                  onClick={async () => { await api.stopSession(activeSession.id); refreshStore() }}
                >
                  End
                </button>
              )}
            </div>
          )}
          {/* key={view} remounts on navigation so each screen fades in — gives a calm,
              consistent sense of moving from one screen to the next. */}
          <div key={view} className={`flex-1 min-h-0 animate-fade-in ${view === 'home' || view === 'insights' ? 'overflow-hidden' : 'overflow-y-auto'}`}>
            {renderView()}
          </div>
        </main>

        {chatOpen && (
          <ChatPanel onClose={() => { setChatOpen(false); setChatPreFill('') }} onRefresh={refreshStore} initialMessage={chatPreFill} />
        )}
      </div>

    </div>
  )
}

declare global {
  interface Window {
    electronAPI: {
      getStore: () => Promise<import('@shared/types').AppStore>
      setStore: (patch: Partial<import('@shared/types').AppStore>) => Promise<import('@shared/types').AppStore>
      getChangeLog: (limit?: number) => Promise<import('@shared/types').ChangeEntry[]>
      getSafetyStatus: () => Promise<{ changeCount: number }>
      revertAllChanges: () => Promise<{ ok: boolean; undone: string[]; errors: string[] }>
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
      exportPdf: () => Promise<{ ok: boolean; canceled?: boolean; filePath?: string; error?: string }>
      hideInterstitial: () => Promise<void>
      proceedAnyway: () => Promise<void>
      startBreak: (durationMs: number, reason?: string) => Promise<{ ok: boolean; endsAt: number }>
      endBreak: () => Promise<{ ok: boolean }>
      getBreakStatus: () => Promise<{ endsAt: number; reason?: string } | null>
      onBreakStarted: (cb: (evt: { endsAt: number; reason?: string }) => void) => (() => void)
      onBreakEnded: (cb: () => void) => (() => void)
      onInterstitialData: (cb: (data: { blocked: string; type: string; endsAt?: number }) => void) => void
      onHeuristicAlert: (cb: (alerts: import('@shared/types').HeuristicAlert[]) => void) => void
      onGuardAlert: (cb: (alert: { url: string; domain: string; title: string; category: string; message: string; searchQuery?: string; timestamp: number }) => void) => (() => void)
      onInferenceAutoBlocked: (cb: (evt: { domain: string; confidence: number }) => void) => (() => void)
      onInferenceSuggest: (cb: (inf: unknown) => void) => (() => void)
      getInferences: (status?: string) => Promise<unknown[]>
      resolveInference: (id: string, status: 'confirmed' | 'rejected') => Promise<{ ok: boolean }>
      chatStart: (text: string) => void
      onChatChunk: (cb: (chunk: string) => void) => (() => void)
      onChatTool: (cb: (toolName: string) => void) => (() => void)
      onChatDone: (cb: (event: import('@shared/types').AgentDoneEvent) => void) => (() => void)
      onChatError: (cb: (err: string) => void) => (() => void)
      getAgentHistory: (limit?: number) => Promise<unknown[]>
      clearChatHistory: () => Promise<{ ok: boolean }>
      dismissProactive: () => Promise<{ ok: boolean }>
      onAgentProactive: (cb: (evt: import('@shared/types').AgentProactiveEvent) => void) => (() => void)
      onStoreRefresh: (cb: () => void) => (() => void)
      addGoal: (text: string, priority?: number) => Promise<unknown>
      getGoals: () => Promise<unknown[]>
      clearGoal: (id: string) => Promise<{ ok: boolean }>
      getAlwaysOn: () => Promise<{ enabled: boolean; startupRegistered: boolean }>
      setAlwaysOn: (enabled: boolean) => Promise<{ ok: boolean; enabled: boolean; startupRegistered: boolean }>
      getApiKeyStatus: () => Promise<{ hasKey: boolean }>
      setApiKey: (key: string) => Promise<{ ok: boolean }>
      deleteApiKey: () => Promise<{ ok: boolean }>
      getUsage: () => Promise<import('@shared/types').UsageState>
      onUsageChanged: (cb: (usage: import('@shared/types').UsageState) => void) => (() => void)
      getCloud: () => Promise<import('@shared/types').CloudState>
      setCloudLicense: (license: string) => Promise<import('@shared/types').CloudState>
      clearCloudLicense: () => Promise<import('@shared/types').CloudState>
      cloudCheckout: (email?: string) => Promise<{ url?: string; error?: string }>
      openExternal: (url: string) => Promise<{ ok: boolean }>
      minimizeWindow: () => void
      maximizeWindow: () => void
      closeWindow: () => void
    }
  }
}

import React, { useState, useEffect, useCallback } from 'react'
import { useTheme } from './context/ThemeContext'
import Sidebar from './components/Sidebar'
import Overview from './views/Overview'
import DeepClean from './views/DeepClean'
import DeepFocusMode from './views/DeepFocusMode'
import ScheduleManager from './views/ScheduleManager'
import AlgoTrack from './views/AlgoTrack'
import Analytics from './views/Analytics'
import FocusScanResults from './views/FocusScanResults'
import Patterns from './views/Patterns'
import Actions from './views/Actions'
import SettingsView from './views/Settings'
import Onboarding from './views/Onboarding'
import Timesheets from './views/Timesheets'
import Logic from './views/Logic'
import Activity from './views/Activity'
import ChatPanel from './chat/ChatPanel'
import AmbientWash from './components/AmbientWash'
import PulseField from './components/PulseField'
import { PresenceProvider } from './context/PresenceContext'
import AuthPanel from './components/AuthPanel'
import type { ViewName, AppStore, ScanResult, HeuristicAlert } from '@shared/types'
import { Minus, Square, X, Coffee, Download, Lock } from 'lucide-react'

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
  // Sidebar collapse. Local, not in the store: it is a per-window view preference, and
  // routing it through IPC would put a layout toggle behind the sign-in gate.
  const [sidebarCollapsed, setSidebarCollapsed] = useState(
    () => localStorage.getItem('sidebarCollapsed') === '1',
  )
  const toggleSidebar = useCallback(() => {
    setSidebarCollapsed((v) => {
      localStorage.setItem('sidebarCollapsed', v ? '0' : '1')
      return !v
    })
  }, [])

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

  // Sign-in state. The app stays browsable signed-out, but the main process rejects every
  // action channel (see OPEN_CHANNELS in ipc.ts), so the UI has to say why rather than
  // letting buttons fail silently. Re-checked on window focus so signing in through the
  // system browser (OAuth) reflects here without a restart.
  const [auth, setAuth] = useState<import('@shared/types').AuthState | null>(null)
  const refreshAuth = useCallback(() => {
    api.getAuth?.().then(setAuth).catch(() => setAuth(null))
  }, [])
  useEffect(() => {
    refreshAuth()
    window.addEventListener('focus', refreshAuth)
    return () => window.removeEventListener('focus', refreshAuth)
  }, [refreshAuth])
  // null = still loading; don't flash the banner before we know.
  const signedOut = auth !== null && !auth.signedIn
  const [authPrompt, setAuthPrompt] = useState(false)
  // Close the prompt the moment sign-in succeeds.
  useEffect(() => { if (auth?.signedIn) setAuthPrompt(false) }, [auth?.signedIn])

  // Auto-update status → show a "restart to update" banner when a build is ready.
  const [update, setUpdate] = useState<import('@shared/types').UpdateStatus>({ state: 'idle' })
  useEffect(() => {
    api.getUpdateStatus?.().then(setUpdate).catch(() => {})
    const off = api.onUpdateStatus?.((s) => setUpdate(s))
    return () => { off?.() }
  }, [])

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
      case 'home': return <ChatPanel key="home-chat" variant="full" onRefresh={refreshStore} initialMessage={chatPreFill} />
      case 'timesheets': return <Timesheets onChatWith={(msg) => { setChatPreFill(msg); setChatOpen(true) }} />
      case 'logic': return <Logic onChatWith={(msg) => { setChatPreFill(msg); setChatOpen(true) }} />
      case 'activity': return <Activity onChatWith={(msg) => { setChatPreFill(msg); setChatOpen(true) }} />

      case 'focus-shield': return <Overview store={store} onRefresh={refreshStore} onChatWith={(msg) => { setChatPreFill(msg); setChatOpen(true) }} />
      case 'deep-clean': return <DeepClean store={store} onChatWith={(msg) => { setChatPreFill(msg); setChatOpen(true) }} />
      // Insights was merged into Analytics — keep the route working for old links.
      case 'insights':
      case 'analytics': return <Analytics onChatWith={(msg) => { setChatPreFill(msg); setChatOpen(true) }} />
      case 'deep-focus': return <DeepFocusMode store={store} onRefresh={refreshStore} />
      case 'schedule-manager': return <ScheduleManager store={store} onRefresh={refreshStore} />
      case 'algo-track': return <AlgoTrack store={store} onChatWith={(msg) => { setChatPreFill(msg); setChatOpen(true) }} />
      case 'patterns': return <Patterns heuristicAlerts={heuristicAlerts} onChatWith={(msg) => { setChatPreFill(msg); setChatOpen(true) }} />
      case 'actions': return <Actions onChatWith={(msg) => { setChatPreFill(msg); setChatOpen(true) }} liveAutoBlocks={liveAutoBlocks} />
      case 'settings': return <SettingsView store={store} onRefresh={refreshStore} onNavigate={handleNavigate} />
      case 'focus-scan-results': return <FocusScanResults results={scanResults} store={store} onNavigate={handleNavigate} onRefresh={refreshStore} onChatWith={(msg) => { setChatPreFill(msg); setChatOpen(true) }} />
      default: return <ChatPanel key="home-chat" variant="full" onRefresh={refreshStore} initialMessage={chatPreFill} />
    }
  }

  return (
    <PresenceProvider
      hasActiveSession={!!activeSession}
      alertCount={activeAlertCount}
      pendingCount={pendingActionCount}
    >
    <div className="flex flex-col h-screen w-full overflow-hidden relative" style={{ background: colors.rootBg, transition: 'background 0.2s ease' }}>
      {/* The app's ambient response to your state. Behind everything, pointer-events:none. */}
      <AmbientWash />
      <PulseField />
      {/* Custom title bar */}
      <div
        className="titlebar-drag flex items-center justify-between px-4 flex-shrink-0"
        style={{
          height: 32,
          background: colors.panelBg,
          borderBottom: `1px solid ${colors.border}`,
          transition: 'background 0.2s ease',
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
              <div className="w-px h-3" style={{ background: 'rgba(99,102,241,0.15)' }} />
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
              border: `1px solid ${alwaysOn ? 'rgba(52,211,153,0.45)' : 'rgba(99,102,241,0.15)'}`,
              background: alwaysOn ? 'rgba(52,211,153,0.10)' : 'transparent',
            }}
          >
            <span
              className="rounded-full"
              style={{
                width: 6, height: 6,
                background: alwaysOn ? '#34d399' : 'rgba(99,102,241,0.3)',
                boxShadow: alwaysOn ? '0 0 6px #34d399' : 'none',
              }}
            />
            <span style={{ fontFamily: '"Share Tech Mono", monospace', fontSize: 9, letterSpacing: '0.15em', color: alwaysOn ? '#34d399' : 'rgba(99,102,241,0.4)' }}>
              ALWAYS&nbsp;ON
            </span>
          </button>
        </div>

        {/* Theme, bug report and account used to sit here as a centre cluster; they now
            live in the sidebar's utility row, which keeps the title bar to window
            chrome only. */}

        {/* Right: Windows / Linux window controls (hidden on macOS, which uses the
            traffic lights on the left). */}
        {platform !== 'mac' ? (
          <div className="titlebar-nodrag flex items-center">
            <button
              onClick={() => api.minimizeWindow()}
              className="flex items-center justify-center transition-colors hover:bg-white/5"
              style={{ width: 32, height: 32, color: 'rgba(99,102,241,0.5)' }}
            >
              <Minus size={11} />
            </button>
            <button
              onClick={() => api.maximizeWindow()}
              className="flex items-center justify-center transition-colors hover:bg-white/5"
              style={{ width: 32, height: 32, color: 'rgba(99,102,241,0.5)' }}
            >
              <Square size={10} />
            </button>
            <button
              onClick={() => api.closeWindow()}
              className="flex items-center justify-center transition-colors hover:bg-[#e81123]"
              style={{ width: 32, height: 32, color: 'rgba(99,102,241,0.5)' }}
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
          collapsed={sidebarCollapsed}
          onToggleCollapsed={toggleSidebar}
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
          // Transparent on purpose: the ambient wash lives behind the whole app, so an
          // opaque main plane would cover the one surface carrying the AI's state.
          style={{ background: 'transparent', transition: 'background 0.2s ease' }}
        >
          {signedOut && (
            <div className="flex-shrink-0 flex items-center justify-between px-5 py-1.5"
              style={{ background: 'rgba(251,191,36,0.07)', borderBottom: '1px solid rgba(251,191,36,0.25)' }}>
              <div className="flex items-center gap-2.5">
                <Lock size={12} style={{ color: '#fbbf24' }} />
                <span className="text-[11px]" style={{ color: colors.textSecondary }}>
                  You&rsquo;re signed out. Look around freely, blocking, focus sessions and the
                  assistant need an account.
                </span>
              </div>
              <button onClick={() => setAuthPrompt(true)}
                className="text-[11px] font-medium px-2.5 py-1 rounded-md transition-opacity hover:opacity-90"
                style={{ background: 'rgba(251,191,36,0.14)', border: '1px solid rgba(251,191,36,0.4)', color: '#fbbf24' }}>
                Sign in
              </button>
            </div>
          )}
          {(update.state === 'ready' || update.state === 'downloading') && (
            <div className="flex-shrink-0 flex items-center justify-between px-5 py-1.5"
              style={{ background: 'rgba(99,102,241,0.06)', borderBottom: '1px solid rgba(99,102,241,0.2)' }}>
              <div className="flex items-center gap-2.5">
                <Download size={12} style={{ color: colors.accent }} />
                <span className="text-[11px]" style={{ color: colors.textSecondary }}>
                  {update.state === 'ready'
                    ? <>Update{update.version ? ` ${update.version}` : ''} ready to install.</>
                    : <>Downloading update{typeof update.percent === 'number' ? `: ${update.percent}%` : '…'}</>}
                </span>
              </div>
              {update.state === 'ready' && (
                <button onClick={() => void api.installUpdate?.()}
                  className="text-[11px] font-medium px-2.5 py-1 rounded-md transition-opacity hover:opacity-90"
                  style={{ background: colors.accent, color: '#fff' }}>
                  Restart to update
                </button>
              )}
            </div>
          )}
          {breakMode && Date.now() < breakMode.endsAt && (
            <div
              className="flex-shrink-0 flex items-center justify-between px-5 py-1.5"
              style={{ background: 'rgba(251,191,36,0.05)', borderBottom: '1px solid rgba(251,191,36,0.18)' }}
            >
              <div className="flex items-center gap-2.5">
                <Coffee size={12} style={{ color: '#fbbf24' }} />
                <span
                  className="text-[10px] font-bold uppercase tracking-widest"
                  style={{ color: '#fbbf24', fontFamily: '"Share Tech Mono", monospace', letterSpacing: '0.2em' }}
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
                background: 'rgba(52,211,153,0.04)',
                borderBottom: '1px solid rgba(52,211,153,0.15)',
              }}
            >
              <div className="flex items-center gap-2.5">
                <div
                  className="w-1.5 h-1.5 rounded-full animate-pulse"
                  style={{ background: '#34d399', boxShadow: '0 0 6px #34d399' }}
                />
                <span
                  className="text-[10px] font-bold uppercase tracking-widest"
                  style={{ color: '#34d399', fontFamily: '"Share Tech Mono", monospace', letterSpacing: '0.2em' }}
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
                  style={{ color: '#fbbf24', fontFamily: '"Share Tech Mono", monospace' }}
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
          <div key={view} className={`flex-1 min-h-0 animate-fade-in ${view === 'home' || view === 'logic' || view === 'activity' ? 'overflow-hidden' : 'overflow-y-auto'}`}>
            {renderView()}
          </div>
        </main>

        {chatOpen && (
          <ChatPanel onClose={() => { setChatOpen(false); setChatPreFill('') }} onRefresh={refreshStore} initialMessage={chatPreFill} />
        )}
      </div>

      {/* Sign-in prompt. Dismissible on purpose: signed-out users are meant to be able to
          browse, so this asks rather than walls the app off. */}
      {authPrompt && (
        <>
          <div className="fixed inset-0 z-[70]" style={{ background: 'rgba(0,0,0,0.45)' }} onClick={() => setAuthPrompt(false)} />
          <div className="fixed z-[71] left-1/2 top-1/2" style={{ transform: 'translate(-50%,-50%)', width: 360 }}>
            <div className="rounded-xl overflow-hidden"
              style={{ background: colors.panelBg, border: `1px solid ${colors.borderMid}`, boxShadow: '0 20px 60px rgba(0,0,0,0.55)' }}>
              <div className="flex items-start justify-between px-4 pt-3.5 pb-1">
                <div>
                  <p className="text-[13px] font-semibold" style={{ color: colors.textPrimary }}>Sign in to Attentify</p>
                  <p className="text-[10px] mt-0.5" style={{ color: colors.textMuted }}>
                    Needed to block sites, run focus sessions and use the assistant.
                  </p>
                </div>
                <button onClick={() => setAuthPrompt(false)} className="rounded p-1 hover:bg-white/5" title="Close">
                  <X size={13} style={{ color: colors.textMuted }} />
                </button>
              </div>
              <div className="p-3 pt-2">
                <AuthPanel onChange={refreshAuth} />
              </div>
            </div>
          </div>
        </>
      )}
    </div>
    </PresenceProvider>
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
      runCompatCheck: () => Promise<import('@shared/types').CompatReport>
      reorderAnalyticsCards: (orderedIds: string[]) => Promise<{ ok: boolean }>
      setWindowGlass: (enabled: boolean) => Promise<{ ok: boolean; reason?: string }>
      runCardAction: (cardId: string) => Promise<{ ok: boolean; error?: string; result?: unknown }>
      getCardItems: (cardId: string) => Promise<{ items: { label: string; detail?: string }[] }>
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
      getTimesheet: (days?: number) => Promise<{ rangeDays: number; sessions: import('@shared/types').ActivitySession[] }>
      getCustomCards: () => Promise<import('@shared/types').CustomAnalyticsCard[]>
      deleteCustomCard: (id: string) => Promise<{ ok: boolean }>
      overlayReady?: () => void
      overlayShown?: (id: string) => void
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
      chatStart: (text: string, images?: { media_type: string; data: string }[], conversationId?: string) => void
      getConversations: () => Promise<import('@shared/types').Conversation[]>
      createConversation: (title?: string) => Promise<import('@shared/types').Conversation>
      getConversationMessages: (id: string, limit?: number) => Promise<{ id: string; role: string; content: string; ts: number }[]>
      renameConversation: (id: string, title: string) => Promise<{ ok: boolean }>
      deleteConversation: (id: string) => Promise<{ ok: boolean }>
      buildAnalyticsCard: (description: string) => Promise<{ ok: boolean; error?: string; summary?: string }>
      getPreferences: () => Promise<{ key: string; value: string; scope: string; confidence: number; source: string }[]>
      getUserContext: () => Promise<import('@shared/types').UserContextNote[]>
      addUserContext: (text: string) => Promise<{ ok: boolean; error?: string; note?: import('@shared/types').UserContextNote }>
      deleteUserContext: (id: string) => Promise<{ ok: boolean }>
      getCheckpoints: (conversationId?: string) => Promise<{ id: string; message_id?: string; ts: number; label?: string }[]>
      restoreCheckpoint: (id: string) => Promise<{ ok: boolean; error?: string; label?: string }>
      getAppVersion: () => Promise<string>
      reportBug: (input: { title?: string; description?: string; view?: string; severity?: string }) => Promise<{ ok: boolean; id: string }>
      getIssues: (limit?: number) => Promise<unknown[]>
      onDiagnosticsIncident: (cb: (evt: { id: string; kind: string; title: string }) => void) => (() => void)
      getActivity: (days?: number) => Promise<{
        rangeDays: number
        searches: { ts: number; query: string; url?: string }[]
        visits: { ts: number; url: string; title?: string }[]
        sessions: import('@shared/types').ActivitySession[]
      }>
      getStartupItems: () => Promise<import('@shared/types').StartupItem[]>
      disableStartupItem: (item: import('@shared/types').StartupItem) => Promise<{ ok: boolean; error?: string; needsAdmin?: boolean }>
      onChatChunk: (cb: (chunk: string, conversationId?: string) => void) => (() => void)
      onChatTool: (cb: (toolName: string, conversationId?: string) => void) => (() => void)
      onChatDone: (cb: (event: import('@shared/types').AgentDoneEvent) => void) => (() => void)
      onChatError: (cb: (err: string, conversationId?: string) => void) => (() => void)
      isChatGenerating: (conversationId?: string) => Promise<boolean>
      getAgentHistory: (limit?: number) => Promise<unknown[]>
      clearChatHistory: (conversationId?: string) => Promise<{ ok: boolean }>
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
      getAuth: () => Promise<import('@shared/types').AuthState>
      signUp: (email: string, password: string) => Promise<import('@shared/types').AuthResult>
      signIn: (email: string, password: string) => Promise<import('@shared/types').AuthResult>
      signOut: () => Promise<{ ok: boolean; auth: import('@shared/types').AuthState }>
      getAuthProviders: () => Promise<import('@shared/types').AuthProvider[]>
      signInWithProvider: (provider: import('@shared/types').AuthProvider) => Promise<import('@shared/types').AuthResult>
      getUpdateStatus: () => Promise<import('@shared/types').UpdateStatus>
      checkForUpdate: () => Promise<import('@shared/types').UpdateStatus>
      installUpdate: () => Promise<{ ok: boolean }>
      onUpdateStatus: (cb: (s: import('@shared/types').UpdateStatus) => void) => (() => void)
      openExternal: (url: string) => Promise<{ ok: boolean }>
      minimizeWindow: () => void
      maximizeWindow: () => void
      closeWindow: () => void
    }
  }
}

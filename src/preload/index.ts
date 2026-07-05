import { contextBridge, ipcRenderer } from 'electron'
import type {
  AppStore, ScanResult, FocusSession, ElevationStatus, IntentCheckResult,
  AgentDoneEvent, AgentProactiveEvent, HeuristicAlert, DailyStats, ActivitySession,
  UsageState, CloudState,
} from '../shared/types'

const api = {
  getStore: (): Promise<AppStore> => ipcRenderer.invoke('store:get'),
  setStore: (patch: Partial<AppStore>): Promise<AppStore> => ipcRenderer.invoke('store:set', patch),

  runScan: (): Promise<ScanResult> => ipcRenderer.invoke('scan:run'),

  addDomain: (domain: string, expiresInMs?: number): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke('blocking:add-domain', domain, expiresInMs),
  removeDomain: (domain: string): Promise<void> =>
    ipcRenderer.invoke('blocking:remove-domain', domain),
  addProcess: (name: string, expiresInMs?: number): Promise<void> =>
    ipcRenderer.invoke('blocking:add-process', name, expiresInMs),
  removeProcess: (name: string): Promise<void> =>
    ipcRenderer.invoke('blocking:remove-process', name),
  getElevationCheck: (): Promise<{ elevated: boolean; writable: boolean }> =>
    ipcRenderer.invoke('blocking:elevation-status'),

  startSession: (mode: 'normal' | 'deep', durationMs?: number, allowlist?: string[]): Promise<FocusSession> =>
    ipcRenderer.invoke('session:start', mode, durationMs, allowlist),
  stopSession: (id: string): Promise<void> => ipcRenderer.invoke('session:stop', id),

  // ── Streaming chat (new) ─────────────────────────────────────────────────
  chatStart: (text: string): void => ipcRenderer.send('chat:start', text),
  onChatChunk: (cb: (chunk: string) => void): (() => void) => {
    const handler = (_e: unknown, chunk: string): void => cb(chunk)
    ipcRenderer.on('chat:chunk', handler)
    return () => ipcRenderer.off('chat:chunk', handler)
  },
  onChatTool: (cb: (toolName: string) => void): (() => void) => {
    const handler = (_e: unknown, toolName: string): void => cb(toolName)
    ipcRenderer.on('chat:tool', handler)
    return () => ipcRenderer.off('chat:tool', handler)
  },
  onChatDone: (cb: (event: AgentDoneEvent) => void): (() => void) => {
    const handler = (_e: unknown, evt: AgentDoneEvent): void => cb(evt)
    ipcRenderer.on('chat:done', handler)
    return () => ipcRenderer.off('chat:done', handler)
  },
  onChatError: (cb: (err: string) => void): (() => void) => {
    const handler = (_e: unknown, err: string): void => cb(err)
    ipcRenderer.on('chat:error', handler)
    return () => ipcRenderer.off('chat:error', handler)
  },

  // Legacy (regex engine fallback)
  sendMessage: (text: string): Promise<{ reply: string; actions: unknown[] }> =>
    ipcRenderer.invoke('chat:message', text),

  // ── API Key ──────────────────────────────────────────────────────────────
  getApiKeyStatus: (): Promise<{ hasKey: boolean }> => ipcRenderer.invoke('apikey:get-status'),
  setApiKey: (key: string): Promise<{ ok: boolean }> => ipcRenderer.invoke('apikey:set', key),
  deleteApiKey: (): Promise<{ ok: boolean }> => ipcRenderer.invoke('apikey:delete'),

  // ── Free-usage metering + Cloud subscription ───────────────────────────────
  getUsage: (): Promise<UsageState> => ipcRenderer.invoke('usage:get'),
  onUsageChanged: (cb: (usage: UsageState) => void): (() => void) => {
    const handler = (_e: unknown, usage: UsageState): void => cb(usage)
    ipcRenderer.on('usage:changed', handler)
    return () => ipcRenderer.off('usage:changed', handler)
  },
  getCloud: (): Promise<CloudState> => ipcRenderer.invoke('cloud:get'),
  setCloudLicense: (license: string): Promise<CloudState> => ipcRenderer.invoke('cloud:set-license', license),
  clearCloudLicense: (): Promise<CloudState> => ipcRenderer.invoke('cloud:clear-license'),
  cloudCheckout: (email?: string): Promise<{ url?: string; error?: string }> => ipcRenderer.invoke('cloud:checkout', email),
  openExternal: (url: string): Promise<{ ok: boolean }> => ipcRenderer.invoke('shell:open-external', url),

  // ── Goals ────────────────────────────────────────────────────────────────
  getGoals: () => ipcRenderer.invoke('goals:get'),
  addGoal: (text: string, priority?: number) => ipcRenderer.invoke('goals:add', text, priority),
  clearGoal: (id: string) => ipcRenderer.invoke('goals:clear', id),

  // ── Preferences ──────────────────────────────────────────────────────────
  getPreferences: (query?: string) => ipcRenderer.invoke('preferences:get', query),
  setPreference: (key: string, value: string, scope?: string) => ipcRenderer.invoke('preferences:set', key, value, scope),
  deletePreference: (key: string) => ipcRenderer.invoke('preferences:delete', key),

  // ── Inferences ────────────────────────────────────────────────────────────
  getInferences: (status?: string) => ipcRenderer.invoke('inferences:get', status),
  resolveInference: (id: string, status: 'confirmed' | 'rejected') => ipcRenderer.invoke('inferences:resolve', id, status),

  // ── Agent history & proactive ─────────────────────────────────────────────
  getAgentHistory: (limit?: number) => ipcRenderer.invoke('agent:get-history', limit),
  clearChatHistory: (): Promise<{ ok: boolean }> => ipcRenderer.invoke('agent:clear-history'),
  dismissProactive: (): Promise<{ ok: boolean }> => ipcRenderer.invoke('agent:dismiss-proactive'),

  onAgentProactive: (cb: (evt: AgentProactiveEvent) => void): (() => void) => {
    const handler = (_e: unknown, evt: AgentProactiveEvent): void => cb(evt)
    ipcRenderer.on('agent:proactive', handler)
    return () => ipcRenderer.off('agent:proactive', handler)
  },

  onStoreRefresh: (cb: () => void): (() => void) => {
    const handler = (): void => cb()
    ipcRenderer.on('store:refresh', handler)
    return () => ipcRenderer.off('store:refresh', handler)
  },

  onInferenceSuggest: (cb: (inf: unknown) => void): (() => void) => {
    const handler = (_e: unknown, inf: unknown): void => cb(inf)
    ipcRenderer.on('inference:suggest', handler)
    return () => ipcRenderer.off('inference:suggest', handler)
  },

  onInferenceAutoBlocked: (cb: (evt: { domain: string; confidence: number }) => void): (() => void) => {
    const handler = (_e: unknown, evt: unknown): void => cb(evt as { domain: string; confidence: number })
    ipcRenderer.on('inference:auto-blocked', handler)
    return () => ipcRenderer.off('inference:auto-blocked', handler)
  },

  checkIntent: (site: string, reason: string): Promise<IntentCheckResult> =>
    ipcRenderer.invoke('intent:check', site, reason),

  getElevationStatus: (): Promise<ElevationStatus> => ipcRenderer.invoke('elevation:status'),
  requestElevation: (): Promise<ElevationStatus> => ipcRenderer.invoke('elevation:request'),
  relaunchAsAdmin: (): Promise<boolean> => ipcRenderer.invoke('elevation:relaunch-admin'),

  getAnalytics: (): Promise<{
    today: DailyStats
    weekly: { focusedTime: number; distractedTime: number; timePerApp: Record<string, number>; sessionCount: number; blockEvents: number }
    heuristicAlerts: HeuristicAlert[]
    recentSessions: ActivitySession[]
    domains: { domain: string; category: string; classification: string; confidence: number; total_ms: number; last_seen: number }[]
  }> => ipcRenderer.invoke('analytics:get'),

  dismissHeuristicAlert: (id: string): Promise<void> => ipcRenderer.invoke('heuristics:dismiss', id),

  exportPdf: (): Promise<{ ok: boolean; canceled?: boolean; filePath?: string; error?: string }> =>
    ipcRenderer.invoke('analytics:export-pdf'),

  getAlwaysOn: (): Promise<{ enabled: boolean; startupRegistered: boolean }> => ipcRenderer.invoke('alwayson:get'),
  setAlwaysOn: (enabled: boolean): Promise<{ ok: boolean; enabled: boolean; startupRegistered: boolean }> => ipcRenderer.invoke('alwayson:set', enabled),

  registerStartupDaemon: (): Promise<boolean> => ipcRenderer.invoke('daemon:register-startup'),
  unregisterStartupDaemon: (): Promise<boolean> => ipcRenderer.invoke('daemon:unregister-startup'),
  getStartupStatus: (): Promise<boolean> => ipcRenderer.invoke('daemon:startup-status'),
  getPlatform: (): Promise<'windows' | 'mac' | 'linux'> => ipcRenderer.invoke('daemon:platform'),

  hideInterstitial: (): Promise<void> => ipcRenderer.invoke('interstitial:hide'),
  proceedAnyway: (): Promise<void> => ipcRenderer.invoke('interstitial:proceed'),

  startBreak: (durationMs: number, reason?: string): Promise<{ ok: boolean; endsAt: number }> =>
    ipcRenderer.invoke('break:start', durationMs, reason),
  endBreak: (): Promise<{ ok: boolean }> => ipcRenderer.invoke('break:end'),
  getBreakStatus: (): Promise<{ endsAt: number; reason?: string } | null> => ipcRenderer.invoke('break:status'),

  onBreakStarted: (cb: (evt: { endsAt: number; reason?: string }) => void): (() => void) => {
    const handler = (_e: unknown, evt: unknown): void => cb(evt as { endsAt: number; reason?: string })
    ipcRenderer.on('break:started', handler)
    return () => ipcRenderer.off('break:started', handler)
  },
  onBreakEnded: (cb: () => void): (() => void) => {
    const handler = (): void => cb()
    ipcRenderer.on('break:ended', handler)
    return () => ipcRenderer.off('break:ended', handler)
  },

  // ── Overlay notification system ───────────────────────────────────────────
  onOverlayShow: (cb: (notif: unknown) => void): (() => void) => {
    const handler = (_e: unknown, notif: unknown): void => cb(notif)
    ipcRenderer.on('overlay:show', handler)
    return () => ipcRenderer.off('overlay:show', handler)
  },
  onOverlayUpdate: (cb: (update: { id: string; aiMessage: string }) => void): (() => void) => {
    const handler = (_e: unknown, update: unknown): void => cb(update as { id: string; aiMessage: string })
    ipcRenderer.on('overlay:update', handler)
    return () => ipcRenderer.off('overlay:update', handler)
  },
  overlayAction: (id: string, action: unknown): void =>
    ipcRenderer.send('overlay:action', id, action),
  overlayDismiss: (id: string): void =>
    ipcRenderer.send('overlay:dismiss', id),
  onOverlayOpenChat: (cb: (msg: string) => void): (() => void) => {
    const handler = (_e: unknown, msg: string): void => cb(msg)
    ipcRenderer.on('overlay:open-chat', handler)
    return () => ipcRenderer.off('overlay:open-chat', handler)
  },
  onOverlayNavigate: (cb: (view: string) => void): (() => void) => {
    const handler = (_e: unknown, view: string): void => cb(view)
    ipcRenderer.on('overlay:navigate', handler)
    return () => ipcRenderer.off('overlay:navigate', handler)
  },

  onInterstitialData: (cb: (data: { blocked: string; type: string; endsAt?: number }) => void) => {
    ipcRenderer.on('interstitial:data', (_e, data) => cb(data))
  },
  onHeuristicAlert: (cb: (alerts: HeuristicAlert[]) => void) => {
    ipcRenderer.on('heuristic:alert', (_e, alerts) => cb(alerts))
  },

  onGuardAlert: (cb: (alert: { url: string; domain: string; title: string; category: string; message: string; searchQuery?: string; timestamp: number }) => void): (() => void) => {
    const handler = (_e: unknown, alert: unknown): void => cb(alert as Parameters<typeof cb>[0])
    ipcRenderer.on('guard:alert', handler)
    return () => ipcRenderer.off('guard:alert', handler)
  },

  minimizeWindow: (): void => ipcRenderer.send('window:minimize'),
  maximizeWindow: (): void => ipcRenderer.send('window:maximize'),
  closeWindow: (): void => ipcRenderer.send('window:close'),

  onNavigate: (cb: (view: string) => void): (() => void) => {
    const handler = (_e: unknown, view: string): void => cb(view)
    ipcRenderer.on('navigate', handler)
    return () => ipcRenderer.off('navigate', handler)
  },
}

contextBridge.exposeInMainWorld('electronAPI', api)
export type ElectronAPI = typeof api

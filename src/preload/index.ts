import { contextBridge, ipcRenderer } from 'electron'
import type { AppStore, ScanResult, FocusSession, ElevationStatus, IntentCheckResult } from '../shared/types'

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

  sendMessage: (text: string): Promise<{ reply: string; actions: unknown[] }> =>
    ipcRenderer.invoke('chat:message', text),

  checkIntent: (site: string, reason: string): Promise<IntentCheckResult> =>
    ipcRenderer.invoke('intent:check', site, reason),

  getElevationStatus: (): Promise<ElevationStatus> => ipcRenderer.invoke('elevation:status'),
  requestElevation: (): Promise<ElevationStatus> => ipcRenderer.invoke('elevation:request'),
  relaunchAsAdmin: (): Promise<boolean> => ipcRenderer.invoke('elevation:relaunch-admin'),

  getAnalytics: (): Promise<{
    today: import('../shared/types').DailyStats
    weekly: { focusedTime: number; distractedTime: number; timePerApp: Record<string, number>; sessionCount: number; blockEvents: number }
    heuristicAlerts: import('../shared/types').HeuristicAlert[]
    recentSessions: import('../shared/types').ActivitySession[]
  }> => ipcRenderer.invoke('analytics:get'),

  dismissHeuristicAlert: (id: string): Promise<void> => ipcRenderer.invoke('heuristics:dismiss', id),

  registerStartupDaemon: (): Promise<boolean> => ipcRenderer.invoke('daemon:register-startup'),
  unregisterStartupDaemon: (): Promise<boolean> => ipcRenderer.invoke('daemon:unregister-startup'),
  getStartupStatus: (): Promise<boolean> => ipcRenderer.invoke('daemon:startup-status'),
  getPlatform: (): Promise<'windows' | 'mac' | 'linux'> => ipcRenderer.invoke('daemon:platform'),

  hideInterstitial: (): Promise<void> => ipcRenderer.invoke('interstitial:hide'),
  proceedAnyway: (): Promise<void> => ipcRenderer.invoke('interstitial:proceed'),

  onInterstitialData: (cb: (data: { blocked: string; type: string; endsAt?: number }) => void) => {
    ipcRenderer.on('interstitial:data', (_e, data) => cb(data))
  },
  onHeuristicAlert: (cb: (alerts: import('../shared/types').HeuristicAlert[]) => void) => {
    ipcRenderer.on('heuristic:alert', (_e, alerts) => cb(alerts))
  },

  minimizeWindow: (): void => ipcRenderer.send('window:minimize'),
  maximizeWindow: (): void => ipcRenderer.send('window:maximize'),
  closeWindow: (): void => ipcRenderer.send('window:close'),
}

contextBridge.exposeInMainWorld('electronAPI', api)
export type ElectronAPI = typeof api

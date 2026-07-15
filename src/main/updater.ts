// Automatic updates.
//
// The app self-updates from a generic feed (latest.yml + installer served by the
// Cloudflare Worker at /updates/, backed by R2). On launch and every few hours it
// checks for a newer build, downloads it in the background, and:
//   • installs it automatically on the next app quit (autoInstallOnAppQuit), and
//   • offers an immediate "Restart to update" once a build is downloaded.
// So an already-installed copy stays current with zero user effort.
//
// electron-updater only operates in a packaged build (app.isPackaged); in dev it is a
// no-op. Windows silently applies an update only when the new installer is code-signed
// with the same identity — so this is fully seamless once Azure signing is wired in.

import { app } from 'electron'
import electronUpdater from 'electron-updater'
import { debugLog } from './debug/logger'

const { autoUpdater } = electronUpdater

export type UpdateState = 'idle' | 'checking' | 'available' | 'downloading' | 'ready' | 'none' | 'error' | 'dev'
export interface UpdateStatus { state: UpdateState; version?: string; percent?: number; message?: string }

type Send = (channel: string, payload: unknown) => void
let send: Send = () => {}
let last: UpdateStatus = { state: 'idle' }

export function setUpdaterSend(fn: Send): void { send = fn }
export function getUpdateStatus(): UpdateStatus { return last }

function emit(status: UpdateStatus): void {
  last = status
  try { send('update:status', status) } catch { /* window gone */ }
}

let started = false
export function initUpdater(): void {
  if (started) return
  started = true
  if (!app.isPackaged) { emit({ state: 'dev' }); debugLog('update:skip-dev', {}); return }

  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true // apply a downloaded update automatically on quit
  autoUpdater.logger = null

  autoUpdater.on('checking-for-update', () => emit({ state: 'checking' }))
  autoUpdater.on('update-available', (info) => { debugLog('update:available', { version: info.version }); emit({ state: 'available', version: info.version }) })
  autoUpdater.on('update-not-available', () => emit({ state: 'none' }))
  autoUpdater.on('download-progress', (p) => emit({ state: 'downloading', percent: Math.round(p.percent) }))
  autoUpdater.on('update-downloaded', (info) => { debugLog('update:downloaded', { version: info.version }); emit({ state: 'ready', version: info.version }) })
  autoUpdater.on('error', (e) => { debugLog('update:error', { error: String(e) }); emit({ state: 'error', message: String((e as Error)?.message ?? e) }) })

  // Check a little after launch (let the app settle), then every 6 hours.
  setTimeout(() => { void checkForUpdates() }, 25_000)
  setInterval(() => { void checkForUpdates() }, 6 * 60 * 60 * 1000)
}

export async function checkForUpdates(): Promise<UpdateStatus> {
  if (!app.isPackaged) return { state: 'dev' }
  try {
    const r = await autoUpdater.checkForUpdates()
    return { state: last.state === 'idle' ? 'none' : last.state, version: r?.updateInfo?.version }
  } catch (e) {
    debugLog('update:check-failed', { error: String(e) })
    const status: UpdateStatus = { state: 'error', message: String((e as Error)?.message ?? e) }
    emit(status)
    return status
  }
}

// Quit and apply the already-downloaded update now.
export function installUpdate(): { ok: boolean } {
  try {
    autoUpdater.quitAndInstall()
    return { ok: true }
  } catch (e) {
    debugLog('update:install-failed', { error: String(e) })
    return { ok: false }
  }
}

import { app, BrowserWindow, shell, Tray, Menu, nativeImage, ipcMain, dialog } from 'electron'
import { join } from 'path'
import { existsSync, renameSync } from 'fs'
import { execSync } from 'child_process'
import { initIpc, setInterstitialWindow, setMainWindow, startTracking, stopTracking, getMonitor, getInferenceEngine, getBlockingEngine, getAgentSvc, getContentRuleEngine } from './ipc'
import { startDebugServer, setDebugMainWindow } from './debug/DebugServer'
import { notificationQueue } from './overlay/NotificationQueue'
import { importBrowserHistory } from './tracking/BrowserHistoryImporter'
import { reportIssue, uploadPending, startDiagnosticsSync } from './diagnostics/report'
import { restoreSession } from './auth'
import { initUpdater, setUpdaterSend } from './updater'
import { getStore, patchStore } from './store'
import { openDatabase, closeDatabase } from './data/db'
import { migrateFromStateJson, purgeOldData, ensureConversations } from './data/repository'
import { sanitizeAssistantText } from '../shared/chatSanitize'

// GPU shader + HTTP disk cache cause "Access is denied" / "Unable to move the cache"
// errors when the process switches between elevated and non-elevated integrity levels,
// because AppData is per-user-per-integrity-level. Fix: point every cache Chromium
// touches to C:\ProgramData\Attentify which is accessible at both levels.
if (process.platform === 'win32') {
  const base = join('C:\\ProgramData', 'Attentify')
  // One-time migration from the pre-rebrand data dir so existing installs keep
  // their state, database, logs and caches after the Attentify rename.
  try {
    const legacy = join('C:\\ProgramData', 'ProductivityDaemon')
    if (existsSync(legacy) && !existsSync(base)) renameSync(legacy, base)
  } catch { /* non-fatal: a fresh dir will be created below */ }
  app.setPath('userData', base)
  app.setPath('cache', join(base, 'Cache'))
  // Tell Chromium's network stack to use the same location for the HTTP disk cache
  app.commandLine.appendSwitch('disk-cache-dir', join(base, 'Cache', 'Network'))
}
// Disable GPU shader disk cache, it's unnecessary for an Electron app and can't
// be easily relocated on Windows before the GPU process spawns.
app.commandLine.appendSwitch('disable-gpu-shader-disk-cache')
app.commandLine.appendSwitch('disable-shader-disk-cache')

// ── Uninstall cleanup ───────────────────────────────────────────────────────────
// Invoked by the NSIS uninstaller (`ExecWait '… --uninstall-cleanup'`) so that removing
// Attentify also REVERSES every machine change it made — hosts entries, firewall rules,
// browser DNS policies and the login startup task — instead of leaving them behind.
// Runs headless (no window, no single-instance lock) and exits fast, with a hard timeout
// so a hung child process can never wedge the uninstaller.
if (process.argv.includes('--uninstall-cleanup')) {
  const finish = (): void => { try { app.quit() } catch { /* ignore */ } ; process.exit(0) }
  const killer = setTimeout(finish, 20_000)
  if (typeof killer.unref === 'function') killer.unref()
  ;(async () => {
    try { const { revertAllChanges } = await import('./safety/systemRestore'); revertAllChanges() }
    catch { /* best-effort — never block the uninstaller */ }
    clearTimeout(killer)
    finish()
  })()
} else {

const RENDERER_URL = process.env['ELECTRON_RENDERER_URL']

// ── Single-instance guard ─────────────────────────────────────────────────────
// Only one Attentify may run at a time. Two instances would race on the SQLite
// file, the hosts-file editor and the debug-server port — corrupting state and
// leaving orphaned blocks. If we can't get the lock, another instance already
// owns it: hand off (it will focus its window via the 'second-instance' event)
// and quit immediately. In dev, ELECTRON_RENDERER_URL is set and hot-reload spawns
// short-lived processes, so we skip the guard there to avoid fighting the reloader.
const gotSingleInstanceLock = RENDERER_URL ? true : app.requestSingleInstanceLock()
if (!gotSingleInstanceLock) {
  app.quit()
  // Nothing else should run in this process.
  process.exit(0)
}

// Never let an unhandled rejection/exception silently kill the background service —
// and capture it as a diagnostics issue so crashes are logged/reported automatically.
process.on('unhandledRejection', (reason) => {
  console.error('[main] unhandledRejection:', reason)
  try { reportIssue({ kind: 'crash', severity: 'high', title: 'Unhandled promise rejection', description: String(reason instanceof Error ? (reason.stack ?? reason.message) : reason).slice(0, 2000) }) } catch { /* ignore */ }
})
process.on('uncaughtException', (err) => {
  console.error('[main] uncaughtException:', err)
  try { reportIssue({ kind: 'crash', severity: 'high', title: `Uncaught exception: ${err.message}`, description: (err.stack ?? String(err)).slice(0, 2000) }) } catch { /* ignore */ }
})

function getIconPath(): string {
  const candidates = [
    join(__dirname, '../../resources/icon.png'),
    join(__dirname, '../../resources/icon.ico'),
    join(process.resourcesPath ?? '', 'icon.png'),
  ]
  return candidates.find(existsSync) ?? ''
}

let mainWin: BrowserWindow | null = null
let interstitialWin: BrowserWindow | null = null
let tray: Tray | null = null

// Domains/processes currently blocked BY the scheduler (so we only lift what we added,
// never the user's own permanent blocks).
const scheduleApplied = { domains: new Set<string>(), processes: new Set<string>() }

function enforceSchedules(): void {
  const engine = getBlockingEngine()
  if (!engine) return
  const store = getStore()
  const schedules = store.schedules ?? []
  const now = new Date()
  const day = now.getDay()
  const hm = now.getHours() * 60 + now.getMinutes()

  const desiredDomains = new Set<string>()
  const desiredProcesses = new Set<string>()
  for (const rule of schedules) {
    if (!rule.active || !rule.days.includes(day)) continue
    const [sh, sm] = rule.startTime.split(':').map(Number)
    const [eh, em] = rule.endTime.split(':').map(Number)
    const start = (sh ?? 0) * 60 + (sm ?? 0)
    const end = (eh ?? 0) * 60 + (em ?? 0)
    // Same-day window, or an overnight window (end earlier than start).
    const inWindow = start <= end ? (hm >= start && hm < end) : (hm >= start || hm < end)
    if (!inWindow) continue
    for (const d of rule.domains) desiredDomains.add(d)
    for (const p of rule.processes) desiredProcesses.add(p)
  }

  // Apply newly-active blocks.
  for (const d of desiredDomains) if (!scheduleApplied.domains.has(d)) { try { engine.addDomain(d) } catch { /* soft mode */ } scheduleApplied.domains.add(d) }
  for (const p of desiredProcesses) if (!scheduleApplied.processes.has(p)) { try { engine.addProcess(p) } catch { /* soft mode */ } scheduleApplied.processes.add(p) }

  // Lift blocks whose window ended, but never touch the user's own blocklist entries.
  const userDomains = new Set(store.blocklist.domains.map((d) => d.domain))
  const userProcesses = new Set(store.blocklist.processes.map((p) => p.name))
  for (const d of [...scheduleApplied.domains]) if (!desiredDomains.has(d)) { if (!userDomains.has(d)) { try { engine.removeDomain(d) } catch { /* ignore */ } } scheduleApplied.domains.delete(d) }
  for (const p of [...scheduleApplied.processes]) if (!desiredProcesses.has(p)) { if (!userProcesses.has(p)) { try { engine.removeProcess(p) } catch { /* ignore */ } } scheduleApplied.processes.delete(p) }
}

// Bring the existing window to the foreground. Used both by the tray and when a
// second launch attempt is handed off to us via the single-instance lock.
function focusMainWindow(): void {
  if (!mainWin) { createMainWindow(); return }
  if (mainWin.isMinimized()) mainWin.restore()
  if (!mainWin.isVisible()) mainWin.show()
  mainWin.focus()
}

function createMainWindow(): void {
  const iconPath = getIconPath()
  // Read before creating: backgroundMaterial is only reliably honoured at construction,
  // and a window created opaque will not become see-through just by being told to later.
  const wantGlass = process.platform === 'win32' && getStore().settings?.fullGlass === true

  mainWin = new BrowserWindow({
    width: 980,
    height: 660,
    minWidth: 860,
    minHeight: 580,
    resizable: true,
    frame: false,
    titleBarStyle: 'hidden',
    // Acrylic composites the real desktop behind the window, but only where nothing
    // paints over it, so the window must not carry an opaque colour. #00000000 needs
    // transparent:true for its alpha to count (see the Electron docs on backgroundColor),
    // and transparent:true cannot be combined with backgroundMaterial. So: opaque colour
    // when off, and let the material own the background when on.
    ...(wantGlass
      ? { backgroundMaterial: 'acrylic' as const, backgroundColor: '#00000000' }
      : { backgroundColor: '#020912' }),
    show: false,
    ...(iconPath ? { icon: iconPath } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.mjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  })

  setMainWindow(mainWin)
  setDebugMainWindow(mainWin)

  if (RENDERER_URL) {
    mainWin.loadURL(RENDERER_URL)
    mainWin.webContents.openDevTools({ mode: 'detach' })
  } else {
    mainWin.loadFile(join(__dirname, '../renderer/index.html'))
  }

  mainWin.once('ready-to-show', () => mainWin?.show())

  mainWin.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  mainWin.on('closed', () => {
    mainWin = null
    setMainWindow(null)  // also null out the ipc.ts reference so sendMain() stops firing
  })

  // ── Auto-capture UI freezes + renderer crashes ──────────────────────────────
  // 'unresponsive' fires when the window's UI hangs; log it and ask the user to report
  // (deduped so one hang isn't logged repeatedly).
  let lastUnresponsive = 0
  mainWin.on('unresponsive', () => {
    const now = Date.now()
    if (now - lastUnresponsive < 30_000) return
    lastUnresponsive = now
    try {
      const issue = reportIssue({ kind: 'freeze', severity: 'high', title: 'App became unresponsive', description: 'The window UI stopped responding.' })
      mainWin?.webContents.send('diagnostics:incident', { id: issue.id, kind: 'freeze', title: 'Attentify froze' })
    } catch { /* ignore */ }
  })
  mainWin.webContents.on('render-process-gone', (_e, details) => {
    try { reportIssue({ kind: 'crash', severity: 'high', title: `Renderer crashed (${details.reason})`, description: `exitCode=${details.exitCode}` }) } catch { /* ignore */ }
  })
}

function createInterstitialWindow(): void {
  interstitialWin = new BrowserWindow({
    width: 460,
    height: 360,
    alwaysOnTop: true,
    frame: false,
    skipTaskbar: true,
    resizable: false,
    center: true,
    show: false,
    // Transparent so the block warning reads as a pane of glass laid over whatever the
    // user was about to open, rather than an opaque dialog that replaces it. The card's
    // own rounded corners could never show against an opaque window colour. Safe here:
    // frameless, non-resizable and centred, which is where Electron's transparent windows
    // are well behaved on Windows.
    transparent: true,
    backgroundColor: '#00000000',
    webPreferences: {
      preload: join(__dirname, '../preload/index.mjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  })

  if (RENDERER_URL) {
    const base = RENDERER_URL.replace(/\/+$/, '')
    interstitialWin.loadURL(`${base}/interstitial.html`)
  } else {
    interstitialWin.loadFile(join(__dirname, '../renderer/interstitial.html'))
  }

  interstitialWin.on('closed', () => {
    interstitialWin = null
    setInterstitialWindow(null)
  })
  setInterstitialWindow(interstitialWin)
}

function createTray(): void {
  try {
    const iconPath = getIconPath()
    const icon = iconPath ? nativeImage.createFromPath(iconPath) : nativeImage.createEmpty()
    tray = new Tray(icon.isEmpty() ? nativeImage.createEmpty() : icon.resize({ width: 16, height: 16 }))
    tray.setToolTip('Attentify — Protecting your attention')
    tray.setContextMenu(Menu.buildFromTemplate([
      { label: 'Open Dashboard', click: () => focusMainWindow() },
      { type: 'separator' },
      { label: 'Quit', click: () => app.quit() },
    ]))
    tray.on('double-click', () => focusMainWindow())
  } catch { /* non-fatal */ }
}

// Window control IPC
ipcMain.on('window:minimize', () => mainWin?.minimize())
ipcMain.on('window:maximize', () => {
  if (mainWin?.isMaximized()) mainWin.unmaximize()
  else mainWin?.maximize()
})
ipcMain.on('window:close', () => mainWin?.hide())

// Relaunch with admin privileges (Windows: UAC prompt; macOS: sudo relaunch)
// Make the WINDOW itself see-through to the desktop.
//
// This is the part CSS cannot do. Translucent panels only ever show the app's own
// background: to see the user's actual desktop through the app, the native window has to
// stop painting an opaque background and let the OS composite behind it.
//
// setBackgroundMaterial('acrylic') is the Windows 11 way (22H2 / build 22621+), and it
// blurs whatever is behind the window. It only shows through where nothing else paints
// over it, so the renderer must ALSO drop to a translucent --root-bg, which is what the
// glass theme does. On Windows 10 this is a no-op and the app simply stays opaque, which
// is why the call reports back rather than failing silently.
ipcMain.handle('window:set-glass', (_e, enabled: boolean) => {
  // Persist first: the material is only reliably applied when the window is created, so
  // the next launch is what guarantees the effect. Applying it live usually works too.
  try {
    const s = getStore()
    patchStore({ settings: { ...s.settings, fullGlass: enabled } })
  } catch { /* non-fatal */ }

  if (process.platform !== 'win32' || !mainWin) return { ok: false, reason: 'unsupported' }

  // Acrylic is Windows 11 22H2+ (build 22621). Below that it silently does nothing, so
  // say so rather than leaving the user toggling a switch that cannot work.
  const build = Number(require('os').release().split('.')[2] ?? 0)
  if (build < 22621) return { ok: false, reason: 'needs-win11-22h2' }

  try {
    mainWin.setBackgroundColor(enabled ? '#00000000' : '#020912')
    mainWin.setBackgroundMaterial(enabled ? 'acrylic' : 'none')
    return { ok: true, applied: true }
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : String(err) }
  }
})

ipcMain.handle('elevation:relaunch-admin', () => {
  // In dev this relaunch is actively harmful, so refuse it.
  //
  // `npm run dev` runs the Electron BINARY (node_modules/electron/dist/electron.exe) and
  // serves the renderer from a dev server via ELECTRON_RENDERER_URL. Start-Process -Verb
  // RunAs spawns a fresh elevated process that does NOT inherit that env var, so the new
  // instance falls back to the renderer built into out/ — i.e. the last build, not the
  // code you are editing. Then app.quit() kills the dev session. The net effect is that
  // clicking "Enable protection" in dev closes your dev environment and opens a stale
  // copy of the app, which is exactly what it looked like.
  //
  // Elevation belongs to the packaged app. In dev, relaunch the dev server from an
  // elevated terminal instead.
  if (!app.isPackaged) {
    dialog.showMessageBox({
      type: 'info',
      title: 'Not available in dev',
      message: 'Relaunching as administrator is disabled in development.',
      detail: 'It would start a fresh Electron process without the dev server, so you would '
        + 'get the last build instead of the code you are editing, and this dev session would quit.\n\n'
        + 'To test blocking with admin rights, close this and run "npm run dev" from a terminal '
        + 'that is already running as administrator.',
      buttons: ['OK'],
    }).catch(() => { /* non-fatal */ })
    return false
  }

  try {
    if (process.platform === 'win32') {
      const exe = process.execPath.replace(/\\/g, '\\\\')
      const args = process.argv.slice(1).map((a) => `\\"${a.replace(/\\/g, '\\\\')}\\"`).join(' ')
      execSync(`powershell -WindowStyle Hidden -Command "Start-Process '${exe}' -ArgumentList '${args}' -Verb RunAs"`, { stdio: 'ignore' })
    } else if (process.platform === 'darwin') {
      execSync(`osascript -e 'do shell script "${process.execPath}" with administrator privileges'`, { stdio: 'ignore' })
    }
  } catch {
    // User cancelled UAC or it failed — don't crash
    return false
  }
  setTimeout(() => app.quit(), 500)
  return true
})

// A second launch (e.g. from the Start menu / search bar) is handed to us here
// instead of starting a new process — surface the existing window rather than
// looking like nothing happened.
app.on('second-instance', () => focusMainWindow())

app.whenReady().then(async () => {
  // Open DB before anything else — IPC handlers need it
  try {
    await openDatabase()
    // One-time migration from state.json on first run
    const store = getStore()
    if (!store.onboardingComplete) {
      // Skip migration if no historical data
    } else {
      migrateFromStateJson({
        activitySessions: store.activitySessions ?? [],
        heuristicAlerts: store.heuristicAlerts ?? [],
        blocklist: store.blocklist,
        sessions: store.sessions,
      })
    }
    // Purge events and messages older than 90 days to keep DB lean
    purgeOldData()
    // Ensure a default conversation exists, adopt legacy messages into it, and scrub
    // any tool-call JSON that leaked into stored assistant text before the sanitizer.
    ensureConversations(sanitizeAssistantText)
  } catch (e) {
    console.error('[main] DB open failed:', e)
  }

  initIpc()
  notificationQueue.init(RENDERER_URL ?? null, join(__dirname, '..'))
  createMainWindow()
  createInterstitialWindow()
  createTray()
  startTracking()

  // Enforce recurring schedules: every minute, apply blocks for any schedule whose
  // window is currently active and lift the ones it applied when the window ends. This
  // is what makes the Scheduler actually do something (it used to just store rules).
  enforceSchedules()
  setInterval(enforceSchedules, 60_000)

  // Bootstrap analytics with the user's real browsing history so there's meaningful
  // data from day one, not just what we observe post-install. Best-effort and
  // non-blocking — reads the current user's own browser profiles (no OS permission
  // needed); silently does nothing if none are found.
  setTimeout(() => {
    try {
      const tracker = getMonitor()?.getTracker()
      if (!tracker) return
      const seeded = tracker.seedSessions(importBrowserHistory(30))
      if (seeded > 0) {
        console.log(`[history] seeded ${seeded} sessions from browser history`)
        // Nudge open views (dashboard / analytics / timesheets) to reload now that
        // historical data is available.
        if (mainWin && !mainWin.isDestroyed()) mainWin.webContents.send('store:refresh')
      }
    } catch (e) {
      console.error('[history] import failed:', e)
    }
  }, 3000)

  // Debug server, always on so agents can probe dev and prod builds
  startDebugServer({
    monitor: getMonitor,
    inference: getInferenceEngine,
    engine: getBlockingEngine,
    agent: getAgentSvc,
    contentRules: getContentRuleEngine,
  })

  // Diagnostics: sync queued issues + token usage to the backend on a slow cadence.
  startDiagnosticsSync()

  // Revalidate any signed-in account session in the background (refreshes tier/expiry).
  void restoreSession()

  // Auto-update: check on launch + periodically, forwarding status to the renderer.
  setUpdaterSend((channel, payload) => { if (mainWin && !mainWin.isDestroyed()) mainWin.webContents.send(channel, payload) })
  initUpdater()

  // Main-process freeze watchdog: schedule a tick every second; if it fires much later
  // than expected, the event loop was blocked (a freeze) — capture it once per episode.
  let watchdogExpected = Date.now() + 1000
  let lastFreezeLog = 0
  setInterval(() => {
    const drift = Date.now() - watchdogExpected
    watchdogExpected = Date.now() + 1000
    if (drift > 2500 && Date.now() - lastFreezeLog > 30_000) {
      lastFreezeLog = Date.now()
      try {
        const issue = reportIssue({ kind: 'freeze', severity: 'medium', title: 'Main process stalled', description: `Event loop blocked for ~${Math.round(drift)}ms.`, context: { driftMs: Math.round(drift) } })
        if (mainWin && !mainWin.isDestroyed()) mainWin.webContents.send('diagnostics:incident', { id: issue.id, kind: 'freeze', title: 'Attentify briefly froze' })
      } catch { /* ignore */ }
    }
  }, 1000)

  app.on('activate', () => focusMainWindow())
})

app.on('window-all-closed', () => {
  // When Always-On is enabled, behave like a background service: keep running in the
  // tray (and keep enforcing blocks) instead of quitting when the window closes.
  if (getStore().settings?.alwaysOn) return
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', () => {
  // Flush any queued diagnostics (usage + issues) to the backend.
  void uploadPending()
  // Stop monitoring subprocesses FIRST so they don't fire events during teardown
  stopTracking()
  patchStore({ sessions: getStore().sessions.map((s) => ({ ...s, active: false })) })
  closeDatabase()
})

} // end of normal-launch branch (see `--uninstall-cleanup` guard above)

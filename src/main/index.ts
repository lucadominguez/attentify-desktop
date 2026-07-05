import { app, BrowserWindow, shell, Tray, Menu, nativeImage, ipcMain } from 'electron'
import { join } from 'path'
import { existsSync, renameSync } from 'fs'
import { execSync } from 'child_process'
import { initIpc, setInterstitialWindow, setMainWindow, startTracking, stopTracking, getMonitor, getInferenceEngine, getBlockingEngine, getAgentSvc, getContentRuleEngine } from './ipc'
import { startDebugServer, setDebugMainWindow } from './debug/DebugServer'
import { notificationQueue } from './overlay/NotificationQueue'
import { getStore, patchStore } from './store'
import { openDatabase, closeDatabase } from './data/db'
import { migrateFromStateJson, purgeOldData } from './data/repository'

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
// Disable GPU shader disk cache — it's unnecessary for an Electron app and can't
// be easily relocated on Windows before the GPU process spawns.
app.commandLine.appendSwitch('disable-gpu-shader-disk-cache')
app.commandLine.appendSwitch('disable-shader-disk-cache')

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

// Never let an unhandled rejection/exception silently kill the background service.
process.on('unhandledRejection', (reason) => {
  console.error('[main] unhandledRejection:', reason)
})
process.on('uncaughtException', (err) => {
  console.error('[main] uncaughtException:', err)
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
  mainWin = new BrowserWindow({
    width: 980,
    height: 660,
    minWidth: 860,
    minHeight: 580,
    resizable: true,
    frame: false,
    titleBarStyle: 'hidden',
    backgroundColor: '#0a1628',
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
    backgroundColor: '#050d18',
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
ipcMain.handle('elevation:relaunch-admin', () => {
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
  } catch (e) {
    console.error('[main] DB open failed:', e)
  }

  initIpc()
  notificationQueue.init(RENDERER_URL ?? null, join(__dirname, '..'))
  createMainWindow()
  createInterstitialWindow()
  createTray()
  startTracking()

  // Debug server — always on so agents can probe dev and prod builds
  startDebugServer({
    monitor: getMonitor,
    inference: getInferenceEngine,
    engine: getBlockingEngine,
    agent: getAgentSvc,
    contentRules: getContentRuleEngine,
  })

  app.on('activate', () => focusMainWindow())
})

app.on('window-all-closed', () => {
  // When Always-On is enabled, behave like a background service: keep running in the
  // tray (and keep enforcing blocks) instead of quitting when the window closes.
  if (getStore().settings?.alwaysOn) return
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', () => {
  // Stop monitoring subprocesses FIRST so they don't fire events during teardown
  stopTracking()
  patchStore({ sessions: getStore().sessions.map((s) => ({ ...s, active: false })) })
  closeDatabase()
})

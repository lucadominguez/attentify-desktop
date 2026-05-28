import { app, BrowserWindow, shell, Tray, Menu, nativeImage, ipcMain } from 'electron'
import { join } from 'path'
import { existsSync } from 'fs'
import { execSync } from 'child_process'
import { initIpc, setInterstitialWindow, setMainWindow, startTracking, stopTracking, getMonitor, getInferenceEngine, getBlockingEngine, getAgentSvc } from './ipc'
import { startDebugServer } from './debug/DebugServer'
import { getStore, patchStore } from './store'
import { openDatabase, closeDatabase } from './data/db'
import { migrateFromStateJson, purgeOldData } from './data/repository'

// GPU shader + HTTP disk cache cause "Access is denied" / "Unable to move the cache"
// errors when the process switches between elevated and non-elevated integrity levels,
// because AppData is per-user-per-integrity-level. Fix: point every cache Chromium
// touches to C:\ProgramData\ProductivityDaemon which is accessible at both levels.
if (process.platform === 'win32') {
  const base = join('C:\\ProgramData', 'ProductivityDaemon')
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

function createMainWindow(): void {
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
    webPreferences: {
      preload: join(__dirname, '../preload/index.mjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  })

  setMainWindow(mainWin)

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
    tray.setToolTip('Productivity Daemon — Protecting your attention')
    tray.setContextMenu(Menu.buildFromTemplate([
      { label: 'Open Dashboard', click: () => mainWin?.show() },
      { type: 'separator' },
      { label: 'Quit', click: () => app.quit() },
    ]))
    tray.on('double-click', () => mainWin?.show())
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
  })

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow()
    else mainWin?.show()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', () => {
  // Stop monitoring subprocesses FIRST so they don't fire events during teardown
  stopTracking()
  patchStore({ sessions: getStore().sessions.map((s) => ({ ...s, active: false })) })
  closeDatabase()
})

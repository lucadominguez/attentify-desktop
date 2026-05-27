import { app, BrowserWindow, shell, Tray, Menu, nativeImage, ipcMain } from 'electron'
import { join } from 'path'
import { existsSync } from 'fs'
import { execSync } from 'child_process'
import { initIpc, setInterstitialWindow, setMainWindow, startTracking } from './ipc'
import { getStore, patchStore } from './store'

// GPU shader disk cache causes "Access is denied" errors when the process runs
// at a different privilege level than the session that originally created the
// cache directory. Disable it so the GPU process never tries to move or create
// those files under AppData.
app.commandLine.appendSwitch('disable-gpu-shader-disk-cache')
app.commandLine.appendSwitch('disable-shader-disk-cache')

// Point user-data to ProgramData on Windows so the same path is usable whether
// the process is elevated or not (AppData is per-user-per-integrity-level).
if (process.platform === 'win32') {
  app.setPath('userData', join('C:\\ProgramData', 'ProductivityDaemon'))
}

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

  mainWin.on('closed', () => { mainWin = null })
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

  interstitialWin.on('closed', () => { interstitialWin = null })
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

app.whenReady().then(() => {
  initIpc()
  createMainWindow()
  createInterstitialWindow()
  createTray()
  startTracking()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow()
    else mainWin?.show()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', () => {
  patchStore({ sessions: getStore().sessions.map((s) => ({ ...s, active: false })) })
})

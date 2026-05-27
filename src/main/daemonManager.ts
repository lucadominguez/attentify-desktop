import { execSync } from 'child_process'
import { writeFileSync, existsSync } from 'fs'
import { platform } from 'process'
import { join } from 'path'
import { homedir } from 'os'

const WIN_TASK_NAME = 'ProductivityDaemon'
const MAC_PLIST_ID = 'com.productivitydaemon.app'
const MAC_PLIST_PATH = join(homedir(), `Library/LaunchAgents/${MAC_PLIST_ID}.plist`)

function ps(cmd: string): void {
  execSync(`powershell -NonInteractive -NoProfile -Command "${cmd}"`, { stdio: 'ignore', timeout: 15000 })
}

// ── Windows Task Scheduler ────────────────────────────────────────────────────
// Registers a logon-triggered task that runs with highest privileges so the app
// launches elevated without a UAC prompt on every subsequent login.

function registerWindowsTask(execPath: string): boolean {
  try {
    const exe = execPath.replace(/'/g, "''")
    // Use schtasks for maximum compatibility across Windows editions
    execSync(
      `schtasks /create /tn "${WIN_TASK_NAME}" /tr "${exe}" /sc onlogon /rl highest /f /it`,
      { stdio: 'ignore', timeout: 15000 }
    )
    return true
  } catch { return false }
}

function unregisterWindowsTask(): boolean {
  try {
    execSync(`schtasks /delete /tn "${WIN_TASK_NAME}" /f`, { stdio: 'ignore', timeout: 5000 })
    return true
  } catch { return false }
}

function isWindowsTaskRegistered(): boolean {
  try {
    const out = execSync(`schtasks /query /tn "${WIN_TASK_NAME}"`, { encoding: 'utf-8', timeout: 5000 })
    return out.includes(WIN_TASK_NAME)
  } catch { return false }
}

// ── macOS LaunchAgent ─────────────────────────────────────────────────────────
// Writes a plist to ~/Library/LaunchAgents so the app starts on login.
// macOS doesn't have a direct equivalent of UAC "run as admin" for GUI apps —
// the app requests authorization via SMJobBless or osascript at runtime.

function registerMacAgent(execPath: string): boolean {
  try {
    const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${MAC_PLIST_ID}</string>
  <key>ProgramArguments</key>
  <array><string>${execPath}</string></array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><false/>
  <key>ProcessType</key><string>Interactive</string>
</dict>
</plist>`
    writeFileSync(MAC_PLIST_PATH, plist, 'utf-8')
    execSync(`launchctl load -w "${MAC_PLIST_PATH}"`, { stdio: 'ignore', timeout: 5000 })
    return true
  } catch { return false }
}

function unregisterMacAgent(): boolean {
  try {
    if (existsSync(MAC_PLIST_PATH)) {
      execSync(`launchctl unload "${MAC_PLIST_PATH}"`, { stdio: 'ignore', timeout: 5000 })
    }
    return true
  } catch { return false }
}

function isMacAgentRegistered(): boolean {
  return existsSync(MAC_PLIST_PATH)
}

// ── Public API ────────────────────────────────────────────────────────────────

export function registerStartupDaemon(execPath: string): boolean {
  if (platform === 'win32') return registerWindowsTask(execPath)
  if (platform === 'darwin') return registerMacAgent(execPath)
  return false
}

export function unregisterStartupDaemon(): boolean {
  if (platform === 'win32') return unregisterWindowsTask()
  if (platform === 'darwin') return unregisterMacAgent()
  return false
}

export function isStartupDaemonRegistered(): boolean {
  if (platform === 'win32') return isWindowsTaskRegistered()
  if (platform === 'darwin') return isMacAgentRegistered()
  return false
}

export function getPlatformLabel(): 'windows' | 'mac' | 'linux' {
  if (platform === 'win32') return 'windows'
  if (platform === 'darwin') return 'mac'
  return 'linux'
}

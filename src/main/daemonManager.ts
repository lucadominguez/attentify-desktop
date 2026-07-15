import { execFile } from 'child_process'
import { promisify } from 'util'
import { writeFileSync, existsSync } from 'fs'
import { platform } from 'process'
import { join } from 'path'
import { homedir } from 'os'
import { recordChange } from './safety/changeJournal'

// ASYNC command execution. Using execFile (not execSync) is critical: execSync BLOCKS the
// entire main-process event loop until the command finishes — schtasks /create with
// highest privileges can take several seconds, which froze the whole app when toggling
// Always-On. Async keeps the UI responsive.
const pexecFile = promisify(execFile)
async function run(cmd: string, args: string[], timeout = 15000): Promise<string> {
  const { stdout } = await pexecFile(cmd, args, { timeout, windowsHide: true })
  return stdout ?? ''
}

const WIN_TASK_NAME = 'Attentify'
const LEGACY_WIN_TASK_NAME = 'ProductivityDaemon' // pre-rebrand; cleaned up on (un)register
const MAC_PLIST_ID = 'com.attentify.app'
const MAC_PLIST_PATH = join(homedir(), `Library/LaunchAgents/${MAC_PLIST_ID}.plist`)

// ── Windows Task Scheduler ────────────────────────────────────────────────────
// Registers a logon-triggered task that runs with highest privileges so the app
// launches elevated without a UAC prompt on every subsequent login.

async function registerWindowsTask(execPath: string): Promise<boolean> {
  try {
    // schtasks for maximum compatibility across Windows editions.
    await run('schtasks', ['/create', '/tn', WIN_TASK_NAME, '/tr', execPath, '/sc', 'onlogon', '/rl', 'highest', '/f', '/it'])
    // Remove the pre-rebrand task so it doesn't launch the old path too.
    try { await run('schtasks', ['/delete', '/tn', LEGACY_WIN_TASK_NAME, '/f'], 5000) } catch { /* none */ }
    return true
  } catch { return false }
}

async function unregisterWindowsTask(): Promise<boolean> {
  try {
    await run('schtasks', ['/delete', '/tn', WIN_TASK_NAME, '/f'], 5000)
    return true
  } catch { return false }
}

async function isWindowsTaskRegistered(): Promise<boolean> {
  try {
    const out = await run('schtasks', ['/query', '/tn', WIN_TASK_NAME], 5000)
    return out.includes(WIN_TASK_NAME)
  } catch { return false }
}

// ── macOS LaunchAgent ─────────────────────────────────────────────────────────
// Writes a plist to ~/Library/LaunchAgents so the app starts on login.
// macOS doesn't have a direct equivalent of UAC "run as admin" for GUI apps —
// the app requests authorization via SMJobBless or osascript at runtime.

async function registerMacAgent(execPath: string): Promise<boolean> {
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
    await run('launchctl', ['load', '-w', MAC_PLIST_PATH], 5000)
    return true
  } catch { return false }
}

async function unregisterMacAgent(): Promise<boolean> {
  try {
    if (existsSync(MAC_PLIST_PATH)) {
      await run('launchctl', ['unload', MAC_PLIST_PATH], 5000)
    }
    return true
  } catch { return false }
}

function isMacAgentRegistered(): boolean {
  return existsSync(MAC_PLIST_PATH)
}

// ── Public API (async — never blocks the event loop) ───────────────────────────

export async function registerStartupDaemon(execPath: string): Promise<boolean> {
  const ok = platform === 'win32' ? await registerWindowsTask(execPath)
    : platform === 'darwin' ? await registerMacAgent(execPath)
    : false
  if (ok) recordChange({ category: 'startup', action: 'apply', detail: 'registered launch-at-login entry' })
  return ok
}

export async function unregisterStartupDaemon(): Promise<boolean> {
  const ok = platform === 'win32' ? await unregisterWindowsTask()
    : platform === 'darwin' ? await unregisterMacAgent()
    : false
  if (ok) recordChange({ category: 'startup', action: 'remove', detail: 'removed launch-at-login entry' })
  return ok
}

export async function isStartupDaemonRegistered(): Promise<boolean> {
  if (platform === 'win32') return isWindowsTaskRegistered()
  if (platform === 'darwin') return isMacAgentRegistered()
  return false
}

export function getPlatformLabel(): 'windows' | 'mac' | 'linux' {
  if (platform === 'win32') return 'windows'
  if (platform === 'darwin') return 'mac'
  return 'linux'
}

import { execSync } from 'child_process'
import { readdirSync, existsSync, mkdirSync, renameSync } from 'fs'
import { join, dirname, basename } from 'path'
import { homedir } from 'os'
import type { StartupItem } from '../../shared/types'

// Lists and disables Windows startup (auto-run) entries, the "advanced" Deep Clean
// option for stopping apps from launching at login. Covers the two HKCU/HKLM "Run"
// registry keys and the user's Startup folder. Disabling a registry entry removes the
// value; disabling a Startup-folder shortcut moves it to a "Disabled" subfolder so it
// can be restored by hand. HKLM entries need admin — reg delete simply fails otherwise.

export type { StartupItem }

const RUN_KEYS: Record<'hkcu' | 'hklm', string> = {
  hkcu: 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run',
  hklm: 'HKLM\\Software\\Microsoft\\Windows\\CurrentVersion\\Run',
}

function startupFolder(): string {
  const roaming = process.env['APPDATA'] || join(homedir(), 'AppData', 'Roaming')
  return join(roaming, 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup')
}

function queryRun(loc: 'hkcu' | 'hklm'): StartupItem[] {
  const out: StartupItem[] = []
  try {
    const raw = execSync(`reg query "${RUN_KEYS[loc]}"`, { encoding: 'utf8', windowsHide: true })
    for (const line of raw.split(/\r?\n/)) {
      const m = line.match(/^\s{4}(.+?)\s{2,}REG_\w+\s{2,}(.*\S)\s*$/)
      if (m && m[1] && m[2]) {
        out.push({ id: `${loc}:${m[1]}`, name: m[1].trim(), command: m[2].trim(), location: loc, needsAdmin: loc === 'hklm' })
      }
    }
  } catch { /* key missing or access denied */ }
  return out
}

export function listStartupItems(): StartupItem[] {
  if (process.platform !== 'win32') return []
  const items = [...queryRun('hkcu'), ...queryRun('hklm')]
  try {
    const folder = startupFolder()
    if (existsSync(folder)) {
      for (const f of readdirSync(folder)) {
        if (f === 'Disabled' || f.toLowerCase() === 'desktop.ini') continue
        items.push({ id: `folder:${f}`, name: f.replace(/\.(lnk|url)$/i, ''), command: f, location: 'folder', path: join(folder, f) })
      }
    }
  } catch { /* ignore */ }
  // De-dupe by id and sort by name.
  const seen = new Set<string>()
  return items.filter((i) => (seen.has(i.id) ? false : (seen.add(i.id), true))).sort((a, b) => a.name.localeCompare(b.name))
}

export function disableStartupItem(item: StartupItem): { ok: boolean; error?: string; needsAdmin?: boolean } {
  if (process.platform !== 'win32') return { ok: false, error: 'Only supported on Windows' }
  try {
    if (item.location === 'hkcu' || item.location === 'hklm') {
      execSync(`reg delete "${RUN_KEYS[item.location]}" /v "${item.name}" /f`, { windowsHide: true, stdio: 'ignore' })
      return { ok: true }
    }
    if (item.location === 'folder' && item.path && existsSync(item.path)) {
      const disabled = join(dirname(item.path), 'Disabled')
      if (!existsSync(disabled)) mkdirSync(disabled, { recursive: true })
      renameSync(item.path, join(disabled, basename(item.path)))
      return { ok: true }
    }
    return { ok: false, error: 'Startup item not found' }
  } catch (e) {
    // HKLM delete without elevation lands here.
    if (item.location === 'hklm') return { ok: false, error: 'This one needs administrator rights.', needsAdmin: true }
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

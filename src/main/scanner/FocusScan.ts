import { execSync } from 'child_process'
import { platform } from 'process'
import { existsSync, readdirSync, readFileSync } from 'fs'
import { join } from 'path'
import type { ScanIssue, ScanResult } from '../../shared/types'

const KNOWN_DISTRACTORS: Record<string, string> = {
  discord: 'Social / gaming chat',
  slack: 'Team messaging (can distract)',
  telegram: 'Messaging',
  whatsapp: 'Messaging',
  steam: 'Gaming platform',
  epicgameslauncher: 'Gaming launcher',
  spotify: 'Music (background distraction)',
  twitch: 'Game streaming',
  twitterweb: 'Social media',
  instagramweb: 'Social media',
  reddit: 'Social media',
}

const DISTRACTING_DOMAINS = [
  'twitter.com', 'x.com', 'instagram.com', 'tiktok.com', 'reddit.com',
  'facebook.com', 'youtube.com', 'twitch.tv', 'netflix.com', 'hulu.com',
  'discord.com', 'snapchat.com', 'pinterest.com', '9gag.com', 'buzzfeed.com',
]

function runSilent(cmd: string): string {
  try {
    return execSync(cmd, { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'], timeout: 8000 })
  } catch {
    return ''
  }
}

function getInstalledAppsWin(): string[] {
  const found: string[] = []
  const dirs = [
    process.env['PROGRAMFILES'] ?? 'C:\\Program Files',
    process.env['PROGRAMFILES(X86)'] ?? 'C:\\Program Files (x86)',
    join(process.env['LOCALAPPDATA'] ?? '', 'Programs'),
    join(process.env['APPDATA'] ?? '', 'Microsoft\\Windows\\Start Menu\\Programs'),
  ]
  for (const dir of dirs) {
    if (!existsSync(dir)) continue
    try {
      const entries = readdirSync(dir, { withFileTypes: true })
      for (const e of entries) {
        const name = e.name.toLowerCase().replace(/\.exe$/, '').replace(/\s+/g, '')
        if (KNOWN_DISTRACTORS[name]) found.push(e.name)
      }
    } catch { /* skip */ }
  }
  // Also check via wmic / winget
  const wmic = runSilent('wmic product get name /format:csv')
  for (const line of wmic.split('\n')) {
    const lower = line.toLowerCase()
    for (const [key] of Object.entries(KNOWN_DISTRACTORS)) {
      if (lower.includes(key) && !found.includes(key)) found.push(key)
    }
  }
  return [...new Set(found)]
}

function getInstalledAppsMac(): string[] {
  const found: string[] = []
  const appDir = '/Applications'
  if (existsSync(appDir)) {
    for (const dir of readdirSync(appDir)) {
      const lower = dir.toLowerCase().replace(/\.app$/, '').replace(/\s+/g, '')
      if (KNOWN_DISTRACTORS[lower]) found.push(dir)
    }
  }
  return found
}

function getRunningDistractorsWin(): string[] {
  const out = runSilent('tasklist /FO CSV /NH')
  const found: string[] = []
  for (const line of out.split('\n')) {
    const name = line.replace(/"/g, '').split(',')[0]?.toLowerCase().replace(/\.exe$/, '') ?? ''
    if (KNOWN_DISTRACTORS[name]) found.push(name)
  }
  return [...new Set(found)]
}

function getRunningDistractorsMac(): string[] {
  const out = runSilent('ps -eo comm')
  const found: string[] = []
  for (const line of out.split('\n').slice(1)) {
    const name = line.trim().toLowerCase()
    if (KNOWN_DISTRACTORS[name]) found.push(name)
  }
  return [...new Set(found)]
}

function getStartupAppsWin(): string[] {
  const found: string[] = []
  const keys = [
    'HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Run',
    'HKCU\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Run',
    'HKLM\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Run',
  ]
  for (const key of keys) {
    const out = runSilent(`reg query "${key}"`)
    for (const [name] of Object.entries(KNOWN_DISTRACTORS)) {
      if (out.toLowerCase().includes(name)) found.push(name)
    }
  }
  // Also check Task Scheduler
  const tasks = runSilent('schtasks /query /fo csv /nh')
  for (const [name] of Object.entries(KNOWN_DISTRACTORS)) {
    if (tasks.toLowerCase().includes(name)) found.push(name + ' (scheduled)')
  }
  return [...new Set(found)]
}

function getStartupAppsMac(): string[] {
  const found: string[] = []
  const dirs = [
    `${process.env['HOME']}/Library/LaunchAgents`,
    '/Library/LaunchAgents',
    '/Library/LaunchDaemons',
  ]
  for (const dir of dirs) {
    if (!existsSync(dir)) continue
    for (const file of readdirSync(dir)) {
      const lower = file.toLowerCase()
      for (const [name] of Object.entries(KNOWN_DISTRACTORS)) {
        if (lower.includes(name)) found.push(name + ' (login item)')
      }
    }
  }
  return [...new Set(found)]
}

function getChromeExtensionsWin(): number {
  const extDir = join(process.env['LOCALAPPDATA'] ?? '', 'Google\\Chrome\\User Data\\Default\\Extensions')
  if (!existsSync(extDir)) return 0
  try { return readdirSync(extDir).length } catch { return 0 }
}

function getChromeExtensionsMac(): number {
  const extDir = join(process.env['HOME'] ?? '', 'Library/Application Support/Google/Chrome/Default/Extensions')
  if (!existsSync(extDir)) return 0
  try { return readdirSync(extDir).length } catch { return 0 }
}

function getRecentBrowserHistoryMac(): string[] {
  const found: string[] = []
  const histories = [
    join(process.env['HOME'] ?? '', 'Library/Application Support/Google/Chrome/Default/History'),
    join(process.env['HOME'] ?? '', 'Library/Application Support/BraveSoftware/Brave-Browser/Default/History'),
  ]
  for (const histPath of histories) {
    if (!existsSync(histPath)) continue
    const tmpPath = `/tmp/pd_hist_${Date.now()}`
    try {
      execSync(`cp "${histPath}" "${tmpPath}"`, { timeout: 3000 })
      const out = runSilent(
        `sqlite3 "${tmpPath}" "SELECT DISTINCT url FROM urls WHERE last_visit_time > (strftime('%s','now','-1 day')-11644473600)*1000000 ORDER BY last_visit_time DESC LIMIT 200;"`
      )
      for (const url of out.split('\n')) {
        for (const domain of DISTRACTING_DOMAINS) {
          if (url.includes(domain) && !found.includes(domain)) found.push(domain)
        }
      }
      runSilent(`rm -f "${tmpPath}"`)
    } catch { /* skip */ }
  }
  return found
}

function getRecentBrowserHistoryWin(): string[] {
  // On Windows, check if sqlite3 is available
  const sqlite3Available = runSilent('where sqlite3').trim().length > 0
  const found: string[] = []
  if (!sqlite3Available) return found

  const profiles = [
    join(process.env['LOCALAPPDATA'] ?? '', 'Google\\Chrome\\User Data\\Default\\History'),
    join(process.env['LOCALAPPDATA'] ?? '', 'Microsoft\\Edge\\User Data\\Default\\History'),
  ]
  for (const histPath of profiles) {
    if (!existsSync(histPath)) continue
    const tmpPath = join(process.env['TEMP'] ?? 'C:\\Temp', `pd_hist_${Date.now()}.db`)
    try {
      execSync(`copy "${histPath}" "${tmpPath}" /Y`, { timeout: 3000, shell: true })
      const out = runSilent(
        `sqlite3 "${tmpPath}" "SELECT DISTINCT url FROM urls ORDER BY last_visit_time DESC LIMIT 200;"`
      )
      for (const url of out.split('\n')) {
        for (const domain of DISTRACTING_DOMAINS) {
          if (url.includes(domain) && !found.includes(domain)) found.push(domain)
        }
      }
      runSilent(`del /F /Q "${tmpPath}"`)
    } catch { /* skip */ }
  }
  return found
}

export async function runFocusScan(): Promise<ScanResult> {
  const issues: ScanIssue[] = []
  const runAt = Date.now()
  const isWin = platform === 'win32'

  const installedDistractors = isWin ? getInstalledAppsWin() : getInstalledAppsMac()
  const runningDistractors = isWin ? getRunningDistractorsWin() : getRunningDistractorsMac()
  const startupDistractors = isWin ? getStartupAppsWin() : getStartupAppsMac()
  const extensionCount = isWin ? getChromeExtensionsWin() : getChromeExtensionsMac()
  const recentDistractingSites = isWin ? getRecentBrowserHistoryWin() : getRecentBrowserHistoryMac()

  // Running distractor apps
  if (runningDistractors.length > 0) {
    issues.push({
      id: 'running-distractors',
      category: 'apps',
      severity: 'high',
      title: `${runningDistractors.slice(0, 2).join(', ')} running right now`,
      description: `These apps are competing for your attention this second. Process Guard will kill them during focus sessions.`,
      affectedItem: runningDistractors[0],
      fixAction: 'add-process-block',
    })
  }

  // Installed distractor apps
  const notRunning = installedDistractors.filter((a) => !runningDistractors.includes(a))
  if (notRunning.length > 0) {
    issues.push({
      id: 'installed-distractors',
      category: 'apps',
      severity: 'medium',
      title: `${notRunning.length} distracting apps installed`,
      description: `${notRunning.slice(0, 3).join(', ')}${notRunning.length > 3 ? ` and ${notRunning.length - 3} more` : ''} are installed and can pull your attention at any time.`,
      fixAction: 'add-process-block',
    })
  }

  // Startup distractors
  if (startupDistractors.length > 0) {
    issues.push({
      id: 'startup-distractors',
      category: 'apps',
      severity: 'high',
      title: `${startupDistractors.length} distracting apps auto-start`,
      description: `${startupDistractors.join(', ')} — these start automatically, embedding themselves in your session before you've made any conscious choice to open them.`,
      affectedItem: startupDistractors[0],
      fixAction: 'add-process-block',
    })
  }

  // Recent browser history hits
  if (recentDistractingSites.length > 0) {
    issues.push({
      id: 'recent-history',
      category: 'feeds',
      severity: 'high',
      title: `Visited ${recentDistractingSites.length} distracting sites today`,
      description: `Recent visits: ${recentDistractingSites.slice(0, 4).join(', ')}. Site Guard intercepts these before you load them.`,
      affectedItem: recentDistractingSites[0],
      fixAction: 'add-domain-block',
    })
  } else {
    // Always flag algorithmic feeds even without history access
    issues.push({
      id: 'feed-guard',
      category: 'feeds',
      severity: 'high',
      title: 'Algorithmic feeds not filtered',
      description: 'YouTube, Instagram, and X serve engineered recommendation feeds. Feed Guard hides them during focus sessions.',
      fixAction: 'enable-feed-guard',
    })
  }

  // Browser extensions (potential privacy/distraction risk)
  if (extensionCount > 10) {
    issues.push({
      id: 'extensions',
      category: 'notifications',
      severity: 'low',
      title: `${extensionCount} browser extensions detected`,
      description: 'Extensions can inject notifications, badge counts, and UI elements that trigger distraction. Audit regularly.',
      fixAction: 'review-extensions',
    })
  }

  // Notifications
  issues.push({
    id: 'notification-filter',
    category: 'notifications',
    severity: 'medium',
    title: 'Desktop notifications not filtered during sessions',
    description: 'Notification Guard can suppress all non-critical OS notifications during focus sessions.',
    fixAction: 'enable-notification-filter',
  })

  return {
    runAt,
    issueCount: issues.length,
    issues,
    installedDistractors,
    runningDistractors,
    startupDistractors,
    browserExtensionsFound: extensionCount,
    recentDistractingSites,
  }
}

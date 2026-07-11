import { spawn, ChildProcess } from 'child_process'
import { platform } from 'process'
import { EventEmitter } from 'events'
import { randomUUID } from 'crypto'
import type { ActivitySession, AppCategory } from '../../shared/types'

// Top desktop browsers (process/executable names, lowercased, no .exe). Covers the
// 15 most-used plus common forks so foreground-window tracking works everywhere —
// independent of the browser extension. See COMPATIBILITY.md for the tracked list.
const BROWSER_PROCESSES = new Set([
  'chrome', 'msedge', 'firefox', 'brave', 'opera', 'operagx', 'vivaldi', 'safari',
  'arc', 'tor', 'torbrowser', 'chromium', 'yandex', 'duckduckgo', 'maxthon',
  'ucbrowser', 'palemoon', 'waterfox', 'librewolf', 'floorp', 'thorium', 'whale',
  'epic', 'iron', 'slimjet', 'min', 'falkon', 'midori', 'basilisk', 'seamonkey',
])
const SOCIAL_PROCESSES = new Set(['discord', 'slack', 'telegram', 'whatsapp', 'messenger', 'signal', 'teams', 'skype', 'zoom', 'element', 'revolt'])
const ENTERTAINMENT = new Set(['spotify', 'netflix', 'vlc', 'mpv', 'obs64', 'obs', 'mpc-hc64', 'mpc-hc', 'potplayer64', 'potplayer', 'foobar2000', 'winamp', 'itunes', 'amazonmusic'])
const GAMING = new Set(['steam', 'epicgameslauncher', 'origin', 'battlenet', 'gog galaxy', 'playnite', 'heroiclauncher', 'leagueclient', 'riotclient', 'minecraft', 'javaw', 'overwatch', 'diablo'])
const DEV_PROCESSES = new Set(['code', 'devenv', 'cursor', 'phpstorm', 'idea64', 'pycharm64', 'rider64', 'webstorm64', 'rider', 'vim', 'nvim', 'emacs', 'terminal', 'windowsterminal', 'iterm2', 'alacritty', 'wezterm', 'sublime_text', 'notepad++', 'zed', 'fleet', 'rubymine64', 'clion64', 'datagrip64', 'goland64'])
const DISTRACTION_DOMAINS = new Set([
  // Social media
  'twitter', 'x.com', 'instagram', 'tiktok', 'reddit', 'facebook', 'snapchat',
  'pinterest', 'tumblr', 'linkedin', 'threads', 'mastodon', 'bluesky', 'weibo',
  // Video
  'youtube', 'twitch', 'netflix', 'hulu', 'disneyplus', 'primevideo', 'hbomax',
  'peacocktv', 'paramountplus', 'crunchyroll', 'funimation', 'vimeo', 'dailymotion',
  'bilibili', 'kick.com', 'trovo', 'rumble', 'odysee',
  // News & tabloids
  'buzzfeed', 'dailymail', 'tmz', 'huffpost', 'vice', 'gawker', 'jezebel',
  'theonion', 'clickhole', 'upworthy', 'boredpanda', 'viralnova', 'distractify',
  // Aggregators & forums
  '9gag', 'imgur', 'ifunny', 'memedroid', '4chan', 'quora', 'yahoo answers',
  'digg', 'stumbleupon', 'flipboard', 'feedly', 'news.ycombinator',
  // Gaming browsers / storefronts
  'twitch.tv', 'chess.com', 'lichess', 'miniclip', 'kongregate', 'addictinggames',
  // Shopping / doom-scrolling retail
  'amazon', 'ebay', 'etsy', 'aliexpress', 'wish.com', 'shein',
])

interface WindowSnapshot {
  process: string
  title: string
  timestamp: number
}

const ENTERTAINMENT_DOMAINS = new Set(['youtube', 'twitch', 'netflix', 'hulu', 'disneyplus', 'primevideo', 'hbomax', 'peacocktv', 'crunchyroll', 'vimeo', 'dailymotion', 'bilibili', 'kick.com', 'rumble', 'odysee', 'spotify'])

function categorize(processName: string, title: string): AppCategory {
  const p = processName.toLowerCase()
  const t = title.toLowerCase()
  if (BROWSER_PROCESSES.has(p)) {
    for (const d of ENTERTAINMENT_DOMAINS) {
      if (t.includes(d)) return 'entertainment'
    }
    for (const d of DISTRACTION_DOMAINS) {
      if (t.includes(d)) return 'social'
    }
    return 'browser'
  }
  if (SOCIAL_PROCESSES.has(p)) return 'communication'
  if (ENTERTAINMENT.has(p)) return 'entertainment'
  if (GAMING.has(p)) return 'gaming'
  if (DEV_PROCESSES.has(p)) return 'development'
  if (['explorer', 'finder', 'nautilus'].includes(p)) return 'system'
  return 'other'
}

function isDistraction(category: AppCategory, processName: string, title: string): boolean {
  if (['social', 'entertainment', 'gaming'].includes(category)) return true
  if (category === 'communication' && !['slack', 'teams', 'zoom'].includes(processName)) return true
  const t = title.toLowerCase()
  for (const d of DISTRACTION_DOMAINS) {
    if (t.includes(d)) return true
  }
  return false
}

export class ActivityTracker extends EventEmitter {
  private trackerProcess: ChildProcess | null = null
  private current: WindowSnapshot | null = null
  private sessions: ActivitySession[] = []
  private active = false
  private buffer = ''

  start(): void {
    if (this.active) return
    this.active = true
    this.spawnTracker()
  }

  stop(): void {
    this.active = false
    this.trackerProcess?.kill()
    this.trackerProcess = null
  }

  getSessions(sinceMs?: number): ActivitySession[] {
    const cutoff = sinceMs ?? 0
    return this.sessions.filter((s) => s.startTime >= cutoff)
  }

  // Merge historical/imported sessions (e.g. from the user's browser history) into the
  // in-memory pool so analytics and timesheets have data from day one. Deduplicates by
  // id, keeps the list time-ordered, and caps total size.
  seedSessions(incoming: ActivitySession[]): number {
    if (incoming.length === 0) return 0
    const existing = new Set(this.sessions.map((s) => s.id))
    const add = incoming.filter((s) => !existing.has(s.id))
    if (add.length === 0) return 0
    this.sessions = [...this.sessions, ...add].sort((a, b) => a.startTime - b.startTime).slice(-8000)
    return add.length
  }

  flushSessions(): ActivitySession[] {
    const all = [...this.sessions]
    this.sessions = this.sessions.slice(-500) // keep recent 500
    return all
  }

  getTimePerApp(sinceMs: number): Record<string, number> {
    const totals: Record<string, number> = {}
    for (const s of this.getSessions(sinceMs)) {
      totals[s.app] = (totals[s.app] ?? 0) + s.duration
    }
    return totals
  }

  getFocusedTime(sinceMs: number): number {
    return this.getSessions(sinceMs)
      .filter((s) => !s.isDistraction)
      .reduce((sum, s) => sum + s.duration, 0)
  }

  getDistractedTime(sinceMs: number): number {
    return this.getSessions(sinceMs)
      .filter((s) => s.isDistraction)
      .reduce((sum, s) => sum + s.duration, 0)
  }

  private spawnTracker(): void {
    if (platform === 'win32') {
      this.spawnWindows()
    } else if (platform === 'darwin') {
      this.spawnMac()
    }
  }

  private spawnWindows(): void {
    // Persistent PowerShell process — compiles the C# type ONCE on startup
    const script = `
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
using System.Text;
using System.Diagnostics;
public class FW {
  [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll", CharSet=CharSet.Auto)] static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  public static string Get() {
    var h = GetForegroundWindow();
    if (h == IntPtr.Zero) return "idle|";
    uint pid;
    GetWindowThreadProcessId(h, out pid);
    try {
      var p = Process.GetProcessById((int)pid);
      var s = new StringBuilder(512);
      GetWindowText(h, s, 512);
      return p.ProcessName + "|" + s.ToString();
    } catch { return "unknown|"; }
  }
}
"@ -ErrorAction SilentlyContinue
while ($true) {
  try { Write-Output ([FW]::Get()) } catch { Write-Output "idle|" }
  Start-Sleep -Seconds 3
}
`.trim()

    this.trackerProcess = spawn(
      'powershell',
      ['-NonInteractive', '-NoProfile', '-WindowStyle', 'Hidden', '-Command', script],
      { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true }
    )
    this.attachOutput()
  }

  private spawnMac(): void {
    const script = `
while true; do
  result=$(osascript 2>/dev/null <<'EOF'
tell application "System Events"
  set fp to first process where it is frontmost
  set fn to name of fp
  set ft to ""
  try
    set ft to name of first window of fp
  end try
  return fn & "|" & ft
end tell
EOF
)
  echo "$result"
  sleep 3
done
`.trim()
    this.trackerProcess = spawn('bash', ['-c', script], { stdio: ['ignore', 'pipe', 'pipe'] })
    this.attachOutput()
  }

  private attachOutput(): void {
    if (!this.trackerProcess) return

    this.trackerProcess.stdout?.on('data', (data: Buffer) => {
      this.buffer += data.toString()
      const lines = this.buffer.split('\n')
      this.buffer = lines.pop() ?? ''

      for (const line of lines) {
        const trimmed = line.trim()
        if (!trimmed || !trimmed.includes('|')) continue
        const idx = trimmed.indexOf('|')
        const processName = trimmed.slice(0, idx).toLowerCase().trim()
        const title = trimmed.slice(idx + 1).trim()
        if (processName && processName !== 'idle') {
          this.onSnapshot({ process: processName, title, timestamp: Date.now() })
        }
      }
    })

    this.trackerProcess.on('exit', () => {
      if (this.active) setTimeout(() => this.spawnTracker(), 2000)
    })
  }

  private onSnapshot(snap: WindowSnapshot): void {
    if (!this.current) {
      this.current = snap
      return
    }

    const changed = this.current.process !== snap.process || this.current.title !== snap.title
    if (!changed) return

    const duration = snap.timestamp - this.current.timestamp
    if (duration >= 3000) {
      const category = categorize(this.current.process, this.current.title)
      const session: ActivitySession = {
        id: randomUUID(),
        app: this.current.process,
        title: this.current.title,
        category,
        startTime: this.current.timestamp,
        endTime: snap.timestamp,
        duration,
        isDistraction: isDistraction(category, this.current.process, this.current.title),
      }
      this.sessions.push(session)
      if (this.sessions.length > 5000) this.sessions = this.sessions.slice(-5000)
      this.emit('session', session)
    }

    this.current = snap
  }
}

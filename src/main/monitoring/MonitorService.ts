import { EventEmitter } from 'events'
import { spawn, type ChildProcess } from 'child_process'
import { platform } from 'process'
import { ActivityTracker } from '../tracking/ActivityTracker'
import { HeuristicEngine } from '../heuristics/HeuristicEngine'
import { UrlGuardService, extractSearchQuery } from '../guard/UrlGuardService'
import { InferenceEngine } from '../inference/InferenceEngine'
import { bufferEvent, flushEventBuffer, upsertApp, upsertDomain } from '../data/repository'
import { getStore } from '../store'
import type { ActivitySession } from '../../shared/types'

// ── MonitorService ────────────────────────────────────────────────────────────
// Wraps ActivityTracker + HeuristicEngine, writes all events to DB,
// captures browser URLs via a separate PS subprocess, and re-emits
// typed events for AgentService / InferenceEngine to consume.

export class MonitorService extends EventEmitter {
  private tracker: ActivityTracker
  private heuristics: HeuristicEngine
  private urlGuard: UrlGuardService
  private inference: InferenceEngine | null = null
  private urlProcess: ChildProcess | null = null
  private flushTimer: ReturnType<typeof setInterval> | null = null
  private currentUrl: string | null = null
  private currentTitle: string | null = null
  private active = false
  // Heuristics are advisory, not real-time — throttle them so they run at most
  // once per HEURISTICS_MIN_INTERVAL_MS instead of on every focus change (which
  // can fire several times a minute, each doing a 1h DB query + ~12 array passes).
  private lastHeuristicsRun = 0
  private static readonly HEURISTICS_MIN_INTERVAL_MS = 20_000

  constructor() {
    super()
    this.tracker = new ActivityTracker()
    this.heuristics = new HeuristicEngine()
    this.urlGuard = new UrlGuardService()
    this.urlGuard.setAlertCallback((alert) => this.emit('guard:alert', alert))
  }

  getTracker(): ActivityTracker { return this.tracker }
  getHeuristics(): HeuristicEngine { return this.heuristics }
  getUrlGuard(): UrlGuardService { return this.urlGuard }
  getCurrentUrl(): string | null { return this.currentUrl }

  // Attach the inference engine so MonitorService can call its hot paths
  attachInference(inf: InferenceEngine): void {
    this.inference = inf
  }

  start(): void {
    if (this.active) return
    this.active = true

    // Forward tracker events → DB + our own events
    this.tracker.on('session', (session: ActivitySession) => {
      // Write to event buffer
      bufferEvent({
        ts: session.startTime,
        type: 'focus_change',
        app: session.app,
        title: session.title,
        url: session.url ?? this.currentUrl ?? undefined,
        category: session.category,
        is_distraction: session.isDistraction,
        duration_ms: session.duration,
      })

      // Upsert app registry
      upsertApp(session.app, session.category, session.isDistraction, session.duration)

      // Upsert domain registry if URL captured
      const url = session.url ?? this.currentUrl
      if (url) {
        try {
          const domain = new URL(url.startsWith('http') ? url : `https://${url}`).hostname.replace(/^www\./, '')
          upsertDomain(domain, session.category, session.isDistraction, session.duration)
        } catch { /* ignore invalid URLs */ }
      }
      // Keep current title in sync for URL guard context
      this.currentTitle = session.title

      // Enrich session with currentUrl so downstream (InferenceEngine) can do domain matching
      const enriched: ActivitySession = session.url
        ? session
        : { ...session, url: this.currentUrl ?? undefined }

      this.emit('session', enriched)

      // Run heuristics — throttled. Skipping a run just defers pattern detection by
      // a few seconds; the session is already persisted, so nothing is lost.
      const nowTs = Date.now()
      if (nowTs - this.lastHeuristicsRun >= MonitorService.HEURISTICS_MIN_INTERVAL_MS) {
        this.lastHeuristicsRun = nowTs
        const alerts = this.heuristics.analyze(this.tracker.getSessions(nowTs - 3600000))
        if (alerts.length > 0) {
          this.emit('patterns', alerts)
        }
      }

      // Emit distraction event for proactive agent
      if (enriched.isDistraction && enriched.duration >= 30000) {
        this.emit('distraction', enriched)
      }
    })

    this.tracker.start()

    // Flush event buffer every 4 seconds
    this.flushTimer = setInterval(() => {
      try { flushEventBuffer() } catch { /* noop */ }
    }, 4000)

    // Start URL capture subprocess (best-effort)
    if (platform === 'win32') {
      this.startWindowsUrlCapture()
    }
  }

  stop(): void {
    this.active = false
    this.tracker.stop()
    this.urlProcess?.kill()
    this.urlProcess = null
    if (this.flushTimer) {
      clearInterval(this.flushTimer)
      this.flushTimer = null
    }
    try { flushEventBuffer() } catch { /* noop */ }
  }

  // ── URL capture (Windows, UI Automation via PowerShell) ────────────────────

  private startWindowsUrlCapture(): void {
    // Use UIAutomation to read the browser address bar.
    // Falls back gracefully if UIAutomation fails.
    const script = `
$browsers = @{
  'chrome'   = 'Google Chrome'
  'msedge'   = 'Microsoft Edge'
  'firefox'  = 'Mozilla Firefox'
  'brave'    = 'Brave'
  'vivaldi'  = 'Vivaldi'
}
Add-Type -AssemblyName UIAutomationClient -ErrorAction SilentlyContinue
Add-Type -AssemblyName UIAutomationTypes -ErrorAction SilentlyContinue
function Get-BrowserUrl {
  foreach ($proc in $browsers.Keys) {
    $ps = Get-Process $proc -ErrorAction SilentlyContinue | Where-Object MainWindowHandle -ne 0 | Select-Object -First 1
    if (-not $ps) { continue }
    try {
      $root = [System.Windows.Automation.AutomationElement]::FromHandle($ps.MainWindowHandle)
      $cond = New-Object System.Windows.Automation.PropertyCondition(
        [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
        [System.Windows.Automation.ControlType]::Edit
      )
      $el = $root.FindFirst([System.Windows.Automation.TreeScope]::Subtree, $cond)
      if ($el) {
        $vp = $el.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern)
        $url = $vp.Current.Value
        if ($url -match '^https?://') { return $url }
      }
    } catch {}
  }
  return $null
}
while ($true) {
  try {
    $url = Get-BrowserUrl
    if ($url) { Write-Output "URL:$url" }
  } catch {}
  Start-Sleep -Seconds 3
}
`.trim()

    this.urlProcess = spawn(
      'powershell',
      ['-NonInteractive', '-NoProfile', '-WindowStyle', 'Hidden', '-Command', script],
      { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true }
    )

    let buf = ''
    this.urlProcess.stdout?.on('data', (data: Buffer) => {
      buf += data.toString()
      const lines = buf.split('\n')
      buf = lines.pop() ?? ''
      for (const line of lines) {
        const trimmed = line.trim()
        if (trimmed.startsWith('URL:')) {
          const url = trimmed.slice(4).trim()
          // While the extension is the live sensor, ignore the PowerShell reading — the
          // extension's URL is authoritative and the poller is only a fallback.
          if (this.extensionSensing()) continue
          if (url !== this.currentUrl) this.processUrl(url, this.currentTitle ?? '', 'powershell')
        }
      }
    })

    this.urlProcess.on('exit', () => {
      if (this.active) {
        // Restart after delay
        setTimeout(() => {
          if (this.active) this.startWindowsUrlCapture()
        }, 10000)
      }
    })
  }

  // ── Sensor selection ─────────────────────────────────────────────────────────

  private lastExtensionActivityTs = 0

  // The extension counts as the live sensor if it pushed activity recently. When true, the
  // PowerShell address-bar poller stands down (its reads are dropped) so the two never fight.
  extensionSensing(): boolean {
    return Date.now() - this.lastExtensionActivityTs < 60_000
  }

  // Which sensor is currently authoritative — surfaced to the UI so it can tell the user
  // whether they are on the accurate (extension) path or the fallback.
  activeSensor(): 'extension' | 'fallback' {
    return this.extensionSensing() ? 'extension' : 'fallback'
  }

  // Authoritative navigation event from the browser extension. Same processing as the
  // PowerShell path, but with a real URL + title (and room for page metadata), so it is
  // both more reliable and richer.
  ingestExtensionActivity(url: string, title: string, _meta?: { description?: string; mediaPlaying?: boolean; headings?: string[] }): void {
    this.lastExtensionActivityTs = Date.now()
    if (!this.active) return
    if (title) this.currentTitle = title
    if (url !== this.currentUrl) this.processUrl(url, title || this.currentTitle || '', 'extension')
  }

  // Shared URL handling for BOTH sensors: blocklist → interstitial, event log, the
  // inference hot path, search extraction, and the debounced AI guard.
  private processUrl(url: string, title: string, _source: 'powershell' | 'extension'): void {
    this.currentUrl = url
    this.emit('url', url)

    try {
      const domain = new URL(url.startsWith('http') ? url : `https://${url}`)
        .hostname.replace(/^www\./, '').toLowerCase()
      const store = getStore()
      if (store.blocklist.domains.some((d) => domain === d.domain || domain.endsWith('.' + d.domain))) {
        this.emit('url:blocked', { domain, url })
      }
    } catch { /* ignore invalid URLs */ }

    bufferEvent({ ts: Date.now(), type: 'url_visit', url, title })
    this.inference?.analyzeUrl(url, title)

    const query = extractSearchQuery(url)
    if (query) {
      bufferEvent({ ts: Date.now(), type: 'search_query', url, title: query })
      this.inference?.analyzeSearchQuery(query)
      this.emit('search', query)
    }

    this.urlGuard.onUrlChange(url, title)
  }
}

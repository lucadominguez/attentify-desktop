import { createServer, type IncomingMessage, type ServerResponse } from 'http'
import { writeFileSync } from 'fs'
import { join } from 'path'
import { randomUUID } from 'crypto'
import { getStore, patchStore } from '../store'
import { getInferences, getRecentEvents, getActiveGoals, getAgentMessages } from '../data/repository'
import { getRecentLogs, getLogPath, debugLog } from './logger'
import { runFocusScan } from '../scanner/FocusScan'
import { recordDecision, recordFeedback } from '../feedback/FeedbackService'
import type { MonitorService } from '../monitoring/MonitorService'
import type { InferenceEngine } from '../inference/InferenceEngine'
import type { BlockingEngine } from '../blocking/BlockingEngine'
import type { AgentService } from '../agent/AgentService'
import type { ContentRuleEngine } from '../blocking/ContentRuleEngine'
import type { ActivitySession } from '../../shared/types'

// Injected by index.ts so DebugServer can bring the main window to front
let _mainWinRef: import('electron').BrowserWindow | null = null
export function setDebugMainWindow(win: import('electron').BrowserWindow | null): void { _mainWinRef = win }

export const DEBUG_PORT = 9119
const PORT_FILE = join('C:\\ProgramData', 'Attentify', 'debug-port')
const FALLBACK_PORTS = [9119, 9120, 9121, 9122, 9123]

interface Deps {
  monitor: () => MonitorService | null
  inference: () => InferenceEngine | null
  engine: () => BlockingEngine | null
  agent: () => AgentService | null
  contentRules?: () => ContentRuleEngine | null
}

// ── Route helpers ─────────────────────────────────────────────────────────────

function json(res: ServerResponse, data: unknown, status = 200): void {
  const body = JSON.stringify(data, null, 2)
  res.writeHead(status, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' })
  res.end(body)
}

async function readBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let raw = ''
    req.on('data', (c: Buffer) => { raw += c.toString() })
    req.on('end', () => { try { resolve(JSON.parse(raw || '{}')) } catch { resolve({}) } })
    req.on('error', reject)
  })
}

// ── Main handler ─────────────────────────────────────────────────────────────

async function handle(req: IncomingMessage, res: ServerResponse, deps: Deps): Promise<void> {
  const url = new URL(req.url ?? '/', `http://localhost:${DEBUG_PORT}`)
  const path = url.pathname
  const method = req.method ?? 'GET'

  // CORS pre-flight
  if (method === 'OPTIONS') { res.writeHead(204, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET,POST', 'Access-Control-Allow-Headers': 'Content-Type' }); res.end(); return }

  // ── GET routes ─────────────────────────────────────────────────────────────

  if (method === 'GET') {
    if (path === '/ping') {
      return json(res, { ok: true, pid: process.pid, uptime: Math.round(process.uptime()), port: DEBUG_PORT })
    }

    if (path === '/state') {
      return json(res, getStore())
    }

    if (path === '/blocklist') {
      const { blocklist } = getStore()
      return json(res, blocklist)
    }

    if (path === '/inferences') {
      const status = url.searchParams.get('status') ?? undefined
      return json(res, getInferences(status as Parameters<typeof getInferences>[0]))
    }

    if (path === '/events') {
      const limit = parseInt(url.searchParams.get('limit') ?? '50', 10)
      const since = parseInt(url.searchParams.get('since') ?? '0', 10)
      return json(res, getRecentEvents(since || Date.now() - 2 * 60 * 60 * 1000, limit))
    }

    if (path === '/logs') {
      const n = parseInt(url.searchParams.get('n') ?? '100', 10)
      return json(res, { path: getLogPath(), entries: getRecentLogs(n) })
    }

    if (path === '/monitor') {
      const mon = deps.monitor()
      return json(res, {
        active: mon !== null,
        currentUrl: mon?.getCurrentUrl() ?? null,
        trackerRunning: !!(mon),
      })
    }

    if (path === '/summary') {
      const store = getStore()
      const inferences = getInferences()
      const pending = inferences.filter((i) => i.status === 'pending')
      const autoBlocked = inferences.filter((i) => i.status === 'auto_applied')
      const recentEvents = getRecentEvents(Date.now() - 30 * 60 * 1000, 20)
      const mon = deps.monitor()
      return json(res, {
        appState: {
          elevation: store.elevation,
          blockingMode: store.settings.blockingMode ?? 'auto',
          activeFocusSession: store.sessions.find((s) => s.active) ?? null,
          blockedDomains: store.blocklist.domains.length,
          blockedProcesses: store.blocklist.processes.length,
        },
        monitor: { currentUrl: mon?.getCurrentUrl() ?? null },
        inference: {
          pending: pending.length,
          autoBlocked: autoBlocked.length,
          topPending: pending.slice(0, 5),
        },
        recentActivity: recentEvents.slice(0, 10),
        logs: getRecentLogs(20),
      })
    }

    if (path === '/agent/goals') {
      return json(res, getActiveGoals())
    }

    if (path === '/agent/messages') {
      const limit = parseInt(url.searchParams.get('limit') ?? '20', 10)
      return json(res, getAgentMessages(limit))
    }

    if (path === '/content-rules') {
      const cre = deps.contentRules?.()
      return json(res, {
        rules: cre?.getRules() ?? [],
        extensionConnected: cre?.isExtensionConnected() ?? false,
        bypassScores: cre?.getAllBypassScores() ?? {},
      })
    }

    if (path === '/extension/status') {
      const cre = deps.contentRules?.()
      return json(res, {
        connected: cre?.isExtensionConnected() ?? false,
        rules: cre?.getRules().length ?? 0,
        enabledRules: cre?.getRules().filter((r) => r.enabled).length ?? 0,
        bypassScores: cre?.getAllBypassScores() ?? {},
        recentBypasses: cre?.getBypassAttempts(undefined, 20) ?? [],
      })
    }

    return json(res, { error: 'Not found', routes: ROUTES }, 404)
  }

  // ── POST routes ────────────────────────────────────────────────────────────

  if (method === 'POST') {
    const body = await readBody(req) as Record<string, unknown>

    // Raw AI proxy for the browser extension (URL classifier, etc.). Does a single-shot
    // completion WITHOUT persisting to the chat history or running tools, so the
    // extension's internal prompts never leak into the user's conversation.
    if (path === '/ai/json' || path === '/ai/chat') {
      const svc = deps.agent()
      if (!svc || !svc.isReady()) return json(res, { error: 'no_key' }, 503)
      const system = (body.system as string) ?? ''
      const input = (body.input as string) ?? (body.message as string) ?? ''
      if (!input) return json(res, { error: 'input required' }, 400)
      try {
        const text = await svc.complete(system, input, (body.max_tokens as number) ?? 400)
        return json(res, { text, content: text })
      } catch (e) {
        return json(res, { error: e instanceof Error ? e.message : String(e) }, 500)
      }
    }

    if (path === '/inject/url') {
      const rawUrl = (body.url as string) ?? ''
      const title = (body.title as string) ?? ''
      if (!rawUrl) return json(res, { error: 'url required' }, 400)

      const inf = deps.inference()
      if (!inf) return json(res, { error: 'inference engine not ready' }, 503)

      inf.analyzeUrl(rawUrl, title)

      // Also fire search query analysis if it looks like a search
      if (rawUrl.includes('?') && (rawUrl.includes('q=') || rawUrl.includes('search'))) {
        try {
          const u = new URL(rawUrl)
          const q = u.searchParams.get('q') ?? u.searchParams.get('query') ?? ''
          if (q) inf.analyzeSearchQuery(q)
        } catch { /* ignore */ }
      }

      return json(res, { ok: true, url: rawUrl, message: 'URL injected into inference pipeline, check /inferences for results' })
    }

    if (path === '/inject/search') {
      const query = (body.query as string) ?? ''
      if (!query) return json(res, { error: 'query required' }, 400)
      const inf = deps.inference()
      if (!inf) return json(res, { error: 'inference engine not ready' }, 503)
      inf.analyzeSearchQuery(query)
      return json(res, { ok: true, query, message: 'Search query injected, check /inferences for results' })
    }

    if (path === '/inject/block') {
      const domain = (body.domain as string) ?? ''
      if (!domain) return json(res, { error: 'domain required' }, 400)
      const eng = deps.engine()
      if (!eng) return json(res, { error: 'blocking engine not ready' }, 503)
      const result = eng.addDomain(domain)
      if (result.ok) {
        const s = getStore()
        if (!s.blocklist.domains.find((d) => d.domain === domain)) {
          patchStore({
            blocklist: {
              ...s.blocklist,
              domains: [...s.blocklist.domains, { domain, addedAt: Date.now(), reason: 'debug:inject' }],
            },
          })
        }
        debugLog('debug:block', { domain })
      }
      return json(res, { ok: result.ok, domain, error: (result as { ok: boolean; error?: string }).error })
    }

    if (path === '/inject/unblock') {
      const domain = (body.domain as string) ?? ''
      if (!domain) return json(res, { error: 'domain required' }, 400)
      const eng = deps.engine()
      if (!eng) return json(res, { error: 'blocking engine not ready' }, 503)
      eng.removeDomain(domain)
      const s = getStore()
      patchStore({
        blocklist: {
          ...s.blocklist,
          domains: s.blocklist.domains.filter((d) => d.domain !== domain),
        },
      })
      debugLog('debug:unblock', { domain })
      return json(res, { ok: true, domain })
    }

    if (path === '/inject/sweep') {
      const inf = deps.inference()
      if (!inf) return json(res, { error: 'inference engine not ready' }, 503)
      inf.runBackgroundSweep()
      return json(res, { ok: true, message: 'Background sweep triggered, check /inferences shortly' })
    }

    if (path === '/inject/session') {
      // Inject a fake ActivitySession into the inference + heuristic engines.
      // Repeat N times to simulate a pattern (e.g. compulsive checking).
      const app = (body.app as string) ?? 'chrome'
      const title = (body.title as string) ?? ''
      const durationMs = (body.duration as number) ?? 60_000
      const isDistraction = body.isDistraction !== false
      const count = Math.min(Math.max(1, (body.count as number) ?? 1), 20)
      const inf = deps.inference()
      const mon = deps.monitor()

      const sessions: ActivitySession[] = Array.from({ length: count }, (_, i) => ({
        id: randomUUID(),
        app,
        title,
        url: body.url as string | undefined,
        category: (body.category as ActivitySession['category']) ?? 'browser',
        startTime: Date.now() - (count - i) * (durationMs + 5000),
        endTime: Date.now() - (count - i - 1) * (durationMs + 5000),
        duration: durationMs,
        isDistraction,
      }))

      const results: { inference?: unknown; heuristic?: unknown[] } = {}

      for (const session of sessions) {
        inf?.analyzeSession(session)
      }
      results.inference = { injected: count, message: 'check /inferences for results' }

      if (mon) {
        const heuristics = mon.getHeuristics()
        const alerts = heuristics.analyze(sessions)
        results.heuristic = alerts
      }

      debugLog('debug:inject-session', { app, count, durationMs, isDistraction })
      return json(res, { ok: true, ...results })
    }

    if (path === '/inject/chat') {
      const message = (body.message as string) ?? ''
      if (!message) return json(res, { error: 'message required' }, 400)
      const svc = deps.agent()
      if (!svc) return json(res, { error: 'agent not ready — API key required' }, 503)
      if (!svc.isReady()) return json(res, { error: 'agent not initialized (no API key)' }, 503)

      let fullContent = ''
      const toolsUsed: string[] = []

      await new Promise<void>((resolve, reject) => {
        svc.chat(message, {
          // onChunk emits the FULL sanitized reply-so-far each time (not a delta), so
          // REPLACE — appending produced "TheThe existing…" style duplication downstream.
          onChunk: (c) => { fullContent = c },
          onToolUse: (t) => { toolsUsed.push(t) },
          onDone: () => resolve(),
          onError: (e) => reject(new Error(e)),
        })
      })

      debugLog('debug:chat', { message: message.slice(0, 80), toolsUsed })
      return json(res, { ok: true, content: fullContent, toolsUsed })
    }

    if (path === '/inject/proactive') {
      // Simulate a long distraction session to trigger the proactive agent callback.
      const svc = deps.agent()
      if (!svc) return json(res, { error: 'agent not ready' }, 503)
      const session: ActivitySession = {
        id: randomUUID(),
        app: (body.app as string) ?? 'chrome',
        title: (body.title as string) ?? 'Reddit - Front Page',
        url: body.url as string | undefined,
        category: 'entertainment',
        startTime: Date.now() - 180_000,
        endTime: Date.now(),
        duration: 180_000,
        isDistraction: true,
      }
      svc.notifyDistraction(session)
      debugLog('debug:proactive', { app: session.app })
      return json(res, { ok: true, message: 'Proactive check triggered — open the chat to see if the agent responded' })
    }

    if (path === '/inject/scan') {
      const result = await runFocusScan()
      patchStore({ lastScan: result })
      debugLog('debug:scan', { issueCount: result.issueCount })
      return json(res, result)
    }

    // ── Content rule / extension endpoints ──────────────────────────────────

    if (path === '/content-rules/predefined') {
      const cre = deps.contentRules?.()
      if (!cre) return json(res, { error: 'ContentRuleEngine not ready' }, 503)
      const rules = cre.installPredefined()
      return json(res, { ok: true, count: rules.length })
    }

    const ruleToggleMatch = path.match(/^\/content-rules\/([^/]+)\/toggle$/)
    if (ruleToggleMatch) {
      const id = ruleToggleMatch[1]!
      const enabled = body.enabled !== false
      const cre = deps.contentRules?.()
      if (!cre) return json(res, { error: 'ContentRuleEngine not ready' }, 503)
      const ok = cre.toggleRule(id, enabled)
      return json(res, { ok, id, enabled })
    }

    if (path === '/extension/bypass') {
      const cre = deps.contentRules?.()
      if (!cre) return json(res, { ok: true }) // silently accept even if engine not ready
      const attempt = {
        ruleId: (body.ruleId as string) ?? 'unknown',
        method: (body.method as import('../../shared/types').BypassAttempt['method']) ?? 'url_navigation',
        url: (body.url as string) ?? '',
        timestamp: (body.timestamp as number) ?? Date.now(),
        searchTerm: body.searchTerm as string | undefined,
      }
      const result = cre.handleBypass(attempt)
      debugLog('extension:bypass', { ruleId: attempt.ruleId, method: attempt.method, score: result.score, escalation: result.escalation })
      return json(res, { ok: true, score: result.score, escalation: result.escalation })
    }

    if (path === '/extension/heartbeat') {
      deps.contentRules?.()?.heartbeat()
      return json(res, { ok: true })
    }

    // The extension as the AUTHORITATIVE browser sensor. When installed it reports real
    // navigation events (with the actual URL + title + light page metadata) here, which is
    // far more reliable than scraping the address bar via PowerShell. The monitor prefers
    // this and backs the PowerShell poller off to a fallback while the extension is live.
    if (path === '/extension/activity') {
      const url = body.url as string
      const title = (body.title as string) ?? ''
      if (typeof url === 'string' && /^https?:\/\//.test(url)) {
        deps.contentRules?.()?.heartbeat()
        deps.monitor()?.ingestExtensionActivity(url, title, {
          description: body.description as string | undefined,
          mediaPlaying: body.mediaPlaying as boolean | undefined,
          headings: Array.isArray(body.headings) ? (body.headings as unknown[]).slice(0, 6).map(String) : undefined,
        })
      }
      return json(res, { ok: true })
    }

    // The extension's element auto-hide is a separate subsystem from the daemon's URL/domain
    // classifier, so its mistakes never reached the self-evaluation ledger. When the user hits
    // "not a distraction?" on an auto-hidden element, mirror it into the ledger as a
    // decision + disagreement so calibration, the error-hypothesis engine and the mistake
    // reviewer can all see extension auto-hide errors too. Component-tagged so it's
    // distinguishable from the daemon classifier's own calls.
    if (path === '/extension/feedback') {
      const url = typeof body.url === 'string' ? body.url : ''
      const domain = (typeof body.domain === 'string' && body.domain) ||
        (() => { try { return new URL(url).hostname.replace(/^www\./, '') } catch { return '' } })()
      const verdict = body.verdict as string | undefined
      if (domain && verdict === 'wrong-hide') {
        try {
          const score = Number(body.score)
          recordDecision({
            targetType: 'domain',
            targetValue: domain,
            action: 'auto_block',
            confidence: Number.isFinite(score) ? Math.max(0, Math.min(1, score / 100)) : 0.6,
            category: 'element',
            source: 'extension_autohide',
            component: 'extension_autohide',
            reasoning: typeof body.label === 'string' ? `auto-hid "${body.label}"` : 'auto-hid element',
            url: url || undefined,
            features: {
              label: body.label, selector: body.selector,
              signals: Array.isArray(body.signals) ? body.signals : undefined,
              confidence: body.confidence,
            },
          })
          recordFeedback({ targetType: 'domain', targetValue: domain, signal: 'extension_wrong_hide', note: typeof body.label === 'string' ? body.label : undefined })
          debugLog('extension:wrong-hide', { domain, label: body.label })
        } catch { /* never break the reporting path */ }
      }
      return json(res, { ok: true })
    }

    if (path === '/extension/escalate') {
      const domain = body.domain as string
      const action = body.action as string
      if (domain && (action === 'block_5m' || action === 'block_1h')) {
        const durationMs = action === 'block_5m' ? 5 * 60 * 1000 : 60 * 60 * 1000
        deps.engine()?.addDomain(domain, durationMs)
        debugLog('extension:escalate', { domain, action })
      }
      return json(res, { ok: true })
    }

    if (path === '/extension/check-in') {
      debugLog('extension:check-in', { ruleId: body.ruleId, domain: body.domain, score: body.score })
      return json(res, { ok: true })
    }

    if (path === '/daemon/focus-rules') {
      // Browser extension requests daemon window to open on the Actions/Rules tab
      if (_mainWinRef && !_mainWinRef.isDestroyed()) {
        _mainWinRef.show()
        _mainWinRef.focus()
        _mainWinRef.webContents.send('navigate', 'actions')
      }
      return json(res, { ok: !!_mainWinRef, focused: true })
    }

    if (path === '/inject/break') {
      // Start/end break mode via the debug API
      const action = (body.action as string) ?? 'start'
      const durationMs = (body.durationMs as number) ?? 5 * 60 * 1000
      const store = getStore()
      if (action === 'end') {
        patchStore({ breakMode: undefined })
        return json(res, { ok: true, action: 'ended' })
      }
      const endsAt = Date.now() + durationMs
      patchStore({ breakMode: { endsAt } })
      return json(res, { ok: true, action: 'started', endsAt })
    }

    return json(res, { error: 'Not found' }, 404)
  }

  json(res, { error: 'Method not allowed' }, 405)
}

// ── Available routes (for 404 hint) ──────────────────────────────────────────

const ROUTES = {
  'GET /ping':              'health check',
  'GET /summary':           'full status snapshot (start here)',
  'GET /state':             'raw app store',
  'GET /blocklist':         'current domain + process blocklist',
  'GET /inferences':        'all AI inferences (?status=pending|auto_applied|confirmed|rejected)',
  'GET /events':            'recent activity events (?limit=N&since=epochMs)',
  'GET /logs':              'structured debug log (?n=N)',
  'GET /monitor':           'monitor service state',
  'GET /agent/goals':       'active focus goals',
  'GET /agent/messages':    'agent conversation history (?limit=N)',
  'POST /inject/url':       '{ url, title? }, run URL through inference pipeline',
  'POST /inject/search':    '{ query }, run search query through inference',
  'POST /inject/session':   '{ app, title, url?, duration?, isDistraction?, category?, count? } — inject N activity sessions for heuristic+inference testing',
  'POST /inject/chat':      '{ message } — send message to agent, returns response',
  'POST /inject/proactive': '{ app?, title?, url? } — simulate distraction session to trigger proactive intervention',
  'POST /inject/scan':      'run FocusScan and return results',
  'POST /inject/block':     '{ domain }, add domain to blocklist',
  'POST /inject/unblock':   '{ domain } — remove domain from blocklist',
  'POST /inject/sweep':               'trigger background inference sweep immediately',
  'POST /inject/break':               '{ action:"start"|"end", durationMs? } — control break mode',
  'GET /content-rules':               'all element-blocking rules + bypass scores',
  'GET /extension/status':            'extension connection state + recent bypasses',
  'POST /content-rules/predefined':   'install the 10 predefined rules',
  'POST /content-rules/:id/toggle':   '{ enabled } — enable/disable a rule',
  'POST /extension/bypass':           '{ ruleId, method, url, timestamp? } — record bypass attempt',
  'POST /extension/heartbeat':        'mark extension as connected',
  'POST /extension/feedback':         '{ verdict:"wrong-hide", domain, url, label, score, signals } — log an auto-hide mistake into the self-eval ledger',
  'POST /extension/escalate':         '{ domain, score, action:"block_5m"|"block_1h" } — escalate block',
  'POST /extension/check-in':         '{ ruleId, domain, score } — trigger agent check-in',
}

// ── Start ─────────────────────────────────────────────────────────────────────

export function startDebugServer(deps: Deps): void {
  if (!deps.agent) {
    // backfill for callers that haven't added agent yet
    deps = { ...deps, agent: () => null }
  }
  const server = createServer((req, res) => {
    handle(req, res, deps).catch((e) => {
      try { json(res, { error: String(e) }, 500) } catch { /* already sent */ }
    })
  })

  // Try each port in sequence until one binds. Necessary because hot-reload in dev mode
  // restarts the main process before the OS releases the previous port binding.
  let portIdx = 0

  const tryNext = (): void => {
    if (portIdx >= FALLBACK_PORTS.length) {
      console.warn('[DebugServer] all ports 9119-9123 in use — debug API unavailable')
      return
    }
    const port = FALLBACK_PORTS[portIdx++]!

    server.once('error', (e: NodeJS.ErrnoException) => {
      if (e.code === 'EADDRINUSE') {
        console.warn(`[DebugServer] port ${port} in use, trying ${FALLBACK_PORTS[portIdx] ?? '(none)'}…`)
        tryNext()
      } else {
        console.error('[DebugServer] error:', e.message)
      }
    })

    server.listen(port, '127.0.0.1', () => {
      // Write the actual port to a well-known file so probe.mjs can find it
      try { writeFileSync(PORT_FILE, String(port), 'utf8') } catch { /* non-fatal */ }
      debugLog('debug:server:started', { port, pid: process.pid })
      console.log(`[DebugServer] http://127.0.0.1:${port} — GET /summary to start`)
    })
  }

  tryNext()
}

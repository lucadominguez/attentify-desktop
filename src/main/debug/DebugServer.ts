import { createServer, type IncomingMessage, type ServerResponse } from 'http'
import { getStore, patchStore } from '../store'
import { getInferences, getRecentEvents } from '../data/repository'
import { getRecentLogs, getLogPath, debugLog } from './logger'
import type { MonitorService } from '../monitoring/MonitorService'
import type { InferenceEngine } from '../inference/InferenceEngine'
import type { BlockingEngine } from '../blocking/BlockingEngine'

export const DEBUG_PORT = 9119

interface Deps {
  monitor: () => MonitorService | null
  inference: () => InferenceEngine | null
  engine: () => BlockingEngine | null
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

    return json(res, { error: 'Not found', routes: ROUTES }, 404)
  }

  // ── POST routes ────────────────────────────────────────────────────────────

  if (method === 'POST') {
    const body = await readBody(req) as Record<string, unknown>

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

      return json(res, { ok: true, url: rawUrl, message: 'URL injected into inference pipeline — check /inferences for results' })
    }

    if (path === '/inject/search') {
      const query = (body.query as string) ?? ''
      if (!query) return json(res, { error: 'query required' }, 400)
      const inf = deps.inference()
      if (!inf) return json(res, { error: 'inference engine not ready' }, 503)
      inf.analyzeSearchQuery(query)
      return json(res, { ok: true, query, message: 'Search query injected — check /inferences for results' })
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
      return json(res, { ok: true, message: 'Background sweep triggered — check /inferences shortly' })
    }

    return json(res, { error: 'Not found' }, 404)
  }

  json(res, { error: 'Method not allowed' }, 405)
}

// ── Available routes (for 404 hint) ──────────────────────────────────────────

const ROUTES = {
  'GET /ping':           'health check',
  'GET /summary':        'full status snapshot (start here)',
  'GET /state':          'raw app store',
  'GET /blocklist':      'current domain + process blocklist',
  'GET /inferences':     'all AI inferences (?status=pending|auto_applied|confirmed|rejected)',
  'GET /events':         'recent activity events (?limit=N&since=epochMs)',
  'GET /logs':           'structured debug log (?n=N)',
  'GET /monitor':        'monitor service state',
  'POST /inject/url':    '{ url, title? } — run URL through inference pipeline',
  'POST /inject/search': '{ query } — run search query through inference',
  'POST /inject/block':  '{ domain } — add domain to blocklist',
  'POST /inject/unblock':'{ domain } — remove domain from blocklist',
  'POST /inject/sweep':  'trigger background inference sweep immediately',
}

// ── Start ─────────────────────────────────────────────────────────────────────

export function startDebugServer(deps: Deps): void {
  const server = createServer((req, res) => {
    handle(req, res, deps).catch((e) => {
      try { json(res, { error: String(e) }, 500) } catch { /* already sent */ }
    })
  })

  server.once('error', (e: NodeJS.ErrnoException) => {
    if (e.code === 'EADDRINUSE') {
      console.warn(`[DebugServer] port ${DEBUG_PORT} in use — debug API unavailable`)
    } else {
      console.error('[DebugServer] error:', e.message)
    }
  })

  server.listen(DEBUG_PORT, '127.0.0.1', () => {
    debugLog('debug:server:started', { port: DEBUG_PORT, pid: process.pid })
    console.log(`[DebugServer] http://127.0.0.1:${DEBUG_PORT} — GET /summary to start`)
  })
}

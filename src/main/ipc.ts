import { ipcMain } from 'electron'
import type { BrowserWindow } from 'electron'
import { getStore, patchStore } from './store'
import { BlockingEngine } from './blocking/BlockingEngine'
import { processMessage } from './chat/ChatEngine'
import { runFocusScan } from './scanner/FocusScan'
import { ActivityTracker } from './tracking/ActivityTracker'
import { HeuristicEngine } from './heuristics/HeuristicEngine'
import { checkElevation, verifyHostsWritable } from './blocking/hostsFileEditor'
import { registerStartupDaemon, unregisterStartupDaemon, isStartupDaemonRegistered, getPlatformLabel } from './daemonManager'
import type { FocusSession, ChatMessage, ActivitySession, DailyStats, IntentCheckResult, AppCategory } from '../shared/types'
import { randomUUID } from 'crypto'

let engine: BlockingEngine | null = null
let tracker: ActivityTracker | null = null
let heuristics: HeuristicEngine | null = null
let interstitialWin: BrowserWindow | null = null
let mainWin: BrowserWindow | null = null

export function setInterstitialWindow(win: BrowserWindow): void {
  interstitialWin = win
}

export function setMainWindow(win: BrowserWindow): void {
  mainWin = win
}

export function getTracker(): ActivityTracker | null {
  return tracker
}

// ── Local intent check for unblock requests ──────────────────────────────────

async function checkOllamaAvailable(url: string): Promise<boolean> {
  try {
    const res = await fetch(`${url}/api/tags`, { signal: AbortSignal.timeout(2000) })
    return res.ok
  } catch {
    return false
  }
}

async function evaluateIntentWithOllama(url: string, model: string, site: string, reason: string): Promise<IntentCheckResult> {
  const prompt = `You are a focus protection assistant. A user wants to temporarily unblock "${site}" during a focus session.

Their stated reason: "${reason}"

Evaluate if this is a legitimate, specific work-related need or if it sounds like rationalization/impulse.

ALLOW: Clear, specific work purpose (e.g. "need to check a Twitter thread linked in a design document")
ALLOW_TIMED: Plausible but vague reason — grant 10 minutes maximum
DENY: Vague, impulsive, or not work-related (e.g. "just want to check", "quickly look", "for a sec")

Reply with exactly one word: ALLOW, ALLOW_TIMED, or DENY`

  try {
    const res = await fetch(`${url}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, prompt, stream: false }),
      signal: AbortSignal.timeout(15000),
    })
    const data = await res.json() as { response?: string }
    const verdict = (data.response ?? '').trim().toUpperCase()
    if (verdict.includes('ALLOW_TIMED')) return { verdict: 'allow_timed', reason: 'Plausible but vague — 10 minutes granted', allowedMinutes: 10, ollamaUsed: true }
    if (verdict.includes('ALLOW')) return { verdict: 'allow', reason: 'Purpose verified', ollamaUsed: true }
    return { verdict: 'deny', reason: 'Reason not specific enough for a work task', ollamaUsed: true }
  } catch {
    return evaluateIntentRuleBased(site, reason)
  }
}

function evaluateIntentRuleBased(site: string, reason: string): IntentCheckResult {
  const lower = reason.toLowerCase().trim()
  if (reason.length < 8) return { verdict: 'deny', reason: 'Reason too vague — be specific about what you need.', ollamaUsed: false }

  const impulsive = ['just check', 'quickly', 'for a sec', 'one min', 'real quick', 'just look', 'wanna see', 'just wanna', 'bored', 'take a break']
  for (const kw of impulsive) {
    if (lower.includes(kw)) return { verdict: 'deny', reason: `"${kw}" sounds impulsive, not purposeful. What specifically do you need?`, ollamaUsed: false }
  }

  const workKeywords = ['work', 'project', 'deadline', 'client', 'meeting', 'research', 'article', 'document', 'report', 'presentation', 'bug', 'issue', 'pull request', 'email', 'link', 'reference', 'source', 'data', 'post', 'tweet', 'thread', 'announcement']
  const wordCount = reason.trim().split(/\s+/).length
  const hasWorkKeyword = workKeywords.some((kw) => lower.includes(kw))

  if (hasWorkKeyword && wordCount >= 5) return { verdict: 'allow', reason: 'Looks like a legitimate work need.', ollamaUsed: false }
  if (wordCount >= 8) return { verdict: 'allow_timed', reason: '10 minutes granted. Stay focused.', allowedMinutes: 10, ollamaUsed: false }

  return { verdict: 'deny', reason: 'Be more specific. What exactly do you need from this site for your current task?', ollamaUsed: false }
}

// ── Daily stats builder ───────────────────────────────────────────────────────

function buildDailyStats(sessions: ActivitySession[], blockEvents: number): DailyStats {
  const today = new Date().toISOString().split('T')[0]!
  const focusedTime = sessions.filter((s) => !s.isDistraction).reduce((sum, s) => sum + s.duration, 0)
  const distractedTime = sessions.filter((s) => s.isDistraction).reduce((sum, s) => sum + s.duration, 0)
  const neutralTime = sessions.filter((s) => !s.isDistraction && s.category === 'other').reduce((sum, s) => sum + s.duration, 0)

  const appTotals = new Map<string, { duration: number; category: AppCategory }>()
  for (const s of sessions) {
    const cur = appTotals.get(s.app) ?? { duration: 0, category: s.category }
    cur.duration += s.duration
    appTotals.set(s.app, cur)
  }

  const totalTime = focusedTime + distractedTime
  const focusScore = totalTime > 0
    ? Math.round(Math.min(100, (focusedTime / totalTime) * 100 * 1.2))
    : 50

  return {
    date: today,
    focusedTime,
    distractedTime,
    neutralTime,
    blockEvents,
    focusSessions: getStore().sessions.filter((s) => {
      const d = new Date(s.startedAt).toISOString().split('T')[0]
      return d === today
    }).length,
    appBreakdown: Array.from(appTotals.entries())
      .map(([app, v]) => ({ app, ...v }))
      .sort((a, b) => b.duration - a.duration)
      .slice(0, 20),
    focusScore,
  }
}

// ── IPC initialization ────────────────────────────────────────────────────────

export function initIpc(): void {
  const store = getStore()

  // Auto-detect actual elevation at startup — don't rely on stale stored value
  const actuallyElevated = checkElevation()
  const resolvedElevation: import('../shared/types').ElevationStatus = actuallyElevated ? 'full' : 'soft'
  if (store.elevation !== resolvedElevation) {
    patchStore({ elevation: resolvedElevation })
  }

  engine = new BlockingEngine(resolvedElevation)
  engine.loadState(store.blocklist.domains, store.blocklist.processes)

  // Immediately apply all protection layers if elevated and domains exist
  if (actuallyElevated && store.blocklist.domains.length > 0) {
    engine.protect()
  }

  // Auto-register startup daemon on first elevated run so future launches skip UAC
  if (actuallyElevated && !isStartupDaemonRegistered()) {
    registerStartupDaemon(process.execPath)
  }

  tracker = new ActivityTracker()
  heuristics = new HeuristicEngine()

  engine.on('blocked', (event: { type: string; item: string }) => {
    if (interstitialWin && !interstitialWin.isVisible()) {
      const session = getStore().sessions.find((s) => s.active)
      interstitialWin.webContents.send('interstitial:data', {
        blocked: event.item,
        type: event.type,
        endsAt: session?.endsAt,
      })
      interstitialWin.show()
    }
    patchStore({ blockEventCount: (getStore().blockEventCount ?? 0) + 1 })
  })

  tracker.on('session', (session: ActivitySession) => {
    // Run heuristics on every new session
    const alerts = heuristics!.analyze(tracker!.getSessions(Date.now() - 60 * 60 * 1000))
    if (alerts.length > 0) {
      const s = getStore()
      patchStore({ heuristicAlerts: [...s.heuristicAlerts, ...alerts].slice(-200) })
      // Notify main window
      mainWin?.webContents.send('heuristic:alert', alerts)
    }
  })

  // ── Store ──────────────────────────────────────────────────────────────────

  ipcMain.handle('store:get', () => getStore())

  ipcMain.handle('store:set', (_e, patch) => {
    const updated = patchStore(patch)
    engine?.loadState(updated.blocklist.domains, updated.blocklist.processes)
    return updated
  })

  // ── Scan ──────────────────────────────────────────────────────────────────

  ipcMain.handle('scan:run', async () => {
    const result = await runFocusScan()
    patchStore({ lastScan: result })
    return result
  })

  // ── Blocking ──────────────────────────────────────────────────────────────

  ipcMain.handle('blocking:add-domain', (_e, domain: string, expiresInMs?: number) => {
    const result = engine?.addDomain(domain, expiresInMs) ?? { ok: false, error: 'Engine not initialized' }
    if (result.ok) {
      const s = getStore()
      if (!s.blocklist.domains.find((d) => d.domain === domain)) {
        patchStore({
          blocklist: {
            ...s.blocklist,
            domains: [...s.blocklist.domains, { domain, addedAt: Date.now(), expiresAt: expiresInMs ? Date.now() + expiresInMs : undefined }],
          },
        })
      }
    }
    return result
  })

  ipcMain.handle('blocking:remove-domain', (_e, domain: string) => {
    engine?.removeDomain(domain)
    const s = getStore()
    patchStore({ blocklist: { ...s.blocklist, domains: s.blocklist.domains.filter((d) => d.domain !== domain) } })
  })

  ipcMain.handle('blocking:add-process', (_e, name: string, expiresInMs?: number) => {
    engine?.addProcess(name, expiresInMs)
    const s = getStore()
    patchStore({ blocklist: { ...s.blocklist, processes: [...s.blocklist.processes, { name, addedAt: Date.now(), expiresAt: expiresInMs ? Date.now() + expiresInMs : undefined }] } })
  })

  ipcMain.handle('blocking:remove-process', (_e, name: string) => {
    engine?.removeProcess(name)
    const s = getStore()
    patchStore({ blocklist: { ...s.blocklist, processes: s.blocklist.processes.filter((p) => p.name !== name) } })
  })

  ipcMain.handle('blocking:elevation-status', () => {
    const elevated = checkElevation()
    const writable = elevated ? verifyHostsWritable() : false
    return { elevated, writable }
  })

  // ── Sessions ──────────────────────────────────────────────────────────────

  ipcMain.handle('session:start', (_e, mode: 'normal' | 'deep', durationMs?: number, allowlist?: string[]) => {
    const session: FocusSession = {
      id: randomUUID(),
      startedAt: Date.now(),
      endsAt: durationMs ? Date.now() + durationMs : undefined,
      mode,
      active: true,
      allowlist,
    }
    const s = getStore()
    patchStore({ sessions: [session, ...s.sessions.map((sess) => ({ ...sess, active: false }))] })
    engine?.start()
    return session
  })

  ipcMain.handle('session:stop', (_e, id: string) => {
    const s = getStore()
    patchStore({ sessions: s.sessions.map((sess) => (sess.id === id ? { ...sess, active: false } : sess)) })
    engine?.stop()
  })

  // ── Chat ─────────────────────────────────────────────────────────────────

  ipcMain.handle('chat:message', (_e, text: string) => {
    const store = getStore()
    const trackingData = {
      sessions: tracker?.getSessions(Date.now() - 7 * 24 * 60 * 60 * 1000) ?? [],
      timePerApp: tracker?.getTimePerApp(Date.now() - 7 * 24 * 60 * 60 * 1000) ?? {},
    }
    const response = processMessage(text, store, trackingData)
    const userMsg: ChatMessage = { id: randomUUID(), role: 'user', content: text, timestamp: Date.now() }
    const assistantMsg: ChatMessage = { id: randomUUID(), role: 'assistant', content: response.reply, timestamp: Date.now() + 1 }
    patchStore({ chatHistory: [...store.chatHistory.slice(-100), userMsg, assistantMsg] })

    for (const action of response.actions) {
      if (action.type === 'block' && action.payload.domain) {
        const domain = action.payload.domain as string
        const durationMs = action.payload.durationMs as number | undefined
        engine?.addDomain(domain, durationMs)
        // Persist to store so the block survives restarts and shows in UI
        const s2 = getStore()
        if (!s2.blocklist.domains.find((d) => d.domain === domain)) {
          patchStore({
            blocklist: {
              ...s2.blocklist,
              domains: [...s2.blocklist.domains, {
                domain,
                addedAt: Date.now(),
                expiresAt: durationMs ? Date.now() + durationMs : undefined,
              }],
            },
          })
        }
      } else if (action.type === 'unblock' && action.payload.domain) {
        const domain = action.payload.domain as string
        engine?.removeDomain(domain)
        const s2 = getStore()
        patchStore({
          blocklist: {
            ...s2.blocklist,
            domains: s2.blocklist.domains.filter((d) => d.domain !== domain),
          },
        })
      } else if (action.type === 'start-session') {
        const payload = action.payload as { mode?: 'normal' | 'deep'; durationMs?: number }
        const session: FocusSession = {
          id: randomUUID(),
          startedAt: Date.now(),
          endsAt: payload.durationMs ? Date.now() + payload.durationMs : undefined,
          mode: payload.mode ?? 'normal',
          active: true,
        }
        const s2 = getStore()
        patchStore({ sessions: [session, ...s2.sessions.map((sess) => ({ ...sess, active: false }))] })
        engine?.start()
      } else if (action.type === 'stop-session') {
        const s2 = getStore()
        const active = s2.sessions.find((sess) => sess.active)
        if (active) {
          patchStore({ sessions: s2.sessions.map((sess) => (sess.id === active.id ? { ...sess, active: false } : sess)) })
        }
        engine?.stop()
      }
    }

    return response
  })

  // ── Intent check ──────────────────────────────────────────────────────────

  ipcMain.handle('intent:check', async (_e, site: string, reason: string): Promise<IntentCheckResult> => {
    const store = getStore()
    const { ollamaUrl, ollamaModel } = store.settings
    if (ollamaUrl && await checkOllamaAvailable(ollamaUrl)) {
      return evaluateIntentWithOllama(ollamaUrl, ollamaModel, site, reason)
    }
    return evaluateIntentRuleBased(site, reason)
  })

  // ── Elevation ────────────────────────────────────────────────────────────

  ipcMain.handle('elevation:status', () => getStore().elevation)

  ipcMain.handle('elevation:request', async () => {
    const elevated = checkElevation()
    const status = elevated ? 'full' : 'soft'
    patchStore({ elevation: status })
    engine?.setElevation(status)
    if (status === 'full') engine?.start()
    return status
  })

  // ── Analytics ────────────────────────────────────────────────────────────

  ipcMain.handle('analytics:get', () => {
    const now = Date.now()
    const todaySessions = tracker?.getSessions(new Date().setHours(0, 0, 0, 0)) ?? []
    const weeklySessions = tracker?.getSessions(now - 7 * 24 * 60 * 60 * 1000) ?? []
    const store = getStore()

    return {
      today: buildDailyStats(todaySessions, store.blockEventCount ?? 0),
      weekly: {
        focusedTime: tracker?.getFocusedTime(now - 7 * 24 * 60 * 60 * 1000) ?? 0,
        distractedTime: tracker?.getDistractedTime(now - 7 * 24 * 60 * 60 * 1000) ?? 0,
        timePerApp: tracker?.getTimePerApp(now - 7 * 24 * 60 * 60 * 1000) ?? {},
        sessionCount: weeklySessions.length,
        blockEvents: store.blockEventCount ?? 0,
      },
      heuristicAlerts: heuristics?.getAlerts(now - 7 * 24 * 60 * 60 * 1000) ?? [],
      recentSessions: weeklySessions.slice(-200),
    }
  })

  ipcMain.handle('heuristics:dismiss', (_e, id: string) => {
    heuristics?.dismissAlert(id)
    const s = getStore()
    patchStore({
      heuristicAlerts: s.heuristicAlerts.map((a) => (a.id === id ? { ...a, dismissed: true } : a)),
    })
  })

  // ── Daemon management ─────────────────────────────────────────────────────

  ipcMain.handle('daemon:register-startup', () => registerStartupDaemon(process.execPath))
  ipcMain.handle('daemon:unregister-startup', () => unregisterStartupDaemon())
  ipcMain.handle('daemon:startup-status', () => isStartupDaemonRegistered())
  ipcMain.handle('daemon:platform', () => getPlatformLabel())

  // ── Interstitial ──────────────────────────────────────────────────────────

  ipcMain.handle('interstitial:hide', () => interstitialWin?.hide())
  ipcMain.handle('interstitial:proceed', () => interstitialWin?.hide())
}

export function startTracking(): void {
  const store = getStore()
  if (store.settings?.trackingEnabled !== false) {
    tracker?.start()
  }
}

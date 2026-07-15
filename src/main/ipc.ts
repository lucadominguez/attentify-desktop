import { ipcMain, dialog, shell, app, BrowserWindow as ElectronBrowserWindow } from 'electron'
import type { BrowserWindow } from 'electron'
import { writeFile } from 'fs/promises'
import { getStore, patchStore } from './store'
import { mergeSeeds } from './cards/seeds'
import {
  getEffectiveApiKey, getUsageState, getCloudState, setCloudLicense, clearCloudLicense,
  startCheckout, setUsageChangeCallback,
} from './billing'
import { getAuthState, signup as authSignup, login as authLogin, logout as authLogout, getAuthProviders as authProviders, oauthLogin as authOauthLogin } from './auth'
import { checkForUpdates, installUpdate, getUpdateStatus } from './updater'
import { BlockingEngine } from './blocking/BlockingEngine'
import { processMessage } from './chat/ChatEngine'
import { runFocusScan } from './scanner/FocusScan'
import { listStartupItems, disableStartupItem } from './scanner/StartupManager'
import { reportIssue } from './diagnostics/report'
import { listIssues } from './data/repository'
import { checkElevation, verifyHostsWritable } from './blocking/hostsFileEditor'
import { registerStartupDaemon, unregisterStartupDaemon, isStartupDaemonRegistered, getPlatformLabel } from './daemonManager'
import { revertAllChanges } from './safety/systemRestore'
import { readChanges, changeCount } from './safety/changeJournal'
import { saveApiKey, deleteApiKey, hasApiKey } from './keystore'
import { MonitorService } from './monitoring/MonitorService'
import { AgentService } from './agent/AgentService'
import { InferenceEngine } from './inference/InferenceEngine'
import { debugLog } from './debug/logger'
import { notificationQueue } from './overlay/NotificationQueue'
import { ContentRuleEngine } from './blocking/ContentRuleEngine'
import { recordCloudEvent, startCloudSync, stopCloudSync } from './cloudSync'
import { randomUUID } from 'crypto'
import {
  getActiveGoals, insertGoal, clearGoal,
  getPreferences, upsertPreference, deletePreference,
  getInferences, resolveInference,
  getAgentMessages, insertAgentMessage, clearAgentMessages, getDomains, getRecentEvents,
  getConversationMessages, listConversations, createConversation, renameConversation, deleteConversation,
  listCheckpoints, getCheckpoint,
} from './data/repository'
import type { FocusSession, ChatMessage, ActivitySession, DailyStats, IntentCheckResult, AppCategory, AppSettings, AuthProvider } from '../shared/types'

let engine: BlockingEngine | null = null
let monitor: MonitorService | null = null
let agentService: AgentService | null = null
let inferenceEngine: InferenceEngine | null = null
let contentRuleEngine: ContentRuleEngine | null = null
let interstitialWin: BrowserWindow | null = null
let mainWin: BrowserWindow | null = null

// Break mode — suppresses interstitials and new auto-blocks for a timed window
let breakEndAt: number | null = null
let breakTimer: ReturnType<typeof setTimeout> | null = null
// Deep Focus auto-end timer (cleared on manual stop)
let deepFocusTimer: ReturnType<typeof setTimeout> | null = null

function isBreakActive(): boolean {
  return breakEndAt !== null && Date.now() < breakEndAt
}

export function setInterstitialWindow(win: BrowserWindow | null): void {
  interstitialWin = win
}

export function setMainWindow(win: BrowserWindow | null): void {
  mainWin = win
}

export function getMonitor(): MonitorService | null {
  return monitor
}

export function getAgentSvc(): AgentService | null {
  return agentService
}

export function getInferenceEngine(): InferenceEngine | null {
  return inferenceEngine
}

export function getBlockingEngine(): BlockingEngine | null {
  return engine
}

export function getContentRuleEngine(): ContentRuleEngine | null {
  return contentRuleEngine
}

export function stopTracking(): void {
  monitor?.stop()
  inferenceEngine?.stop()
  stopCloudSync()
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
ALLOW_TIMED: Plausible but vague reason, so grant 10 minutes maximum
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
    if (verdict.includes('ALLOW_TIMED')) return { verdict: 'allow_timed', reason: 'Plausible but vague, 10 minutes granted', allowedMinutes: 10, ollamaUsed: true }
    if (verdict.includes('ALLOW')) return { verdict: 'allow', reason: 'Purpose verified', ollamaUsed: true }
    return { verdict: 'deny', reason: 'Reason not specific enough for a work task', ollamaUsed: true }
  } catch {
    return evaluateIntentRuleBased(site, reason)
  }
}

function evaluateIntentRuleBased(site: string, reason: string): IntentCheckResult {
  const lower = reason.toLowerCase().trim()
  if (reason.length < 8) return { verdict: 'deny', reason: 'Reason too vague. Be specific about what you need.', ollamaUsed: false }

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

// Safe IPC send — guards against the window being destroyed between events.
// Uses try/catch because accessing .webContents on a destroyed BrowserWindow
// can itself throw in some Electron versions, not just .send().
function sendMain(channel: string, ...args: unknown[]): void {
  try {
    if (mainWin && !mainWin.isDestroyed()) {
      mainWin.webContents.send(channel, ...args)
    }
  } catch {
    // window was destroyed between the isDestroyed() check and the send
  }
}

// ── IPC initialization ────────────────────────────────────────────────────────

// ── Sign-in gate ──────────────────────────────────────────────────────────────
// Attentify is browsable signed-out — every view still renders, but any channel that
// DOES something (spends AI credit, changes the machine, writes user data) needs an
// account. Enforced here rather than by hiding buttons, because the renderer is not a
// trust boundary and a UI-only gate drifts out of sync with the handlers it guards.
//
// Deliberately default-DENY: this lists what stays open, so a channel added later is
// gated until someone decides otherwise. Open = reads, auth itself, window/app chrome,
// and the few actions a signed-out user must still have (report a bug, take an update,
// leave a block interstitial, change appearance).
const OPEN_CHANNELS = new Set<string>([
  // auth + account
  'auth:get', 'auth:providers', 'auth:login', 'auth:signup', 'auth:logout', 'auth:oauth',
  // reads
  'store:get', 'activity:get', 'agent:get-history', 'alwayson:get', 'analytics:get',
  'analytics:get-cards', 'apikey:get-status', 'blocking:elevation-status', 'break:status',
  'checkpoints:list', 'cloud:get', 'compat:check', 'content-rules:get', 'context:list',
  'conversations:list', 'conversations:messages', 'elevation:status', 'extension:status',
  'goals:get', 'inferences:get', 'issue:list', 'preferences:get', 'safety:changelog',
  'safety:status', 'startup:list', 'timesheet:get', 'update:check', 'update:status',
  'usage:get', 'daemon:startup-status',
  // chrome / environment
  'app:version', 'daemon:platform', 'shell:open-external',
  // Settings incl. the theme + diagnostics toggles: appearance is part of "looking".
  // The system-changing settings are enforced on their own channels below, not here.
  'store:set',
  // must keep working signed-out
  'issue:report', 'update:install', 'interstitial:hide', 'interstitial:proceed',
  'agent:dismiss-proactive',
  // Home IS the chat panel, which opens a conversation shell on mount — gating this
  // would leave a signed-out user staring at a broken home screen. Only a local row;
  // actually talking to the assistant is gated on chat:start.
  'conversations:create',
])

class AuthRequiredError extends Error {
  constructor(channel: string) {
    super(`AUTH_REQUIRED:${channel}`)
    this.name = 'AuthRequiredError'
  }
}

export function initIpc(): void {
  const store = getStore()

  // Merge the shipped cards in on every launch, not just at install, so an existing user
  // picks up new defaults too. Seeds the user deleted stay deleted (dismissedSeedIds),
  // and their own cards are never touched or reordered. This runs in main rather than
  // behind a gated channel, so the seeds are there for a signed-out user to look at.
  {
    const merged = mergeSeeds(store.customAnalyticsCards ?? [], store.dismissedSeedIds ?? [])
    if (merged.length !== (store.customAnalyticsCards ?? []).length) {
      patchStore({ customAnalyticsCards: merged })
    }
  }

  // Wrap ipcMain.handle for the duration of registration so the gate is applied once, at
  // a single choke point, instead of being repeated in ~50 handlers where one omission
  // is a silent hole. Restored immediately after the handlers below are registered.
  const originalHandle = ipcMain.handle.bind(ipcMain)
  ipcMain.handle = ((channel: string, listener: (event: Electron.IpcMainInvokeEvent, ...args: unknown[]) => unknown) => {
    if (OPEN_CHANNELS.has(channel)) return originalHandle(channel, listener)
    return originalHandle(channel, (event, ...args) => {
      if (!getAuthState().signedIn) throw new AuthRequiredError(channel)
      return listener(event, ...args)
    })
  }) as typeof ipcMain.handle

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
  // (async + fire-and-forget so init never blocks on schtasks).
  if (actuallyElevated) {
    void isStartupDaemonRegistered().then((reg) => { if (!reg) void registerStartupDaemon(process.execPath) })
  }

  monitor = new MonitorService()
  contentRuleEngine = new ContentRuleEngine()
  agentService = new AgentService({
    engine,
    tracker: monitor.getTracker(),
    heuristics: monitor.getHeuristics(),
    monitor,
    contentRules: contentRuleEngine,
  })

  inferenceEngine = new InferenceEngine(engine)
  inferenceEngine.setCallbacks({
    onAutoBlock: (domain, confidence) => {
      debugLog('inference:auto-block', { domain, confidence: Math.round(confidence * 100) })
      sendMain('inference:auto-blocked', { domain, confidence })
      notificationQueue.push({
        id: randomUUID(),
        type: 'auto-block',
        title: 'Blocked',
        rawMessage: `${domain} was automatically blocked (${Math.round(confidence * 100)}% confidence).`,
        domain,
        confidence,
        actions: [
          { label: 'Take 5 min break', type: 'break', durationMs: 5 * 60 * 1000 },
          { label: 'View Actions', type: 'view-actions' },
          { label: 'Ignore', type: 'dismiss' },
        ],
      })
    },
    onSuggest: (inf) => {
      debugLog('inference:suggest', { value: inf.value, type: inf.type, confidence: Math.round(inf.confidence * 100), reasoning: inf.reasoning })
      sendMain('inference:suggest', inf)
      if (inf.confidence >= 0.70) {
        const actions = inf.type === 'domain'
          ? [
              { label: 'Block it', type: 'block' as const, domain: inf.value },
              { label: 'Ask AI', type: 'chat' as const, chatMsg: `Why was ${inf.value} flagged? Should I block it?` },
              { label: 'Ignore', type: 'dismiss' as const },
            ]
          : [
              { label: 'View Actions', type: 'view-actions' as const },
              { label: 'Ignore', type: 'dismiss' as const },
            ]
        notificationQueue.push({
          id: randomUUID(),
          type: 'suggest',
          title: 'Flagged',
          rawMessage: inf.reasoning ?? `${inf.value} looks like a distraction (${Math.round(inf.confidence * 100)}% confidence).`,
          domain: inf.type === 'domain' ? inf.value : undefined,
          confidence: inf.confidence,
          actions,
        })
      }
    },
    onSearchAlert: (query, predictedDomain, category) => {
      sendMain('guard:alert', {
        url: '',
        domain: predictedDomain,
        title: `Search: "${query}"`,
        category,
        message: predictedDomain
          ? `Search predicts navigation to **${predictedDomain}** (${category}).`
          : `Recreational search detected: "${query}"`,
        searchQuery: query,
        timestamp: Date.now(),
      })
    },
  })
  monitor.attachInference(inferenceEngine)

  // Apply blocking mode from store
  const storedMode = (store.settings as AppSettings & { blockingMode?: 'auto' | 'ask' }).blockingMode ?? 'auto'
  inferenceEngine.setBlockingMode(storedMode)

  // Initialize agent + URL guard + inference with the effective key. This is the
  // user's own key if they pasted one, otherwise the bundled OpenRouter key, so AI
  // works out of the box. Spend against the bundled key is metered (see billing.ts).
  const effectiveKey = getEffectiveApiKey()
  agentService.init(effectiveKey)
  monitor.getUrlGuard().init(effectiveKey)
  inferenceEngine.init(effectiveKey)

  // Push live free-usage updates to the renderer so the meter/paywall stay current.
  setUsageChangeCallback((usage) => sendMain('usage:changed', usage))

  // Proactive agent callback
  agentService.setProactiveCallback((text) => {
    sendMain('agent:proactive', { text, timestamp: Date.now() })
  })

  engine.on('blocked', (event: { type: string; item: string }) => {
    if (!isBreakActive() && interstitialWin && !interstitialWin.isDestroyed() && !interstitialWin.isVisible()) {
      const session = getStore().sessions.find((s) => s.active)
      interstitialWin.webContents.send('interstitial:data', {
        blocked: event.item,
        type: event.type,
        endsAt: session?.endsAt,
      })
      interstitialWin.show()
    }
    patchStore({ blockEventCount: (getStore().blockEventCount ?? 0) + 1 })
    recordCloudEvent({ type: 'block', domain: event.item, label: event.type, ts: Date.now() })
  })

  monitor.on('url:blocked', (data: { domain: string; url: string }) => {
    debugLog('monitor:url-blocked', { domain: data.domain, url: data.url })
    if (!isBreakActive() && interstitialWin && !interstitialWin.isDestroyed() && !interstitialWin.isVisible()) {
      const session = getStore().sessions.find((s) => s.active)
      interstitialWin.webContents.send('interstitial:data', {
        blocked: data.domain,
        type: 'domain',
        endsAt: session?.endsAt,
      })
      interstitialWin.show()
    }
    patchStore({ blockEventCount: (getStore().blockEventCount ?? 0) + 1 })
    sendMain('inference:auto-blocked', { domain: data.domain, confidence: 1.0 })
    recordCloudEvent({ type: 'block', domain: data.domain, label: 'url', ts: Date.now() })
  })

  monitor.on('session', (session: ActivitySession) => {
    inferenceEngine?.analyzeSession(session)
  })

  // Only trigger proactive agent for substantial distraction sessions (≥90s)
  // This prevents 3-second title-change sessions from spamming the chat
  monitor.on('distraction', (session: ActivitySession) => {
    if (session.duration >= 90000) {
      agentService?.notifyDistraction(session)
    }
    // Feed the cloud dashboard for substantial distraction reads (≥30s).
    if (session.duration >= 30000) {
      let domain: string | undefined
      try { if (session.url) domain = new URL(session.url.startsWith('http') ? session.url : `https://${session.url}`).hostname.replace(/^www\./, '') } catch { /* ignore */ }
      recordCloudEvent({ type: 'distraction', domain, label: session.app, value: Math.round(session.duration / 1000), ts: Date.now() })
    }
  })

  monitor.on('guard:alert', (alert: unknown) => {
    const a = alert as { category?: string; message?: string; domain?: string; searchQuery?: string }
    debugLog('guard:alert', { domain: a.domain, category: a.category, message: (a.message ?? '').slice(0, 80) })
    sendMain('guard:alert', alert)
    const rawMsg = (a.message ?? '').replace(/\*\*(.*?)\*\*/g, '$1')
    const actions = a.domain
      ? [
          { label: 'Block it', type: 'block' as const, domain: a.domain },
          { label: 'Ask AI', type: 'chat' as const, chatMsg: a.searchQuery ? `I searched "${a.searchQuery}". Should I be worried?` : `Tell me about my browsing pattern on ${a.domain}` },
          { label: 'Ignore', type: 'dismiss' as const },
        ]
      : [
          { label: 'Ask AI', type: 'chat' as const, chatMsg: a.searchQuery ? `I searched "${a.searchQuery}". Is this a distraction?` : 'Am I getting distracted?' },
          { label: 'Ignore', type: 'dismiss' as const },
        ]
    notificationQueue.push({
      id: randomUUID(),
      type: 'guard',
      title: a.category ?? 'Guard',
      rawMessage: rawMsg || (a.domain ? `Potential distraction: ${a.domain}` : 'Distraction detected'),
      domain: a.domain,
      actions,
    })
  })

  monitor.on('patterns', (alerts: unknown[]) => {
    const s = getStore()
    patchStore({ heuristicAlerts: [...s.heuristicAlerts, ...alerts as typeof s.heuristicAlerts].slice(-200) })
    sendMain('heuristic:alert', alerts)
    // Show the highest-severity alert through the overlay
    const typed = alerts as import('../shared/types').HeuristicAlert[]
    const top = typed.find((a) => a.severity === 'high') ?? typed.find((a) => a.severity === 'medium')
    if (top) {
      notificationQueue.push({
        id: randomUUID(),
        type: 'heuristic',
        title: top.type,
        rawMessage: top.description,
        actions: [
          { label: 'Take 5 min break', type: 'break', durationMs: 5 * 60 * 1000 },
          { label: 'Ask AI', type: 'chat', chatMsg: `I just got a "${top.title}" alert. What should I do?` },
          { label: 'Ignore', type: 'dismiss' },
        ],
      })
    }
  })

  // ── Store ──────────────────────────────────────────────────────────────────

  ipcMain.handle('store:get', () => getStore())

  // ── Safety & Recovery ─────────────────────────────────────────────────────────
  // Read the change journal (most-recent-first) and its count for the recovery UI.
  ipcMain.handle('safety:changelog', (_e, limit?: number) => readChanges(limit ?? 250))
  ipcMain.handle('safety:status', () => ({ changeCount: changeCount() }))

  // One-click "Restore my system": wipe every persistent change Attentify made and
  // clear the app's own blocking state so nothing re-applies after the restore.
  ipcMain.handle('safety:revert', () => {
    const engine = getBlockingEngine()
    try { engine?.factoryReset() } catch { /* continue with the OS-level revert regardless */ }
    const s = getStore()
    patchStore({
      blocklist: { domains: [], processes: [] },
      feedBlocks: [],
      settings: { ...s.settings, alwaysOn: false },
    })
    return revertAllChanges()
  })

  ipcMain.handle('store:set', (_e, patch) => {
    const updated = patchStore(patch)
    engine?.loadState(updated.blocklist.domains, updated.blocklist.processes)
    // Sync blocking mode if it was changed
    const newMode = (updated.settings as AppSettings & { blockingMode?: 'auto' | 'ask' }).blockingMode
    if (newMode) inferenceEngine?.setBlockingMode(newMode)
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
    // Anti-bypass: domains the active Deep Focus session is enforcing can't be removed.
    const deep = getStore().sessions.find((s) => s.active && s.mode === 'deep')
    if (deep && engine?.isDeepDomain(domain)) {
      return { ok: false, locked: true, error: 'Locked by Deep Focus until the session ends.' }
    }
    engine?.removeDomain(domain)
    const s = getStore()
    patchStore({ blocklist: { ...s.blocklist, domains: s.blocklist.domains.filter((d) => d.domain !== domain) } })
    return { ok: true }
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

  // Full machine compatibility sweep (OS floor, architecture, elevation, hosts,
  // PowerShell tracking probe, data folder). Surfaced in Settings → Compatibility.
  ipcMain.handle('compat:check', async () => {
    const { runPreflight } = await import('./preflight')
    return runPreflight()
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

    // Deep Focus: actually enforce it, block the curated distraction set (minus the
    // allowlist) for the duration, and auto-end when the timer runs out.
    if (mode === 'deep') {
      const blocked = engine?.startDeepFocus(allowlist ?? [], durationMs) ?? 0
      if (deepFocusTimer) clearTimeout(deepFocusTimer)
      if (durationMs) {
        deepFocusTimer = setTimeout(() => {
          deepFocusTimer = null
          engine?.endDeepFocus()
          const cur = getStore()
          patchStore({ sessions: cur.sessions.map((x) => (x.id === session.id ? { ...x, active: false } : x)) })
          engine?.stop()
          sendMain('store:refresh')
          debugLog('deepfocus:auto-end', { sessionId: session.id })
        }, durationMs)
      }
      debugLog('deepfocus:start', { durationMs, blocked })
      return { ...session, deepBlocked: blocked }
    }
    return session
  })

  ipcMain.handle('session:stop', (_e, id: string) => {
    const s = getStore()
    const sess = s.sessions.find((x) => x.id === id)
    // Anti-bypass: a Deep Focus session is a commitment. It cannot be ended early —
    // only when its timer runs out (open-ended deep sessions can still be stopped).
    if (sess && sess.active && sess.mode === 'deep' && sess.endsAt && Date.now() < sess.endsAt) {
      return { ok: false, locked: true, endsAt: sess.endsAt, error: 'Deep Focus is locked until it ends.' }
    }
    if (deepFocusTimer) { clearTimeout(deepFocusTimer); deepFocusTimer = null }
    engine?.endDeepFocus()
    patchStore({ sessions: s.sessions.map((x) => (x.id === id ? { ...x, active: false } : x)) })
    engine?.stop()
    return { ok: true }
  })

  // ── Overlay notification actions ──────────────────────────────────────────

  // The overlay renderer signals it has mounted and registered its listeners. Only
  // then does the queue flush a pending notification — showing earlier races the
  // window blank (the old "stuck empty window in the corner" bug).
  ipcMain.on('overlay:ready', () => {
    notificationQueue.markReady()
  })

  // The renderer has painted the notification — safe to reveal the window now. This is
  // what keeps the corner window from ever flashing blank.
  ipcMain.on('overlay:shown', (_e, id: string) => {
    notificationQueue.handleShown(id)
  })

  ipcMain.on('overlay:dismiss', (_e, id: string) => {
    notificationQueue.onDismiss(id)
  })

  ipcMain.on('overlay:action', (_e, id: string, action: { type: string; domain?: string; durationMs?: number; chatMsg?: string }) => {
    notificationQueue.onDismiss(id)
    // Route actions that need main-process involvement
    if (action.type === 'chat' && action.chatMsg) {
      mainWin?.show()
      sendMain('overlay:open-chat', action.chatMsg)
    }
    if (action.type === 'view-actions') {
      mainWin?.show()
      sendMain('overlay:navigate', 'actions')
    }
  })

  // ── Break mode ────────────────────────────────────────────────────────────

  ipcMain.handle('break:start', (_e, durationMs: number, reason?: string) => {
    if (breakTimer) clearTimeout(breakTimer)
    breakEndAt = Date.now() + durationMs
    patchStore({ breakMode: { endsAt: breakEndAt, reason } })
    sendMain('break:started', { endsAt: breakEndAt, reason })
    interstitialWin?.hide()
    debugLog('break:start', { durationMs, endsAt: breakEndAt })
    breakTimer = setTimeout(() => {
      breakEndAt = null
      breakTimer = null
      patchStore({ breakMode: undefined })
      sendMain('break:ended', {})
      debugLog('break:end', { reason: 'timer' })
    }, durationMs)
    return { ok: true, endsAt: breakEndAt }
  })

  ipcMain.handle('break:end', () => {
    if (breakTimer) { clearTimeout(breakTimer); breakTimer = null }
    breakEndAt = null
    patchStore({ breakMode: undefined })
    sendMain('break:ended', {})
    debugLog('break:end', { reason: 'manual' })
    return { ok: true }
  })

  ipcMain.handle('break:status', () => {
    const store = getStore()
    return store.breakMode ?? null
  })

  // ── Chat (streaming agent) ────────────────────────────────────────────────

  ipcMain.on('chat:start', async (event, text: string, images?: { media_type: string; data: string }[], conversationId?: string) => {
    const sender = event.sender
    // Streaming chat registers via ipcMain.on, so the handle-wrapper gate above cannot
    // see it — gate it explicitly. This is the main way the assistant is used, and it
    // spends AI credit, so it must not be reachable signed-out.
    if (!getAuthState().signedIn) {
      sender.send('chat:error', 'AUTH_REQUIRED')
      return
    }
    if (!agentService) {
      sender.send('chat:error', 'Agent not initialized')
      return
    }

    // Fallback to regex engine if no API key
    if (!agentService.isReady()) {
      const store = getStore()
      const trackingData = {
        sessions: monitor?.getTracker().getSessions(Date.now() - 7 * 24 * 60 * 60 * 1000) ?? [],
        timePerApp: monitor?.getTracker().getTimePerApp(Date.now() - 7 * 24 * 60 * 60 * 1000) ?? {},
      }
      const response = processMessage(text, store, trackingData)
      const now = Date.now()
      insertAgentMessage({ role: 'user', content: text, ts: now, session_id: conversationId })
      const saved = insertAgentMessage({ role: 'assistant', content: response.reply, ts: now + 1, session_id: conversationId })
      sender.send('chat:chunk', response.reply)
      sender.send('chat:done', { id: saved.id, content: saved.content, timestamp: saved.ts })
      return
    }

    await agentService.chat(text, {
      onChunk: (chunk) => { if (!sender.isDestroyed()) sender.send('chat:chunk', chunk) },
      onToolUse: (toolName) => { if (!sender.isDestroyed()) sender.send('chat:tool', toolName) },
      onDone: (msg) => {
        if (!sender.isDestroyed()) {
          sender.send('chat:done', { id: msg.id, content: msg.content, timestamp: msg.ts })
          sendMain('store:refresh')
        }
      },
      onError: (err) => { if (!sender.isDestroyed()) sender.send('chat:error', err) },
    }, images)
  })

  // Legacy handle kept for backwards compat
  ipcMain.handle('chat:message', (_e, text: string) => {
    const store = getStore()
    const trackingData = {
      sessions: monitor?.getTracker().getSessions(Date.now() - 7 * 24 * 60 * 60 * 1000) ?? [],
      timePerApp: monitor?.getTracker().getTimePerApp(Date.now() - 7 * 24 * 60 * 60 * 1000) ?? {},
    }
    return processMessage(text, store, trackingData)
  })

  // ── API Key management ────────────────────────────────────────────────────

  ipcMain.handle('apikey:get-status', () => ({ hasKey: hasApiKey() }))

  ipcMain.handle('apikey:set', (_e, key: string) => {
    saveApiKey(key)
    agentService?.init(key)
    monitor?.getUrlGuard().init(key)
    inferenceEngine?.init(key)
    notificationQueue.refreshClient()
    sendMain('usage:changed', getUsageState())  // own key → no longer metered
    return { ok: true }
  })

  ipcMain.handle('apikey:delete', () => {
    deleteApiKey()
    // Fall back to the bundled key so AI keeps working (metered again).
    const k = getEffectiveApiKey()
    agentService?.init(k)
    monitor?.getUrlGuard().init(k)
    inferenceEngine?.init(k)
    notificationQueue.refreshClient()
    sendMain('usage:changed', getUsageState())
    return { ok: true }
  })

  // ── Free-usage metering + Cloud subscription ──────────────────────────────

  ipcMain.handle('usage:get', () => getUsageState())

  ipcMain.handle('cloud:get', () => getCloudState())

  ipcMain.handle('cloud:set-license', async (_e, license: string) => {
    const state = await setCloudLicense(license)
    return state
  })

  ipcMain.handle('cloud:clear-license', () => {
    clearCloudLicense()
    return getCloudState()
  })

  ipcMain.handle('cloud:checkout', async (_e, email?: string) => startCheckout(email))

  // ── Account authentication (email + password against the cloud backend) ──────
  ipcMain.handle('auth:get', () => getAuthState())
  ipcMain.handle('auth:signup', (_e, input: { email: string; password: string }) => authSignup(input?.email ?? '', input?.password ?? ''))
  ipcMain.handle('auth:login', (_e, input: { email: string; password: string }) => authLogin(input?.email ?? '', input?.password ?? ''))
  ipcMain.handle('auth:logout', async () => { await authLogout(); return { ok: true, auth: getAuthState() } })
  ipcMain.handle('auth:providers', () => authProviders())
  ipcMain.handle('auth:oauth', (_e, provider: AuthProvider) => authOauthLogin(provider))

  // ── Auto-update ─────────────────────────────────────────────────────────────
  ipcMain.handle('update:status', () => getUpdateStatus())
  ipcMain.handle('update:check', () => checkForUpdates())
  ipcMain.handle('update:install', () => installUpdate())

  ipcMain.handle('shell:open-external', (_e, url: string) => {
    if (typeof url === 'string' && /^https?:\/\//.test(url)) void shell.openExternal(url)
    return { ok: true }
  })

  // ── Goals ──────────────────────────────────────────────────────────────────

  ipcMain.handle('goals:get', () => getActiveGoals())
  ipcMain.handle('goals:add', (_e, text: string, priority?: number) => insertGoal(text, priority))
  ipcMain.handle('goals:clear', (_e, id: string) => { clearGoal(id); return { ok: true } })

  // ── Preferences ────────────────────────────────────────────────────────────

  ipcMain.handle('preferences:get', (_e, query?: string) => getPreferences(query))
  ipcMain.handle('preferences:set', (_e, key: string, value: string, scope = 'always', confidence = 0.9, source = 'user') => {
    upsertPreference(key, value, scope as Parameters<typeof upsertPreference>[2], confidence, source as 'user' | 'agent')
    return { ok: true }
  })
  ipcMain.handle('preferences:delete', (_e, key: string) => { deletePreference(key); return { ok: true } })

  // ── Inferences ─────────────────────────────────────────────────────────────

  ipcMain.handle('inferences:get', (_e, status?: string) => getInferences(status as Parameters<typeof getInferences>[0]))
  ipcMain.handle('inferences:resolve', (_e, id: string, status: 'confirmed' | 'rejected') => {
    // Look up the inference before resolving so we can act on it
    const all = getInferences()
    const inf = all.find((i) => i.id === id)
    resolveInference(id, status)

    // When user confirms a domain suggestion, actually add it to the blocklist
    if (status === 'confirmed' && inf && inf.type === 'domain') {
      const result = engine?.addDomain(inf.value) ?? { ok: false }
      if (result.ok) {
        const s = getStore()
        if (!s.blocklist.domains.find((d) => d.domain === inf.value)) {
          patchStore({
            blocklist: {
              ...s.blocklist,
              domains: [...s.blocklist.domains, { domain: inf.value, addedAt: Date.now(), reason: 'user:confirmed_inference' }],
            },
          })
        }
        sendMain('inference:auto-blocked', { domain: inf.value, confidence: inf.confidence })
      }
    }

    return { ok: true }
  })

  // ── Agent messages history ─────────────────────────────────────────────────

  ipcMain.handle('agent:get-history', (_e, limit = 40) => getAgentMessages(limit))

  ipcMain.handle('agent:clear-history', (_e, conversationId?: string) => {
    clearAgentMessages(conversationId)
    return { ok: true }
  })

  // ── Checkpoints (revert to a point in the conversation) ────────────────────
  ipcMain.handle('checkpoints:list', (_e, conversationId?: string) => listCheckpoints(conversationId))

  ipcMain.handle('checkpoints:restore', (_e, id: string) => {
    const cp = getCheckpoint(id)
    if (!cp) return { ok: false, error: 'Checkpoint not found' }
    let snap: {
      blocklist?: { domains: { domain: string }[]; processes: { name: string }[] }
      schedules?: unknown[]; sessions?: { active?: boolean; mode?: string; endsAt?: number }[]
      contentRules?: unknown[]; customAnalyticsCards?: unknown[]; feedBlocks?: unknown[]
    }
    try { snap = JSON.parse(cp.snapshot) } catch { return { ok: false, error: 'Corrupt checkpoint' } }

    const store = getStore()
    // Respect the Deep Focus lock — never let a revert bypass an active locked session.
    const lockedDeep = store.sessions.find((s) => s.active && s.mode === 'deep' && s.endsAt && Date.now() < s.endsAt)
    if (lockedDeep) return { ok: false, error: "Can't revert while a Deep Focus session is locked." }

    // Reconcile domains/processes with the blocking engine to match the snapshot.
    const targetDomains = new Set((snap.blocklist?.domains ?? []).map((d) => d.domain))
    const currentDomains = new Set(store.blocklist.domains.map((d) => d.domain))
    for (const d of currentDomains) if (!targetDomains.has(d)) { try { engine?.removeDomain(d) } catch { /* soft */ } }
    for (const d of targetDomains) if (!currentDomains.has(d)) { try { engine?.addDomain(d) } catch { /* soft */ } }
    const targetProcs = new Set((snap.blocklist?.processes ?? []).map((p) => p.name))
    const currentProcs = new Set(store.blocklist.processes.map((p) => p.name))
    for (const p of currentProcs) if (!targetProcs.has(p)) { try { engine?.removeProcess(p) } catch { /* soft */ } }
    for (const p of targetProcs) if (!currentProcs.has(p)) { try { engine?.addProcess(p) } catch { /* soft */ } }

    patchStore({
      blocklist: (snap.blocklist as typeof store.blocklist) ?? store.blocklist,
      schedules: (snap.schedules as typeof store.schedules) ?? store.schedules,
      sessions: (snap.sessions as typeof store.sessions) ?? store.sessions,
      contentRules: (snap.contentRules as typeof store.contentRules) ?? store.contentRules,
      customAnalyticsCards: (snap.customAnalyticsCards as typeof store.customAnalyticsCards) ?? store.customAnalyticsCards,
      feedBlocks: (snap.feedBlocks as typeof store.feedBlocks) ?? store.feedBlocks,
    })
    sendMain('store:refresh')
    return { ok: true, label: cp.label }
  })

  // ── Logic page: user-provided context (preferences:get is registered above) ──
  ipcMain.handle('context:list', () => getStore().userContext ?? [])

  ipcMain.handle('context:add', (_e, text: string) => {
    const t = (text || '').trim()
    if (!t) return { ok: false, error: 'empty' }
    const s = getStore()
    const note = { id: 'ctx-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), text: t.slice(0, 400), ts: Date.now() }
    patchStore({ userContext: [note, ...(s.userContext ?? [])].slice(0, 100) })
    return { ok: true, note }
  })

  ipcMain.handle('context:delete', (_e, id: string) => {
    const s = getStore()
    patchStore({ userContext: (s.userContext ?? []).filter((c) => c.id !== id) })
    return { ok: true }
  })

  // App version (so the UI can show which build is installed)
  ipcMain.handle('app:version', () => app.getVersion())

  // ── Bug reports / diagnostics ──────────────────────────────────────────────
  ipcMain.handle('issue:report', (_e, input: { title?: string; description?: string; view?: string; severity?: string }) => {
    const issue = reportIssue({
      kind: 'bug_manual',
      severity: input?.severity ?? 'medium',
      title: (input?.title || 'Bug report').slice(0, 200),
      description: (input?.description || '').slice(0, 4000),
      view: input?.view,
    })
    return { ok: true, id: issue.id }
  })
  ipcMain.handle('issue:list', (_e, limit?: number) => listIssues(limit ?? 100))

  // ── Activity feed: raw searches + browsing history + app activity ──────────
  ipcMain.handle('activity:get', (_e, days?: number) => {
    const win = Math.max(1, Math.min(days ?? 14, 90))
    const since = Date.now() - win * 24 * 60 * 60 * 1000
    const events = getRecentEvents(since, 2000)
    const searches = events
      .filter((e) => e.type === 'search_query' && e.title)
      .map((e) => ({ ts: e.ts, query: e.title as string, url: e.url }))
    const visits = events
      .filter((e) => e.type === 'url_visit' && e.url)
      .map((e) => ({ ts: e.ts, url: e.url as string, title: e.title }))
    const tracker = monitor?.getTracker()
    const sessions = tracker?.getSessions(since) ?? []
    return { rangeDays: win, searches, visits, sessions: sessions.slice(-500) }
  })

  // ── Startup (auto-run) management ──────────────────────────────────────────
  ipcMain.handle('startup:list', () => listStartupItems())
  ipcMain.handle('startup:disable', (_e, item: Parameters<typeof disableStartupItem>[0]) => disableStartupItem(item))

  // ── Conversations ──────────────────────────────────────────────────────────

  ipcMain.handle('conversations:list', () => listConversations())
  ipcMain.handle('conversations:create', (_e, title?: string) => createConversation(title || 'New chat'))
  ipcMain.handle('conversations:messages', (_e, id: string, limit = 200) => getConversationMessages(id, limit))
  ipcMain.handle('conversations:rename', (_e, id: string, title: string) => { renameConversation(id, title); return { ok: true } })
  ipcMain.handle('conversations:delete', (_e, id: string) => { deleteConversation(id); return { ok: true } })

  // ── Build a custom analytics card directly (no chat UI) ────────────────────
  ipcMain.handle('analytics:build-card', async (_e, description: string) => {
    if (!agentService) return { ok: false, error: 'Agent not initialized' }
    const res = await agentService.buildAnalyticsCard(description)
    if (res.ok) sendMain('store:refresh')
    return res
  })

  // ── Proactive intervention dismiss ────────────────────────────────────────

  ipcMain.handle('agent:dismiss-proactive', () => {
    agentService?.onInterventionDismissed()
    return { ok: true }
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
    const tracker = monitor?.getTracker()
    const heuristics = monitor?.getHeuristics()
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
      domains: getDomains(now - 7 * 24 * 60 * 60 * 1000, 100),
    }
  })

  // ── Timesheets (RescueTime-style) ─────────────────────────────────────────
  // Returns the full (uncapped) set of tracked sessions for the range so the client
  // can build a day-by-day / category grid. Range is clamped to a sane window.
  ipcMain.handle('timesheet:get', (_e, days?: number) => {
    const tracker = monitor?.getTracker()
    const win = Math.max(1, Math.min(days ?? 7, 31))
    const since = Date.now() - win * 24 * 60 * 60 * 1000
    const sessions = tracker?.getSessions(since) ?? []
    return { rangeDays: win, sessions }
  })

  // ── Custom analytics cards (built via the AI "describe your analytics" tool) ──
  ipcMain.handle('analytics:get-cards', () => {
    return getStore().customAnalyticsCards ?? []
  })

  // Run a saved action card. Takes an ID, never the action itself: the renderer must not
  // be able to name a tool or supply params, or a click would become an arbitrary tool
  // call. The card is looked up in the store, where create_action_card already validated
  // it, and AgentService re-checks the whitelist before executing.
  ipcMain.handle('cards:run-action', async (_e, cardId: string) => {
    if (!agentService) return { ok: false, error: 'Agent not initialized' }
    const card = (getStore().customAnalyticsCards ?? []).find((c) => c.id === cardId)
    if (!card) return { ok: false, error: 'Card not found' }
    const res = await agentService.runCardAction(card)
    if (res.ok) sendMain('store:refresh')
    return res
  })

  // Drag-to-reorder writes the user's order back onto the cards themselves, so it
  // survives restarts rather than being implied by insertion order.
  ipcMain.handle('analytics:reorder-cards', (_e, orderedIds: string[]) => {
    const s = getStore()
    const cards = s.customAnalyticsCards ?? []
    const pos = new Map(orderedIds.map((id, i) => [id, i]))
    const next = cards.map((c) => (pos.has(c.id) ? { ...c, order: pos.get(c.id)! } : c))
    patchStore({ customAnalyticsCards: next })
    return { ok: true }
  })

  ipcMain.handle('analytics:delete-card', (_e, id: string) => {
    // A deleted seed must stay deleted: mergeSeeds runs on every launch, so without
    // this the default would quietly reappear and the card would feel undeletable.
    const doomed = (getStore().customAnalyticsCards ?? []).find((c) => c.id === id)
    if (doomed?.seeded) {
      const prev = getStore().dismissedSeedIds ?? []
      if (!prev.includes(id)) patchStore({ dismissedSeedIds: [...prev, id] })
    }
    const s = getStore()
    patchStore({ customAnalyticsCards: (s.customAnalyticsCards ?? []).filter((c) => c.id !== id) })
    return { ok: true }
  })

  ipcMain.handle('heuristics:dismiss', (_e, id: string) => {
    monitor?.getHeuristics().dismissAlert(id)
    const s = getStore()
    patchStore({
      heuristicAlerts: s.heuristicAlerts.map((a) => (a.id === id ? { ...a, dismissed: true } : a)),
    })
  })

  // ── PDF export ────────────────────────────────────────────────────────────

  ipcMain.handle('analytics:export-pdf', async () => {
    if (!mainWin) return { ok: false, error: 'No window' }

    const now = Date.now()
    const tracker = monitor?.getTracker()
    const todaySessions = tracker?.getSessions(new Date().setHours(0, 0, 0, 0)) ?? []
    const weeklySessions = tracker?.getSessions(now - 7 * 24 * 60 * 60 * 1000) ?? []
    const store = getStore()
    const today = buildDailyStats(todaySessions, store.blockEventCount ?? 0)
    const weekly = {
      focusedTime: tracker?.getFocusedTime(now - 7 * 24 * 60 * 60 * 1000) ?? 0,
      distractedTime: tracker?.getDistractedTime(now - 7 * 24 * 60 * 60 * 1000) ?? 0,
      timePerApp: tracker?.getTimePerApp(now - 7 * 24 * 60 * 60 * 1000) ?? {},
      sessionCount: weeklySessions.length,
      blockEvents: store.blockEventCount ?? 0,
    }

    const fmt = (ms: number): string => {
      const h = Math.floor(ms / 3_600_000), m = Math.floor((ms % 3_600_000) / 60_000)
      if (h > 0 && m > 0) return `${h}h ${m}m`
      if (h > 0) return `${h}h`
      if (m > 0) return `${m}m`
      return '< 1m'
    }

    const topApps = today.appBreakdown.slice(0, 8)
    const totalTracked = today.focusedTime + today.distractedTime + today.neutralTime || 1

    const appRows = topApps.map((a) => {
      const pct = Math.round((a.duration / totalTracked) * 100)
      const bar = `<div style="height:6px;border-radius:3px;background:#e8f0fe;margin-top:3px"><div style="height:6px;border-radius:3px;background:${a.isDistraction ? '#f87171' : '#34d399'};width:${Math.min(pct, 100)}%"></div></div>`
      return `<tr><td>${a.app}</td><td style="text-transform:capitalize">${a.category}</td><td>${fmt(a.duration)}</td><td>${pct}%${bar}</td><td style="color:${a.isDistraction ? '#f87171' : '#34d399'}">${a.isDistraction ? 'Distraction' : 'Productive'}</td></tr>`
    }).join('')

    const weeklyApps = Object.entries(weekly.timePerApp).sort((a, b) => b[1] - a[1]).slice(0, 5)
    const weeklyAppRows = weeklyApps.map(([app, ms]) =>
      `<tr><td>${app}</td><td>${fmt(ms)}</td></tr>`
    ).join('')

    const dateStr = new Date().toLocaleDateString([], { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })
    const weekAgo = new Date(now - 7 * 24 * 60 * 60 * 1000).toLocaleDateString([], { month: 'short', day: 'numeric' })
    const todayShort = new Date().toLocaleDateString([], { month: 'short', day: 'numeric' })

    const html = `<!DOCTYPE html><html><head><meta charset="utf-8">
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: 'Segoe UI', Arial, sans-serif; color: #1a2332; background: #fff; padding: 32px 40px; font-size: 13px; line-height: 1.5; }
  h1 { font-size: 22px; font-weight: 700; color: #0d1b2a; }
  h2 { font-size: 13px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.1em; color: #3d6080; margin: 24px 0 10px; border-bottom: 2px solid #e2eaf2; padding-bottom: 6px; }
  .header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 28px; padding-bottom: 18px; border-bottom: 3px solid #1565c0; }
  .header-sub { font-size: 11px; color: #6b8aaa; margin-top: 4px; }
  .kpi-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin-bottom: 8px; }
  .kpi { background: #f4f8ff; border: 1px solid #d0dff0; border-radius: 6px; padding: 12px 14px; }
  .kpi-val { font-size: 22px; font-weight: 800; color: #1565c0; line-height: 1.1; }
  .kpi-label { font-size: 10px; text-transform: uppercase; letter-spacing: 0.1em; color: #6b8aaa; margin-top: 3px; }
  .kpi-val.green { color: #2e7d32; } .kpi-val.red { color: #c62828; } .kpi-val.amber { color: #e65100; }
  table { width: 100%; border-collapse: collapse; margin-top: 8px; font-size: 12px; }
  th { background: #f4f8ff; color: #3d6080; text-transform: uppercase; font-size: 10px; letter-spacing: 0.08em; padding: 7px 10px; text-align: left; border-bottom: 2px solid #d0dff0; }
  td { padding: 6px 10px; border-bottom: 1px solid #edf2f8; vertical-align: middle; }
  tr:last-child td { border-bottom: none; }
  .footer { margin-top: 32px; padding-top: 14px; border-top: 1px solid #e2eaf2; font-size: 10px; color: #9ab0c4; display: flex; justify-content: space-between; }
  .score-circle { width: 56px; height: 56px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 18px; font-weight: 800; color: #fff; background: ${today.focusScore >= 70 ? '#2e7d32' : today.focusScore >= 40 ? '#e65100' : '#c62828'}; flex-shrink: 0; }
  .today-header { display: flex; align-items: center; gap: 14px; margin-bottom: 14px; }
  .today-header-text h2 { margin: 0; border: none; padding: 0; }
  .today-header-text p { font-size: 11px; color: #6b8aaa; margin-top: 2px; }
  @media print { body { padding: 20px 28px; } }
</style>
</head><body>
<div class="header">
  <div>
    <h1>Attentify — Focus Report</h1>
    <div class="header-sub">${dateStr}</div>
    <div class="header-sub" style="margin-top:1px">Weekly range: ${weekAgo} – ${todayShort}</div>
  </div>
  <div style="text-align:right">
    <div style="font-size:10px;color:#9ab0c4;text-transform:uppercase;letter-spacing:0.1em">Generated</div>
    <div style="font-size:12px;color:#3d6080;font-weight:600">${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</div>
  </div>
</div>

<div class="today-header">
  <div class="score-circle">${today.focusScore}</div>
  <div class="today-header-text">
    <h2>Today at a Glance</h2>
    <p>Focus score: ${today.focusScore >= 70 ? 'Strong — you\'re in the zone' : today.focusScore >= 40 ? 'Moderate — room to improve' : 'Low — high distraction day'}</p>
  </div>
</div>

<div class="kpi-grid">
  <div class="kpi"><div class="kpi-val green">${fmt(today.focusedTime)}</div><div class="kpi-label">Focused Time</div></div>
  <div class="kpi"><div class="kpi-val red">${fmt(today.distractedTime)}</div><div class="kpi-label">Distracted Time</div></div>
  <div class="kpi"><div class="kpi-val ${today.blockEvents > 0 ? 'amber' : ''}">${today.blockEvents}</div><div class="kpi-label">Blocks Triggered</div></div>
  <div class="kpi"><div class="kpi-val">${today.focusSessions}</div><div class="kpi-label">Focus Sessions</div></div>
</div>

<h2>App Usage — Today</h2>
<table>
  <thead><tr><th>Application</th><th>Category</th><th>Time Spent</th><th>Share of Day</th><th>Classification</th></tr></thead>
  <tbody>${appRows || '<tr><td colspan="5" style="color:#9ab0c4;text-align:center;padding:16px">No activity recorded today</td></tr>'}</tbody>
</table>

<h2>This Week (${weekAgo} – ${todayShort})</h2>
<div class="kpi-grid">
  <div class="kpi"><div class="kpi-val green">${fmt(weekly.focusedTime)}</div><div class="kpi-label">Total Focused</div></div>
  <div class="kpi"><div class="kpi-val red">${fmt(weekly.distractedTime)}</div><div class="kpi-label">Total Distracted</div></div>
  <div class="kpi"><div class="kpi-val">${weekly.sessionCount}</div><div class="kpi-label">Sessions Tracked</div></div>
  <div class="kpi"><div class="kpi-val ${weekly.blockEvents > 0 ? 'amber' : ''}">${weekly.blockEvents}</div><div class="kpi-label">Blocks Triggered</div></div>
</div>

${weeklyAppRows ? `<h2>Top Apps This Week</h2><table><thead><tr><th>Application</th><th>Time Spent</th></tr></thead><tbody>${weeklyAppRows}</tbody></table>` : ''}

<div class="footer">
  <span>Attentify · attentify.ai</span>
  <span>Exported ${new Date().toISOString()}</span>
</div>
</body></html>`

    const { filePath, canceled } = await dialog.showSaveDialog(mainWin, {
      title: 'Export Analytics Report',
      defaultPath: `focus-report-${new Date().toISOString().split('T')[0]}.pdf`,
      filters: [{ name: 'PDF Document', extensions: ['pdf'] }],
    })

    if (canceled || !filePath) return { ok: false, canceled: true }

    const hidden = new ElectronBrowserWindow({
      show: false,
      webPreferences: { javascript: false },
    })

    try {
      await hidden.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`)
      await new Promise((r) => setTimeout(r, 600))
      const pdfBuffer = await hidden.webContents.printToPDF({
        printBackground: true,
        pageSize: 'A4',
        margins: { marginType: 'default' },
      })
      await writeFile(filePath, pdfBuffer)
      return { ok: true, filePath }
    } catch (err) {
      return { ok: false, error: String(err) }
    } finally {
      hidden.destroy()
    }
  })

  // ── Daemon management ─────────────────────────────────────────────────────

  ipcMain.handle('daemon:register-startup', () => registerStartupDaemon(process.execPath))
  ipcMain.handle('daemon:unregister-startup', () => unregisterStartupDaemon())
  ipcMain.handle('daemon:startup-status', () => isStartupDaemonRegistered())
  ipcMain.handle('daemon:platform', () => getPlatformLabel())

  // ── Always-On (runs like an antivirus: starts at login, stays in the tray, and
  //    keeps enforcing blocks even when the window is closed) ──────────────────
  ipcMain.handle('alwayson:get', async () => ({
    enabled: getStore().settings.alwaysOn === true,
    startupRegistered: await isStartupDaemonRegistered(),
  }))

  ipcMain.handle('alwayson:set', async (_e, enabled: boolean) => {
    const s = getStore()
    patchStore({ settings: { ...s.settings, alwaysOn: !!enabled } })
    // Update UI state immediately; the (async) startup-task registration runs without
    // blocking the event loop, so the app never freezes during the toggle.
    if (enabled) {
      engine?.protect()                          // make sure every protection layer is live now
      await registerStartupDaemon(process.execPath).catch(() => false)   // relaunch at login (elevated on Windows)
    } else {
      await unregisterStartupDaemon().catch(() => false)
    }
    const startupRegistered = await isStartupDaemonRegistered()
    debugLog('alwayson:set', { enabled, startupRegistered })
    return { ok: true, enabled: !!enabled, startupRegistered }
  })

  // ── Interstitial ──────────────────────────────────────────────────────────

  ipcMain.handle('interstitial:hide', () => interstitialWin?.hide())
  ipcMain.handle('interstitial:proceed', () => interstitialWin?.hide())

  // ── Content Rule Engine (browser extension element blocking) ─────────────

  // Wire up bypass escalation → agent check-in + overlay notification
  contentRuleEngine.on('bypass', (attempt: import('../../shared/types').BypassAttempt, score: number, escalation: string) => {
    if (escalation === 'warn') {
      const rule = contentRuleEngine!.getRules().find((r) => r.id === attempt.ruleId)
      agentService?.notifyDistraction({
        id: randomUUID(),
        app: 'browser',
        title: `Bypass attempt on ${rule?.displayName ?? attempt.ruleId} (${score}x)`,
        url: attempt.url,
        category: 'browser',
        startTime: Date.now() - 30000,
        endTime: Date.now(),
        duration: 30000,
        isDistraction: true,
      })
    }
    if (escalation === 'block_5m' || escalation === 'block_1h') {
      const rule = contentRuleEngine!.getRules().find((r) => r.id === attempt.ruleId)
      if (rule?.domain) {
        const ms = escalation === 'block_5m' ? 5 * 60 * 1000 : 60 * 60 * 1000
        engine?.addDomain(rule.domain, ms)
        sendMain('inference:auto-blocked', { domain: rule.domain, confidence: 1.0 })
        notificationQueue.push({
          id: randomUUID(),
          type: 'auto-block',
          title: 'Escalated Block',
          rawMessage: `${rule.displayName} bypass detected ${score}x — ${rule.domain} blocked for ${escalation === 'block_5m' ? '5 minutes' : '1 hour'}.`,
          domain: rule.domain,
          confidence: 1.0,
          actions: [
            { label: 'Understood', type: 'dismiss' },
            { label: 'Ask AI', type: 'chat', chatMsg: `I tried to access ${rule.displayName} ${score} times. Should I be worried?` },
          ],
        })
      }
    }
  })

  ipcMain.handle('content-rules:get', () => contentRuleEngine?.getRules() ?? [])

  ipcMain.handle('content-rules:add', (_e, rule: import('../../shared/types').ContentRule) => {
    const added = contentRuleEngine?.addRule(rule)
    return { ok: !!added, rule: added }
  })

  ipcMain.handle('content-rules:toggle', (_e, id: string, enabled: boolean) => {
    const ok = contentRuleEngine?.toggleRule(id, enabled) ?? false
    return { ok }
  })

  ipcMain.handle('content-rules:delete', (_e, id: string) => {
    const ok = contentRuleEngine?.deleteRule(id) ?? false
    return { ok }
  })

  ipcMain.handle('content-rules:install-predefined', () => {
    const rules = contentRuleEngine?.installPredefined() ?? []
    return { ok: true, count: rules.length, rules }
  })

  ipcMain.handle('extension:status', () => ({
    connected: contentRuleEngine?.isExtensionConnected() ?? false,
    rules: contentRuleEngine?.getRules().length ?? 0,
    enabledRules: contentRuleEngine?.getRules().filter((r) => r.enabled).length ?? 0,
    bypassScores: contentRuleEngine?.getAllBypassScores() ?? {},
  }))

  // Registration is done — stop intercepting so nothing registered elsewhere (or later)
  // is silently wrapped by this gate.
  ipcMain.handle = originalHandle
}

export function startTracking(): void {
  const store = getStore()
  if (store.settings?.trackingEnabled !== false) {
    monitor?.start()
    inferenceEngine?.start()
    // Sync focus events to the cloud for Cloud-tier users (powers the web dashboard).
    // The module itself no-ops for free users, so it's always safe to start.
    startCloudSync()
  }
}

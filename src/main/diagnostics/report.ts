import { app } from 'electron'
import { randomUUID } from 'crypto'
import { release, platform as osPlatform, arch } from 'os'
import { getStore, patchStore } from '../store'
import { CLOUD_API_BASE } from '../config'
import { getRecentLogs } from '../debug/logger'
import { debugLog } from '../debug/logger'
import {
  insertIssue, getUnuploadedIssues, markIssuesUploaded,
  getUnsyncedUsage, markUsageSynced, getAgentMessages,
  type DbIssue,
} from '../data/repository'

// Diagnostics + self-improvement pipeline. Everything (manual bug reports, auto crash /
// freeze capture, AI-detected friction) is written to the local `issues` table with rich
// captured context, and, when the user leaves diagnostics sharing on — uploaded to the
// Cloudflare backend so all beta users' issues + token usage land in one place.

// Stable anonymous install id, so uploaded reports can be grouped per user without PII.
export function getInstallId(): string {
  const s = getStore()
  if (s.installId) return s.installId
  const id = 'ins_' + randomUUID().replace(/-/g, '').slice(0, 20)
  patchStore({ installId: id })
  return id
}

export function diagnosticsEnabled(): boolean {
  // Default ON (beta). Users can turn it off in Settings.
  return getStore().settings?.shareDiagnostics !== false
}

// Snapshot of the app's state at the moment of an issue, the context that makes a
// report actionable. Chat excerpt is trimmed and tool-call noise excluded upstream.
export function captureContext(extra: Record<string, unknown> = {}): Record<string, unknown> {
  let recentLogs: unknown[] = []
  let recentChat: { role: string; content: string; ts: number }[] = []
  try { recentLogs = getRecentLogs(60) } catch { /* ignore */ }
  try {
    recentChat = getAgentMessages(8)
      .filter((m) => m.role === 'user' || m.role === 'assistant')
      .map((m) => ({ role: m.role, content: (m.content || '').slice(0, 500), ts: m.ts }))
  } catch { /* ignore */ }
  return {
    version: app.getVersion(),
    os: `${osPlatform()} ${release()} ${arch()}`,
    ts: Date.now(),
    recentLogs,
    recentChat,
    ...extra,
  }
}

export interface ReportInput {
  kind: DbIssue['kind']
  category?: string
  severity?: string
  title?: string
  description?: string
  view?: string
  context?: Record<string, unknown>
}

export function reportIssue(input: ReportInput): DbIssue {
  const issue = insertIssue({
    kind: input.kind,
    category: input.category,
    severity: input.severity,
    title: input.title,
    description: input.description,
    context: captureContext({ view: input.view, ...(input.context ?? {}) }),
  })
  debugLog('issue:reported', { id: issue.id, kind: issue.kind, category: issue.category })
  // Best-effort upload; never blocks the caller.
  void uploadPending()
  return issue
}

// ── Upload / sync to backend ────────────────────────────────────────────────────

let syncing = false
let syncTimer: ReturnType<typeof setInterval> | null = null

export async function uploadPending(): Promise<void> {
  if (syncing || !diagnosticsEnabled()) return
  syncing = true
  try {
    const base = CLOUD_API_BASE.replace(/\/$/, '')
    const installId = getInstallId()
    const version = app.getVersion()

    // 1) Issues
    const issues = getUnuploadedIssues(50)
    if (issues.length > 0) {
      const res = await fetch(`${base}/v1/issues`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ install_id: installId, version, issues }),
        signal: AbortSignal.timeout(10000),
      })
      if (res.ok) markIssuesUploaded(issues.map((i) => i.id))
    }

    // 2) Usage (token/cost by model+day)
    const usage = getUnsyncedUsage()
    if (usage.length > 0) {
      const res = await fetch(`${base}/v1/usage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ install_id: installId, version, stats: usage }),
        signal: AbortSignal.timeout(10000),
      })
      if (res.ok) markUsageSynced(usage.map((u) => ({ day: u.day, model: u.model })))
    }
  } catch (e) {
    debugLog('issue:upload-failed', { error: String(e) })
  } finally {
    syncing = false
  }
}

export function startDiagnosticsSync(): void {
  if (syncTimer) return
  // Periodic push so usage + any queued issues reach the backend even without a report.
  syncTimer = setInterval(() => { void uploadPending() }, 4 * 60 * 1000)
  setTimeout(() => { void uploadPending() }, 15000)
}

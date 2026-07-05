// Cloud analytics sync.
//
// When the user is on the Cloud tier, the desktop app streams a lightweight feed of
// focus events (blocks, distractions, corrections) up to the Worker's /v1/analytics
// endpoint. That's what powers the *website* dashboard — the same numbers the app
// shows locally, available from any browser after signing in.
//
// Design goals:
//   • Zero cost for free users — nothing is sent unless cloudActive is true.
//   • Privacy-light — only event type + domain + timestamp, never page content.
//   • Robust — events are buffered in memory and flushed on an interval; a failed
//     flush keeps the buffer (capped) so a brief outage doesn't lose data, and a
//     full buffer drops oldest rather than growing unbounded.

import { getStore } from './store'
import { CLOUD_API_BASE } from './config'
import { debugLog } from './debug/logger'

export interface CloudEvent {
  type: 'block' | 'distraction' | 'misprediction' | 'context'
  domain?: string
  label?: string
  value?: number
  ts: number
}

const FLUSH_INTERVAL_MS = 3 * 60 * 1000 // 3 minutes
const MAX_BUFFER = 500                    // hard cap; drop-oldest beyond this
const MAX_BATCH = 200                     // Worker accepts up to 200 per POST

let buffer: CloudEvent[] = []
let timer: ReturnType<typeof setInterval> | null = null

function isCloudActive(): { active: boolean; license: string | null } {
  const s = getStore()
  return { active: !!s.cloudActive, license: s.cloudLicense ?? null }
}

/** Queue an event for the next flush. No-op when the user isn't on Cloud. */
export function recordCloudEvent(evt: CloudEvent): void {
  if (!isCloudActive().active) return
  buffer.push(evt)
  if (buffer.length > MAX_BUFFER) buffer = buffer.slice(-MAX_BUFFER)
}

async function flush(): Promise<void> {
  const { active, license } = isCloudActive()
  if (!active || !license || buffer.length === 0) return

  const batch = buffer.slice(0, MAX_BATCH)
  try {
    const res = await fetch(`${CLOUD_API_BASE.replace(/\/$/, '')}/v1/analytics`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${license}` },
      body: JSON.stringify({ events: batch }),
      signal: AbortSignal.timeout(10_000),
    })
    if (res.ok) {
      // Drop the batch we successfully sent; keep anything queued since.
      buffer = buffer.slice(batch.length)
      debugLog('cloud:sync', { sent: batch.length, remaining: buffer.length })
    } else {
      debugLog('cloud:sync-failed', { status: res.status })
    }
  } catch (e) {
    // Keep the buffer for the next attempt (network blip, offline, etc.)
    debugLog('cloud:sync-error', { error: String(e) })
  }
}

export function startCloudSync(): void {
  if (timer) return
  timer = setInterval(() => { void flush() }, FLUSH_INTERVAL_MS)
}

export function stopCloudSync(): void {
  if (timer) { clearInterval(timer); timer = null }
  // Best-effort final flush on shutdown.
  void flush()
}

import { appendFileSync, existsSync, mkdirSync, statSync, renameSync } from 'fs'
import { join } from 'path'

const LOG_DIR = join('C:\\ProgramData', 'Attentify', 'logs')
const LOG_PATH = join(LOG_DIR, 'debug.log')
const MAX_BYTES = 4 * 1024 * 1024  // rotate at 4 MB

// In-memory ring buffer — last 500 entries, for instant /logs API response
let _ring: string[] = []

function ensureDir(): void {
  if (!existsSync(LOG_DIR)) mkdirSync(LOG_DIR, { recursive: true })
}

function rotate(): void {
  try {
    if (existsSync(LOG_PATH) && statSync(LOG_PATH).size > MAX_BYTES) {
      renameSync(LOG_PATH, LOG_PATH + '.old')
    }
  } catch { /* non-fatal */ }
}

export function debugLog(event: string, data: Record<string, unknown> = {}): void {
  try {
    ensureDir()
    rotate()
    const line = JSON.stringify({ ts: Date.now(), event, ...data })
    appendFileSync(LOG_PATH, line + '\n', 'utf8')
    _ring.push(line)
    if (_ring.length > 500) _ring = _ring.slice(-300)
  } catch { /* non-fatal — never crash the app over debug logging */ }
}

export function getRecentLogs(n = 150): unknown[] {
  return _ring.slice(-n).map((l) => { try { return JSON.parse(l) } catch { return l } })
}

export function getLogPath(): string { return LOG_PATH }

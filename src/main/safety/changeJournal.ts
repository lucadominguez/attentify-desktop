import { appendFileSync, readFileSync, existsSync, mkdirSync } from 'fs'
import { join } from 'path'
import { platform } from 'process'
import { app } from 'electron'

// ─── Change journal ────────────────────────────────────────────────────────────
// An append-only record of every system-level change Attentify makes (hosts-file
// edits, firewall rules, browser DNS policies, login startup entries). Two purposes:
//   1. Transparency, the user can see exactly what was done to their machine.
//   2. Recovery, it underpins the one-click "Restore my system" action.
//
// Deliberately lightweight: each change is a single appended JSON line (one syscall,
// no read/parse, no in-memory buffer). We never poll and never rewrite the file, so
// the running cost is effectively zero until something actually changes.

export type ChangeCategory = 'hosts' | 'firewall' | 'policy' | 'startup' | 'system'

export interface ChangeEntry {
  ts: number
  category: ChangeCategory
  action: string        // 'block' | 'unblock' | 'apply' | 'remove' | 'clear' | 'revert-all' | …
  target?: string       // domain / rule / registry key affected
  detail?: string
}

function dataDir(): string {
  // Mirror store.ts: pin to a fixed absolute path on Windows so the journal always
  // lands in the same place regardless of app.setPath timing.
  if (platform === 'win32') return join('C:\\ProgramData', 'Attentify')
  try { return app.getPath('userData') } catch { return join(process.cwd(), '.attentify') }
}

function journalPath(): string {
  const dir = dataDir()
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  return join(dir, 'change-journal.jsonl')
}

/** Append one change. Never throws — journaling must not break a real operation. */
export function recordChange(entry: Omit<ChangeEntry, 'ts'>): void {
  try {
    appendFileSync(journalPath(), JSON.stringify({ ts: Date.now(), ...entry }) + '\n', 'utf-8')
  } catch { /* non-fatal */ }
}

/** Most-recent-first list of changes (capped) for the recovery UI. */
export function readChanges(limit = 250): ChangeEntry[] {
  try {
    const lines = readFileSync(journalPath(), 'utf-8').split('\n').filter(Boolean)
    const out: ChangeEntry[] = []
    for (const l of lines.slice(-limit)) {
      try { out.push(JSON.parse(l) as ChangeEntry) } catch { /* skip corrupt line */ }
    }
    return out.reverse()
  } catch { return [] }
}

/** Cheap count of recorded changes (used for the "N changes recorded" status). */
export function changeCount(): number {
  try {
    return readFileSync(journalPath(), 'utf-8').split('\n').filter(Boolean).length
  } catch { return 0 }
}

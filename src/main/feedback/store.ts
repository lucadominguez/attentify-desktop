import { randomUUID } from 'crypto'
import { getDb, markDirty } from '../data/db'

// Persistence for the decision log and the feedback stream. Kept out of the big
// repository.ts on purpose: this is one cohesive subsystem (log a decision → attach the
// user's reaction → review), and colocating its storage with its callers keeps it legible.
//
// Every function here is defensive. A logging or feedback failure must NEVER propagate into
// the blocking path — recording that a decision happened is strictly less important than
// the decision itself.

export interface DecisionRow {
  id: string
  ts: number
  target_type: 'domain' | 'app'
  target_value: string
  category?: string
  action: 'auto_block' | 'suggest' | 'skip'
  confidence: number
  policy_weight?: number
  source?: string
  reasoning?: string
  goal_id?: string
  goal_text?: string
  fingerprint?: string
  features?: Record<string, unknown>
  classifier_version?: string
  outcome?: 'agree' | 'disagree' | 'override' | 'ignored'
  outcome_at?: number
}

export interface FeedbackRow {
  id: string
  ts: number
  decision_id?: string
  target_type?: string
  target_value?: string
  fingerprint?: string
  signal: string
  user_decision: 'agree' | 'disagree' | 'override'
  goal_id?: string
  latency_ms?: number
  note?: string
  reviewed?: number
}

// ── Decisions ───────────────────────────────────────────────────────────────────

export function insertDecision(d: Omit<DecisionRow, 'id' | 'ts'> & { id?: string; ts?: number }): string {
  const id = d.id ?? randomUUID()
  try {
    getDb().run(
      `INSERT INTO classification_decisions
       (id,ts,target_type,target_value,category,action,confidence,policy_weight,source,reasoning,goal_id,goal_text,fingerprint,features,classifier_version)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        id, d.ts ?? Date.now(), d.target_type, d.target_value, d.category ?? null, d.action,
        d.confidence, d.policy_weight ?? null, d.source ?? null, d.reasoning ?? null,
        d.goal_id ?? null, d.goal_text ?? null, d.fingerprint ?? null,
        d.features != null ? JSON.stringify(d.features) : null, d.classifier_version ?? null,
      ]
    )
    // Bound the table: this can log on every navigation, so cap it hard.
    getDb().run('DELETE FROM classification_decisions WHERE id NOT IN (SELECT id FROM classification_decisions ORDER BY ts DESC LIMIT 5000)')
    markDirty()
  } catch { /* logging must never break blocking */ }
  return id
}

// The most recent decision for a target within a window — used to attach feedback when the
// caller (e.g. an unblock click) knows the domain but not the decision id.
export function findRecentDecision(targetValue: string, withinMs = 6 * 60 * 60 * 1000): DecisionRow | null {
  try {
    const rows = getDb().exec(
      'SELECT * FROM classification_decisions WHERE target_value=? AND ts > ? ORDER BY ts DESC LIMIT 1',
      [targetValue, Date.now() - withinMs]
    )
    const r = rows[0]?.values?.[0]
    return r ? mapDecision(rows[0].columns, r) : null
  } catch { return null }
}

export function attachOutcome(decisionId: string, outcome: DecisionRow['outcome']): void {
  try {
    getDb().run('UPDATE classification_decisions SET outcome=?, outcome_at=? WHERE id=?', [outcome ?? null, Date.now(), decisionId])
    markDirty()
  } catch { /* best-effort */ }
}

// Decisions that carry an outcome, for calibration. Only rows the user actually reacted to
// tell us whether the score meant anything.
export function getResolvedDecisions(sinceMs: number, limit = 2000): DecisionRow[] {
  try {
    const rows = getDb().exec(
      'SELECT * FROM classification_decisions WHERE outcome IS NOT NULL AND ts > ? ORDER BY ts DESC LIMIT ?',
      [sinceMs, limit]
    )
    if (!rows[0]) return []
    return rows[0].values.map((r: unknown[]) => mapDecision(rows[0].columns, r))
  } catch { return [] }
}

function mapDecision(cols: string[], r: unknown[]): DecisionRow {
  const o: Record<string, unknown> = {}
  cols.forEach((c, i) => { o[c] = r[i] })
  return {
    id: o.id as string, ts: o.ts as number,
    target_type: o.target_type as DecisionRow['target_type'], target_value: o.target_value as string,
    category: (o.category as string) ?? undefined, action: o.action as DecisionRow['action'],
    confidence: o.confidence as number, policy_weight: (o.policy_weight as number) ?? undefined,
    source: (o.source as string) ?? undefined, reasoning: (o.reasoning as string) ?? undefined,
    goal_id: (o.goal_id as string) ?? undefined, goal_text: (o.goal_text as string) ?? undefined,
    fingerprint: (o.fingerprint as string) ?? undefined,
    features: o.features ? safeParse(o.features as string) : undefined,
    classifier_version: (o.classifier_version as string) ?? undefined,
    outcome: (o.outcome as DecisionRow['outcome']) ?? undefined, outcome_at: (o.outcome_at as number) ?? undefined,
  }
}

// ── Feedback ──────────────────────────────────────────────────────────────────

export function insertFeedback(f: Omit<FeedbackRow, 'id' | 'ts'> & { id?: string; ts?: number }): string {
  const id = f.id ?? randomUUID()
  try {
    getDb().run(
      `INSERT INTO classification_feedback
       (id,ts,decision_id,target_type,target_value,fingerprint,signal,user_decision,goal_id,latency_ms,note,reviewed)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,0)`,
      [
        id, f.ts ?? Date.now(), f.decision_id ?? null, f.target_type ?? null, f.target_value ?? null,
        f.fingerprint ?? null, f.signal, f.user_decision, f.goal_id ?? null,
        f.latency_ms ?? null, f.note ?? null,
      ]
    )
    getDb().run('DELETE FROM classification_feedback WHERE id NOT IN (SELECT id FROM classification_feedback ORDER BY ts DESC LIMIT 3000)')
    markDirty()
  } catch { /* best-effort */ }
  return id
}

// Unreviewed disagreements, joined to the decision that caused them so the reviewer has the
// full feature context in one row. Agreements are recorded too (for calibration) but the
// reviewer only reads disagreements/overrides — those are the candidate mistakes.
export interface FeedbackWithDecision extends FeedbackRow {
  d_category?: string
  d_confidence?: number
  d_policy_weight?: number
  d_action?: string
  d_source?: string
  d_reasoning?: string
  d_goal_text?: string
  d_features?: Record<string, unknown>
}

export function getUnreviewedDisagreements(limit = 40): FeedbackWithDecision[] {
  try {
    const rows = getDb().exec(
      `SELECT f.id,f.ts,f.decision_id,f.target_type,f.target_value,f.fingerprint,f.signal,f.user_decision,f.goal_id,f.latency_ms,f.note,
              d.category,d.confidence,d.policy_weight,d.action,d.source,d.reasoning,d.goal_text,d.features
       FROM classification_feedback f
       LEFT JOIN classification_decisions d ON d.id = f.decision_id
       WHERE f.reviewed = 0 AND f.user_decision IN ('disagree','override')
       ORDER BY f.ts DESC LIMIT ?`,
      [limit]
    )
    if (!rows[0]) return []
    return rows[0].values.map((r: unknown[]) => ({
      id: r[0] as string, ts: r[1] as number, decision_id: (r[2] as string) ?? undefined,
      target_type: (r[3] as string) ?? undefined, target_value: (r[4] as string) ?? undefined,
      fingerprint: (r[5] as string) ?? undefined, signal: r[6] as string,
      user_decision: r[7] as FeedbackRow['user_decision'], goal_id: (r[8] as string) ?? undefined,
      latency_ms: (r[9] as number) ?? undefined, note: (r[10] as string) ?? undefined,
      d_category: (r[11] as string) ?? undefined, d_confidence: (r[12] as number) ?? undefined,
      d_policy_weight: (r[13] as number) ?? undefined, d_action: (r[14] as string) ?? undefined,
      d_source: (r[15] as string) ?? undefined, d_reasoning: (r[16] as string) ?? undefined,
      d_goal_text: (r[17] as string) ?? undefined,
      d_features: r[18] ? safeParse(r[18] as string) : undefined,
    }))
  } catch { return [] }
}

export function markFeedbackReviewed(ids: string[]): void {
  if (ids.length === 0) return
  try {
    const placeholders = ids.map(() => '?').join(',')
    getDb().run(`UPDATE classification_feedback SET reviewed=1 WHERE id IN (${placeholders})`, ids)
    markDirty()
  } catch { /* best-effort */ }
}

// Invalidate the "agree" verdict for a context the user just corrected: any cached-as-fine
// decision for the same fingerprint should no longer count as agreement. Cheap version of
// the text's "explicit corrections invalidate related cache entries".
export function countFeedback(sinceMs: number): { agree: number; disagree: number; override: number } {
  const out = { agree: 0, disagree: 0, override: 0 }
  try {
    const rows = getDb().exec(
      "SELECT user_decision, COUNT(*) FROM classification_feedback WHERE ts > ? GROUP BY user_decision",
      [sinceMs]
    )
    for (const r of rows[0]?.values ?? []) {
      const k = r[0] as keyof typeof out
      if (k in out) out[k] = r[1] as number
    }
  } catch { /* best-effort */ }
  return out
}

function safeParse(s: string): Record<string, unknown> | undefined {
  try { return JSON.parse(s) } catch { return undefined }
}

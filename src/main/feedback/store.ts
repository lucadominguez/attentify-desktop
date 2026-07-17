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
  component?: string
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
       (id,ts,component,target_type,target_value,category,action,confidence,policy_weight,source,reasoning,goal_id,goal_text,fingerprint,features,classifier_version)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        id, d.ts ?? Date.now(), d.component ?? 'distraction_classifier', d.target_type, d.target_value,
        d.category ?? null, d.action, d.confidence, d.policy_weight ?? null, d.source ?? null,
        d.reasoning ?? null, d.goal_id ?? null, d.goal_text ?? null, d.fingerprint ?? null,
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
    // Only REAL user reactions calibrate the score. Shadow-audit outcomes (audit_ok /
    // audit_error) live in the same column but must never count as user agreement.
    const rows = getDb().exec(
      "SELECT * FROM classification_decisions WHERE outcome IN ('agree','disagree','override') AND ts > ? ORDER BY ts DESC LIMIT ?",
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
    id: o.id as string, ts: o.ts as number, component: (o.component as string) ?? undefined,
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

// ── Learned adjustments (scoped correction memory) ──────────────────────────────

export interface AdjustmentRow {
  id: string
  ts: number
  scope: 'route' | 'domain_goal' | 'domain' | 'global'
  scope_key: string
  target_value?: string
  goal_id?: string
  kind: 'suppress' | 'downweight'
  weight_delta?: number
  reason?: string
  source?: string
  error_prob?: number
  support: number
  active: number
  updated_at?: number
  expires_at?: number
}

// Insert, or reinforce an existing adjustment for the same scope_key+kind (bumping its
// support and recency). Reinforcement is what later licenses widening the scope.
export function upsertAdjustment(a: Omit<AdjustmentRow, 'id' | 'ts' | 'support' | 'active'> & { id?: string; ts?: number }): { id: string; support: number } {
  try {
    const existing = getDb().exec(
      "SELECT id, support FROM learned_adjustments WHERE scope_key=? AND kind=? AND active=1 LIMIT 1",
      [a.scope_key, a.kind]
    )
    const row = existing[0]?.values?.[0]
    if (row) {
      const id = row[0] as string
      const support = (row[1] as number) + 1
      // A reinforced correction becomes PERMANENT: clear any cooldown expiry. One reversal
      // is a 24h cooldown; a second reversal on the same context makes it stick for good.
      getDb().run('UPDATE learned_adjustments SET support=?, updated_at=?, error_prob=?, reason=?, expires_at=NULL WHERE id=?',
        [support, Date.now(), a.error_prob ?? null, a.reason ?? null, id])
      markDirty()
      return { id, support }
    }
    const id = a.id ?? randomUUID()
    getDb().run(
      `INSERT INTO learned_adjustments (id,ts,scope,scope_key,target_value,goal_id,kind,weight_delta,reason,source,error_prob,support,active,updated_at,expires_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,1,1,?,?)`,
      [id, a.ts ?? Date.now(), a.scope, a.scope_key, a.target_value ?? null, a.goal_id ?? null,
       a.kind, a.weight_delta ?? null, a.reason ?? null, a.source ?? null, a.error_prob ?? null,
       Date.now(), a.expires_at ?? null]
    )
    markDirty()
    return { id, support: 1 }
  } catch { return { id: a.id ?? 'err', support: 0 } }
}

// Adjustments that apply to a context, matched ONLY by the exact scope keys the caller
// supplies (route fingerprint, domain|goal, and domain). Matching on the bare target_value
// would leak a narrowly-scoped correction — "youtube is fine for THIS goal" — onto every
// goal, since a domain-scoped row's key already IS the domain and is passed explicitly.
export function findAdjustments(_targetValue: string, scopeKeys: string[]): AdjustmentRow[] {
  try {
    const keys = [...new Set(scopeKeys)].filter(Boolean)
    if (keys.length === 0) return []
    const ph = keys.map(() => '?').join(',')
    const rows = getDb().exec(
      `SELECT * FROM learned_adjustments WHERE active=1 AND scope_key IN (${ph}) AND (expires_at IS NULL OR expires_at > ?)`,
      [...keys, Date.now()]
    )
    if (!rows[0]) return []
    return rows[0].values.map((r: unknown[]) => mapAdjustment(rows[0].columns, r))
  } catch { return [] }
}

export function listAdjustments(limit = 100): AdjustmentRow[] {
  try {
    const rows = getDb().exec('SELECT * FROM learned_adjustments WHERE active=1 ORDER BY updated_at DESC, ts DESC LIMIT ?', [limit])
    if (!rows[0]) return []
    return rows[0].values.map((r: unknown[]) => mapAdjustment(rows[0].columns, r))
  } catch { return [] }
}

function mapAdjustment(cols: string[], r: unknown[]): AdjustmentRow {
  const o: Record<string, unknown> = {}
  cols.forEach((c, i) => { o[c] = r[i] })
  return {
    id: o.id as string, ts: o.ts as number, scope: o.scope as AdjustmentRow['scope'],
    scope_key: o.scope_key as string, target_value: (o.target_value as string) ?? undefined,
    goal_id: (o.goal_id as string) ?? undefined, kind: o.kind as AdjustmentRow['kind'],
    weight_delta: (o.weight_delta as number) ?? undefined, reason: (o.reason as string) ?? undefined,
    source: (o.source as string) ?? undefined, error_prob: (o.error_prob as number) ?? undefined,
    support: o.support as number, active: o.active as number,
    updated_at: (o.updated_at as number) ?? undefined, expires_at: (o.expires_at as number) ?? undefined,
  }
}

// Recent disagreement signals for one fingerprint — the raw evidence the hypothesis engine
// weights. Includes the signal type and whether goals differed across occurrences (which
// governs how wide a correction may generalize).
export function feedbackForFingerprint(fingerprint: string, withinMs = 30 * 24 * 3600_000): FeedbackRow[] {
  try {
    const rows = getDb().exec(
      "SELECT id,ts,decision_id,target_type,target_value,fingerprint,signal,user_decision,goal_id,latency_ms,note FROM classification_feedback WHERE fingerprint=? AND ts > ? ORDER BY ts DESC LIMIT 50",
      [fingerprint, Date.now() - withinMs]
    )
    if (!rows[0]) return []
    return rows[0].values.map((r: unknown[]) => ({
      id: r[0] as string, ts: r[1] as number, decision_id: (r[2] as string) ?? undefined,
      target_type: (r[3] as string) ?? undefined, target_value: (r[4] as string) ?? undefined,
      fingerprint: (r[5] as string) ?? undefined, signal: r[6] as string,
      user_decision: r[7] as FeedbackRow['user_decision'], goal_id: (r[8] as string) ?? undefined,
      latency_ms: (r[9] as number) ?? undefined, note: (r[10] as string) ?? undefined,
    }))
  } catch { return [] }
}

// ── Error hypotheses (engineering diagnosis) ────────────────────────────────────

export interface HypothesisRow {
  id: string
  ts: number
  decision_id?: string
  component?: string
  target_value?: string
  fingerprint?: string
  error_prob: number
  failure_stage?: string
  failure_mode?: string
  severity?: string
  evidence?: unknown
  status?: string
  recovered?: number
}

export function insertHypothesis(h: Omit<HypothesisRow, 'id' | 'ts'> & { id?: string; ts?: number }): string {
  const id = h.id ?? randomUUID()
  try {
    getDb().run(
      `INSERT INTO error_hypotheses (id,ts,decision_id,component,target_value,fingerprint,error_prob,failure_stage,failure_mode,severity,evidence,status,recovered)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [id, h.ts ?? Date.now(), h.decision_id ?? null, h.component ?? null, h.target_value ?? null,
       h.fingerprint ?? null, h.error_prob, h.failure_stage ?? null, h.failure_mode ?? null,
       h.severity ?? null, h.evidence != null ? JSON.stringify(h.evidence) : null,
       h.status ?? 'suspected', h.recovered ? 1 : 0]
    )
    getDb().run('DELETE FROM error_hypotheses WHERE id NOT IN (SELECT id FROM error_hypotheses ORDER BY ts DESC LIMIT 2000)')
    markDirty()
  } catch { /* best-effort */ }
  return id
}

// Per-signal reliability, learned from history: of the decisions a given feedback signal
// was attached to, how often did their outcome end up a disagreement? This is what turns
// the hand-set signal weights into data-calibrated ones once there is volume.
export function signalOutcomeStats(sinceMs: number): Record<string, { total: number; disagree: number }> {
  const out: Record<string, { total: number; disagree: number }> = {}
  try {
    const rows = getDb().exec(
      `SELECT signal,
              COUNT(*) AS n,
              SUM(CASE WHEN user_decision IN ('disagree','override') THEN 1 ELSE 0 END) AS dis
       FROM classification_feedback WHERE ts > ? GROUP BY signal`,
      [sinceMs]
    )
    for (const r of rows[0]?.values ?? []) {
      out[r[0] as string] = { total: r[1] as number, disagree: r[2] as number }
    }
  } catch { /* best-effort */ }
  return out
}

// Has the deterministic loop already confirmed an error for this context? Used to keep the
// LLM reviewer from filing a second, duplicate issue for something already handled.
export function confirmedHypothesisExists(fingerprint: string, sinceMs: number): boolean {
  try {
    const rows = getDb().exec(
      "SELECT 1 FROM error_hypotheses WHERE fingerprint=? AND status IN ('confirmed','corrected') AND ts > ? LIMIT 1",
      [fingerprint, sinceMs]
    )
    return !!rows[0]?.values?.length
  } catch { return false }
}

// Decisions the user never reacted to, old enough that they had the chance — the candidates
// for shadow auditing of SILENT errors. Oversamples the risky kinds (auto-blocks and
// low-confidence calls) by ordering them first.
export function getUnreactedDecisions(olderThanMs: number, limit = 40): DecisionRow[] {
  try {
    const cutoff = Date.now() - olderThanMs
    const rows = getDb().exec(
      `SELECT * FROM classification_decisions
       WHERE outcome IS NULL AND action IN ('auto_block','suggest') AND ts < ?
       ORDER BY (CASE WHEN action='auto_block' THEN 0 ELSE 1 END), ABS(confidence-0.7) ASC, ts DESC
       LIMIT ?`,
      [cutoff, limit]
    )
    if (!rows[0]) return []
    return rows[0].values.map((r: unknown[]) => mapDecision(rows[0].columns, r))
  } catch { return [] }
}

// Mark a decision audited (reuse the outcome column with a distinct value so it is not
// re-audited, without pretending the user reacted).
export function markDecisionAudited(id: string, silentError: boolean): void {
  try {
    getDb().run('UPDATE classification_decisions SET outcome=?, outcome_at=? WHERE id=?',
      [silentError ? 'audit_error' : 'audit_ok', Date.now(), id])
    markDirty()
  } catch { /* best-effort */ }
}

function safeParse(s: string): Record<string, unknown> | undefined {
  try { return JSON.parse(s) } catch { return undefined }
}

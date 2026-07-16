import { contextFingerprint, contextTokens, CLASSIFIER_VERSION } from './fingerprint'
import {
  insertDecision, findRecentDecision, attachOutcome, insertFeedback,
  getResolvedDecisions, type DecisionRow,
} from './store'
import type { CalibrationBucket, CategoryCalibration, CalibrationReport } from '../../shared/types'

// The public surface the rest of the app uses. Callers deal in "a decision was made" and
// "the user reacted"; fingerprinting, linking, and outcome bookkeeping live here.

export interface RecordDecisionInput {
  targetType: 'domain' | 'app'
  targetValue: string
  action: 'auto_block' | 'suggest' | 'skip'
  confidence: number
  policyWeight?: number       // the hand-set category base score, kept separate from confidence
  category?: string
  source?: string
  reasoning?: string
  goalId?: string
  goalText?: string
  url?: string                // to derive path-aware fingerprint identity
  features?: Record<string, unknown>
}

// Log a classification decision. Returns the decision id so a caller can link an
// immediate reaction to it. Never throws.
export function recordDecision(input: RecordDecisionInput): string {
  const tokens = input.url ? contextTokens(input.url) : { registeredDomain: input.targetValue, pathClass: '-' }
  const fingerprint = contextFingerprint({
    registeredDomain: tokens.registeredDomain || input.targetValue,
    pathClass: tokens.pathClass,
    goalId: input.goalId,
  })
  return insertDecision({
    target_type: input.targetType,
    target_value: input.targetValue,
    category: input.category,
    action: input.action,
    confidence: input.confidence,
    policy_weight: input.policyWeight,
    source: input.source,
    reasoning: input.reasoning,
    goal_id: input.goalId,
    goal_text: input.goalText,
    fingerprint,
    classifier_version: CLASSIFIER_VERSION,
    features: {
      registeredDomain: tokens.registeredDomain,
      pathClass: tokens.pathClass,
      ...(input.features ?? {}),
    },
  })
}

const SIGNAL_DECISION: Record<string, 'agree' | 'disagree' | 'override'> = {
  bypass: 'disagree',
  quick_unblock: 'override',
  inference_rejected: 'disagree',
  inference_confirmed: 'agree',
  interstitial_proceed: 'override',
  nudge_dismissed: 'disagree',      // dismissing a flag/nudge is weak disagreement
  nudge_acted: 'agree',
}

export interface RecordFeedbackInput {
  targetType?: 'domain' | 'app'
  targetValue?: string
  signal: keyof typeof SIGNAL_DECISION
  goalId?: string
  note?: string
}

// Record a user reaction and, when possible, attach it to the decision that caused it. The
// decision's outcome column is updated so calibration can read it directly. Never throws.
export function recordFeedback(input: RecordFeedbackInput): void {
  const userDecision = SIGNAL_DECISION[input.signal] ?? 'disagree'
  let decisionId: string | undefined
  let fingerprint: string | undefined
  let latencyMs: number | undefined

  if (input.targetValue) {
    const dec = findRecentDecision(input.targetValue)
    if (dec) {
      decisionId = dec.id
      fingerprint = dec.fingerprint
      latencyMs = Date.now() - dec.ts
      attachOutcome(dec.id, userDecision)
    }
  }

  insertFeedback({
    decision_id: decisionId,
    target_type: input.targetType,
    target_value: input.targetValue,
    fingerprint,
    signal: input.signal,
    user_decision: userDecision,
    goal_id: input.goalId,
    latency_ms: latencyMs,
    note: input.note,
  })
}

// ── Calibration ─────────────────────────────────────────────────────────────────
// The aggregate mistake signal: for decisions the user actually reacted to, does a given
// confidence band behave like its number claims? A well-calibrated 0.80 band should be
// disagreed with ~20% of the time. Also broken out per category to surface ones that fail
// systematically. This needs volume to mean anything; with little data it just reports the
// counts honestly rather than pretending to a calibration curve.

export function computeCalibration(windowDays = 30): CalibrationReport {
  const since = Date.now() - windowDays * 24 * 3600_000
  const rows = getResolvedDecisions(since)
  const isDisagree = (d: DecisionRow): boolean => d.outcome === 'disagree' || d.outcome === 'override'

  const bands = [
    { band: '0.45-0.60', lo: 0.45, hi: 0.60 },
    { band: '0.60-0.75', lo: 0.60, hi: 0.75 },
    { band: '0.75-0.85', lo: 0.75, hi: 0.85 },
    { band: '0.85-0.95', lo: 0.85, hi: 0.95 },
    { band: '0.95-1.00', lo: 0.95, hi: 1.01 },
  ]
  const buckets: CalibrationBucket[] = bands.map(({ band, lo, hi }) => {
    const inBand = rows.filter((d) => d.confidence >= lo && d.confidence < hi)
    const n = inBand.length
    const dis = inBand.filter(isDisagree).length
    const rate = n ? dis / n : 0
    const mid = (lo + Math.min(hi, 1)) / 2
    const expected = 1 - mid
    return { band, lo, n, disagreementRate: round(rate), expectedDisagreement: round(expected), gap: round(rate - expected) }
  })

  const byCat = new Map<string, { n: number; dis: number }>()
  for (const d of rows) {
    const c = d.category || 'unknown'
    const e = byCat.get(c) ?? { n: 0, dis: 0 }
    e.n++; if (isDisagree(d)) e.dis++
    byCat.set(c, e)
  }
  const categories: CategoryCalibration[] = [...byCat.entries()]
    .map(([category, { n, dis }]) => ({ category, n, disagreementRate: round(dis / n) }))
    .sort((a, b) => b.disagreementRate - a.disagreementRate)

  // Only nominate a "worst" category once there is enough of it to not be noise.
  const worstCategory = categories.find((c) => c.n >= 5 && c.disagreementRate >= 0.4)

  return {
    windowDays,
    totalResolved: rows.length,
    buckets,
    categories,
    worstCategory,
    generatedAt: Date.now(),
  }
}

function round(n: number): number { return Math.round(n * 100) / 100 }

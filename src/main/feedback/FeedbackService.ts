import { contextFingerprint, contextTokens, CLASSIFIER_VERSION } from './fingerprint'
import {
  insertDecision, findRecentDecision, attachOutcome, insertFeedback,
  getResolvedDecisions, feedbackForFingerprint, upsertAdjustment, findAdjustments,
  insertHypothesis, signalOutcomeStats, type DecisionRow, type AdjustmentRow,
} from './store'
import { estimateError, setLearnedWeights, type ErrorHypothesis } from './ErrorHypothesis'
import { debugLog } from '../debug/logger'
import type { CalibrationBucket, CategoryCalibration, CalibrationReport } from '../../shared/types'

// The probability at which accumulated disagreement is treated as a real error worth
// correcting. Deliberately high: a false correction (learning to stop blocking a genuine
// distraction) is worse here than a missed one, matching the "precision over recall" call.
const CORRECTION_THRESHOLD = 0.8

// Recovery hook: unblock a domain the classifier wrongly auto-blocked. Set by ipc.ts, which
// owns the blocking engine; kept as a hook to avoid a module cycle. Returns whether it acted.
let recoveryHook: ((domain: string) => boolean) | null = null
export function setRecoveryHook(fn: (domain: string) => boolean): void { recoveryHook = fn }

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
  // Which AI subsystem made this call. Defaults to the distraction classifier; the ledger
  // spans agent check-ins and notifications too, so error detection is not classifier-only.
  component?: string
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
    component: input.component,
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
  nudge_dismissed: 'disagree',        // dismissing a flag/nudge is weak disagreement
  nudge_acted: 'agree',
  proactive_dismissed: 'disagree',    // dismissed an agent check-in
  proactive_acted: 'agree',
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

  // Close the loop immediately and deterministically (no AI): a disagreement may already be
  // enough evidence to correct. The LLM reviewer later adds the categorized explanation,
  // but the correction + recovery must not wait on budget.
  if (userDecision !== 'agree' && input.targetValue && fingerprint) {
    try { evaluateAndCorrect(input.targetType ?? 'domain', input.targetValue, fingerprint, input.goalId) } catch { /* never break the reaction path */ }
  }
}

// ── Scoped correction memory ─────────────────────────────────────────────────────
// Turn accumulated disagreement into a learned exception at the NARROWEST scope the
// evidence supports, widening only when repeated corrections across different goals agree.

interface ScopeKeys { route: string; domainGoal: string; domain: string }

function scopeKeysFor(domain: string, fingerprint: string, goalId?: string): ScopeKeys {
  return { route: fingerprint, domainGoal: `${domain}|${goalId ?? '-'}`, domain }
}

// Consulted by the classifier BEFORE it decides. Returns the strongest applicable
// correction: a suppress (do not auto-block this context) or a confidence downweight.
export function getApplicableAdjustment(
  targetValue: string,
  url?: string,
  goalId?: string
): { suppress: boolean; downweight: number; reason?: string } {
  const tokens = url ? contextTokens(url) : { registeredDomain: targetValue, pathClass: '-' }
  const domain = tokens.registeredDomain || targetValue
  const fp = contextFingerprint({ registeredDomain: domain, pathClass: tokens.pathClass, goalId })
  const keys = scopeKeysFor(domain, fp, goalId)
  const rows = findAdjustments(targetValue, [keys.route, keys.domainGoal, keys.domain])
  if (rows.length === 0) return { suppress: false, downweight: 0 }
  let suppress = false
  let downweight = 0
  let reason: string | undefined
  for (const a of rows) {
    if (a.kind === 'suppress') { suppress = true; reason = a.reason }
    else if (a.kind === 'downweight') downweight = Math.max(downweight, a.weight_delta ?? 0)
  }
  return { suppress, downweight, reason }
}

// The heart of the closed loop: given fresh disagreement on a context, aggregate ALL its
// evidence, decide if it crosses the error threshold, and if so learn a scoped exception,
// record the engineering hypothesis, and recover (unblock) if the domain is blocked now.
export function evaluateAndCorrect(
  targetType: 'domain' | 'app',
  targetValue: string,
  fingerprint: string,
  goalId?: string
): { hypothesis: ErrorHypothesis; corrected: boolean; recovered: boolean } | null {
  const feedback = feedbackForFingerprint(fingerprint)
  const decision = findRecentDecision(targetValue)
  const hyp = estimateError(feedback, decision ? {
    category: decision.category, goalText: decision.goal_text,
    confidence: decision.confidence, features: decision.features,
  } : undefined)

  insertHypothesis({
    decision_id: decision?.id,
    component: 'distraction_classifier',
    target_value: targetValue,
    fingerprint,
    error_prob: hyp.errorProbability,
    failure_stage: hyp.failureStage,
    failure_mode: hyp.failureMode,
    severity: hyp.severity,
    evidence: hyp.evidence,
    status: hyp.errorProbability >= CORRECTION_THRESHOLD ? 'confirmed' : 'suspected',
  })

  if (hyp.errorProbability < CORRECTION_THRESHOLD) return { hypothesis: hyp, corrected: false, recovered: false }

  // Scope selection. Disagreement that spans several goals is about the SITE, not one task,
  // so it generalizes to the domain. A single-goal correction stays route/goal-scoped so a
  // youtube tutorial being fine for coding never teaches "all youtube is fine".
  const domain = decision?.features?.registeredDomain as string || targetValue
  const keys = scopeKeysFor(domain, fingerprint, goalId)
  const wideEnough = hyp.distinctGoals >= 2
  const scope: AdjustmentRow['scope'] = wideEnough ? 'domain' : (goalId ? 'domain_goal' : 'route')
  const scopeKey = scope === 'domain' ? keys.domain : scope === 'domain_goal' ? keys.domainGoal : keys.route

  const res = upsertAdjustment({
    scope, scope_key: scopeKey, target_value: targetValue, goal_id: goalId,
    kind: 'suppress',
    reason: `${hyp.failureMode} (${hyp.failureStage}); user reversed ${feedback.length}x so far, p(err)=${hyp.errorProbability}`,
    source: 'behavioural', error_prob: hyp.errorProbability,
  })

  // Recovery: if this domain is auto-blocked right now, the correct repair is to lift it.
  let recovered = false
  if (targetType === 'domain' && recoveryHook) {
    try { recovered = recoveryHook(targetValue) } catch { recovered = false }
  }

  debugLog('feedback:corrected', { target: targetValue, scope, support: res.support, pErr: hyp.errorProbability, recovered })
  return { hypothesis: hyp, corrected: true, recovered }
}

// ── Calibration ─────────────────────────────────────────────────────────────────
// The aggregate mistake signal: for decisions the user actually reacted to, does a given
// confidence band behave like its number claims? A well-calibrated 0.80 band should be
// disagreed with ~20% of the time. Also broken out per category to surface ones that fail
// systematically. This needs volume to mean anything; with little data it just reports the
// counts honestly rather than pretending to a calibration curve.

// Recompute the data-learned signal weights from the last 30 days and push them into the
// hypothesis engine. Cheap; called on the calibration timer. With no history it is a no-op
// and the hand-set priors stand.
export function refreshLearnedWeights(windowDays = 30): void {
  try { setLearnedWeights(signalOutcomeStats(Date.now() - windowDays * 24 * 3600_000)) } catch { /* keep priors */ }
}

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

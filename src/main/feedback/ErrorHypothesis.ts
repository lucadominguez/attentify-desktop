import type { FeedbackRow } from './store'

// Turns raw disagreement signals into a calibrated error hypothesis, deterministically and
// without an LLM. This is the difference the spec asked for: one signal does not declare an
// error; evidence accumulates into a probability, and a probability crosses a threshold.
//
// The weights are log-odds contributions. They start hand-set (and are documented as such,
// not dressed up as learned) and are meant to be calibrated from labeled outcomes later.

// Prior: absent any evidence, a logged decision is probably NOT an error. -2.2 log-odds ≈ 0.10.
const PRIOR_LOG_ODDS = -2.2

// Per-signal strength. Pushing past a block or explicitly rejecting is near-conclusive;
// dismissing a soft nudge barely moves the needle (people dismiss things they agree with).
const SIGNAL_WEIGHT: Record<string, number> = {
  interstitial_proceed: 2.4,   // walked through a wall — the strongest wordless "you're wrong"
  quick_unblock: 2.2,          // removed an auto-block the app just added
  inference_rejected: 2.0,     // explicit "no, don't block this"
  bypass: 1.4,                 // tried to get around an element block
  nudge_dismissed: 0.5,        // weak: dismissal is not disagreement
  inference_confirmed: -2.5,   // explicit agreement pulls the other way
  nudge_acted: -1.5,
}

// Repeated occurrences of the same signal accumulate with geometric decay: the 2nd counts
// 0.6, the 3rd 0.36, and so on, capped at a 2.5x total. So one rejection is weak evidence,
// three rejections are strong, and a stuck loop of fifty can't manufacture false certainty.
function occurrenceFactor(occurrences: number): number {
  const decay = 0.6
  // (1 - decay^n) / (1 - decay), the geometric sum, naturally capped at 1/(1-decay)=2.5.
  return (1 - Math.pow(decay, occurrences)) / (1 - decay)
}

export type FailureStage = 'context_capture' | 'intent_inference' | 'classification' | 'policy' | 'unknown'
export type FailureMode =
  | 'false_positive' | 'false_negative' | 'misinterpretation' | 'ignored_constraint'
  | 'missing_context' | 'overconfidence' | 'wrong_category' | 'other'

export interface EvidenceItem { type: string; strength: number; ts: number }

export interface ErrorHypothesis {
  errorProbability: number
  failureStage: FailureStage
  failureMode: FailureMode
  severity: 'low' | 'medium' | 'high'
  evidence: EvidenceItem[]
  distinctGoals: number       // how many different goals the disagreement spanned — governs scope
}

function sigmoid(x: number): number { return 1 / (1 + Math.exp(-x)) }

// Aggregate a set of feedback rows (all for one context/fingerprint) into a hypothesis.
export function estimateError(feedback: FeedbackRow[], decision?: { category?: string; goalText?: string; confidence?: number; features?: Record<string, unknown> }): ErrorHypothesis {
  let logOdds = PRIOR_LOG_ODDS
  const bySignal = new Map<string, number>()
  const evidence: EvidenceItem[] = []
  const goals = new Set<string>()

  for (const f of feedback) {
    bySignal.set(f.signal, (bySignal.get(f.signal) ?? 0) + 1)
    if (f.goal_id) goals.add(f.goal_id)
  }
  for (const [signal, count] of bySignal) {
    const w = SIGNAL_WEIGHT[signal] ?? 0.3
    logOdds += w * occurrenceFactor(count)
    evidence.push({ type: signal, strength: round(sigmoid(w) * 2 - 1), ts: Date.now() })
  }
  // Internal-disagreement evidence: a HIGH-confidence decision that the user still reversed
  // is worse than a borderline one — it means the score was not just wrong but overconfident.
  if (decision?.confidence != null && decision.confidence >= 0.9 && logOdds > PRIOR_LOG_ODDS) {
    logOdds += 0.5
    evidence.push({ type: 'overconfident_reversal', strength: 0.5, ts: Date.now() })
  }

  const errorProbability = round(sigmoid(logOdds))
  const { failureStage, failureMode } = diagnose(feedback, decision)
  const severity = errorProbability >= 0.85 ? 'high' : errorProbability >= 0.65 ? 'medium' : 'low'

  return { errorProbability, failureStage, failureMode, severity, evidence, distinctGoals: goals.size }
}

// Map the shape of the disagreement to WHERE and HOW it failed. Heuristic, deliberately
// coarse — the LLM reviewer refines the label when budget allows, but this always runs.
function diagnose(feedback: FeedbackRow[], decision?: { category?: string; goalText?: string; features?: Record<string, unknown> }): { failureStage: FailureStage; failureMode: FailureMode } {
  const signals = new Set(feedback.map((f) => f.signal))
  const hadGoal = !!decision?.goalText
  const pathClass = decision?.features?.pathClass as string | undefined

  // A block reversed while a goal was active, on a route that often carries on-task content
  // (a watch page, a technical subreddit) → the page was probably fine FOR THIS TASK: the
  // failure is upstream, at goal/intent, not at the category label.
  if (hadGoal && (pathClass === 'watch' || pathClass?.startsWith('sub:'))) {
    return { failureStage: 'intent_inference', failureMode: 'ignored_constraint' }
  }
  if (signals.has('interstitial_proceed') || signals.has('quick_unblock')) {
    return { failureStage: 'policy', failureMode: 'false_positive' }
  }
  if (signals.has('inference_rejected')) {
    return { failureStage: 'classification', failureMode: 'false_positive' }
  }
  if (signals.has('bypass')) {
    return { failureStage: 'policy', failureMode: 'overconfidence' }
  }
  return { failureStage: 'unknown', failureMode: 'other' }
}

function round(n: number): number { return Math.round(n * 100) / 100 }

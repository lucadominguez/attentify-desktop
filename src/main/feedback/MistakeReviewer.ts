import Anthropic from '@anthropic-ai/sdk'
import { canUseAi, recordUsage } from '../billing'
import { resolveModel } from '../agent/modelRouter'
import { buildAiClient } from '../aiClient'
import { reportIssue } from '../diagnostics/report'
import { debugLog } from '../debug/logger'
import {
  getUnreviewedDisagreements, markFeedbackReviewed, countFeedback,
  confirmedHypothesisExists, getUnreactedDecisions, markDecisionAudited, insertHypothesis,
  type FeedbackWithDecision, type DecisionRow,
} from './store'
import { computeCalibration, refreshLearnedWeights } from './FeedbackService'

const OPENROUTER_BASE = 'https://openrouter.ai/api'
const REVIEW_INTERVAL_MS = 12 * 60 * 1000     // sweep for new disagreements every 12 min
const CALIBRATION_INTERVAL_MS = 6 * 60 * 60 * 1000  // recompute calibration ~4x/day
const MIN_CLUSTER_TO_REVIEW = 1               // even a single strong disagreement is worth a look
const DEDUP_WINDOW_MS = 24 * 60 * 60 * 1000   // don't re-file an issue already handled today
// Shadow audit: sample decisions the user never reacted to, so SILENT errors (never
// complained about) still get caught. Conservative rate — this spends tokens on the quiet.
const AUDIT_SAMPLE = 6                          // decisions audited per pass
const AUDIT_MIN_AGE_MS = 45 * 60 * 1000         // give the user 45 min to react before auditing

// Audits the classifier's OWN decisions using the user's reactions as ground truth. The
// friction detector in AgentService only fires when the user complains in chat; this closes
// the gap the critique named — it turns bypasses, quick unblocks, rejections and
// proceed-anyways into reviewed, categorized classifier mistakes without anyone typing a
// word.
//
// The judge is deliberately NOT asked "was this a distraction?" in a vacuum — that would
// just re-run the same call that already erred. It is told the user disagreed (that is the
// label) and asked to categorize WHY and what rule change would prevent a repeat. The model
// explains a known-wrong outcome; it is not the oracle.
export class MistakeReviewer {
  private client: Anthropic | null = null
  private model = resolveModel('cheap', false)
  private reviewTimer: ReturnType<typeof setInterval> | null = null
  private calibTimer: ReturnType<typeof setInterval> | null = null
  private running = false
  private active = false

  init(): void {
    const { client, isOpenRouter } = buildAiClient()
    this.client = client
    this.model = resolveModel('cheap', isOpenRouter)
  }

  start(): void {
    if (this.active) return
    this.active = true
    // Stagger the first run so it never piles onto launch.
    setTimeout(() => { void this.review() }, 90_000)
    this.reviewTimer = setInterval(() => { void this.review() }, REVIEW_INTERVAL_MS)
    setTimeout(() => { this.runCalibration() }, 5 * 60_000)
    this.calibTimer = setInterval(() => { this.runCalibration() }, CALIBRATION_INTERVAL_MS)
  }

  stop(): void {
    this.active = false
    if (this.reviewTimer) { clearInterval(this.reviewTimer); this.reviewTimer = null }
    if (this.calibTimer) { clearInterval(this.calibTimer); this.calibTimer = null }
  }

  // ── Disagreement review ──────────────────────────────────────────────────────

  async review(): Promise<{ reviewed: number; mistakes: number }> {
    if (this.running || !this.client) return { reviewed: 0, mistakes: 0 }
    // No AI budget: leave the feedback UNREVIEWED so it is picked up later, rather than
    // dropping it. Detection quality must not silently degrade with billing state.
    if (!canUseAi()) return { reviewed: 0, mistakes: 0 }
    this.running = true
    let mistakes = 0
    let reviewedIds: string[] = []
    try {
      const rows = getUnreviewedDisagreements(40)

      // Cluster by fingerprint (falling back to target): repeated disagreement on the same
      // context is one mistake to fix, not N, and the repeat count is itself evidence.
      const clusters = new Map<string, FeedbackWithDecision[]>()
      for (const r of rows) {
        const key = r.fingerprint || r.target_value || r.id
        const list = clusters.get(key) ?? []
        list.push(r)
        clusters.set(key, list)
      }

      for (const [, group] of clusters) {
        if (group.length < MIN_CLUSTER_TO_REVIEW) continue
        const verdict = await this.judge(group)
        // Mark the whole cluster reviewed regardless of verdict, so we don't re-spend on it.
        reviewedIds = reviewedIds.concat(group.map((g) => g.id))
        if (verdict?.mistake) {
          // Dedupe: if the deterministic loop already confirmed and corrected this context,
          // the user-facing issue is already covered — don't file a second one. Still count
          // it, and enrich the record, but no duplicate entry in "recently caught".
          const fp = group[0]!.fingerprint
          if (fp && confirmedHypothesisExists(fp, DEDUP_WINDOW_MS)) {
            debugLog('mistake:dedup-skip', { fingerprint: fp, category: verdict.category })
            continue
          }
          mistakes++
          this.fileMistake(group, verdict)
        }
      }

      // Shadow audit for SILENT errors: decisions the user never reacted to. Runs on the
      // same pass so it shares the AI-budget gate. This is the only path that can catch a
      // wrong call the user simply never noticed.
      mistakes += await this.auditSilent()
    } catch (e) {
      debugLog('mistake:review-error', { error: String(e) })
    } finally {
      if (reviewedIds.length) markFeedbackReviewed(reviewedIds)
      this.running = false
    }
    debugLog('mistake:review-done', { reviewed: reviewedIds.length, mistakes })
    return { reviewed: reviewedIds.length, mistakes }
  }

  private async judge(group: FeedbackWithDecision[]): Promise<JudgeVerdict | null> {
    if (!this.client) return null
    const head = group[0]!
    const count = group.length
    const sys = `You audit an attention-guarding app's automatic decisions. The user ALREADY reacted against this decision (they bypassed, unblocked, rejected, or pushed past it), so treat a mistake as LIKELY and your job is to categorize WHY, not to re-judge from scratch. Categories:
- false_block: blocked or flagged something aligned, work-related, or harmless.
- wrong_category: the content category label was wrong.
- context_ignored: the site is fine for THIS user's current goal/task (e.g. a tutorial video during related work).
- over_aggressive: right category, wrong intensity — should have observed or nudged, not blocked.
- acceptable: the decision was reasonable; the user just wanted a one-off exception.
Reply with ONLY compact JSON, no prose: {"mistake":<true|false>,"category":"<one of the above>","fix":"<=18 words: the concrete rule/threshold change that prevents a repeat>","confidence":0.0-1.0}`

    const input = [
      `Decision: ${head.d_action ?? 'flag'} "${head.target_value ?? '?'}"` +
        `${head.d_category ? ` (category: ${head.d_category})` : ''}` +
        `${head.d_confidence != null ? ` at confidence ${head.d_confidence.toFixed(2)}` : ''}.`,
      head.d_reasoning ? `Why the app decided this: ${head.d_reasoning}` : '',
      head.d_goal_text ? `User's active goal at the time: "${head.d_goal_text}"` : 'User had no active goal set.',
      head.d_features ? `Page context: ${JSON.stringify(head.d_features).slice(0, 240)}` : '',
      `User's reaction: ${head.signal} (${head.user_decision})${count > 1 ? `, and ${count}× total on similar pages` : ''}.`,
    ].filter(Boolean).join('\n')

    try {
      const resp = await this.client.messages.create({
        model: this.model,
        max_tokens: 120,
        messages: [{ role: 'user', content: `${sys}\n\n${input}` }],
      })
      recordUsage(this.model, resp.usage?.input_tokens ?? 0, resp.usage?.output_tokens ?? 0)
      const text = resp.content.find((b) => b.type === 'text')?.text ?? ''
      const m = text.match(/\{[\s\S]*\}/)
      if (!m) return null
      const parsed = JSON.parse(m[0]) as JudgeVerdict
      if (typeof parsed.mistake !== 'boolean') return null
      return parsed
    } catch (e) {
      debugLog('mistake:judge-error', { error: String(e) })
      return null
    }
  }

  private fileMistake(group: FeedbackWithDecision[], v: JudgeVerdict): void {
    const head = group[0]!
    reportIssue({
      kind: 'classifier_mistake',
      severity: group.length >= 3 ? 'high' : 'medium',
      category: String(v.category || 'false_block').slice(0, 40),
      title: `Classifier mistake: ${v.category} on ${head.target_value ?? 'a site'}`,
      description: [
        `${head.d_action ?? 'flagged'} ${head.target_value ?? '?'}` +
          `${head.d_category ? ` as ${head.d_category}` : ''}` +
          `${head.d_confidence != null ? ` (${Math.round(head.d_confidence * 100)}%)` : ''};` +
          ` user ${head.user_decision} via ${head.signal}${group.length > 1 ? ` ×${group.length}` : ''}.`,
        v.fix ? `Suggested fix: ${v.fix}` : '',
      ].filter(Boolean).join(' '),
      context: {
        verdict: v,
        clusterSize: group.length,
        fingerprint: head.fingerprint,
        decision: {
          action: head.d_action, category: head.d_category, confidence: head.d_confidence,
          policyWeight: head.d_policy_weight, source: head.d_source, reasoning: head.d_reasoning,
          goal: head.d_goal_text, features: head.d_features,
        },
        signals: group.map((g) => ({ signal: g.signal, decision: g.user_decision, latencyMs: g.latency_ms })),
      },
    })
    debugLog('mistake:filed', { target: head.target_value, category: v.category, cluster: group.length })
  }

  // ── Shadow audit of silent errors ────────────────────────────────────────────

  // Sample decisions the user never reacted to and ask a model, given richer context than
  // the classifier had, whether the call was actually supported. A flagged one becomes a
  // suspected error hypothesis (NOT a correction — the user never confirmed it, so it must
  // not auto-suppress; it is evidence for a human/aggregate, per the spec's caveat).
  private async auditSilent(): Promise<number> {
    if (!this.client) return 0
    const candidates = getUnreactedDecisions(AUDIT_MIN_AGE_MS, 60).slice(0, AUDIT_SAMPLE)
    if (candidates.length === 0) return 0
    let flagged = 0
    for (const d of candidates) {
      const verdict = await this.auditOne(d)
      if (verdict == null) continue          // parse/transport failure: leave unaudited, try later
      markDecisionAudited(d.id, verdict.silent_error === true)
      if (verdict.silent_error) {
        flagged++
        insertHypothesis({
          decision_id: d.id, component: 'distraction_classifier', target_value: d.target_value,
          fingerprint: d.fingerprint, error_prob: Math.min(0.75, verdict.confidence ?? 0.6),
          failure_stage: 'classification', failure_mode: String(verdict.failure_mode || 'other'),
          severity: 'low', evidence: [{ type: 'shadow_audit', strength: verdict.confidence ?? 0.6, ts: Date.now() }],
          status: 'suspected',
        })
        reportIssue({
          kind: 'classifier_mistake', severity: 'low', category: `silent:${verdict.failure_mode ?? 'other'}`.slice(0, 40),
          title: `Possible silent error on ${d.target_value ?? 'a site'}`,
          description: `Shadow audit flagged an un-reacted ${d.action} of ${d.target_value} (${d.category ?? '?'}, ${Math.round((d.confidence ?? 0) * 100)}%). ${verdict.why ?? ''}`.slice(0, 300),
          context: { audit: verdict, decision: { action: d.action, category: d.category, confidence: d.confidence, reasoning: d.reasoning, goal: d.goal_text, features: d.features } },
        })
      }
    }
    debugLog('mistake:audit-done', { audited: candidates.length, flagged })
    return flagged
  }

  private async auditOne(d: DecisionRow): Promise<AuditVerdict | null> {
    if (!this.client) return null
    const sys = `You independently audit ONE automatic decision made by an attention-guarding app. The user did NOT react to it, so there is no complaint — judge purely on whether the decision was SUPPORTED by its evidence. Be conservative: only flag a clear mistake, since silence usually means the decision was fine.
Reply ONLY compact JSON: {"silent_error":<bool>,"failure_mode":"false_positive|wrong_category|over_aggressive|other","why":"<=16 words","confidence":0.0-1.0}`
    const input = [
      `Decision: ${d.action} "${d.target_value}"${d.category ? ` (labeled ${d.category})` : ''} at confidence ${(d.confidence ?? 0).toFixed(2)}.`,
      d.reasoning ? `Reason given: ${d.reasoning}` : '',
      d.goal_text ? `User's active goal: "${d.goal_text}"` : 'No active goal.',
      d.features ? `Page context: ${JSON.stringify(d.features).slice(0, 200)}` : '',
    ].filter(Boolean).join('\n')
    try {
      const resp = await this.client.messages.create({ model: this.model, max_tokens: 90, messages: [{ role: 'user', content: `${sys}\n\n${input}` }] })
      recordUsage(this.model, resp.usage?.input_tokens ?? 0, resp.usage?.output_tokens ?? 0)
      const text = resp.content.find((b) => b.type === 'text')?.text ?? ''
      const m = text.match(/\{[\s\S]*\}/)
      if (!m) return null
      const parsed = JSON.parse(m[0]) as AuditVerdict
      return typeof parsed.silent_error === 'boolean' ? parsed : null
    } catch { return null }
  }

  // ── Calibration ──────────────────────────────────────────────────────────────

  // No AI needed — pure aggregation. If a category is both frequent and frequently
  // disagreed with, that is a systematic classifier fault, so file it as one issue.
  runCalibration(): void {
    try {
      // Refresh the data-learned signal weights first, so the hypothesis engine calibrates
      // itself off accumulated outcomes instead of the hand-set priors forever.
      refreshLearnedWeights(30)
      const report = computeCalibration(30)
      if (report.totalResolved < 10) return   // not enough to conclude anything
      const fb = countFeedback(Date.now() - 30 * 24 * 3600_000)
      debugLog('mistake:calibration', {
        resolved: report.totalResolved, worst: report.worstCategory?.category,
        agree: fb.agree, disagree: fb.disagree, override: fb.override,
      })
      if (report.worstCategory) {
        const w = report.worstCategory
        reportIssue({
          kind: 'classifier_mistake',
          severity: 'medium',
          category: 'miscalibration',
          title: `Systematic miscalibration: ${w.category}`,
          description: `Over the last 30 days, ${Math.round(w.disagreementRate * 100)}% of "${w.category}" decisions (n=${w.n}) were reversed by the user. The category's policy weight is likely too high or too context-blind.`,
          context: { report },
        })
      }
    } catch (e) {
      debugLog('mistake:calibration-error', { error: String(e) })
    }
  }
}

interface JudgeVerdict {
  mistake: boolean
  category?: string
  fix?: string
  confidence?: number
}

interface AuditVerdict {
  silent_error: boolean
  failure_mode?: string
  why?: string
  confidence?: number
}

export const mistakeReviewer = new MistakeReviewer()

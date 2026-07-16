import Anthropic from '@anthropic-ai/sdk'
import { canUseAi, recordUsage } from '../billing'
import { resolveModel } from '../agent/modelRouter'
import { reportIssue } from '../diagnostics/report'
import { debugLog } from '../debug/logger'
import {
  getUnreviewedDisagreements, markFeedbackReviewed, countFeedback,
  type FeedbackWithDecision,
} from './store'
import { computeCalibration } from './FeedbackService'

const OPENROUTER_BASE = 'https://openrouter.ai/api'
const REVIEW_INTERVAL_MS = 12 * 60 * 1000     // sweep for new disagreements every 12 min
const CALIBRATION_INTERVAL_MS = 6 * 60 * 60 * 1000  // recompute calibration ~4x/day
const MIN_CLUSTER_TO_REVIEW = 1               // even a single strong disagreement is worth a look

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

  init(apiKey: string): void {
    const isOpenRouter = apiKey.startsWith('sk-or-')
    this.model = resolveModel('cheap', isOpenRouter)
    this.client = new Anthropic({
      apiKey,
      ...(isOpenRouter ? {
        baseURL: OPENROUTER_BASE,
        defaultHeaders: { 'HTTP-Referer': 'https://attentify.ai', 'X-Title': 'Attentify' },
      } : {}),
    })
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
      if (rows.length === 0) return { reviewed: 0, mistakes: 0 }

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
          mistakes++
          this.fileMistake(group, verdict)
        }
      }
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

  // ── Calibration ──────────────────────────────────────────────────────────────

  // No AI needed — pure aggregation. If a category is both frequent and frequently
  // disagreed with, that is a systematic classifier fault, so file it as one issue.
  runCalibration(): void {
    try {
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

export const mistakeReviewer = new MistakeReviewer()

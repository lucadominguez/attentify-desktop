import Anthropic from '@anthropic-ai/sdk'
import { canUseAi, recordUsage } from '../billing'
import { resolveModel } from '../agent/modelRouter'
import { contextFingerprint } from '../feedback/fingerprint'
import { debugLog } from '../debug/logger'

const OPENROUTER_BASE = 'https://openrouter.ai/api'

// ONE semantic assessment for the whole app. Before this there were three separate LLM
// classifiers — the URL guard, the unknown-URL check, and the search check — each with its
// own prompt, schema, cache and confidence meaning, which could and did disagree. They now
// all call this: one schema, one cache, one prompt, one confidence scale, one place to
// version. The model RECOMMENDS an assessment; the deterministic policy engine (rules +
// corroboration in InferenceEngine) still chooses the intervention.

export interface AssessmentContext {
  kind: 'url' | 'search'
  domain?: string
  path?: string
  title?: string
  searchQuery?: string
  goals: string[]
  avoidances?: string[]
  goalId?: string
}

export type RecommendedAction = 'allow' | 'observe' | 'nudge' | 'confirm' | 'block'

export interface AiAssessment {
  contentCategory: string
  recreationalProbability: number
  goalAlignment: number
  confidence: number
  evidence: string[]
  recommendedAction: RecommendedAction
}

const CACHE_TTL = 20 * 60 * 1000
const MIN_INTERVAL_MS = 3500   // serialize + rate-limit all assessment calls in one place

class ContextAssessmentService {
  private client: Anthropic | null = null
  private model = resolveModel('cheap', false)
  private cache = new Map<string, { value: AiAssessment; at: number }>()
  private lastCallTs = 0
  private chain: Promise<unknown> = Promise.resolve()

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

  ready(): boolean { return this.client != null }

  private keyFor(ctx: AssessmentContext): string {
    if (ctx.kind === 'search') return `s:${(ctx.searchQuery ?? '').toLowerCase().slice(0, 60)}:${ctx.goalId ?? '-'}`
    return `u:${contextFingerprint({ registeredDomain: ctx.domain ?? '', pathClass: ctx.path ?? '-', goalId: ctx.goalId })}`
  }

  // Assess one activity. Returns null if AI is unavailable/over budget — callers must treat
  // that as "no opinion" (degrade to observe), never as "safe" or "block".
  async assess(ctx: AssessmentContext): Promise<AiAssessment | null> {
    if (!this.client) return null
    const key = this.keyFor(ctx)
    const cached = this.cache.get(key)
    if (cached && Date.now() - cached.at < CACHE_TTL) return cached.value
    if (!canUseAi()) return null

    // Serialize through one chain so the whole app makes at most one assessment call at a
    // time, at a bounded rate — the rate limiting the three callers each used to do alone.
    const run = this.chain.then(() => this.callModel(ctx)).catch(() => null)
    this.chain = run.catch(() => null)
    const result = await run
    if (result) this.cache.set(key, { value: result, at: Date.now() })
    return result
  }

  private async callModel(ctx: AssessmentContext): Promise<AiAssessment | null> {
    if (!this.client) return null
    const since = Date.now() - this.lastCallTs
    if (since < MIN_INTERVAL_MS) await sleep(MIN_INTERVAL_MS - since)
    this.lastCallTs = Date.now()

    const sys = `You assess whether a web activity is aligned with a user's current work or is a distraction. Judge THIS specific page/query for THIS user's goals: the same site can be aligned or off-task depending on the page and the task (a coding tutorial video is aligned; the same site's home feed is not). Be conservative about calling things distractions when a goal-relevant reading is plausible.
Return ONLY compact JSON, no prose:
{"content_category":"<3 words>","recreational_probability":0.0-1.0,"goal_alignment":0.0-1.0,"confidence":0.0-1.0,"evidence":["<short reason>"],"recommended_action":"allow|observe|nudge|confirm|block"}`

    const lines: string[] = []
    lines.push(ctx.goals.length ? `Active goals: ${ctx.goals.slice(0, 3).join('; ')}` : 'No active goal set.')
    if (ctx.avoidances?.length) lines.push(`User avoids: ${ctx.avoidances.slice(0, 5).join('; ')}`)
    if (ctx.kind === 'search') {
      lines.push(`The user just SEARCHED for: "${ctx.searchQuery}". This is intent, not a visit — never recommend "block" for a search alone.`)
    } else {
      lines.push(`Activity: ${ctx.domain ?? '?'}${ctx.path && ctx.path !== '/' ? ctx.path : ''}${ctx.title ? ` — page title: "${ctx.title.slice(0, 100)}"` : ''}`)
    }

    try {
      const resp = await this.client.messages.create({
        model: this.model, max_tokens: 150,
        messages: [{ role: 'user', content: `${sys}\n\n${lines.join('\n')}` }],
      })
      recordUsage(this.model, resp.usage?.input_tokens ?? 0, resp.usage?.output_tokens ?? 0)
      const text = resp.content.find((b) => b.type === 'text')?.text ?? ''
      const m = text.match(/\{[\s\S]*\}/)
      if (!m) return null
      const p = JSON.parse(m[0]) as Record<string, unknown>
      const action = String(p.recommended_action ?? 'observe') as RecommendedAction
      if (!['allow', 'observe', 'nudge', 'confirm', 'block'].includes(action)) return null
      return {
        contentCategory: String(p.content_category ?? 'unknown').slice(0, 40),
        recreationalProbability: clamp01(Number(p.recreational_probability)),
        goalAlignment: clamp01(Number(p.goal_alignment)),
        confidence: clamp01(Number(p.confidence)),
        evidence: Array.isArray(p.evidence) ? (p.evidence as unknown[]).slice(0, 4).map((e) => String(e).slice(0, 80)) : [],
        recommendedAction: action,
      }
    } catch (e) {
      debugLog('assess:error', { error: String(e) })
      return null
    }
  }

  // Map the recommended action onto the InferenceEngine confidence scale, so its rules,
  // corroboration gate and thresholds treat an AI verdict identically to a rule-based one.
  static toConfidence(a: AiAssessment): number {
    switch (a.recommendedAction) {
      case 'block': return 0.9
      case 'confirm': return 0.78
      case 'nudge': return 0.68
      case 'observe': return 0.5
      case 'allow': return 0.2
    }
  }

  static isDistraction(a: AiAssessment): boolean {
    return ['block', 'confirm', 'nudge'].includes(a.recommendedAction)
  }
}

function clamp01(n: number): number { return Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 0.5 }
function sleep(ms: number): Promise<void> { return new Promise((r) => setTimeout(r, ms)) }

export const contextAssessment = new ContextAssessmentService()
export { ContextAssessmentService }

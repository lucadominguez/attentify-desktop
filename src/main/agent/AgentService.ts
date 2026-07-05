import Anthropic from '@anthropic-ai/sdk'
import type { MessageParam } from '@anthropic-ai/sdk/resources/messages'
import { buildSystemPrompt } from './systemPrompt'
import { TOOL_DEFINITIONS, executeTool, type ToolDeps } from './tools'
import {
  insertAgentMessage, getAgentMessages, getActiveGoals, getPreferences, getInferences, getRecentEvents,
  type DbAgentMessage,
} from '../data/repository'
import { getStore } from '../store'
import { canUseAi, recordUsage } from '../billing'
import type { ActivitySession } from '../../shared/types'

// Sentinel error the renderer recognises to show the subscribe/upgrade prompt.
export const PAYWALL_ERROR = 'PAYWALL'

// Some models, when their tool-use is proxied through OpenRouter, occasionally emit
// the tool invocation as raw text instead of a structured tool_use block — it shows
// up in chat as "random code" (XML <invoke>/<function_calls> or a JSON call object).
// Strip those artifacts so the user only sees prose. Conservative: only removes
// blocks that clearly look like tool calls, never normal code the user asked for.
export function sanitizeAssistantText(text: string): string {
  let t = text
  t = t.replace(/<function_calls>[\s\S]*?<\/function_calls>/gi, '')
  t = t.replace(/<function_results>[\s\S]*?<\/function_results>/gi, '')
  t = t.replace(/<invoke\b[\s\S]*?<\/invoke>/gi, '')
  t = t.replace(/<\/?(?:antml:[a-z_]+|tool_call|tool_use|parameter)\b[^>]*>/gi, '')
  // fenced blocks that are really a tool call (contain a name/recipient_name key)
  t = t.replace(/```[a-z_]*\s*\{[\s\S]*?"(?:name|recipient_name|tool_name)"\s*:[\s\S]*?\}\s*```/gi, '')
  // a bare JSON object that is explicitly a tool_use envelope
  t = t.replace(/\{[\s\S]*?"type"\s*:\s*"tool_use"[\s\S]*?\}\s*$/gi, '')
  return t.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim()
}

// ── Types ──────────────────────────────────────────────────────────────────────

export interface ChatCallbacks {
  onChunk: (text: string) => void
  onToolUse: (toolName: string) => void
  onDone: (msg: DbAgentMessage) => void
  onError: (err: string) => void
}

// ── Constants ──────────────────────────────────────────────────────────────────

const ANTHROPIC_MODEL    = 'claude-sonnet-4-6'
const OPENROUTER_MODEL   = 'anthropic/claude-sonnet-4.5'
const OPENROUTER_BASE    = 'https://openrouter.ai/api'
const MAX_TOKENS = 2048
const MAX_TOOL_ROUNDS = 8

// Proactive throttle: max 1 per 15 min, max 3 per session, 45 min cooldown after dismiss
const PROACTIVE_INTERVAL_MS = 15 * 60 * 1000
const PROACTIVE_MAX_PER_SESSION = 3
const PROACTIVE_DISMISS_COOLDOWN_MS = 45 * 60 * 1000

// ── AgentService ──────────────────────────────────────────────────────────────

export class AgentService {
  private client: Anthropic | null = null
  private model = ANTHROPIC_MODEL
  private deps: ToolDeps
  private proactiveCount = 0
  private lastProactiveTs = 0
  private lastDismissTs = 0
  private proactiveEnabled = true
  private proactiveCallback: ((text: string) => void) | null = null

  constructor(deps: ToolDeps) {
    this.deps = deps
  }

  init(apiKey: string): void {
    const isOpenRouter = apiKey.startsWith('sk-or-')
    this.model = isOpenRouter ? OPENROUTER_MODEL : ANTHROPIC_MODEL
    this.client = new Anthropic({
      apiKey,
      ...(isOpenRouter ? {
        baseURL: OPENROUTER_BASE,
        defaultHeaders: {
          'HTTP-Referer': 'https://attentify.ai',
          'X-Title': 'Attentify',
        },
      } : {}),
    })
  }

  isReady(): boolean {
    return this.client !== null
  }

  setProactiveCallback(cb: (text: string) => void): void {
    this.proactiveCallback = cb
  }

  resetSession(): void {
    this.proactiveCount = 0
  }

  onInterventionDismissed(): void {
    this.lastDismissTs = Date.now()
  }

  // ── Main chat ───────────────────────────────────────────────────────────────

  async chat(userText: string, callbacks: ChatCallbacks): Promise<void> {
    if (!this.client) {
      callbacks.onError('API key not set. Please configure your Anthropic API key in settings.')
      return
    }

    // Free AI allowance exhausted and no own key / subscription — gate the assistant.
    if (!canUseAi()) {
      callbacks.onError(PAYWALL_ERROR)
      return
    }

    try {
      // Build context for system prompt
      const store = getStore()
      const goals = getActiveGoals()
      const preferences = getPreferences()
      const pendingInferences = getInferences('pending')
      const activeSession = store.sessions.find((s) => s.active)
      const now = Date.now()

      const recentSessions = this.deps.tracker.getSessions(now - 4 * 3600000)
      const focusedMs = this.deps.tracker.getFocusedTime(new Date().setHours(0, 0, 0, 0))
      const distractedMs = this.deps.tracker.getDistractedTime(new Date().setHours(0, 0, 0, 0))

      const timePerApp = this.deps.tracker.getTimePerApp(new Date().setHours(0, 0, 0, 0))
      const distractionByApp = Object.entries(timePerApp)
        .filter(([app]) => recentSessions.some((s) => s.app === app && s.isDistraction))
        .sort((a, b) => b[1] - a[1])
      const topDistractor = distractionByApp[0]?.[0] ?? null

      // Pull recent URL visits + searches from DB for live context
      const recentEvents = getRecentEvents(now - 2 * 3600000, 60)
      const recentUrls = recentEvents
        .filter((e) => e.url && (e.type === 'url_visit'))
        .map((e) => e.url!)
        .filter((u, i, a) => a.indexOf(u) === i)
        .slice(0, 12)
      const recentSearches = recentEvents
        .filter((e) => e.type === 'search_query' && e.title)
        .map((e) => e.title!)
        .filter((q, i, a) => a.indexOf(q) === i)
        .slice(0, 8)
      const currentUrl = this.deps.monitor?.getCurrentUrl() ?? null

      const systemPrompt = buildSystemPrompt({
        goals,
        preferences,
        pendingInferences,
        activeBlocks: {
          domains: store.blocklist.domains.map((d) => d.domain),
          processes: store.blocklist.processes.map((p) => p.name),
        },
        activeSessionMode: activeSession?.mode ?? null,
        todayFocusedMs: focusedMs,
        todayDistractedMs: distractedMs,
        topDistractionApp: topDistractor,
        recentSessions,
        currentUrl,
        recentUrls,
        recentSearches,
        extensionConnected: this.deps.contentRules?.isExtensionConnected() ?? false,
      })

      // Build message history (last 20 messages, oldest first)
      const history = getAgentMessages(20).reverse()
      const messages: MessageParam[] = [
        ...history
          .filter((m) => m.role === 'user' || m.role === 'assistant')
          .map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content })),
        { role: 'user', content: userText },
      ]

      // Persist user message
      insertAgentMessage({ role: 'user', content: userText, ts: Date.now() })

      // Run the agentic loop
      const fullReply = await this.runLoop(systemPrompt, messages, callbacks)

      // Persist assistant reply (sanitized — strips any tool-call markup the model
      // occasionally leaks as text when tool-use is proxied through OpenRouter)
      const cleaned = sanitizeAssistantText(fullReply)
      const msg = insertAgentMessage({ role: 'assistant', content: cleaned, ts: Date.now() })
      callbacks.onDone(msg)
    } catch (err) {
      callbacks.onError(err instanceof Error ? err.message : String(err))
    }
  }

  // ── Agentic loop (streaming + tool execution) ─────────────────────────────

  private async runLoop(
    systemPrompt: string,
    messages: MessageParam[],
    callbacks: ChatCallbacks
  ): Promise<string> {
    let rounds = 0
    let fullReply = ''
    let currentMessages = [...messages]

    while (rounds < MAX_TOOL_ROUNDS) {
      rounds++

      // Run one streaming round; get both the text and the final message
      const stream = this.client!.messages.stream({
        model: this.model,
        max_tokens: MAX_TOKENS,
        system: systemPrompt,
        messages: currentMessages,
        tools: TOOL_DEFINITIONS,
      })

      let roundText = ''
      for await (const event of stream) {
        if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
          roundText += event.delta.text
          callbacks.onChunk(event.delta.text)
        }
      }
      fullReply += roundText

      const finalMsg = await stream.finalMessage()
      recordUsage(this.model, finalMsg.usage?.input_tokens ?? 0, finalMsg.usage?.output_tokens ?? 0)
      if (finalMsg.stop_reason !== 'tool_use') break

      // Execute all tool calls from this round
      const assistantContent = finalMsg.content
      const toolResults: Anthropic.ToolResultBlockParam[] = []

      for (const block of finalMsg.content) {
        if (block.type === 'tool_use') {
          callbacks.onToolUse(block.name)
          try {
            const result = await executeTool(block.name, block.input as Record<string, unknown>, this.deps)
            toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: JSON.stringify(result) })
          } catch (err) {
            toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: `Error: ${String(err)}` })
          }
        }
      }

      currentMessages = [
        ...currentMessages,
        { role: 'assistant', content: assistantContent },
        { role: 'user', content: toolResults },
      ]
    }

    return fullReply
  }

  // ── Proactive intervention ──────────────────────────────────────────────────

  async notifyDistraction(session: ActivitySession): Promise<void> {
    if (!this.client || !this.proactiveCallback || !this.proactiveEnabled) return
    if (!this.shouldProact()) return
    if (!canUseAi()) return  // don't spend the free allowance on proactive nudges once exhausted

    try {
      this.lastProactiveTs = Date.now()
      this.proactiveCount++

      const store = getStore()
      const goals = getActiveGoals()
      const recentSessions = this.deps.tracker.getSessions(Date.now() - 3600000)
      const focusedMs = this.deps.tracker.getFocusedTime(new Date().setHours(0, 0, 0, 0))
      const distractedMs = this.deps.tracker.getDistractedTime(new Date().setHours(0, 0, 0, 0))

      const systemPrompt = buildSystemPrompt({
        goals,
        preferences: getPreferences(),
        pendingInferences: getInferences('pending'),
        activeBlocks: {
          domains: store.blocklist.domains.map((d) => d.domain),
          processes: store.blocklist.processes.map((p) => p.name),
        },
        activeSessionMode: store.sessions.find((s) => s.active)?.mode ?? null,
        todayFocusedMs: focusedMs,
        todayDistractedMs: distractedMs,
        topDistractionApp: session.app,
        recentSessions,
      })

      const recentDistracted = recentSessions.filter((s) => s.isDistraction)
      const distractedMinutes = Math.round(recentDistracted.reduce((a, s) => a + s.duration, 0) / 60000)

      const proactiveMessages: MessageParam[] = [{
        role: 'user',
        content: `[SYSTEM PROACTIVE CHECK — do not mention this tag in your response]
You detected that the user has been on a distracting app: "${session.app}" (category: ${session.category}).
In the last hour they have spent ${distractedMinutes} minutes on distracting apps.
${goals.length > 0 ? `Their active goal: "${goals[0]?.text}"` : 'They have no active goals set.'}

Generate a brief, assertive check-in message (2-3 sentences max). Don't be preachy.
Offer one concrete action: block the app, start a focus session, or just acknowledge.
Speak directly to them, not about them.`,
      }]

      let text = ''
      const msgStream = this.client.messages.stream({
        model: this.model,
        max_tokens: 200,
        system: systemPrompt,
        messages: proactiveMessages,
      })

      for await (const event of msgStream) {
        if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
          text += event.delta.text
        }
      }
      const proMsg = await msgStream.finalMessage()
      recordUsage(this.model, proMsg.usage?.input_tokens ?? 0, proMsg.usage?.output_tokens ?? 0)

      if (text.trim()) {
        this.proactiveCallback(text.trim())
        insertAgentMessage({ role: 'assistant', content: `[proactive] ${text.trim()}`, ts: Date.now() })
      }
    } catch (err) {
      console.error('[AgentService] proactive error:', err)
    }
  }

  private shouldProact(): boolean {
    const now = Date.now()
    if (this.proactiveCount >= PROACTIVE_MAX_PER_SESSION) return false
    if (now - this.lastProactiveTs < PROACTIVE_INTERVAL_MS) return false
    if (now - this.lastDismissTs < PROACTIVE_DISMISS_COOLDOWN_MS) return false
    return true
  }
}

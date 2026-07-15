import Anthropic from '@anthropic-ai/sdk'
import { getActiveGoals, getPreferences, bufferEvent } from '../data/repository'
import { canUseAi, recordUsage } from '../billing'
import { resolveModel } from '../agent/modelRouter'

const OPENROUTER_BASE  = 'https://openrouter.ai/api'

// Domains that are always productive — skip AI check entirely
const SAFE_DOMAINS = new Set([
  'github.com', 'gitlab.com', 'bitbucket.org',
  'stackoverflow.com', 'stackexchange.com', 'superuser.com', 'serverfault.com',
  'docs.google.com', 'drive.google.com', 'calendar.google.com', 'mail.google.com',
  'notion.so', 'linear.app', 'jira.atlassian.com', 'confluence.atlassian.com',
  'figma.com', 'miro.com',
  'npmjs.com', 'pypi.org', 'crates.io', 'rubygems.org',
  'developer.mozilla.org', 'developer.apple.com', 'learn.microsoft.com',
  'localhost', '127.0.0.1',
])

// Domains that are obviously distracting — flag without AI
const OBVIOUS_DISTRACTIONS: { domain: string; category: string }[] = [
  { domain: 'twitter.com', category: 'social media' },
  { domain: 'x.com', category: 'social media' },
  { domain: 'instagram.com', category: 'social media' },
  { domain: 'facebook.com', category: 'social media' },
  { domain: 'tiktok.com', category: 'short-form video' },
  { domain: 'reddit.com', category: 'social forum' },
  { domain: 'youtube.com', category: 'video' },
  { domain: 'twitch.tv', category: 'live streaming' },
  { domain: 'netflix.com', category: 'streaming' },
  { domain: 'hulu.com', category: 'streaming' },
  { domain: 'disneyplus.com', category: 'streaming' },
  { domain: '9gag.com', category: 'meme / entertainment' },
  { domain: 'buzzfeed.com', category: 'tabloid' },
  { domain: 'dailymail.co.uk', category: 'tabloid' },
]

export interface GuardAlert {
  url: string
  domain: string
  title: string
  category: string
  message: string
  searchQuery?: string
  timestamp: number
}

// ── Search query extraction ───────────────────────────────────────────────────

export function extractSearchQuery(url: string): string | null {
  try {
    const u = new URL(url)
    const h = u.hostname.replace(/^www\./, '')
    // Google
    if (h === 'google.com' || h.endsWith('.google.com')) {
      const q = u.searchParams.get('q')
      return q || null
    }
    // Bing
    if (h === 'bing.com' || h.endsWith('.bing.com')) {
      return u.searchParams.get('q')
    }
    // YouTube search
    if (h === 'youtube.com' && u.pathname === '/results') {
      return u.searchParams.get('search_query')
    }
    // DuckDuckGo
    if (h === 'duckduckgo.com') {
      return u.searchParams.get('q')
    }
    // Reddit search
    if (h === 'reddit.com' && u.pathname.startsWith('/search')) {
      return u.searchParams.get('q')
    }
    // Brave search
    if (h === 'search.brave.com') {
      return u.searchParams.get('q')
    }
    // Kagi
    if (h === 'kagi.com' && u.pathname === '/search') {
      return u.searchParams.get('q')
    }
    return null
  } catch {
    return null
  }
}

export function extractDomain(url: string): string | null {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return null
  }
}

// ── UrlGuardService ───────────────────────────────────────────────────────────

export class UrlGuardService {
  private client: Anthropic | null = null
  private model = resolveModel('micro', false)
  private enabled = true
  private onAlert: ((alert: GuardAlert) => void) | null = null

  // Cache: domain → { flagged, category, message, checkedAt }
  private cache = new Map<string, { flagged: boolean; category: string; message: string; checkedAt: number }>()
  private readonly CACHE_TTL = 10 * 60 * 1000 // 10 minutes

  // Pending check: debounce URL changes (user might navigate quickly)
  private pendingTimer: ReturnType<typeof setTimeout> | null = null
  private pendingUrl: string | null = null
  private pendingTitle: string | null = null

  init(apiKey: string): void {
    const isOpenRouter = apiKey.startsWith('sk-or-')
    this.model = resolveModel('micro', isOpenRouter)
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

  setAlertCallback(cb: (alert: GuardAlert) => void): void {
    this.onAlert = cb
  }

  setEnabled(val: boolean): void {
    this.enabled = val
  }

  // Called by MonitorService whenever URL changes
  onUrlChange(url: string, title: string): void {
    // Record search query regardless
    const query = extractSearchQuery(url)
    if (query) {
      bufferEvent({ ts: Date.now(), type: 'search_query', url, title: query })
    }

    if (!this.enabled || !this.client) return

    // Debounce: wait 6s after last URL change before evaluating
    // (avoids firing on quick navigations / tab switches)
    if (this.pendingTimer) clearTimeout(this.pendingTimer)
    this.pendingUrl = url
    this.pendingTitle = title
    this.pendingTimer = setTimeout(() => {
      void this.evaluate(url, title, query ?? undefined)
    }, 6000)
  }

  private async evaluate(url: string, title: string, searchQuery?: string): Promise<void> {
    const domain = extractDomain(url)
    if (!domain) return

    // Skip safe domains
    if (SAFE_DOMAINS.has(domain)) return

    // Check obvious distractions without AI
    const obvious = OBVIOUS_DISTRACTIONS.find((d) =>
      domain === d.domain || domain.endsWith('.' + d.domain)
    )
    if (obvious) {
      const goals = getActiveGoals()
      if (goals.length > 0) {
        this.fireAlert({
          url, domain, title,
          category: obvious.category,
          message: `**${domain}** is ${obvious.category}. Your goal: "${goals[0]!.text}"`,
          searchQuery,
          timestamp: Date.now(),
        })
      }
      return
    }

    // Check cache
    const cached = this.cache.get(domain)
    if (cached && Date.now() - cached.checkedAt < this.CACHE_TTL) {
      if (cached.flagged) {
        this.fireAlert({ url, domain, title, category: cached.category, message: cached.message, searchQuery, timestamp: Date.now() })
      }
      return
    }

    // Ask AI
    await this.askAI(url, domain, title, searchQuery)
  }

  private async askAI(url: string, domain: string, title: string, searchQuery?: string): Promise<void> {
    if (!this.client || !canUseAi()) return

    const goals = getActiveGoals()
    const prefs = getPreferences()

    const avoidPrefs = prefs.filter((p) =>
      p.key.toLowerCase().includes('avoid') ||
      p.key.toLowerCase().includes('block') ||
      p.key.toLowerCase().includes('distract')
    ).slice(0, 5)

    // Skip AI call if no goals and no avoid preferences, nothing to evaluate against
    if (goals.length === 0 && avoidPrefs.length === 0) return

    const goalText = goals.slice(0, 3).map((g) => g.text).join('; ')
    const avoidText = avoidPrefs.map((p) => `${p.key}: ${p.value}`).join('; ')

    const prompt = `User is visiting: "${domain}" — page title: "${title}"${searchQuery ? ` — searched for: "${searchQuery}"` : ''}

User goals: ${goalText || 'none'}
User avoidances: ${avoidText || 'none stated'}

Is this visit aligned with their goals, or does it fall into a category they want to avoid?

Reply with a single JSON object (no markdown):
{"flagged":true/false,"category":"<1-3 word category>","message":"<one concise sentence, 10 words max>"}`

    try {
      const response = await this.client.messages.create({
        model: this.model,
        max_tokens: 80,
        messages: [{ role: 'user', content: prompt }],
      })

      recordUsage(this.model, response.usage?.input_tokens ?? 0, response.usage?.output_tokens ?? 0)
      const text = response.content.find((b) => b.type === 'text')?.text ?? ''
      const jsonMatch = text.match(/\{[\s\S]*?\}/)
      if (!jsonMatch) return

      const result = JSON.parse(jsonMatch[0]) as { flagged?: boolean; category?: string; message?: string }
      const flagged = result.flagged === true
      const category = result.category ?? 'unknown'
      const message = result.message ?? `${domain} may not align with your goals.`

      this.cache.set(domain, { flagged, category, message, checkedAt: Date.now() })

      if (flagged) {
        this.fireAlert({ url, domain, title, category, message, searchQuery, timestamp: Date.now() })
      }
    } catch {
      // Silent fail, this is a non-critical background check
    }
  }

  private fireAlert(alert: GuardAlert): void {
    this.onAlert?.(alert)
  }

  clearCache(): void {
    this.cache.clear()
  }
}

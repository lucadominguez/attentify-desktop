// Central AI model routing.
//
// Goal: run the BULK of tasks on a cheap, capable model (DeepSeek V4 Pro) and escalate
// to a premium model (Claude Sonnet) only for genuinely high-ambiguity work. This cuts
// cost hard without lowering quality — trivial commands ("block youtube") don't need a
// frontier model, and the few genuinely nuanced/reasoning-heavy asks still get one.
//
// DeepSeek is only reachable through OpenRouter (or the bundled OpenRouter key), so an
// Anthropic-direct key falls back to Haiku (cheap) / Sonnet (premium).
//
// NOTE: if a provider's exact model slug differs, change it HERE only.

export type Tier = 'micro' | 'cheap' | 'premium'

const OPENROUTER_MODELS: Record<Tier, string> = {
  micro: 'deepseek/deepseek-v4-pro',      // one-liners: overlay nudges, URL classifier
  cheap: 'deepseek/deepseek-v4-pro',      // default for most chat + tool tasks
  premium: 'anthropic/claude-sonnet-4.5', // high-ambiguity / vision / deep reasoning
}

const ANTHROPIC_MODELS: Record<Tier, string> = {
  micro: 'claude-haiku-4-5-20251001',
  cheap: 'claude-haiku-4-5-20251001',
  premium: 'claude-sonnet-4-6',
}

export function resolveModel(tier: Tier, isOpenRouter: boolean): string {
  return (isOpenRouter ? OPENROUTER_MODELS : ANTHROPIC_MODELS)[tier]
}

// Anthropic prompt caching works for Claude models (direct or proxied via OpenRouter).
// DeepSeek does its own automatic server-side caching, so we don't send cache markers to
// it (avoids any chance of an unsupported-field error).
export function isCacheable(model: string): boolean {
  return /claude/i.test(model)
}

// ── Zero-token ambiguity classifier ─────────────────────────────────────────────
// Decide whether a chat turn needs the premium model. Purely local (no API call), so it
// adds no tokens. Conservative: default to cheap; only escalate on clear signals of an
// open-ended, reasoning-heavy, or nuanced request.

const SIMPLE_CMD = /^(block|unblock|hide|show|allow|start|stop|end|pause|resume|mute|snooze|skip|schedule|add|remove|delete|clear|list|enable|disable|turn (on|off)|set|open|go to)\b/i

const COMPLEX = /\b(why|how (do|can|should|would|might)|should i|figure out|analy[sz]e|advice|help me (understand|figure|decide|plan|work|get)|make a plan|strateg|struggl|keep (getting|being|ending up|going|coming)|explain|compare|trade-?off|recommend|what.?s the best|design|debug|troubleshoot|understand|make sense of|overwhelm|procrastinat|motivat|feel like|burn(ing|t) out|can'?t focus|distracted (all|every)|what should i)\b/i

export function chatTier(userText: string, opts: { hasImages?: boolean } = {}): Tier {
  if (opts.hasImages) return 'premium'                 // vision + reasoning
  const t = (userText || '').trim()
  if (!t) return 'cheap'
  if (COMPLEX.test(t)) return 'premium'                // open-ended / advice / analysis
  if (t.length > 240) return 'premium'                 // long → likely nuanced
  if ((t.match(/\?/g) || []).length >= 2) return 'premium' // multiple questions
  if (SIMPLE_CMD.test(t) && t.length < 160) return 'cheap' // clear imperative
  return 'cheap'                                        // most tasks → cheap
}

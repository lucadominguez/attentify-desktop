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
  // Premium uses DeepSeek's reasoner because the account's OpenRouter keys don't currently
  // serve Anthropic. To restore Claude here, enable Anthropic on the OpenRouter account and
  // set this back to 'anthropic/claude-sonnet-4.5'.
  premium: 'deepseek/deepseek-r1',        // high-ambiguity / deep reasoning
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

// DEFAULT IS CHEAP (DeepSeek). Only genuinely deep / open-ended / planning / emotional
// asks, the small slice where a frontier model's quality actually matters — escalate.
// Deliberately narrow so the overwhelming majority of turns run on DeepSeek.
const DEEP = /\b(figure out why|help me (figure|understand why|decide|plan|work out)|make (me )?a plan|come up with (a )?(plan|strateg|approach)|strateg(y|ise|ize)|analy[sz]e (my|the|why|how)|why (do|am|does|is|can'?t) (i|it|this|my)|(i(?:'m| am) )?(struggl|overwhelm|burn(t|ing) out|stuck|lost|anxious|depressed)|can'?t (focus|concentrate|stop|seem to)|think (this |it )?through|weigh (the |my )?(options|pros)|what should i do about|advice (on|about)|help me get (my|back)|root cause|why does the app|doesn'?t (make sense|understand))\b/i

export function chatTier(userText: string, opts: { hasImages?: boolean } = {}): Tier {
  if (opts.hasImages) return 'premium'   // vision — needs a capable multimodal model
  const t = (userText || '').trim()
  if (!t) return 'cheap'
  if (t.length > 600) return 'premium'   // unusually long → likely genuinely complex
  if (DEEP.test(t)) return 'premium'     // deep reasoning / advice / planning / emotional
  return 'cheap'                         // everything else → DeepSeek (the vast majority)
}

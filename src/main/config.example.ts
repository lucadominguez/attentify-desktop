// Shipped configuration — TEMPLATE.
//
// Copy this file to `config.ts` and fill in BUNDLED_OPENROUTER_KEY before building.
// `config.ts` is gitignored on purpose: it holds a live provider key that must NOT
// be committed (GitHub secret-scanners and bots would drain it within minutes). The
// key still ships inside the packaged app so new users get zero-setup AI, it's just
// never stored in source control.
//
// A bundled OpenRouter key powers the AI features so a new user needs zero setup.
// Usage against this key is metered locally (see billing.ts): every install gets
// FREE_USAGE_LIMIT_USD of free AI; past that, the user is asked to subscribe to the
// $5/mo Cloud plan (or paste their own key, which is never metered).

export const BUNDLED_OPENROUTER_KEY = 'sk-or-v1-REPLACE_ME'

// Free AI allowance per install, in US dollars of estimated provider spend.
export const FREE_USAGE_LIMIT_USD = 1.0

// Cloud backend + checkout (the $5/mo subscription that lifts the free cap).
export const CLOUD_API_BASE = 'https://attentify-cloud.ludomi2502.workers.dev'

// Model pricing per 1M tokens, [input, output] in USD. Used to estimate the cost of
// each AI call so the free allowance can be metered without the provider's billing API.
const MODEL_PRICING: Record<string, [number, number]> = {
  'claude-haiku-4-5-20251001': [1, 5],
  'anthropic/claude-haiku-4.5': [1, 5],
  'anthropic/claude-haiku-4-5': [1, 5],
  'claude-sonnet-4-6': [3, 15],
  'anthropic/claude-sonnet-4-6': [3, 15],
  'anthropic/claude-sonnet-4.5': [3, 15],
  'anthropic/claude-sonnet-4-5': [3, 15],
  'deepseek/deepseek-v4-pro': [0.35, 1.4],
  'deepseek/deepseek-chat': [0.28, 1.1],
  'deepseek/deepseek-reasoner': [0.55, 2.2],
}
const DEFAULT_PRICING: [number, number] = [0.5, 2] // assume cheap-class if unknown

export function estimateCostUsd(model: string, inputTokens: number, outputTokens: number): number {
  const [inPrice, outPrice] = MODEL_PRICING[model] ?? DEFAULT_PRICING
  return (inputTokens / 1_000_000) * inPrice + (outputTokens / 1_000_000) * outPrice
}

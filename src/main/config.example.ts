// Shipped configuration — TEMPLATE. Copy to `config.ts` (gitignored) before building.
//
// No provider key ships in the app any more. AI runs through the metered cloud proxy
// once the user signs in (every account gets a free trial credit), or directly against
// the user's own pasted key (unmetered). See aiClient.ts + billing.ts.

// Cloud backend base: accounts, the metered AI proxy, billing/checkout, analytics sync.
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

// Browser extension. Installing it upgrades the app from address-bar scraping (a
// fallback) onto an accurate, richer sensor. Once the extension is published to the
// Chrome Web Store, set EXTENSION_STORE_ID to its ID: the app then offers a true
// one-click install (and, on managed setups, a registry force-install). Until then,
// install is a guided sideload of the downloadable build.
export const EXTENSION_STORE_ID = ''   // e.g. 'abcdefghijklmnopabcdefghijklmnop' once listed
export const EXTENSION_WEBSTORE_URL = EXTENSION_STORE_ID
  ? `https://chromewebstore.google.com/detail/${EXTENSION_STORE_ID}`
  : ''
// Where the sideloadable build lives until the store listing exists. Points at the LIVE
// deployment (attentify.ca isn't on Cloudflare yet); clicking Install downloads the zip.
export const EXTENSION_DOWNLOAD_URL = 'https://productivity-daemon.pages.dev/ext/attentify-extension.zip'

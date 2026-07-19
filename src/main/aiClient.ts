// Central AI client construction.
//
// One place decides HOW the app talks to the model:
//   1) the user pasted their OWN key  → talk to the provider DIRECTLY, unmetered
//      (their key, their bill — exactly as before);
//   2) otherwise, if SIGNED IN         → talk to the managed metered proxy: the backend
//      holds the real provider key, meters the call against this account's credit /
//      subscription, and forwards to OpenRouter. The Anthropic SDK just posts to
//      `${CLOUD_API_BASE}/v1/messages` with the account token as x-api-key.
//   3) neither                         → no client (the caller must prompt sign-in).
//
// No provider key ships in the app any more (the old bundled key is gone).

import Anthropic from '@anthropic-ai/sdk'
import { loadApiKey } from './keystore'
import { getCloudToken } from './billing'
import { CLOUD_API_BASE } from './config'

const OPENROUTER_BASE = 'https://openrouter.ai/api'
const OR_HEADERS = { 'HTTP-Referer': 'https://attentify.ca', 'X-Title': 'Attentify App' }

export interface AiClient {
  client: Anthropic | null
  /** true when model slugs should be OpenRouter-style (own OR key, or the proxy which forwards to OpenRouter). */
  isOpenRouter: boolean
  /** true when calls draw on the account's credit balance / subscription. */
  metered: boolean
}

export function buildAiClient(): AiClient {
  const own = loadApiKey()
  if (own) {
    const isOR = own.startsWith('sk-or-')
    return {
      client: new Anthropic({ apiKey: own, ...(isOR ? { baseURL: OPENROUTER_BASE, defaultHeaders: OR_HEADERS } : {}) }),
      isOpenRouter: isOR,
      metered: false,
    }
  }
  const token = getCloudToken()
  if (token) {
    return {
      client: new Anthropic({
        apiKey: token,
        baseURL: CLOUD_API_BASE.replace(/\/$/, ''),
        defaultHeaders: { 'X-Attentify-Client': 'app', ...OR_HEADERS },
      }),
      isOpenRouter: true,   // the proxy forwards to OpenRouter → use OpenRouter model slugs
      metered: true,
    }
  }
  return { client: null, isOpenRouter: false, metered: false }
}

// Free-tier metering + Cloud subscription state.
//
// The app ships with a bundled OpenRouter key (config.ts). Usage against it is
// metered in estimated USD; each install gets FREE_USAGE_LIMIT_USD of free AI.
// Once exhausted, AI is gated until the user either (a) pastes their own key, or
// (b) subscribes to the $5/mo Cloud plan (a validated license key). Neither a
// user-supplied key nor a Cloud subscription is metered.

import { getStore, patchStore } from './store'
import { recordModelUsage } from './data/repository'
import { loadApiKey } from './keystore'
import { BUNDLED_OPENROUTER_KEY, FREE_USAGE_LIMIT_USD, CLOUD_API_BASE, estimateCostUsd } from './config'
import { debugLog } from './debug/logger'
import type { UsageState, CloudState } from '../shared/types'

let onChange: ((usage: UsageState) => void) | null = null

export function setUsageChangeCallback(cb: (usage: UsageState) => void): void {
  onChange = cb
}

/** True when the user has pasted their own API key, their own usage is never metered. */
export function hasOwnKey(): boolean {
  return !!loadApiKey()
}

/** The key the AI engines should use: the user's own if set, otherwise the bundled one. */
export function getEffectiveApiKey(): string {
  return loadApiKey() ?? BUNDLED_OPENROUTER_KEY
}

export function isSubscribed(): boolean {
  return !!getStore().cloudActive
}

export function getUsageState(): UsageState {
  const used = getStore().aiUsageUsd ?? 0
  const subscribed = isSubscribed()
  const own = hasOwnKey()
  return {
    usedUsd: used,
    limitUsd: FREE_USAGE_LIMIT_USD,
    remainingUsd: Math.max(0, FREE_USAGE_LIMIT_USD - used),
    subscribed,
    hasOwnKey: own,
    exhausted: !own && !subscribed && used >= FREE_USAGE_LIMIT_USD,
  }
}

/** Whether an AI call is allowed right now. */
export function canUseAi(): boolean {
  return !getUsageState().exhausted
}

/**
 * Record the estimated cost of a completed AI call. Only the bundled free key is
 * metered, a user's own key and Cloud subscriptions are unmetered.
 */
export function recordUsage(model: string, inputTokens: number, outputTokens: number): void {
  if (!inputTokens && !outputTokens) return
  const cost = estimateCostUsd(model, inputTokens, outputTokens)

  // Always record per-model token usage locally (for the admin panel's cost breakdown),
  // regardless of whose key paid. Best-effort; never throws into the caller.
  try { recordModelUsage(model, inputTokens, outputTokens, cost) } catch { /* ignore */ }

  // Only the bundled free key is metered against the free allowance.
  if (hasOwnKey() || isSubscribed()) return
  if (cost <= 0) return
  const prev = getStore().aiUsageUsd ?? 0
  patchStore({ aiUsageUsd: prev + cost })
  debugLog('billing:usage', { model, inputTokens, outputTokens, cost: +cost.toFixed(5), total: +(prev + cost).toFixed(4) })
  onChange?.(getUsageState())
}

// ── Cloud subscription (license key) ──────────────────────────────────────────

export function getCloudState(): CloudState {
  const s = getStore()
  return {
    license: s.cloudLicense ?? null,
    active: !!s.cloudActive,
    tier: s.cloudTier ?? null,
    email: s.cloudEmail ?? null,
  }
}

/** Validate a Cloud license key against the backend and persist its tier/status. */
export async function setCloudLicense(license: string): Promise<CloudState> {
  const key = (license ?? '').trim()
  if (!key) {
    patchStore({ cloudLicense: undefined, cloudActive: false, cloudTier: undefined, cloudEmail: undefined })
    onChange?.(getUsageState())
    return getCloudState()
  }
  try {
    const res = await fetch(`${CLOUD_API_BASE.replace(/\/$/, '')}/v1/me`, {
      headers: { Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(8000),
    })
    if (res.ok) {
      const data = (await res.json()) as { user?: { tier?: string; status?: string; email?: string } }
      const u = data.user
      const active = u?.status === 'active' && u?.tier === 'cloud'
      patchStore({ cloudLicense: key, cloudActive: active, cloudTier: u?.tier, cloudEmail: u?.email })
    } else {
      patchStore({ cloudLicense: key, cloudActive: false, cloudTier: undefined })
    }
  } catch (e) {
    debugLog('billing:cloud-validate-failed', { error: String(e) })
    patchStore({ cloudLicense: key, cloudActive: false })
  }
  onChange?.(getUsageState())
  return getCloudState()
}

export function clearCloudLicense(): void {
  patchStore({ cloudLicense: undefined, cloudActive: false, cloudTier: undefined, cloudEmail: undefined })
  onChange?.(getUsageState())
}

/** Start a $5/mo Cloud checkout, returning the hosted Stripe URL to open externally. */
export async function startCheckout(email?: string): Promise<{ url?: string; error?: string }> {
  try {
    const res = await fetch(`${CLOUD_API_BASE.replace(/\/$/, '')}/v1/billing/checkout`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: email || undefined }),
      signal: AbortSignal.timeout(15000),
    })
    const data = (await res.json()) as { url?: string; error?: string }
    return { url: data.url, error: data.error }
  } catch (e) {
    return { error: String(e) }
  }
}

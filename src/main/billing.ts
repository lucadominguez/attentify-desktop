// Account credit/subscription state (client side).
//
// All managed AI runs through the backend proxy, which meters each call against the
// account: subscribers draw on a monthly fair-use allowance; everyone else spends a
// credit balance (every new account gets a free trial credit). This module holds the
// cached balance/subscription the backend reports and exposes it to the renderer + the
// gating checks. A user who pastes their OWN key is unmetered and never gated here.

import { getStore, patchStore } from './store'
import { recordModelUsage } from './data/repository'
import { loadApiKey } from './keystore'
import { CLOUD_API_BASE, estimateCostUsd } from './config'
import { debugLog } from './debug/logger'
import type { UsageState, CloudState } from '../shared/types'

const CREDIT_UNIT_MICROS = 1000   // 1 credit = $0.001 (matches the backend)
const base = (): string => CLOUD_API_BASE.replace(/\/$/, '')

let onChange: ((usage: UsageState) => void) | null = null
export function setUsageChangeCallback(cb: (usage: UsageState) => void): void {
  onChange = cb
}

/** True when the user has pasted their own API key — their usage is never metered. */
export function hasOwnKey(): boolean {
  return !!loadApiKey()
}

/** The account token (session or license) used to authenticate the metered proxy. */
export function getCloudToken(): string | null {
  const s = getStore()
  return s.authToken ?? s.cloudLicense ?? null
}

export function isSignedIn(): boolean {
  return !!getCloudToken()
}

export function isSubscribed(): boolean {
  return !!getStore().cloudActive
}

export function getUsageState(): UsageState {
  const s = getStore()
  const own = hasOwnKey()
  const subscribed = isSubscribed()
  const signedIn = isSignedIn()
  const balanceMicros = s.creditMicros ?? 0
  const credits = Math.max(0, Math.round(balanceMicros / CREDIT_UNIT_MICROS))
  const metered = !own && !subscribed
  return {
    credits,
    balanceMicros,
    subscribed,
    hasOwnKey: own,
    signedIn,
    // Out of credit only applies to a signed-in, metered account with an empty balance.
    outOfCredit: metered && signedIn && balanceMicros <= 0,
    canUseAi: own || subscribed || (signedIn && balanceMicros > 0),
  }
}

/** Whether an AI call is allowed right now (own key / subscription / positive balance). */
export function canUseAi(): boolean {
  return getUsageState().canUseAi
}

/**
 * Record a completed AI call for the LOCAL admin cost panel only (the authoritative
 * metering happens server-side in the proxy). If the call was metered, schedule a
 * debounced balance refresh so the UI reflects the new balance.
 */
export function recordUsage(model: string, inputTokens: number, outputTokens: number): void {
  if (!inputTokens && !outputTokens) return
  const cost = estimateCostUsd(model, inputTokens, outputTokens)
  try { recordModelUsage(model, inputTokens, outputTokens, cost) } catch { /* ignore */ }
  if (!hasOwnKey() && isSignedIn() && !isSubscribed()) scheduleBalanceRefresh()
}

// ── Server-truth balance ────────────────────────────────────────────────────────
let refreshTimer: ReturnType<typeof setTimeout> | null = null
function scheduleBalanceRefresh(): void {
  if (refreshTimer) return
  refreshTimer = setTimeout(() => { refreshTimer = null; void refreshCloudBalance() }, 4000)
}

interface MeUser { email?: string; tier?: string; status?: string; subscribed?: boolean; balanceMicros?: number }

/** Pull the current balance + subscription from the backend and notify the renderer. */
export async function refreshCloudBalance(): Promise<void> {
  const token = getCloudToken()
  if (!token) { onChange?.(getUsageState()); return }
  try {
    const res = await fetch(`${base()}/v1/me`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(8000),
    })
    if (res.ok) {
      const data = (await res.json()) as { user?: MeUser }
      const u = data.user
      if (u) {
        patchStore({
          creditMicros: u.balanceMicros ?? 0,
          cloudActive: u.subscribed ?? (u.status === 'active' && u.tier === 'cloud'),
          cloudTier: u.tier,
          cloudEmail: u.email ?? getStore().cloudEmail,
        })
      }
    } else if (res.status === 401) {
      // Token no longer valid — treat as signed out for gating purposes.
      patchStore({ cloudActive: false })
    }
  } catch (e) {
    debugLog('billing:balance-refresh-failed', { error: String(e) })
  }
  onChange?.(getUsageState())
}

// ── Cloud subscription / license ──────────────────────────────────────────────
export function getCloudState(): CloudState {
  const s = getStore()
  return {
    license: s.cloudLicense ?? null,
    active: !!s.cloudActive,
    tier: s.cloudTier ?? null,
    email: s.cloudEmail ?? null,
  }
}

/** Validate a pasted license key against the backend and persist its tier/balance. */
export async function setCloudLicense(license: string): Promise<CloudState> {
  const key = (license ?? '').trim()
  if (!key) {
    patchStore({ cloudLicense: undefined, cloudActive: false, cloudTier: undefined, cloudEmail: undefined, creditMicros: 0 })
    onChange?.(getUsageState())
    return getCloudState()
  }
  patchStore({ cloudLicense: key })
  await refreshCloudBalance()
  return getCloudState()
}

export function clearCloudLicense(): void {
  patchStore({ cloudLicense: undefined, cloudActive: false, cloudTier: undefined, cloudEmail: undefined })
  onChange?.(getUsageState())
}

/** Start a $9.99/mo subscription checkout, returning the hosted Stripe URL. */
export async function startCheckout(email?: string): Promise<{ url?: string; error?: string }> {
  try {
    const res = await fetch(`${base()}/v1/billing/checkout`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: email || getStore().cloudEmail || undefined }),
      signal: AbortSignal.timeout(15000),
    })
    const data = (await res.json()) as { url?: string; error?: string }
    return { url: data.url, error: data.error }
  } catch (e) {
    return { error: String(e) }
  }
}

/** Start a one-time credit-pack purchase ('5' | '10' | '20'), returning the hosted URL. */
export async function buyCredits(pack: string): Promise<{ url?: string; error?: string }> {
  const token = getCloudToken()
  if (!token) return { error: 'Sign in to buy credits.' }
  try {
    const res = await fetch(`${base()}/v1/billing/credits`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ pack }),
      signal: AbortSignal.timeout(15000),
    })
    const data = (await res.json()) as { url?: string; error?: string }
    return { url: data.url, error: data.error }
  } catch (e) {
    return { error: String(e) }
  }
}

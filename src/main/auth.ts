// In-app account authentication.
//
// The desktop app can sign in / create an account with email + password against the
// cloud backend (the same accounts the website uses). On success we persist the 30-day
// session token AND the account's license key: the token establishes identity and lets
// us restore the session on launch, while the license key continues to drive AI/cloud
// gating so existing billing + cloudSync keep working with zero changes.
//
// Auth is intentionally decoupled from payment: a brand-new account is `tier: 'free'`
// and simply identifies the user. Subscription gating (cloudActive) is unchanged.

import http from 'node:http'
import os from 'node:os'
import type { AddressInfo } from 'node:net'
import { randomBytes, createHash } from 'node:crypto'
import { shell } from 'electron'
import { getStore, patchStore } from './store'
import { CLOUD_API_BASE } from './config'
import { debugLog } from './debug/logger'
import type { AuthState, AuthResult, AuthProvider } from '../shared/types'

const base = (): string => CLOUD_API_BASE.replace(/\/$/, '')

interface BackendUser { email?: string; tier?: string; status?: string; license_key?: string; subscribed?: boolean; balanceMicros?: number }

// Stable-ish per-device fingerprint (hostname + platform + MAC addresses, hashed). Sent
// on signup so the backend grants the one-time free trial credit at most once per device,
// surviving reinstalls — the client-side half of the trial anti-abuse gate.
function deviceFingerprint(): string {
  const macs = Object.values(os.networkInterfaces())
    .flat()
    .filter((n): n is os.NetworkInterfaceInfo => !!n && !n.internal && !!n.mac && n.mac !== '00:00:00:00:00:00')
    .map((n) => n.mac)
  const basis = [os.hostname(), os.platform(), os.arch(), ...new Set(macs)].join('|')
  return createHash('sha256').update(basis).digest('hex').slice(0, 32)
}

export function getAuthState(): AuthState {
  const s = getStore()
  return {
    signedIn: !!s.authToken,
    email: s.cloudEmail ?? null,
    tier: s.cloudTier ?? null,
    subscribed: !!s.cloudActive,
  }
}

// Persist a freshly authenticated user: session token for identity + license/tier for
// gating. Called after signup/login and on session restore.
function applyUser(token: string | null, user: BackendUser): void {
  const active = user.subscribed ?? (user.status === 'active' && user.tier === 'cloud')
  patchStore({
    authToken: token ?? undefined,
    cloudLicense: user.license_key ?? getStore().cloudLicense,
    cloudActive: active,
    cloudTier: user.tier,
    cloudEmail: user.email,
    ...(typeof user.balanceMicros === 'number' ? { creditMicros: user.balanceMicros } : {}),
  })
}

async function authRequest(path: string, body: Record<string, unknown>): Promise<AuthResult> {
  try {
    const res = await fetch(`${base()}${path}`, {
      method: 'POST',
      // X-Attentify-Client marks this as the desktop app: the backend uses the device
      // fingerprint (below) for trial anti-abuse instead of the browser-only Turnstile.
      headers: { 'Content-Type': 'application/json', 'X-Attentify-Client': 'app' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(12000),
    })
    const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string; token?: string; user?: BackendUser }
    if (!res.ok || !data.ok || !data.user) {
      return { ok: false, error: data.error || `Request failed (${res.status})` }
    }
    applyUser(data.token ?? null, data.user)
    return { ok: true, auth: getAuthState() }
  } catch (e) {
    debugLog('auth:request-failed', { path, error: String(e) })
    const msg = String(e).includes('timeout') ? 'Could not reach the server, check your connection.' : 'Something went wrong. Try again.'
    return { ok: false, error: msg }
  }
}

export async function signup(email: string, password: string): Promise<AuthResult> {
  const em = (email || '').trim().toLowerCase()
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(em)) return { ok: false, error: 'Enter a valid email address.' }
  if ((password || '').length < 8) return { ok: false, error: 'Password must be at least 8 characters.' }
  return authRequest('/v1/auth/signup', { email: em, password, fingerprint: deviceFingerprint() })
}

export async function login(email: string, password: string): Promise<AuthResult> {
  const em = (email || '').trim().toLowerCase()
  if (!em || !password) return { ok: false, error: 'Enter your email and password.' }
  return authRequest('/v1/auth/login', { email: em, password })
}

export async function logout(): Promise<void> {
  const token = getStore().authToken
  if (token) {
    try {
      await fetch(`${base()}/v1/auth/logout`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(8000),
      })
    } catch { /* best-effort; clear locally regardless */ }
  }
  patchStore({ authToken: undefined, cloudLicense: undefined, cloudActive: false, cloudTier: undefined, cloudEmail: undefined })
}

// On launch, revalidate the stored session so the account state is fresh (tier changes,
// expiry). A 401 means the 30-day session lapsed → sign out locally.
export async function restoreSession(): Promise<void> {
  const token = getStore().authToken
  if (!token) return
  try {
    const res = await fetch(`${base()}/v1/auth/session`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(8000),
    })
    if (res.status === 401) {
      patchStore({ authToken: undefined })
      debugLog('auth:session-expired', {})
      return
    }
    if (res.ok) {
      const data = (await res.json().catch(() => ({}))) as { user?: BackendUser }
      if (data.user) applyUser(token, data.user)
    }
  } catch (e) {
    // Offline / transient — keep the local session; try again next launch.
    debugLog('auth:restore-failed', { error: String(e) })
  }
}

// ── Social sign-in (Google / Facebook / GitHub / Microsoft) ──────────────────────
// Which providers the backend has credentials for. The renderer only shows buttons
// for providers in this list, so we never offer one that can't complete.
export async function getAuthProviders(): Promise<AuthProvider[]> {
  try {
    const res = await fetch(`${base()}/v1/auth/providers`, { signal: AbortSignal.timeout(8000) })
    const data = (await res.json().catch(() => ({}))) as { providers?: AuthProvider[] }
    return Array.isArray(data.providers) ? data.providers : []
  } catch { return [] }
}

function oauthResultHtml(okState: boolean): string {
  const msg = okState
    ? 'You’re signed in. You can close this tab and return to Attentify.'
    : 'Sign-in didn’t complete. You can close this tab and try again in Attentify.'
  return `<!doctype html><html><head><meta charset="utf-8"><title>Attentify</title>
<style>body{margin:0;height:100vh;display:flex;align-items:center;justify-content:center;
font-family:system-ui,Segoe UI,Roboto,sans-serif;background:#0b0b12;color:#e5e7eb}
.card{max-width:360px;text-align:center;padding:32px}h1{font-size:16px;margin:0 0 8px;color:#a78bfa}
p{font-size:13px;color:#9ca3af;line-height:1.5;margin:0}</style></head>
<body><div class="card"><h1>Attentify</h1><p>${msg}</p></div></body></html>`
}

function friendlyOauthError(code: string | null): string {
  switch (code) {
    case 'no_email': return 'That account didn’t share an email address, which we need to sign you in.'
    case 'exchange_failed': return 'The sign-in provider rejected the request. Please try again.'
    case 'access_denied': return 'Sign-in was cancelled.'
    case 'timeout': return 'Sign-in timed out. Please try again.'
    default: return 'Sign-in could not be completed. Please try again.'
  }
}

// Sign in with a social provider using the "loopback" desktop OAuth flow: open the
// provider login in the user's real browser, listen on a throwaway 127.0.0.1 port, and
// let the backend hand the finished session token back to that port (bound to a random
// nonce so another local process can't hijack it).
export async function oauthLogin(provider: AuthProvider): Promise<AuthResult> {
  return new Promise<AuthResult>((resolve) => {
    const nonce = randomBytes(16).toString('hex')
    let settled = false

    const finish = async (token: string | null, errCode: string | null): Promise<void> => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      try { server.close() } catch { /* ignore */ }
      if (!token) { resolve({ ok: false, error: friendlyOauthError(errCode) }); return }
      patchStore({ authToken: token })
      await restoreSession() // hydrates cloudEmail / tier from /v1/auth/session
      const st = getAuthState()
      resolve(st.signedIn ? { ok: true, auth: st } : { ok: false, error: 'Sign-in could not be completed.' })
    }

    const server = http.createServer((req, res) => {
      let reqUrl: URL
      try { reqUrl = new URL(req.url ?? '/', 'http://127.0.0.1') } catch { res.writeHead(400); res.end(); return }
      if (reqUrl.pathname !== '/cb') { res.writeHead(404); res.end('Not found'); return }
      const token = reqUrl.searchParams.get('token')
      const gotNonce = reqUrl.searchParams.get('nonce')
      const errCode = reqUrl.searchParams.get('error')
      const good = !errCode && !!token && gotNonce === nonce
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
      res.end(oauthResultHtml(good))
      void finish(good ? token : null, good ? null : (errCode ?? 'state_mismatch'))
    })

    server.on('error', (e) => {
      if (settled) return
      settled = true
      debugLog('auth:oauth-listen-failed', { error: String(e) })
      resolve({ ok: false, error: 'Could not start the local sign-in listener. Please try again.' })
    })

    // Give the user 5 minutes to complete the browser flow, then give up.
    const timer = setTimeout(() => { void finish(null, 'timeout') }, 5 * 60 * 1000)

    server.listen(0, '127.0.0.1', () => {
      const addr = server.address() as AddressInfo | null
      const port = addr ? addr.port : 0
      const cb = `http://127.0.0.1:${port}/cb`
      const startUrl = `${base()}/v1/auth/oauth/${encodeURIComponent(provider)}/start`
        + `?cb=${encodeURIComponent(cb)}&nonce=${nonce}`
      void shell.openExternal(startUrl)
    })
  })
}

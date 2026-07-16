import { createHash } from 'crypto'

// Identity of a *classification context*, not a URL. Two visits that should get the same
// verdict must hash to the same fingerprint, and two that legitimately differ (youtube
// homepage vs a /watch tutorial while a coding goal is active) must not. This is what lets
// feedback on one visit inform the next, and what a per-context cache should key on.
//
// Bumped whenever the rules/taxonomy/prompt change, so stale feedback and cache entries
// from an older classifier are never silently trusted as if they described the current one.
export const CLASSIFIER_VERSION = 'clf-2026.07.0-rules'

// A small two-level-TLD table. A full Public Suffix List is the correct fix (and is noted
// as a separate task), but even this stops the worst registered-domain mistakes — e.g.
// treating `bbc.co.uk` as `co.uk`, or `a.github.io` and `b.github.io` as the same site.
const TWO_LEVEL_TLDS = new Set([
  'co.uk', 'org.uk', 'gov.uk', 'ac.uk', 'me.uk',
  'com.au', 'net.au', 'org.au', 'co.nz', 'co.jp', 'co.kr', 'co.in', 'co.za',
  'com.br', 'com.mx', 'com.tr', 'com.sg', 'com.hk', 'com.tw',
])

// eTLD+1. `docs.google.com` and `news.google.com` share a registered domain, which is
// correct — but the pathClass below keeps them from being scored as one thing.
export function registeredDomain(hostname: string): string {
  const h = (hostname || '').replace(/^www\./, '').toLowerCase().replace(/\.$/, '')
  const parts = h.split('.').filter(Boolean)
  if (parts.length <= 2) return h
  const lastTwo = parts.slice(-2).join('.')
  if (TWO_LEVEL_TLDS.has(lastTwo)) return parts.slice(-3).join('.')
  return lastTwo
}

// A coarse bucket for the URL path. The point is the handful of routes that FLIP a site's
// meaning — youtube /shorts vs /watch, reddit /r/<community>, a feed vs a DM inbox — not a
// per-URL label. Anything unremarkable collapses to a stable, low-cardinality token so
// fingerprints group rather than scatter.
export function pathClass(pathname: string | undefined): string {
  const p = (pathname || '/').toLowerCase()
  if (p === '/' || p === '') return 'root'
  const seg = p.split('/').filter(Boolean)
  const first = seg[0] ?? ''
  if (first === 'shorts') return 'shorts'
  if (first === 'watch' || first === 'video' || first === 'videos' || first === 'v') return 'watch'
  if (first === 'results' || first === 'search') return 'search'
  // Community identity matters: r/programming is not r/aww. Keep the name.
  if (first === 'r' && seg[1]) return `sub:${seg[1]}`
  if (['feed', 'home', 'explore', 'trending', 'reels', 'foryou', 'fyp'].includes(first)) return 'feed'
  if (['messages', 'message', 'dm', 'dms', 'inbox', 'chat', 'chats'].includes(first)) return 'messaging'
  // A trailing numeric-ish id usually means an article/thread/product page.
  if (/^\d/.test(seg[seg.length - 1] ?? '') && seg.length > 1) return 'article'
  return first.length > 24 ? 'deep' : first
}

// Derive both identity tokens from a raw URL in one shot.
export function contextTokens(url: string | undefined): { registeredDomain: string; pathClass: string } {
  if (!url) return { registeredDomain: '', pathClass: '-' }
  try {
    const u = new URL(url.startsWith('http') ? url : `https://${url}`)
    return { registeredDomain: registeredDomain(u.hostname), pathClass: pathClass(u.pathname) }
  } catch {
    return { registeredDomain: '', pathClass: '-' }
  }
}

export function contextFingerprint(input: {
  registeredDomain: string
  pathClass?: string
  goalId?: string
  classifierVersion?: string
}): string {
  const key = [
    input.registeredDomain || '-',
    input.pathClass || '-',
    input.goalId || '-',
    input.classifierVersion || CLASSIFIER_VERSION,
  ].join('|')
  return 'fp_' + createHash('sha1').update(key).digest('hex').slice(0, 16)
}

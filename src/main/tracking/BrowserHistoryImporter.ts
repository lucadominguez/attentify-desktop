import { existsSync, copyFileSync, readFileSync, readdirSync, mkdtempSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir, homedir } from 'os'
import { getSqlJs } from '../data/db'
import type { ActivitySession, AppCategory } from '../../shared/types'
import { debugLog } from '../debug/logger'

// Bootstraps analytics with the user's real browsing history so the app has data "from
// inception" instead of only what it observes after install. On Windows/macOS the
// browser history SQLite files live in the current user's own profile, so no special OS
// permission is needed — we just read them (copying first to dodge the live DB lock).

// ── Domain → category classification (compact; distraction-aware) ───────────────

const DISTRACTING_DOMAINS: Record<string, AppCategory> = {}
const add = (cat: AppCategory, list: string[]): void => { for (const d of list) DISTRACTING_DOMAINS[d] = cat }
add('social', ['twitter.com', 'x.com', 'instagram.com', 'facebook.com', 'tiktok.com', 'snapchat.com', 'reddit.com', 'threads.net', 'pinterest.com', 'tumblr.com', 'linkedin.com', 'quora.com'])
add('entertainment', ['youtube.com', 'youtu.be', 'netflix.com', 'twitch.tv', 'hulu.com', 'disneyplus.com', 'primevideo.com', 'hbomax.com', 'vimeo.com', 'dailymotion.com', 'crunchyroll.com', 'spotify.com'])
add('gaming', ['steampowered.com', 'epicgames.com', 'chess.com', 'lichess.org', 'roblox.com', 'ign.com', 'twitch.tv'])

// Browsing that's distracting but keeps the generic "browser" category.
const DISTRACTING_BROWSE = new Set<string>([
  'cnn.com', 'foxnews.com', 'bbc.com', 'nytimes.com', 'buzzfeed.com', 'dailymail.co.uk', '9gag.com', 'imgur.com',
  'amazon.com', 'ebay.com', 'etsy.com', 'aliexpress.com', 'temu.com', 'shein.com',
  'news.ycombinator.com', '4chan.org',
])

// Clearly productive destinations.
const PRODUCTIVE_DOMAINS = new Set<string>([
  'github.com', 'gitlab.com', 'stackoverflow.com', 'stackexchange.com', 'developer.mozilla.org',
  'docs.google.com', 'notion.so', 'figma.com', 'linear.app', 'jira.com', 'confluence.com',
  'overleaf.com', 'colab.research.google.com', 'kaggle.com', 'huggingface.co', 'arxiv.org', 'chatgpt.com', 'claude.ai',
])

function classify(domain: string): { category: AppCategory; isDistraction: boolean } {
  const d = domain.replace(/^www\./, '')
  if (PRODUCTIVE_DOMAINS.has(d)) return { category: 'productivity', isDistraction: false }
  if (DISTRACTING_DOMAINS[d]) return { category: DISTRACTING_DOMAINS[d]!, isDistraction: true }
  if (DISTRACTING_BROWSE.has(d)) return { category: 'browser', isDistraction: true }
  return { category: 'browser', isDistraction: false }
}

function hostOf(url: string): string | null {
  try { return new URL(url).hostname.replace(/^www\./, '') } catch { return null }
}

// ── Locate browser history files ────────────────────────────────────────────────

interface Source { browser: string; file: string; engine: 'chromium' | 'firefox' }

function chromiumProfiles(base: string): string[] {
  // "Default" plus any "Profile N" directories.
  const out: string[] = []
  for (const name of ['Default']) if (existsSync(join(base, name, 'History'))) out.push(join(base, name, 'History'))
  try {
    for (const entry of readdirSync(base)) {
      if (/^Profile /.test(entry) && existsSync(join(base, entry, 'History'))) out.push(join(base, entry, 'History'))
    }
  } catch { /* ignore */ }
  return out
}

function findSources(): Source[] {
  const sources: Source[] = []
  const home = homedir()
  const local = process.env['LOCALAPPDATA'] || join(home, 'AppData', 'Local')
  const roaming = process.env['APPDATA'] || join(home, 'AppData', 'Roaming')

  const chromiumBases: [string, string][] = process.platform === 'darwin'
    ? [
        ['Chrome', join(home, 'Library', 'Application Support', 'Google', 'Chrome')],
        ['Edge', join(home, 'Library', 'Application Support', 'Microsoft Edge')],
        ['Brave', join(home, 'Library', 'Application Support', 'BraveSoftware', 'Brave-Browser')],
        ['Vivaldi', join(home, 'Library', 'Application Support', 'Vivaldi')],
        ['Opera', join(home, 'Library', 'Application Support', 'com.operasoftware.Opera')],
        ['Arc', join(home, 'Library', 'Application Support', 'Arc', 'User Data')],
        ['Chromium', join(home, 'Library', 'Application Support', 'Chromium')],
      ]
    : [
        ['Chrome', join(local, 'Google', 'Chrome', 'User Data')],
        ['Edge', join(local, 'Microsoft', 'Edge', 'User Data')],
        ['Brave', join(local, 'BraveSoftware', 'Brave-Browser', 'User Data')],
        ['Vivaldi', join(local, 'Vivaldi', 'User Data')],
        ['Opera', join(roaming, 'Opera Software', 'Opera Stable')],
        ['Opera GX', join(roaming, 'Opera Software', 'Opera GX Stable')],
        ['Yandex', join(local, 'Yandex', 'YandexBrowser', 'User Data')],
        ['Arc', join(local, 'Arc', 'User Data')],
        ['Chromium', join(local, 'Chromium', 'User Data')],
      ]

  for (const [browser, base] of chromiumBases) {
    if (!existsSync(base)) continue
    // Opera keeps History directly in its profile dir (no "Default" subfolder).
    if (existsSync(join(base, 'History'))) sources.push({ browser, file: join(base, 'History'), engine: 'chromium' })
    for (const file of chromiumProfiles(base)) sources.push({ browser, file, engine: 'chromium' })
  }

  // Firefox family (Firefox, Waterfox, LibreFox, Pale Moon) — all use places.sqlite.
  const ffBases = process.platform === 'darwin'
    ? [
        join(home, 'Library', 'Application Support', 'Firefox', 'Profiles'),
        join(home, 'Library', 'Application Support', 'Waterfox', 'Profiles'),
        join(home, 'Library', 'Application Support', 'LibreWolf', 'Profiles'),
      ]
    : [
        join(roaming, 'Mozilla', 'Firefox', 'Profiles'),
        join(roaming, 'Waterfox', 'Profiles'),
        join(roaming, 'librewolf', 'Profiles'),
        join(roaming, 'Moonchild Productions', 'Pale Moon', 'Profiles'),
      ]
  for (const ffProfiles of ffBases) {
    try {
      if (!existsSync(ffProfiles)) continue
      for (const prof of readdirSync(ffProfiles)) {
        const places = join(ffProfiles, prof, 'places.sqlite')
        if (existsSync(places)) sources.push({ browser: 'Firefox', file: places, engine: 'firefox' })
      }
    } catch { /* ignore */ }
  }

  return sources
}

// ── Read one history DB into raw visits ─────────────────────────────────────────

interface RawVisit { url: string; title: string; ts: number }

function readSource(src: Source, sinceMs: number, tmp: string): RawVisit[] {
  // Copy first — the live DB is often locked by the running browser.
  const copy = join(tmp, `${src.browser}-${Math.random().toString(36).slice(2)}.db`)
  try { copyFileSync(src.file, copy) } catch { return [] }

  let bytes: Buffer
  try { bytes = readFileSync(copy) } catch { return [] }

  const SQL = getSqlJs()
  let db: import('sql.js').Database | null = null
  const out: RawVisit[] = []
  try {
    db = new SQL.Database(bytes)
    if (src.engine === 'chromium') {
      // Chromium timestamps are microseconds since 1601-01-01.
      const chromeSince = (sinceMs + 11644473600000) * 1000
      const res = db.exec(
        `SELECT urls.url, urls.title, visits.visit_time
         FROM visits JOIN urls ON visits.url = urls.id
         WHERE visits.visit_time > ${chromeSince}
         ORDER BY visits.visit_time ASC LIMIT 40000`
      )
      for (const r of res[0]?.values ?? []) {
        const url = r[0] as string
        const ts = Math.round((r[2] as number) / 1000 - 11644473600000)
        if (url && ts > 0) out.push({ url, title: (r[1] as string) || '', ts })
      }
    } else {
      // Firefox timestamps are microseconds since the Unix epoch.
      const ffSince = sinceMs * 1000
      const res = db.exec(
        `SELECT p.url, p.title, h.visit_date
         FROM moz_historyvisits h JOIN moz_places p ON h.place_id = p.id
         WHERE h.visit_date > ${ffSince}
         ORDER BY h.visit_date ASC LIMIT 40000`
      )
      for (const r of res[0]?.values ?? []) {
        const url = r[0] as string
        const ts = Math.round((r[2] as number) / 1000)
        if (url && ts > 0) out.push({ url, title: (r[1] as string) || '', ts })
      }
    }
  } catch (e) {
    debugLog('history:read-error', { browser: src.browser, error: String(e) })
  } finally {
    try { db?.close() } catch { /* ignore */ }
    try { rmSync(copy, { force: true }) } catch { /* ignore */ }
  }
  return out
}

// ── Public: import history as ActivitySession[] ─────────────────────────────────

const MIN_DUR = 20_000            // floor per visit
const MAX_DUR = 12 * 60 * 1000    // cap so an overnight gap isn't counted as browsing

export function importBrowserHistory(days = 30): ActivitySession[] {
  const sinceMs = Date.now() - days * 24 * 3600000
  const sources = findSources()
  if (sources.length === 0) { debugLog('history:no-sources', {}); return [] }

  const tmp = mkdtempSync(join(tmpdir(), 'attentify-hist-'))
  const raw: (RawVisit & { browser: string })[] = []
  try {
    for (const src of sources) {
      for (const v of readSource(src, sinceMs, tmp)) raw.push({ ...v, browser: src.browser.toLowerCase() })
    }
  } finally {
    try { rmSync(tmp, { recursive: true, force: true }) } catch { /* ignore */ }
  }
  if (raw.length === 0) return []

  // Order all visits and estimate a duration from the gap to the next visit (capped),
  // which spreads history realistically across each day for the timesheet.
  raw.sort((a, b) => a.ts - b.ts)
  const sessions: ActivitySession[] = []
  for (let i = 0; i < raw.length; i++) {
    const v = raw[i]!
    const host = hostOf(v.url)
    if (!host) continue
    const next = raw[i + 1]
    const gap = next ? next.ts - v.ts : 90_000
    const duration = Math.min(MAX_DUR, Math.max(MIN_DUR, gap))
    const { category, isDistraction } = classify(host)
    sessions.push({
      id: `hist-${v.browser}-${v.ts}-${host}`,
      app: v.browser,               // consistent with live tracking (process = browser)
      title: v.title || host,
      url: v.url,
      category,
      startTime: v.ts,
      endTime: v.ts + duration,
      duration,
      isDistraction,
    })
  }
  debugLog('history:imported', { sources: sources.length, visits: raw.length, sessions: sessions.length })
  return sessions
}

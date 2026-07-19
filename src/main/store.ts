import { app } from 'electron'
import { join } from 'path'
import { readFileSync, writeFileSync, existsSync, mkdirSync, renameSync, copyFileSync } from 'fs'
import type { AppStore } from '../shared/types'

const defaultSettings = {
  trackingEnabled: true,
  heuristicsEnabled: true,
  weeklyReportEnabled: true,
  productiveApps: ['code', 'devenv', 'cursor', 'notion', 'obsidian', 'word', 'excel', 'pages', 'numbers'],
  distractingApps: ['discord', 'slack', 'twitter', 'instagram', 'tiktok', 'reddit'],
  focusGoalHoursPerDay: 4,
  ollamaUrl: 'http://localhost:11434',
  ollamaModel: 'phi3:mini',
  alwaysOn: false,
}

const defaultStore: AppStore = {
  blocklist: { domains: [], processes: [] },
  sessions: [],
  schedules: [],
  stats: [],
  activitySessions: [],
  dailyStats: [],
  heuristicAlerts: [],
  weeklyReports: [],
  lastScan: null,
  onboardingComplete: false,
  elevation: 'unknown',
  chatHistory: [],
  settings: defaultSettings,
  blockEventCount: 0,
  aiUsageUsd: 0,
  creditMicros: 0,
  cloudActive: false,
  // Shown in the Overview as feed-level blocks (enforced by the browser extension).
  feedBlocks: [
    { domain: 'reddit.com', displayName: 'Reddit feed' },
    { domain: 'twitter.com', displayName: 'Twitter / X feed' },
  ],
}

// The on-disk data directory. On Windows this is pinned to a FIXED absolute path
// rather than app.getPath('userData'), deliberately: index.ts redirects userData to
// C:\ProgramData\Attentify via app.setPath during startup, but that call happens
// AFTER module imports are evaluated. If anything reads the store before setPath runs
// (an eager load, or a side-effect in an imported module's constructor), it would read
// from the *default* AppData path, where nothing exists → onboardingComplete:false →
// onboarding shows, while later saves go to ProgramData. Reads and writes would target
// different files and every launch would look like a fresh install. Hard-coding the path
// here makes reads and writes deterministic regardless of setPath timing.
function dataDir(): string {
  if (process.platform === 'win32') return join('C:\\ProgramData', 'Attentify')
  return app.getPath('userData')
}

function getStorePath(): string {
  const dir = dataDir()
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  return join(dir, 'state.json')
}

function hydrate(parsed: Partial<AppStore>): AppStore {
  // Merge with defaults to handle new fields
  return {
    ...defaultStore,
    ...parsed,
    settings: { ...defaultSettings, ...(parsed.settings ?? {}) },
  }
}

export function loadStore(): AppStore {
  const path = getStorePath()
  try {
    if (!existsSync(path)) return { ...defaultStore }
    return hydrate(JSON.parse(readFileSync(path, 'utf-8')))
  } catch (err) {
    // The old behaviour here was `return { ...defaultStore }`, which silently wiped
    // everything the user had: every blocked domain, their sign-in, their settings,
    // their cards. The next save then made that loss permanent. A file we cannot parse
    // is a bug to investigate, not a signal to factory-reset someone's app.
    console.error('[store] state file unreadable:', err)

    // Prefer the last known-good snapshot over defaults.
    try {
      if (existsSync(`${path}.bak`)) {
        const recovered = hydrate(JSON.parse(readFileSync(`${path}.bak`, 'utf-8')))
        console.error('[store] recovered from .bak')
        // Keep the unreadable file for diagnosis rather than overwriting it blind.
        try { renameSync(path, `${path}.corrupt-${Date.now()}`) } catch { /* best effort */ }
        return recovered
      }
    } catch (e2) {
      console.error('[store] .bak also unreadable:', e2)
    }

    try { renameSync(path, `${path}.corrupt-${Date.now()}`) } catch { /* best effort */ }
    return { ...defaultStore }
  }
}

export function saveStore(store: AppStore): void {
  const path = getStorePath()
  try {
    const json = JSON.stringify(store, null, 2)

    // Atomic write. writeFileSync truncates the file and then writes into it, so an
    // interrupted save (crash, power loss, kill) leaves a half-written file that cannot
    // be parsed, and any reader that opens the file mid-write sees a torn copy. Writing
    // to a temp file and renaming makes the swap atomic: readers see either the whole old
    // file or the whole new one, never a fragment.
    const tmp = `${path}.tmp`
    writeFileSync(tmp, json, 'utf-8')

    // Keep the previous good copy as .bak before swapping, so loadStore has something to
    // recover from if the swap itself is interrupted.
    try { if (existsSync(path)) copyFileSync(path, `${path}.bak`) } catch { /* best effort */ }

    renameSync(tmp, path)
  } catch (e) {
    console.error('Failed to save store:', e)
  }
}

// Lazily loaded on first access. This MUST NOT be eagerly initialized at module
// load time: index.ts calls app.setPath('userData', 'C:\\ProgramData\\Attentify')
// during startup, but ES module imports are evaluated before that line runs. An
// eager loadStore() here would therefore read from the *default* AppData path
// (where nothing exists → onboardingComplete:false) while later saves go to the
// ProgramData path, so every launch looked like a fresh install. Deferring the
// load until getStore() is first called (inside app.whenReady, after setPath)
// keeps reads and writes pointed at the same file.
let _store: AppStore | null = null

export function getStore(): AppStore {
  if (_store === null) _store = loadStore()
  return _store
}

export function patchStore(patch: Partial<AppStore>): AppStore {
  _store = { ...getStore(), ...patch }
  saveStore(_store)
  return _store
}

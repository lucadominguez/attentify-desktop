import { app } from 'electron'
import { join } from 'path'
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs'
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
  cloudActive: false,
  // Shown in the Overview as feed-level blocks (enforced by the browser extension).
  feedBlocks: [
    { domain: 'reddit.com', displayName: 'Reddit feed' },
    { domain: 'twitter.com', displayName: 'Twitter / X feed' },
  ],
}

function getStorePath(): string {
  const dir = app.getPath('userData')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  return join(dir, 'state.json')
}

export function loadStore(): AppStore {
  try {
    const path = getStorePath()
    if (!existsSync(path)) return { ...defaultStore }
    const raw = readFileSync(path, 'utf-8')
    const parsed = JSON.parse(raw)
    // Merge with defaults to handle new fields
    return {
      ...defaultStore,
      ...parsed,
      settings: { ...defaultSettings, ...(parsed.settings ?? {}) },
    }
  } catch {
    return { ...defaultStore }
  }
}

export function saveStore(store: AppStore): void {
  try {
    writeFileSync(getStorePath(), JSON.stringify(store, null, 2), 'utf-8')
  } catch (e) {
    console.error('Failed to save store:', e)
  }
}

// Lazily loaded on first access. This MUST NOT be eagerly initialized at module
// load time: index.ts calls app.setPath('userData', 'C:\\ProgramData\\Attentify')
// during startup, but ES module imports are evaluated before that line runs. An
// eager loadStore() here would therefore read from the *default* AppData path
// (where nothing exists → onboardingComplete:false) while later saves go to the
// ProgramData path — so every launch looked like a fresh install. Deferring the
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

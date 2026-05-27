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

let _store: AppStore = loadStore()

export function getStore(): AppStore {
  return _store
}

export function patchStore(patch: Partial<AppStore>): AppStore {
  _store = { ..._store, ...patch }
  saveStore(_store)
  return _store
}

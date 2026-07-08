import { existsSync, mkdirSync, writeFileSync, unlinkSync } from 'fs'
import { execSync } from 'child_process'
import { platform } from 'process'
import { join } from 'path'
import { recordChange } from '../safety/changeJournal'

// Firefox installation locations on Windows
const FIREFOX_DIST_DIRS = [
  'C:\\Program Files\\Mozilla Firefox\\distribution',
  'C:\\Program Files (x86)\\Mozilla Firefox\\distribution',
]

const FIREFOX_POLICY = JSON.stringify({
  policies: {
    DNSOverHTTPS: { Enabled: false, Locked: true },
  },
}, null, 2)

const CHROMIUM_REGISTRY_KEYS = [
  'HKLM\\SOFTWARE\\Policies\\Google\\Chrome',
  'HKLM\\SOFTWARE\\Policies\\Microsoft\\Edge',
  'HKLM\\SOFTWARE\\Policies\\BraveSoftware\\Brave',
]

export function applyBrowserPolicies(): void {
  if (platform !== 'win32') return
  applyFirefoxPolicy()
  applyChromiumRegistryPolicies()
  recordChange({ category: 'policy', action: 'apply', detail: 'set browser DNS-over-HTTPS policies (Firefox + Chromium)' })
}

export function removeBrowserPolicies(): void {
  if (platform !== 'win32') return
  removeFirefoxPolicy()
  removeChromiumRegistryPolicies()
  recordChange({ category: 'policy', action: 'remove', detail: 'restored browser DNS-over-HTTPS policies' })
}

function applyFirefoxPolicy(): void {
  for (const dir of FIREFOX_DIST_DIRS) {
    try {
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
      writeFileSync(join(dir, 'policies.json'), FIREFOX_POLICY, 'utf-8')
    } catch { /* Firefox not installed or insufficient permissions */ }
  }
}

function removeFirefoxPolicy(): void {
  for (const dir of FIREFOX_DIST_DIRS) {
    try {
      const file = join(dir, 'policies.json')
      if (existsSync(file)) unlinkSync(file)
    } catch { /* non-fatal */ }
  }
}

function applyChromiumRegistryPolicies(): void {
  for (const key of CHROMIUM_REGISTRY_KEYS) {
    try {
      execSync(`reg add "${key}" /v DnsOverHttpsMode /t REG_SZ /d off /f`, {
        stdio: 'ignore', timeout: 5000,
      })
    } catch { /* browser not installed or insufficient permissions */ }
  }
}

function removeChromiumRegistryPolicies(): void {
  for (const key of CHROMIUM_REGISTRY_KEYS) {
    try {
      execSync(`reg delete "${key}" /v DnsOverHttpsMode /f`, {
        stdio: 'ignore', timeout: 5000,
      })
    } catch { /* non-fatal */ }
  }
}

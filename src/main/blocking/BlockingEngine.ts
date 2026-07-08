import { EventEmitter } from 'events'
import type { BlockedDomain, BlockedProcess, ElevationStatus } from '../../shared/types'
import {
  addDomainToHosts,
  removeDomainFromHosts,
  clearAllHostsEntries,
  flushDnsCache,
  blockDoHServers,
  unblockDoHServers,
  checkElevation,
  listBlockedDomainsInHosts,
} from './hostsFileEditor'
import { isProcessRunning, killProcessByName } from './processKiller'
import { applyFirewallRules, removeFirewallRules, blockSite, unblockSite, refreshSiteBlocks, blockTorPorts, unblockTorPorts } from './firewallManager'
import { applyBrowserPolicies, removeBrowserPolicies } from './browserPolicyManager'
import { AppBlocker } from './AppBlocker'

export type BlockEvent = {
  type: 'domain' | 'process'
  item: string
  timestamp: number
}

// Curated set of the highest-traffic distractions, blocked automatically the moment
// a Deep Focus session starts (minus whatever the user allowlisted). Deep Focus means
// "block the obvious time-sinks without me having to list them."
export const DEEP_FOCUS_DOMAINS: string[] = [
  'twitter.com', 'x.com', 'instagram.com', 'facebook.com', 'tiktok.com', 'snapchat.com',
  'reddit.com', 'threads.net', 'pinterest.com', 'tumblr.com', 'linkedin.com', 'quora.com',
  'youtube.com', 'youtu.be', 'twitch.tv', 'netflix.com', 'hulu.com', 'disneyplus.com',
  'primevideo.com', 'hbomax.com', 'max.com', 'vimeo.com', 'dailymotion.com', 'kick.com',
  'news.ycombinator.com', '9gag.com', 'imgur.com', 'buzzfeed.com', 'dailymail.co.uk',
  'cnn.com', 'foxnews.com', 'discord.com', 'amazon.com', 'ebay.com', 'aliexpress.com',
  'temu.com', 'steampowered.com', 'store.steampowered.com', 'epicgames.com',
  'chess.com', 'lichess.org', 'coolmathgames.com', 'espn.com', 'twitch.tv',
]

export class BlockingEngine extends EventEmitter {
  private domains: BlockedDomain[] = []
  private processes: BlockedProcess[] = []
  private elevation: ElevationStatus = 'unknown'
  private pollInterval: ReturnType<typeof setInterval> | null = null
  private appBlocker: AppBlocker
  private active = false
  private blockEventCount = 0
  private tickCount = 0
  private protectionApplied = false
  // Domains added by an active Deep Focus session (kept separate from the user's
  // persistent blocklist so they survive a store refresh and are cleaned up on exit).
  private deepDomains: string[] = []

  constructor(elevation: ElevationStatus) {
    super()
    this.elevation = elevation
    this.appBlocker = new AppBlocker()
    this.appBlocker.on('blocked', (event: { type: string; item: string }) => {
      this.blockEventCount++
      this.emit('blocked', { ...event, timestamp: Date.now() } as BlockEvent)
    })
  }

  setElevation(status: ElevationStatus): void {
    this.elevation = status
  }

  // Stop enforcing and wipe all in-memory blocks. Used by the full system restore so
  // the next tick()/protect() doesn't immediately re-apply what we just reverted.
  factoryReset(): void {
    this.active = false
    if (this.pollInterval) { clearInterval(this.pollInterval); this.pollInterval = null }
    this.domains = []
    this.processes = []
    this.deepDomains = []
    this.protectionApplied = false
  }

  loadState(domains: BlockedDomain[], processes: BlockedProcess[]): void {
    this.domains = [...domains]
    // Re-apply any active Deep Focus blocks so a store refresh never silently drops them.
    for (const d of this.deepDomains) {
      if (!this.domains.find((x) => x.domain === d)) this.domains.push({ domain: d, addedAt: Date.now(), reason: 'deep-focus' })
    }
    this.processes = processes
    if (this.active && this.elevation === 'full') {
      this.syncHostsFile()
    }
    this.syncAppBlocker()
  }

  // ── Deep Focus ────────────────────────────────────────────────────────────────

  startDeepFocus(allowlist: string[], expiresInMs?: number): number {
    const allow = new Set((allowlist ?? []).map((a) => a.toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '')))
    this.deepDomains = []
    for (const d of DEEP_FOCUS_DOMAINS) {
      if (allow.has(d)) continue
      if (this.domains.find((x) => x.domain === d)) continue // already blocked by the user — leave it
      const r = this.addDomain(d, expiresInMs)
      if (r.ok) this.deepDomains.push(d)
    }
    return this.deepDomains.length
  }

  endDeepFocus(): void {
    for (const d of this.deepDomains) this.removeDomain(d)
    this.deepDomains = []
  }

  isDeepDomain(domain: string): boolean {
    return this.deepDomains.includes(domain)
  }

  inDeepFocus(): boolean {
    return this.deepDomains.length > 0
  }

  // Apply all protection layers without starting the session poller.
  // Safe to call multiple times — idempotent.
  protect(): void {
    if (this.elevation !== 'full') return
    this.syncHostsFile()
    this.ensureDefenseLayers()
    if (this.domains.length > 0) {
      refreshSiteBlocks(this.domains.map((d) => d.domain))
    }
  }

  private ensureDefenseLayers(): void {
    blockDoHServers()
    if (!this.protectionApplied) {
      applyFirewallRules()
      applyBrowserPolicies()
      blockTorPorts()
      this.protectionApplied = true
    }
  }

  start(): void {
    if (this.active) return
    this.active = true

    if (this.elevation === 'full' || checkElevation()) {
      this.elevation = 'full'
      this.protect()
    }

    this.pollInterval = setInterval(() => this.tick(), 2000)
  }

  stop(): void {
    this.active = false
    if (this.pollInterval) {
      clearInterval(this.pollInterval)
      this.pollInterval = null
    }
    if (this.elevation === 'full') {
      // Re-sync to keep permanent domain blocks in place (don't clear everything)
      this.syncHostsFile()
      flushDnsCache()
      // Only remove auxiliary protection if there's nothing left to protect
      if (this.domains.length === 0) {
        unblockDoHServers()
        removeFirewallRules()
        removeBrowserPolicies()
        unblockTorPorts()
        this.protectionApplied = false
      }
    }
  }

  addDomain(domain: string, expiresInMs?: number): { ok: boolean; error?: string } {
    const existing = this.domains.find((d) => d.domain === domain)
    if (existing) return { ok: true }
    const entry: BlockedDomain = {
      domain,
      addedAt: Date.now(),
      expiresAt: expiresInMs ? Date.now() + expiresInMs : undefined,
    }
    this.domains.push(entry)
    if (this.elevation === 'full') {
      const result = addDomainToHosts(domain)
      flushDnsCache()
      this.ensureDefenseLayers()
      blockSite(domain)
      return result
    }
    return { ok: true }
  }

  removeDomain(domain: string): void {
    this.domains = this.domains.filter((d) => d.domain !== domain)
    if (this.elevation === 'full') {
      removeDomainFromHosts(domain)
      flushDnsCache()
      unblockSite(domain)
      if (this.domains.length === 0 && !this.active) {
        unblockDoHServers()
        removeFirewallRules()
        removeBrowserPolicies()
        this.protectionApplied = false
      }
    }
  }

  addProcess(name: string, expiresInMs?: number): void {
    if (this.processes.find((p) => p.name === name)) return
    this.processes.push({
      name,
      addedAt: Date.now(),
      expiresAt: expiresInMs ? Date.now() + expiresInMs : undefined,
    })
    this.syncAppBlocker()
  }

  removeProcess(name: string): void {
    this.processes = this.processes.filter((p) => p.name !== name)
    this.syncAppBlocker()
  }

  private syncAppBlocker(): void {
    const now = Date.now()
    // Expire timed process blocks before syncing
    const active = this.processes.filter((p) => !p.expiresAt || p.expiresAt > now)
    if (active.length !== this.processes.length) {
      this.processes = active
    }
    this.appBlocker.setApps(active.map((p) => p.name))
  }

  getDomains(): BlockedDomain[] { return [...this.domains] }
  getProcesses(): BlockedProcess[] { return [...this.processes] }
  isActive(): boolean { return this.active }
  getBlockEventCount(): number { return this.blockEventCount }
  getElevation(): ElevationStatus { return this.elevation }

  syncToHosts(): void {
    this.syncHostsFile()
  }

  private tick(): void {
    const now = Date.now()
    this.tickCount++

    // Expire timed domain blocks
    const expiredDomains = this.domains.filter((d) => d.expiresAt && d.expiresAt <= now)
    for (const d of expiredDomains) this.removeDomain(d.domain)

    // Expire timed process blocks
    const expiredProcesses = this.processes.filter((p) => p.expiresAt && p.expiresAt <= now)
    if (expiredProcesses.length > 0) {
      for (const p of expiredProcesses) this.processes = this.processes.filter((pr) => pr.name !== p.name)
      this.syncAppBlocker()
    }

    if (this.elevation !== 'full') return

    // Integrity check every ~30 seconds — restore hosts if tampered
    if (this.tickCount % 15 === 0) {
      this.verifyHostsIntegrity()
    }

    // Refresh per-site IP firewall rules every ~5 minutes (CDNs rotate IPs)
    if (this.tickCount % 150 === 0 && this.domains.length > 0) {
      refreshSiteBlocks(this.domains.map((d) => d.domain))
    }

    // Always neutralise Tor Browser — it routes around all DNS and firewall rules
    for (const proc of ['tor', 'torbrowser'] as const) {
      if (isProcessRunning(proc)) {
        killProcessByName(proc)
        this.blockEventCount++
      }
    }
  }

  private verifyHostsIntegrity(): void {
    try {
      const presentInHosts = new Set(listBlockedDomainsInHosts())
      const missing = this.domains.some((d) => !presentInHosts.has(d.domain))
      if (missing) {
        this.syncHostsFile()
        blockDoHServers()
        flushDnsCache()
      }
    } catch { /* non-fatal */ }
  }

  private syncHostsFile(): void {
    clearAllHostsEntries()
    for (const d of this.domains) {
      addDomainToHosts(d.domain)
    }
    flushDnsCache()
  }
}

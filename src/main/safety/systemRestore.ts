import { clearAllHostsEntries, flushDnsCache } from '../blocking/hostsFileEditor'
import { removeAllAttentifyFirewallRules } from '../blocking/firewallManager'
import { removeBrowserPolicies } from '../blocking/browserPolicyManager'
import { unregisterStartupDaemon } from '../daemonManager'
import { recordChange } from './changeJournal'

// ─── System restore ─────────────────────────────────────────────────────────────
// Reverses every persistent change Attentify can make to a machine, returning it to
// the state it was in before the app started blocking. Each step is independent and
// best-effort: one failing (e.g. a firewall rule already gone) never aborts the rest.

export interface RevertResult {
  ok: boolean
  undone: string[]
  errors: string[]
}

export function revertAllChanges(): RevertResult {
  const undone: string[] = []
  const errors: string[] = []

  const step = (label: string, fn: () => void): void => {
    try { fn(); undone.push(label) }
    catch (e) { errors.push(`${label}: ${e instanceof Error ? e.message : String(e)}`) }
  }

  // 1. Hosts file — remove the entire Attentify-managed block (leaves any of the
  //    user's own hosts entries untouched).
  step('Removed all website blocks from the hosts file', () => { clearAllHostsEntries() })

  // 2. Firewall — delete every rule Attentify created (all use the PD_ prefix).
  step('Removed firewall blocking rules', () => { removeAllAttentifyFirewallRules() })

  // 3. Browser DNS-over-HTTPS policies (Firefox policies.json + Chromium registry).
  step('Restored browser DNS settings', () => { removeBrowserPolicies() })

  // 4. Login startup entry (Windows scheduled task / macOS LaunchAgent).
  step('Removed the login startup entry', () => { void unregisterStartupDaemon() })

  // 5. Flush the DNS cache so unblocked sites resolve immediately.
  step('Flushed the DNS cache', () => { flushDnsCache() })

  recordChange({
    category: 'system',
    action: 'revert-all',
    detail: `system restore — ${undone.length} reverted, ${errors.length} error(s)`,
  })

  return { ok: errors.length === 0, undone, errors }
}

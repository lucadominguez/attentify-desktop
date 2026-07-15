import { execSync } from 'child_process'
import { platform } from 'process'
import { recordChange } from '../safety/changeJournal'

const DOH_RULE_TCP = 'PD_BlockDoH_TCP'
const DOH_RULE_UDP = 'PD_BlockDoH_UDP'

// Known DoH resolver IPs
const DOH_IPS = [
  '1.1.1.1', '1.0.0.1',         // Cloudflare
  '8.8.8.8', '8.8.4.4',         // Google
  '9.9.9.9', '149.112.112.112', // Quad9
  '94.140.14.14', '94.140.15.15', // AdGuard
  '208.67.222.222', '208.67.220.220', // OpenDNS
  '45.90.28.0', '45.90.30.0',   // NextDNS
].join(',')

function run(cmd: string): void {
  execSync(cmd, { stdio: 'ignore', timeout: 10000 })
}

function resolveIPs(domain: string): string[] {
  // Use -Server 8.8.8.8 to bypass the local hosts file — otherwise we'd
  // resolve our own 0.0.0.0 sinkhole and block a useless IP.
  try {
    const out = execSync(
      `powershell -NonInteractive -NoProfile -Command "try{(Resolve-DnsName '${domain}' -Type A -Server '8.8.8.8' -ErrorAction Stop | Where-Object QueryType -eq 'A').IPAddress -join ','}catch{''}"`,
      { encoding: 'utf-8', timeout: 8000 }
    ).trim()
    return out ? out.split(',').map((s) => s.trim()).filter(Boolean) : []
  } catch { return [] }
}

function ruleName(domain: string): string {
  return `PD_Site_${domain.replace(/[^a-zA-Z0-9]/g, '_')}`
}

// ── DoH resolver IP blocking ──────────────────────────────────────────────────

export function applyFirewallRules(): void {
  if (platform !== 'win32') return
  try {
    removeFirewallRules()
    run(`netsh advfirewall firewall add rule name="${DOH_RULE_TCP}" dir=out action=block protocol=tcp remoteip="${DOH_IPS}" remoteport=443,853`)
    run(`netsh advfirewall firewall add rule name="${DOH_RULE_UDP}" dir=out action=block protocol=udp remoteip="${DOH_IPS}" remoteport=443,853`)
    recordChange({ category: 'firewall', action: 'apply', target: 'DoH resolvers', detail: 'blocked encrypted-DNS resolver IPs' })
  } catch { /* non-fatal */ }
}

// Remove EVERY firewall rule Attentify has ever added. All of them share the PD_
// prefix, so a single filtered sweep cleans up DoH, per-site and Tor rules at once —
// including any left behind by an earlier build. Used by the full system restore.
export function removeAllAttentifyFirewallRules(): void {
  if (platform !== 'win32') return
  try {
    run(`powershell -NonInteractive -NoProfile -Command "Get-NetFirewallRule -ErrorAction SilentlyContinue | Where-Object { $_.DisplayName -like 'PD_*' } | Remove-NetFirewallRule -ErrorAction SilentlyContinue"`)
  } catch { /* fall through to the named removals below */ }
  // Belt-and-suspenders for the well-known rule names in case the sweep above is
  // unavailable (older PowerShell without NetSecurity module).
  removeFirewallRules()
  unblockTorPorts()
  recordChange({ category: 'firewall', action: 'clear', detail: 'removed all Attentify firewall rules' })
}

export function removeFirewallRules(): void {
  if (platform !== 'win32') return
  try { run(`netsh advfirewall firewall delete rule name="${DOH_RULE_TCP}"`) } catch { /* ok */ }
  try { run(`netsh advfirewall firewall delete rule name="${DOH_RULE_UDP}"`) } catch { /* ok */ }
}

// ── Per-site IP blocking ──────────────────────────────────────────────────────
// Resolves the domain to its current IPs and adds firewall rules blocking
// all HTTP/HTTPS traffic (TCP+UDP 80,443) to those IPs. This works even when
// the browser resolves the domain via DoH, the TCP connection is refused at
// the Windows filtering layer before a byte is sent.

export function blockSite(domain: string): void {
  if (platform !== 'win32') return

  // Block both the bare domain and www subdomain
  const variants = [domain]
  if (!domain.startsWith('www.')) variants.push(`www.${domain}`)

  for (const d of variants) {
    try {
      const ips = resolveIPs(d)
      if (ips.length === 0) continue
      const ipList = ips.join(',')
      const name = ruleName(d)

      // Delete stale rules then add fresh ones
      try { run(`netsh advfirewall firewall delete rule name="${name}_tcp"`) } catch { /* ok */ }
      try { run(`netsh advfirewall firewall delete rule name="${name}_udp"`) } catch { /* ok */ }

      // TCP: blocks HTTP (80), HTTPS (443), and alt ports
      run(`netsh advfirewall firewall add rule name="${name}_tcp" dir=out action=block protocol=tcp remoteip="${ipList}" remoteport=80,443,8080,8443`)
      // UDP: blocks QUIC/HTTP3 (port 443 over UDP) and any DoH over UDP
      run(`netsh advfirewall firewall add rule name="${name}_udp" dir=out action=block protocol=udp remoteip="${ipList}" remoteport=80,443`)
    } catch { /* non-fatal */ }
  }
}

export function unblockSite(domain: string): void {
  if (platform !== 'win32') return
  const variants = [domain, `www.${domain}`]
  for (const d of variants) {
    const name = ruleName(d)
    try { run(`netsh advfirewall firewall delete rule name="${name}_tcp"`) } catch { /* ok */ }
    try { run(`netsh advfirewall firewall delete rule name="${name}_udp"`) } catch { /* ok */ }
  }
}

// Called periodically to refresh IPs (CDNs rotate them). Pass the full list of
// currently blocked domains.
export function refreshSiteBlocks(domains: string[]): void {
  for (const domain of domains) {
    blockSite(domain)
  }
}

// ── Tor network blocking ──────────────────────────────────────────────────────
// Tor routes encrypted traffic through guard nodes on ports 9001 / 9030 and
// exposes a local SOCKS proxy on 9050 / 9150.  Blocking those ports prevents
// the Tor daemon from reaching the network even if the process isn't killed yet.

export function blockTorPorts(): void {
  if (platform !== 'win32') return
  try {
    run(`netsh advfirewall firewall delete rule name="PD_BlockTor_TCP"`)
  } catch { /* ok */ }
  try {
    run(`netsh advfirewall firewall add rule name="PD_BlockTor_TCP" dir=out action=block protocol=tcp remoteport=9001,9030,9050,9051,9150,9151`)
  } catch { /* non-fatal */ }
  try {
    run(`netsh advfirewall firewall delete rule name="PD_BlockTor_UDP"`)
  } catch { /* ok */ }
  try {
    run(`netsh advfirewall firewall add rule name="PD_BlockTor_UDP" dir=out action=block protocol=udp remoteport=9001,9030,9050,9150`)
  } catch { /* non-fatal */ }
}

export function unblockTorPorts(): void {
  if (platform !== 'win32') return
  try { run(`netsh advfirewall firewall delete rule name="PD_BlockTor_TCP"`) } catch { /* ok */ }
  try { run(`netsh advfirewall firewall delete rule name="PD_BlockTor_UDP"`) } catch { /* ok */ }
}

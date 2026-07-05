import { execSync } from 'child_process'
import { readFileSync, writeFileSync, existsSync } from 'fs'
import { platform } from 'process'

export const HOSTS_PATH =
  platform === 'win32'
    ? 'C:\\Windows\\System32\\drivers\\etc\\hosts'
    : '/etc/hosts'

const BLOCK_TAG_START = '# PRODUCTIVITY_DAEMON_START'
const BLOCK_TAG_END = '# PRODUCTIVITY_DAEMON_END'
const SINKHOLE = '0.0.0.0'
const SINKHOLE_V6 = '::'

// ─── Elevation detection ────────────────────────────────────────────────────

export function checkElevation(): boolean {
  if (platform === 'win32') {
    try {
      // `net session` requires admin — exits 0 if elevated, non-zero if not
      execSync('net session', { stdio: 'pipe', timeout: 3000 })
      return true
    } catch {
      return false
    }
  } else {
    return process.getuid?.() === 0
  }
}

export function verifyHostsWritable(): boolean {
  try {
    const content = readFileSync(HOSTS_PATH, 'utf-8')
    writeFileSync(HOSTS_PATH, content) // no-op write — throws if no permission
    return true
  } catch {
    return false
  }
}

// ─── Hosts file manipulation ─────────────────────────────────────────────────

function readHosts(): string {
  return readFileSync(HOSTS_PATH, 'utf-8')
}

function writeHosts(content: string): void {
  writeFileSync(HOSTS_PATH, content, 'utf-8')
}

function getDaemonSection(content: string): string[] {
  const start = content.indexOf(BLOCK_TAG_START)
  const end = content.indexOf(BLOCK_TAG_END)
  if (start === -1 || end === -1) return []
  return content
    .slice(start + BLOCK_TAG_START.length, end)
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.startsWith(SINKHOLE))
    .map((l) => l.split(/\s+/)[1])
    .filter(Boolean) as string[]
}

function rebuildHosts(domains: string[]): void {
  let content = readHosts()
  const start = content.indexOf(BLOCK_TAG_START)
  const end = content.indexOf(BLOCK_TAG_END)

  const section =
    domains.length > 0
      ? [
          BLOCK_TAG_START,
          '# DO NOT EDIT — managed by Attentify',
          ...domains.flatMap((d) => [`${SINKHOLE} ${d}`, `${SINKHOLE_V6} ${d}`]),
          BLOCK_TAG_END,
        ].join('\n')
      : ''

  if (start !== -1 && end !== -1) {
    content = content.slice(0, start).trimEnd() + (section ? '\n\n' + section + '\n' : '\n') + content.slice(end + BLOCK_TAG_END.length).trimStart()
  } else if (domains.length > 0) {
    content = content.trimEnd() + '\n\n' + section + '\n'
  }

  writeHosts(content)
}

export function addDomainToHosts(domain: string): { ok: boolean; error?: string } {
  try {
    const existing = getDaemonSection(readHosts())
    if (!existing.includes(domain)) existing.push(domain)
    const withWww = `www.${domain}`
    if (!existing.includes(withWww) && !domain.startsWith('www.')) existing.push(withWww)
    rebuildHosts(existing)
    return { ok: true }
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e)
    return { ok: false, error: msg }
  }
}

export function removeDomainFromHosts(domain: string): boolean {
  try {
    const existing = getDaemonSection(readHosts())
    rebuildHosts(existing.filter((d) => d !== domain && d !== `www.${domain}`))
    return true
  } catch {
    return false
  }
}

export function listBlockedDomainsInHosts(): string[] {
  try {
    return getDaemonSection(readHosts())
  } catch {
    return []
  }
}

export function clearAllHostsEntries(): boolean {
  try {
    rebuildHosts([])
    return true
  } catch {
    return false
  }
}

export function flushDnsCache(): void {
  try {
    if (platform === 'win32') {
      execSync('ipconfig /flushdns', { stdio: 'ignore', timeout: 5000 })
    } else if (platform === 'darwin') {
      execSync('dscacheutil -flushcache; killall -HUP mDNSResponder', { stdio: 'ignore', timeout: 5000 })
    } else {
      execSync('systemd-resolve --flush-caches 2>/dev/null || true', { stdio: 'ignore', timeout: 5000 })
    }
  } catch { /* non-fatal */ }
}

// ─── Browser DoH mitigation ──────────────────────────────────────────────────
// Blocks Cloudflare (1.1.1.1) and Google (8.8.8.8) DoH endpoints so browsers
// fall back to system DNS (which respects the hosts file)

const DOH_HOSTS = [
  'cloudflare-dns.com',
  'dns.cloudflare.com',
  'chrome.cloudflare-dns.com',
  'dns.google',
  'dns.google.com',
  '8888.google',
  'dns64.dns.google',
  'mozilla.cloudflare-dns.com',
  'firefox.dns.nextdns.io',
]

export function blockDoHServers(): void {
  try {
    const existing = getDaemonSection(readHosts())
    let changed = false
    for (const host of DOH_HOSTS) {
      if (!existing.includes(host)) {
        existing.push(host)
        changed = true
      }
    }
    if (changed) {
      rebuildHosts(existing)
      flushDnsCache()
    }
  } catch { /* non-fatal */ }
}

export function unblockDoHServers(): void {
  try {
    const existing = getDaemonSection(readHosts())
    const filtered = existing.filter((d) => !DOH_HOSTS.includes(d))
    if (filtered.length !== existing.length) {
      rebuildHosts(filtered)
      flushDnsCache()
    }
  } catch { /* non-fatal */ }
}

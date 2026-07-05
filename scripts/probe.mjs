#!/usr/bin/env node
/**
 * agent probe — one-shot status dump for Hermes/Claude Code
 *
 * Usage:
 *   node scripts/probe.mjs                      # full summary
 *   node scripts/probe.mjs logs                 # last 30 structured log entries
 *   node scripts/probe.mjs inferences           # all AI inferences
 *   node scripts/probe.mjs events               # last 20 activity events
 *   node scripts/probe.mjs blocklist            # current blocklist
 *   node scripts/probe.mjs goals                # active focus goals
 *   node scripts/probe.mjs chat "block YouTube for 2 hours"
 *   node scripts/probe.mjs inject:url https://reddit.com
 *   node scripts/probe.mjs inject:search "funny memes"
 *   node scripts/probe.mjs inject:session chrome "Reddit - Front Page" 120000 5
 *   node scripts/probe.mjs inject:proactive
 *   node scripts/probe.mjs inject:scan
 *   node scripts/probe.mjs inject:block reddit.com
 *   node scripts/probe.mjs inject:unblock reddit.com
 *   node scripts/probe.mjs inject:sweep
 *   node scripts/probe.mjs break:start 900000   # 15 min break
 *   node scripts/probe.mjs break:end
 */

const PORT_FILE = 'C:\\ProgramData\\Attentify\\debug-port'
const FALLBACK_PORTS = [9119, 9120, 9121, 9122, 9123]

// Resolve the actual debug server port: check the port file first, then scan.
async function resolveBase() {
  // Try the port written by the running app
  try {
    const { readFileSync } = await import('fs')
    const saved = parseInt(readFileSync(PORT_FILE, 'utf8').trim(), 10)
    if (saved > 0) {
      const r = await fetch(`http://127.0.0.1:${saved}/ping`, { signal: AbortSignal.timeout(600) })
      if (r.ok) return `http://127.0.0.1:${saved}`
    }
  } catch { /* port file missing or stale */ }

  // Scan the fallback range
  for (const port of FALLBACK_PORTS) {
    try {
      const r = await fetch(`http://127.0.0.1:${port}/ping`, { signal: AbortSignal.timeout(600) })
      if (r.ok) return `http://127.0.0.1:${port}`
    } catch { continue }
  }
  return null
}

const BASE = await resolveBase()

async function get(path) {
  const r = await fetch(`${BASE}${path}`)
  return r.json()
}

async function post(path, body) {
  const r = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  return r.json()
}

function fmt(obj) {
  return JSON.stringify(obj, null, 2)
}

function banner(title) {
  console.log(`\n${'─'.repeat(60)}\n  ${title}\n${'─'.repeat(60)}`)
}

// ── Check app is running ──────────────────────────────────────────────────────

if (!BASE) {
  console.error('✗  App is NOT running (ports 9119-9123 all unreachable)')
  console.error('   Start the app first:  npm run dev')
  process.exit(1)
}

let ping
try {
  ping = await get('/ping')
} catch {
  console.error(`✗  App is NOT running (could not reach debug server at ${BASE})`)
  console.error('   Start the app first:  npm run dev')
  process.exit(1)
}

const [cmd, arg] = process.argv.slice(2)

// ── Subcommands ───────────────────────────────────────────────────────────────

if (cmd === 'logs') {
  const { entries } = await get('/logs?n=30')
  banner('Recent debug logs')
  for (const e of entries) {
    const ts = new Date(e.ts).toLocaleTimeString()
    const rest = Object.fromEntries(Object.entries(e).filter(([k]) => k !== 'ts' && k !== 'event'))
    console.log(`${ts}  [${e.event}]  ${JSON.stringify(rest)}`)
  }
  process.exit(0)
}

if (cmd === 'inferences') {
  const rows = await get('/inferences')
  banner('AI Inferences')
  console.log(fmt(rows))
  process.exit(0)
}

if (cmd === 'events') {
  const rows = await get('/events?limit=20')
  banner('Recent activity events')
  for (const e of rows) {
    const ts = new Date(e.ts).toLocaleTimeString()
    console.log(`${ts}  ${e.app ?? '?'}  ${(e.title ?? '').slice(0, 50)}  ${e.url ? `→ ${e.url.slice(0, 60)}` : ''}`)
  }
  process.exit(0)
}

if (cmd === 'blocklist') {
  const bl = await get('/blocklist')
  banner('Blocklist')
  console.log(fmt(bl))
  process.exit(0)
}

if (cmd === 'inject:url') {
  if (!arg) { console.error('Usage: probe.mjs inject:url <url>'); process.exit(1) }
  const r = await post('/inject/url', { url: arg, title: 'test injection' })
  banner('URL injection result')
  console.log(fmt(r))
  console.log('\nWaiting 2s for inference pipeline then fetching results...')
  await new Promise(r => setTimeout(r, 2000))
  const infs = await get('/inferences?status=pending')
  console.log('\nPending inferences after injection:')
  console.log(fmt(infs))
  process.exit(0)
}

if (cmd === 'inject:search') {
  if (!arg) { console.error('Usage: probe.mjs inject:search "<query>"'); process.exit(1) }
  const r = await post('/inject/search', { query: arg })
  banner('Search injection result')
  console.log(fmt(r))
  process.exit(0)
}

if (cmd === 'inject:block') {
  if (!arg) { console.error('Usage: probe.mjs inject:block <domain>'); process.exit(1) }
  const r = await post('/inject/block', { domain: arg })
  banner(`Block ${arg}`)
  console.log(fmt(r))
  process.exit(0)
}

if (cmd === 'inject:unblock') {
  if (!arg) { console.error('Usage: probe.mjs inject:unblock <domain>'); process.exit(1) }
  const r = await post('/inject/unblock', { domain: arg })
  banner(`Unblock ${arg}`)
  console.log(fmt(r))
  process.exit(0)
}

if (cmd === 'goals') {
  const goals = await get('/agent/goals')
  banner('Active goals')
  console.log(fmt(goals))
  process.exit(0)
}

if (cmd === 'chat') {
  if (!arg) { console.error('Usage: probe.mjs chat "<message>"'); process.exit(1) }
  banner(`Chat: "${arg}"`)
  console.log('Sending to agent (may take a few seconds)...')
  const r = await post('/inject/chat', { message: arg })
  if (r.toolsUsed?.length) console.log(`Tools used: ${r.toolsUsed.join(', ')}`)
  console.log('\nAgent response:')
  console.log(r.content ?? r.error ?? fmt(r))
  process.exit(0)
}

if (cmd === 'inject:session') {
  // args: app title durationMs count
  const [, titleArg, durationArg, countArg] = process.argv.slice(2)
  const app2 = arg ?? 'chrome'
  const title2 = titleArg ?? 'Reddit - Front Page'
  const dur = parseInt(durationArg ?? '120000', 10)
  const cnt = parseInt(countArg ?? '5', 10)
  const r = await post('/inject/session', { app: app2, title: title2, duration: dur, isDistraction: true, count: cnt })
  banner(`Session injection: ${cnt}x ${dur/1000}s of ${app2}`)
  console.log(fmt(r))
  process.exit(0)
}

if (cmd === 'inject:proactive') {
  const r = await post('/inject/proactive', {})
  banner('Proactive intervention triggered')
  console.log(fmt(r))
  process.exit(0)
}

if (cmd === 'inject:scan') {
  console.log('Running FocusScan (may take 5-10s)...')
  const r = await post('/inject/scan', {})
  banner('FocusScan results')
  console.log(`Issues found: ${r.issueCount}`)
  if (r.issues) for (const i of r.issues) console.log(`  [${i.severity}] ${i.title}`)
  if (r.installedDistractors?.length) console.log(`\nInstalled distractors: ${r.installedDistractors.join(', ')}`)
  process.exit(0)
}

if (cmd === 'break:start') {
  const ms = parseInt(arg ?? '900000', 10)
  const r = await post('/inject/break', { action: 'start', durationMs: ms })
  banner(`Break mode started (${ms/60000} min)`)
  console.log(fmt(r))
  process.exit(0)
}

if (cmd === 'break:end') {
  const r = await post('/inject/break', { action: 'end' })
  banner('Break mode ended')
  console.log(fmt(r))
  process.exit(0)
}

if (cmd === 'inject:sweep') {
  const r = await post('/inject/sweep', {})
  banner('Background sweep triggered')
  console.log(fmt(r))
  console.log('\nWaiting 3s then fetching inference results...')
  await new Promise(r => setTimeout(r, 3000))
  const infs = await get('/inferences')
  console.log('\nAll inferences after sweep:')
  console.log(fmt(infs))
  process.exit(0)
}

// ── Default: full summary ─────────────────────────────────────────────────────

const summary = await get('/summary')

banner(`Attentify  pid:${ping.pid}  uptime:${ping.uptime}s`)

const s = summary.appState
console.log(`  elevation    : ${s.elevation}`)
console.log(`  blockingMode : ${s.blockingMode}`)
console.log(`  focusSession : ${s.activeFocusSession ? `active (mode: ${s.activeFocusSession.mode})` : 'none'}`)
console.log(`  blockedDomains  : ${s.blockedDomains}`)
console.log(`  blockedProcesses: ${s.blockedProcesses}`)
console.log(`  currentUrl   : ${summary.monitor.currentUrl ?? '(none)'}`)

banner('Inference')
console.log(`  pending     : ${summary.inference.pending}`)
console.log(`  auto-blocked: ${summary.inference.autoBlocked}`)
if (summary.inference.topPending.length > 0) {
  console.log('\n  Top pending:')
  for (const inf of summary.inference.topPending) {
    console.log(`    ${Math.round(inf.confidence * 100)}%  ${inf.type}:${inf.value}  — ${inf.reasoning ?? ''}`)
  }
}

banner('Recent activity (last 30 min)')
for (const e of summary.recentActivity) {
  const ts = new Date(e.ts).toLocaleTimeString()
  console.log(`  ${ts}  ${(e.app ?? '?').padEnd(16)}  ${(e.title ?? '').slice(0, 45)}`)
}

banner('Recent debug logs')
for (const e of summary.logs.slice(-10)) {
  const ts = new Date(e.ts).toLocaleTimeString()
  const rest = Object.fromEntries(Object.entries(e).filter(([k]) => k !== 'ts' && k !== 'event'))
  console.log(`  ${ts}  [${e.event}]  ${JSON.stringify(rest)}`)
}

console.log(`\n  Debug API: ${BASE}`)
console.log(`  Log file:  C:\\ProgramData\\Attentify\\logs\\debug.log\n`)

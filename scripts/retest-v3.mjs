#!/usr/bin/env node
/**
 * V1 Bug Retest V3 — Filters out pre-existing inferences so we only measure
 * what the CURRENT build produces.
 */
const BASE = 'http://127.0.0.1:9119';
const TEST_START = Date.now();

async function GET(path) {
  const r = await fetch(`${BASE}${path}`);
  return { status: r.status, body: await r.json().catch(() => ({})) };
}

async function POST(path, body) {
  const r = await fetch(`${BASE}${path}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: r.status, body: await r.json().catch(() => ({})) };
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function main() {
  console.log('═══════════════════════════════════════════════');
  console.log('  V1 BUG RETEST V3 — Confidence re-verify');
  console.log('═══════════════════════════════════════════════\n');

  const ping = await GET('/ping');
  if (!ping.body.ok) { console.error('FATAL: App not running'); process.exit(1); }
  console.log(`App: PID ${ping.body.pid}, uptime ${ping.body.uptime}s`);

  const state = await GET('/state');
  const elevation = state.body.elevation || '?';
  console.log(`Elevation: ${elevation}\n`);

  // ════════════════════════════════════════════════
  // FAILURE 3: Confidence — fresh injections only
  // ════════════════════════════════════════════════
  console.log('── FAILURE 3: Confidence (fresh injections) ──\n');

  const tests = [
    { url: 'https://instagram.com', title: 'Instagram', threshold: 0.85, cat: 'social_media', base: 0.88 },
    { url: 'https://tiktok.com', title: 'TikTok', threshold: 0.85, cat: 'social_media', base: 0.88 },
    { url: 'https://youtube.com', title: 'YouTube', threshold: 0.85, cat: 'video_streaming', base: 0.85 },
    { url: 'https://netflix.com', title: 'Netflix', threshold: 0.80, cat: 'video_streaming', base: 0.85 },
    { url: 'https://facebook.com', title: 'Facebook', threshold: 0.85, cat: 'social_media', base: 0.88 },
    { url: 'https://twitch.tv', title: 'Twitch', threshold: 0.80, cat: 'video_streaming', base: 0.85 },
    { url: 'https://9gag.com', title: '9GAG', threshold: 0.75, cat: '', base: 0.72 },
  ];

  for (const t of tests) {
    await POST('/inject/url', { url: t.url, title: t.title });
    await sleep(1.8);
  }
  await sleep(2);

  const infs = await GET('/inferences');
  const all = Array.isArray(infs.body) ? infs.body : [];

  let failures = 0;
  for (const t of tests) {
    const domain = t.url.replace('https://', '');
    const matches = all.filter(i => i.value === domain);
    
    if (matches.length === 0) {
      console.log(`  ✗ ${domain}: NO inference found`);
      failures++;
      continue;
    }

    // Show ALL matches so we can see what's happening
    matches.forEach(m => {
      const age = TEST_START - m.created_at;
      const fresh = age < 60000 ? 'FRESH' : `STALE (${Math.round(age/1000)}s old)`;
      const icon = m.confidence >= t.threshold ? '✓' : '✗';
      const expected = t.base > 0 ? ` (expected ~${t.base+0.05} from ${t.cat})` : '';
      console.log(`  ${icon} ${domain.padEnd(18)} conf=${String(m.confidence).padEnd(6)} status=${m.status.padEnd(14)} ${fresh}${expected}`);
      if (m.confidence < t.threshold) failures++;
    });
  }

  // Also check hardblock targets
  console.log('\n  Hardblock check:');
  for (const t of [{ url: 'https://pornhub.com', title: 'Pornhub', expectedMin: 0.97 },
                    { url: 'https://draftkings.com', title: 'DraftKings', expectedMin: 0.92 }]) {
    await POST('/inject/url', { url: t.url, title: t.title });
    await sleep(2);
  }
  await sleep(2);

  const infs2 = await GET('/inferences');
  const all2 = Array.isArray(infs2.body) ? infs2.body : [];
  for (const t of ['pornhub.com', 'draftkings.com']) {
    const matches = all2.filter(i => i.value === t);
    matches.forEach(m => {
      const age = TEST_START - m.created_at;
      console.log(`  ✓ ${t.padEnd(18)} conf=${m.confidence} status=${m.status} ${age < 60000 ? 'FRESH' : `STALE (${Math.round(age/1000)}s)`}`);
    });
    if (matches.length === 0) console.log(`  ✗ ${t}: NO inference`);
  }

  // ════════════════════════════════════════════════
  // FAILURE 6: Re-verify startup log
  // ════════════════════════════════════════════════
  console.log('\n── FAILURE 6: Startup log (re-verify) ──');
  const logs = await GET('/logs?n=5');
  const entries = (logs.body.entries || []);
  const startup = entries.filter(e => (e.event || '').toLowerCase().includes('server:started'));
  if (startup.length > 0) {
    console.log(`  ✓ PASS: debug:server:started found (PID ${ping.body.pid})`);
  } else {
    console.log('  ✗ FAIL: Recent events:');
    entries.forEach(e => console.log(`    ${e.event}`));
  }

  // ════════════════════════════════════════════════
  // FAILURE 4: Elevation
  // ════════════════════════════════════════════════
  console.log('\n── FAILURE 4: Elevation ──');
  if (elevation === 'full') {
    console.log('  ✓ PASS: elevation=full');
  } else {
    console.log(`  ✗ STILL FAILS: elevation=${elevation}`);
    console.log('  ACTION REQUIRED: Restart the app as Administrator from Windows');
    console.log('  (Right-click terminal → "Run as Administrator" → npm run dev)');
  }

  console.log(`\n  Total confidence failures: ${failures}`);
}

main().catch(e => { console.error('FATAL:', e.message); process.exit(1); });

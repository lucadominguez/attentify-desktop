#!/usr/bin/env node
/**
 * Deep-dive diagnostics for the failures found in the stress test.
 */

const BASE = 'http://127.0.0.1:9119';

async function GET(path) {
  const r = await fetch(`${BASE}${path}`);
  return r.json();
}

async function POST(path, body) {
  const r = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: r.status, body: await r.json().catch(() => r.statusText) };
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function main() {
  console.log('═══ FAILURE DIAGNOSTICS ═══\n');

  // ── DIAG 1: S2 false positives — work queries ──
  console.log('── DIAG 1: S2 Work Query False Positives ──');
  const workQueries = [
    'python async await tutorial',
    'react useEffect typescript',
    'electron ipc main renderer',
    'sql join left inner difference',
  ];

  for (const q of workQueries) {
    // Capture log count before
    const before = await GET('/logs?n=5');
    const beforeCount = (before.entries || []).length;

    await POST('/inject/search', { query: q });
    await sleep(1500);

    const after = await GET('/logs?n=30');
    const entries = (after.entries || []).slice(beforeCount);

    const guardEntries = entries.filter(e => {
      const ev = (e.event || '').toLowerCase();
      return ev.includes('guard') || ev.includes('alert') || ev.includes('search');
    });

    console.log(`\nQuery: "${q}"`);
    console.log(`  Guard/alert logs: ${guardEntries.length}`);
    for (const e of guardEntries) {
      console.log(`    event: ${e.event}`);
      if (e.details) console.log(`    details: ${JSON.stringify(e.details).slice(0, 200)}`);
      if (e.value) console.log(`    value: ${e.value}`);
    }
  }

  // ── DIAG 2: S5 Blocklist API ──
  console.log('\n── DIAG 2: S5 Blocklist API ──');

  console.log('\nCurrent /blocklist:');
  const bl1 = await GET('/blocklist');
  console.log(JSON.stringify(bl1, null, 2));

  console.log('\nPOST /inject/block { "domain": "diag-test-x.com" }');
  const r1 = await POST('/inject/block', { domain: 'diag-test-x.com' });
  console.log('  Response status:', r1.status);
  console.log('  Response body:', JSON.stringify(r1.body));

  await sleep(500);

  console.log('\nBlocklist after add:');
  const bl2 = await GET('/blocklist');
  const domains = (bl2.domains || []).map(d => d.domain);
  console.log('  Domains:', domains.join(', ') || '(empty)');

  if (!domains.includes('diag-test-x.com')) {
    console.log('\n  FAIL: domain not added. Checking /state blocklist...');
    const state = await GET('/state');
    const stateBL = state.blocklist || {};
    console.log('  state.blocklist:', JSON.stringify(stateBL).slice(0, 500));
    console.log('  state.blocklist keys:', Object.keys(stateBL).join(', '));
  }

  // Try cleanup anyway
  await POST('/inject/unblock', { domain: 'diag-test-x.com' });

  // ── DIAG 3: S1 missing twitter/reddit ──
  console.log('\n── DIAG 3: S1 Twitter/Reddit Missing ──');
  console.log('\nAll inferences:');
  const allInfs = await GET('/inferences');
  (Array.isArray(allInfs) ? allInfs : []).forEach(i => {
    console.log(`  ${i.value.padEnd(25)} status=${i.status.padEnd(14)} conf=${i.confidence}`);
  });

  // Inject twitter fresh
  console.log('\nInjecting twitter.com fresh...');
  await POST('/inject/url', { url: 'https://twitter.com', title: 'Twitter / X' });
  await sleep(2500);

  console.log('\nAll inferences after twitter injection:');
  const allInfs2 = await GET('/inferences');
  const arr2 = Array.isArray(allInfs2) ? allInfs2 : [];
  arr2.forEach(i => {
    console.log(`  ${i.value.padEnd(25)} status=${i.status.padEnd(14)} conf=${i.confidence}`);
  });

  const twitter = arr2.find(i => i.value === 'twitter.com');
  if (twitter) {
    console.log(`\n  twitter.com: status=${twitter.status} conf=${twitter.confidence}`);
  } else {
    console.log('\n  twitter.com: STILL NOT FOUND');
    // Check logs for twitter
    const logs = await GET('/logs?n=30');
    const twLogs = (logs.entries || []).filter(e => {
      const s = JSON.stringify(e).toLowerCase();
      return s.includes('twitter');
    });
    console.log(`  Twitter-related logs (${twLogs.length}):`);
    twLogs.forEach(e => console.log(`    [${e.ts}] ${e.event}`));
  }

  // ── DIAG 4: S3 mode check ──
  console.log('\n── DIAG 4: Blocking Mode State ──');
  const state = await GET('/state');
  console.log('settings.blockingMode:', state.settings?.blockingMode, '(undefined = auto)');
  console.log('elevation:', state.elevation);
  console.log('onboardingComplete:', state.onboardingComplete);

  // ── DIAG 5: Check blocklist add route in source ──
  console.log('\n── DIAG 5: Checking POST response codes ──');
  const tests = [
    { path: '/inject/block', body: { domain: 'zz-raw-test.com' } },
    { path: '/inject/unblock', body: { domain: 'pornhub.com' } },
  ];
  for (const t of tests) {
    const r = await fetch(`${BASE}${t.path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(t.body),
    });
    const text = await r.text();
    console.log(`  POST ${t.path} ${JSON.stringify(t.body)} → HTTP ${r.status}: ${text.slice(0, 200)}`);
  }

  // Re-block pornhub since we might have unblocked it
  await POST('/inject/block', { domain: 'pornhub.com' });

  // ── DIAG 6: Sweep log ──
  console.log('\n── DIAG 6: Sweep Diagnostics ──');
  const t0 = Date.now();
  await POST('/inject/sweep');
  await sleep(5000);
  const sweepLogs = await GET('/logs?n=30');
  const entries = sweepLogs.entries || [];
  const recent = entries.filter(e => e.ts > t0);
  console.log(`  Log entries after sweep trigger (since ${t0}): ${recent.length}`);
  recent.forEach(e => console.log(`    [${e.ts}] ${e.event}`));

  console.log('\n═══ DIAGNOSTICS COMPLETE ═══');
}

main().catch(e => console.error('FATAL:', e));

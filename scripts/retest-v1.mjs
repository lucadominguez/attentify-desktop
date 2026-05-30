#!/usr/bin/env node
/**
 * V1 Bug Retest — Re-checks the 6 original failures against the current build
 */
const BASE = 'http://127.0.0.1:9119';

async function GET(path) {
  const r = await fetch(`${BASE}${path}`);
  return { status: r.status, body: await r.json().catch(() => ({ _error: r.statusText })) };
}

async function POST(path, body) {
  const r = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: r.status, body: await r.json().catch(() => ({ _error: r.statusText })) };
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ═══════════════════════════════════════════════════════════
async function main() {
  console.log('═══════════════════════════════════════════════');
  console.log('  V1 BUG RETEST — 6 Original Failures');
  console.log('═══════════════════════════════════════════════\n');

  const ping = await GET('/ping');
  if (!ping.body.ok) {
    console.error('FATAL: App not running');
    process.exit(1);
  }
  const pid = ping.body.pid;
  const uptime = ping.body.uptime;
  console.log(`App: PID ${pid}, uptime ${uptime}s\n`);

  // ── BASELINE ──
  const state = await GET('/state');
  const elevation = state.body.elevation || '?';
  const blockingMode = (state.body.settings || {}).blockingMode || 'undefined';
  const blocklistCount = (state.body.blocklist || {}).domains?.length || 0;
  console.log(`BASELINE: elevation=${elevation}, blockingMode=${blockingMode}, blocked=${blocklistCount}`);
  console.log(`sessions=${(state.body.sessions || []).length}, inferences=${(state.body.inferences || []).length}, events=${(state.body.events || []).length}`);

  // ════════════════════════════════════════════════
  // FAILURE 4: Elevation
  // ════════════════════════════════════════════════
  console.log('\n── FAILURE 4: Elevation ──');
  if (elevation === 'full') {
    console.log('  ✓ PASS: elevation=full (was "soft" before)');
  } else {
    console.log(`  ✗ STILL FAILS: elevation=${elevation} (system-level blocking disabled)`);
    console.log('    Impact: hosts file, firewall, DNS, browser policy blocking all disabled');
    console.log('    Fix: Restart app as Administrator to exercise full blocking stack');
  }

  // ════════════════════════════════════════════════
  // FAILURE 1: /inject/block persistence
  // ════════════════════════════════════════════════
  console.log('\n── FAILURE 1: /inject/block persistence ──');
  const stateBefore = await GET('/state');
  const domainsBefore = (stateBefore.body.blocklist || {}).domains || [];
  console.log(`  Domains before: ${domainsBefore.map(d => d.domain).join(', ') || '(none)'}`);

  const testDomains = ['bugfix-test-a.com', 'bugfix-test-b.com', 'bugfix-test-c.com'];
  for (const d of testDomains) {
    const r = await POST('/inject/block', { domain: d });
    console.log(`  POST /inject/block ${d} → ${r.status} ${JSON.stringify(r.body)}`);
  }

  await sleep(800);

  // Check store persistence
  const stateAfter = await GET('/state');
  const domainsAfter = (stateAfter.body.blocklist || {}).domains || [];
  const persisted = testDomains.filter(d => domainsAfter.some(x => x.domain === d));
  
  if (persisted.length === 3) {
    console.log(`  ✓ PASS: All 3 domains persisted in store`);
  } else if (persisted.length > 0) {
    console.log(`  ~ PARTIAL: ${persisted.length}/3 persisted: ${persisted}`);
    console.log(`    Store domains: ${domainsAfter.map(d => d.domain).join(', ')}`);
  } else {
    console.log(`  ✗ STILL FAILS: No domains persisted. Store: ${domainsAfter.map(d => d.domain).join(', ')}`);
    console.log('    Root cause: DebugServer.ts calls eng.addDomain() but never calls patchStore()');
    console.log('    The /blocklist endpoint reads from getStore(), not the engine');
  }

  // Also check /blocklist endpoint directly
  const bl = await GET('/blocklist');
  const blDomains = (bl.body.domains || []).map(d => d.domain);
  const blPersisted = testDomains.filter(d => blDomains.includes(d));
  console.log(`  /blocklist endpoint: ${blPersisted.length}/3 visible (${blDomains.join(', ')})`);

  // Cleanup
  for (const d of testDomains) {
    await POST('/inject/unblock', { domain: d });
  }
  console.log('  Cleanup: removed test domains');

  // ════════════════════════════════════════════════
  // FAILURE 2: Duplicate inference entries
  // ════════════════════════════════════════════════
  console.log('\n── FAILURE 2: Duplicate inferences ──');

  // Count existing instagram entries
  let infs = await GET('/inferences');
  let existingInsta = (Array.isArray(infs.body) ? infs.body : []).filter(i => 
    (i.value || '').includes('instagram')
  );
  console.log(`  Existing instagram entries: ${existingInsta.length}`);

  // Inject instagram.com twice with different contexts
  console.log('  Injecting instagram.com twice (different titles)...');
  await POST('/inject/url', { url: 'https://instagram.com', title: 'Instagram Feed' });
  await sleep(2);
  await POST('/inject/url', { url: 'https://instagram.com', title: 'Instagram - Explore Page' });
  await sleep(3);

  infs = await GET('/inferences');
  const instagramEntries = (Array.isArray(infs.body) ? infs.body : []).filter(i => 
    (i.value || '') === 'instagram.com'
  );
  
  console.log(`  Instagram entries after double inject: ${instagramEntries.length}`);
  instagramEntries.forEach(e => {
    console.log(`    value=${e.value}, status=${e.status}, confidence=${e.confidence}, created_at=${e.created_at}`);
  });

  if (instagramEntries.length > 1) {
    console.log('  ✗ STILL FAILS: Duplicate entries (different statuses)');
    console.log('    Root cause: dedup key is (value, status), should be value-only');
  } else if (instagramEntries.length === 1) {
    console.log('  ✓ PASS: Dedup working (single entry)');
  } else {
    console.log('  ~ No entry found (injection may have been skipped/filtered)');
  }

  // ════════════════════════════════════════════════
  // FAILURE 3: Confidence thresholds
  // ════════════════════════════════════════════════
  console.log('\n── FAILURE 3: Confidence below spec ──');
  
  const distractionTests = [
    { url: 'https://instagram.com', title: 'Instagram', threshold: 0.85 },
    { url: 'https://tiktok.com', title: 'TikTok', threshold: 0.85 },
    { url: 'https://netflix.com', title: 'Netflix', threshold: 0.80 },
    { url: 'https://9gag.com', title: '9GAG', threshold: 0.75 },
    { url: 'https://twitch.tv', title: 'Twitch', threshold: 0.80 },
    { url: 'https://youtube.com', title: 'YouTube', threshold: 0.85 },
    { url: 'https://facebook.com', title: 'Facebook', threshold: 0.85 },
  ];

  const belowSpec = [];
  for (const t of distractionTests) {
    await POST('/inject/url', { url: t.url, title: t.title });
    await sleep(2);
  }
  await sleep(2);

  infs = await GET('/inferences');
  const allInfs = Array.isArray(infs.body) ? infs.body : [];
  
  for (const t of distractionTests) {
    const domain = t.url.replace('https://', '');
    const matches = allInfs.filter(i => i.value === domain);
    for (const m of matches) {
      const conf = m.confidence || 0;
      if (conf < t.threshold) {
        belowSpec.push(`${domain}: conf=${conf} (need >=${t.threshold}), status=${m.status}`);
      }
    }
  }

  if (belowSpec.length === 0) {
    console.log('  ✓ PASS: All distraction confidence values meet spec');
  } else {
    console.log(`  ✗ STILL FAILS: ${belowSpec.length} sites below spec:`);
    belowSpec.forEach(s => console.log(`    ${s}`));
    console.log('  Likely cause: AI model hedges on social media vs hard porn/gambling');
  }

  // Also check hardblock targets
  console.log('\n  Quick hardblock check:');
  for (const t of [{ url: 'https://pornhub.com', title: 'Pornhub' }, { url: 'https://draftkings.com', title: 'DraftKings' }]) {
    await POST('/inject/url', { url: t.url, title: t.title });
    await sleep(2);
  }
  await sleep(2);
  infs = await GET('/inferences');
  const all2 = Array.isArray(infs.body) ? infs.body : [];
  const ph = all2.filter(i => i.value === 'pornhub.com');
  const dk = all2.filter(i => i.value === 'draftkings.com');
  for (const e of [...ph, ...dk]) {
    console.log(`    ${e.value}: conf=${e.confidence}, status=${e.status}`);
  }

  // ════════════════════════════════════════════════
  // FAILURE 5: Sweep logging
  // ════════════════════════════════════════════════
  console.log('\n── FAILURE 5: Sweep logging ──');

  // Clear recent sweep state by checking current logs
  let logs = await GET('/logs?n=20');
  const logEntries = (logs.body.entries || []);
  const sweepLogs = logEntries.filter(e => 
    (e.event || '').toLowerCase().includes('sweep')
  );

  console.log(`  Sweep log entries in recent 20: ${sweepLogs.length}`);

  // Trigger a fresh sweep
  console.log('  Triggering sweep...');
  await POST('/inject/sweep', {});
  await sleep(4);

  logs = await GET('/logs?n=20');
  const newLogs = (logs.body.entries || []);
  const newSweepLogs = newLogs.filter(e => 
    (e.event || '').toLowerCase().includes('sweep')
  );

  if (newSweepLogs.length > sweepLogs.length) {
    console.log(`  ✓ PASS: New sweep log entries appeared (${newSweepLogs.length - sweepLogs.length} new)`);
    newSweepLogs.forEach(e => console.log(`    event=${e.event}, ts=${e.ts}`));
  } else {
    console.log(`  ✗ STILL FAILS: No new sweep log entries`);
    console.log('    Root cause: InferenceEngine.runBackgroundSweep() has no logger calls');
  }

  // ════════════════════════════════════════════════
  // FAILURE 6: Startup log entry
  // ════════════════════════════════════════════════
  console.log('\n── FAILURE 6: Startup log entry ──');
  
  const startupLogs = logEntries.filter(e => {
    const event = (e.event || '').toLowerCase();
    return event.includes('start') || event.includes('server:') || event.includes('app:');
  });

  if (startupLogs.length > 0) {
    console.log(`  ✓ PASS: Startup log entries found (${startupLogs.length})`);
    startupLogs.forEach(e => console.log(`    event=${e.event}, ts=${e.ts}`));
  } else {
    console.log('  ✗ STILL FAILS: No startup log entry');
    console.log('    Sample recent log events:');
    logEntries.slice(0, 5).forEach(e => console.log(`    ${e.event || JSON.stringify(e).slice(0, 80)}`));
  }

  // ════════════════════════════════════════════════
  // FAILURE 0: /inject/unblock persistence
  // ════════════════════════════════════════════════
  console.log('\n── BONUS: /inject/unblock persistence ──');
  
  // Add a domain, verify, then unblock, verify removal
  const testDom = 'unblock-test-xyz.com';
  await POST('/inject/block', { domain: testDom });
  await sleep(500);
  let st = await GET('/state');
  const added = (st.body.blocklist?.domains || []).some(d => d.domain === testDom);
  console.log(`  Added ${testDom} → in store: ${added}`);

  await POST('/inject/unblock', { domain: testDom });
  await sleep(500);
  st = await GET('/state');
  const removed = !(st.body.blocklist?.domains || []).some(d => d.domain === testDom);
  if (removed) {
    console.log(`  ✓ PASS: Domain removed from store after /inject/unblock`);
  } else {
    console.log(`  ✗ FAIL: Domain still in store after /inject/unblock`);
    console.log('    Same root cause as FAILURE 1 — no patchStore() call');
  }

  // ════════════════════════════════════════════════
  // FINAL SUMMARY
  // ════════════════════════════════════════════════
  console.log('\n\n═══════════════════════════════════════════════');
  console.log('  V1 BUG RETEST SUMMARY');
  console.log('═══════════════════════════════════════════════');
  console.log(`App: PID ${pid}, uptime ${uptime}s`);
}

main().catch(e => {
  console.error('FATAL:', e.message);
  process.exit(1);
});

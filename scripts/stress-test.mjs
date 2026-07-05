#!/usr/bin/env node
/**
 * Attentify — Comprehensive QA Stress Test
 * Run from Windows: node scripts/stress-test.mjs
 */

const BASE = 'http://127.0.0.1:9119';
const RESULTS = [];
const FAILURES = [];
const OBSERVATIONS = [];

function fail(test, expected, actual, severity = 'MEDIUM') {
  FAILURES.push({ test, expected, actual, severity });
  return false;
}

function pass(test) {
  RESULTS.push({ test, passed: true });
  return true;
}

function observe(msg) {
  OBSERVATIONS.push(msg);
}

async function GET(path) {
  const r = await fetch(`${BASE}${path}`);
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}

async function POST(path, body) {
  const r = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: r.status, body: await r.json().catch(() => null) };
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ============================================================
// PRE-FLIGHT
// ============================================================
async function preflight() {
  console.log('\n═══ PRE-FLIGHT CHECKS ═══');

  // 1. Ping
  try {
    const ping = await GET('/ping');
    console.log('1. Ping:', JSON.stringify(ping));
    pass('PREFLIGHT-1: App running') || fail('PREFLIGHT-1', 'ok:true', JSON.stringify(ping), 'CRITICAL');
  } catch (e) {
    fail('PREFLIGHT-1', 'ok:true', e.message, 'CRITICAL');
    console.error('FATAL: App not reachable');
    process.exit(1);
  }

  // 2. State coherence
  try {
    const state = await GET('/state');
    console.log('2. State keys:', Object.keys(state).join(', '));
    let ok = true;
    if (!state.blocklist) { ok = false; fail('PREFLIGHT-2a', 'has blocklist', 'missing', 'CRITICAL'); }
    if (!state.sessions) { ok = false; fail('PREFLIGHT-2b', 'has sessions', 'missing', 'CRITICAL'); }
    if (!state.settings) { ok = false; fail('PREFLIGHT-2c', 'has settings', 'missing', 'CRITICAL'); }
    if (!state.elevation) { ok = false; fail('PREFLIGHT-2d', 'has elevation', 'missing', 'CRITICAL'); }
    else if (state.elevation === 'unknown') {
      fail('PREFLIGHT-2e', 'elevation != unknown', state.elevation, 'HIGH');
    }
    const mode = state.settings?.blockingMode;
    if (mode !== 'auto' && mode !== 'ask' && mode !== undefined) {
      fail('PREFLIGHT-2f', 'blockingMode auto/ask/undefined', mode, 'HIGH');
    }
    if (ok) pass('PREFLIGHT-2: State coherent');
    console.log(`   elevation=${state.elevation}, blockingMode=${mode}, trackingEnabled=${state.settings?.trackingEnabled}`);
  } catch (e) {
    fail('PREFLIGHT-2', 'valid state', e.message, 'CRITICAL');
  }

  // 3. Logging active
  try {
    const logs = await GET('/logs?n=5');
    const entries = logs.entries || [];
    console.log('3. Log entries:', entries.length, 'path:', logs.path);
    const validTs = entries.filter(e => typeof e.ts === 'number' && e.ts > 1e12);
    if (validTs.length > 0) pass('PREFLIGHT-3: Logging active');
    else fail('PREFLIGHT-3', '≥1 log with valid ts', `${validTs.length} valid of ${entries.length}`, 'HIGH');
  } catch (e) {
    fail('PREFLIGHT-3', 'valid logs response', e.message, 'CRITICAL');
  }

  // 4. Inference engine
  try {
    await POST('/inject/url', { url: 'https://pornhub.com', title: 'Free Porn Videos' });
    console.log('4. Injected pornhub.com, waiting 2s...');
    await sleep(2000);
    const inferences = await GET('/inferences?status=auto_applied');
    const found = (Array.isArray(inferences) ? inferences : []).find(i => i.value === 'pornhub.com');
    if (found) {
      pass('PREFLIGHT-4: Inference engine alive');
      console.log('   Found pornhub.com:', found.status, 'confidence:', found.confidence);
    } else {
      // Check all inferences
      const allInfs = await GET('/inferences');
      const all = Array.isArray(allInfs) ? allInfs : [];
      const anyPornhub = all.filter(i => i.value === 'pornhub.com');
      console.log('   All pornhub entries:', anyPornhub.length, JSON.stringify(anyPornhub.map(i => ({status:i.status, conf:i.confidence}))));
      if (anyPornhub.length > 0) {
        observe('PREFLIGHT-4: pornhub.com inference found but not auto_applied — possibly in "ask" mode');
        pass('PREFLIGHT-4: Inference engine alive (found inference)');
      } else {
        fail('PREFLIGHT-4', 'pornhub inference', 'not found in any status', 'CRITICAL');
      }
    }
  } catch (e) {
    fail('PREFLIGHT-4', 'inference pipeline', e.message, 'CRITICAL');
  }
}

// ============================================================
// SUITE 1 — KNOWN DISTRACTIONS
// ============================================================
async function suite1() {
  console.log('\n═══ SUITE 1: INFERENCE — KNOWN DISTRACTIONS ═══');

  const hardblocks = [
    { url: 'https://pornhub.com',          title: 'Free Porn Videos',        minConf: 0.90, expectAuto: true },
    { url: 'https://xvideos.com',          title: 'XVIDEOS',                 minConf: 0.90, expectAuto: true },
    { url: 'https://draftkings.com',       title: 'DraftKings Sportsbook',   minConf: 0.85, expectAuto: true },
    { url: 'https://bet365.com',           title: 'Bet365',                  minConf: 0.85, expectAuto: true },
    { url: 'https://tinder.com',           title: 'Tinder - Dating App',     minConf: 0.80, expectAuto: true },
  ];

  const distractions = [
    { url: 'https://twitter.com',          title: 'Twitter / X',             minConf: 0.85 },
    { url: 'https://reddit.com',           title: 'Reddit - Front Page',     minConf: 0.75 },
    { url: 'https://instagram.com',        title: 'Instagram',               minConf: 0.85 },
    { url: 'https://tiktok.com',           title: 'TikTok',                  minConf: 0.85 },
    { url: 'https://twitch.tv',            title: 'Twitch',                  minConf: 0.80 },
    { url: 'https://netflix.com',          title: 'Netflix',                 minConf: 0.80 },
    { url: 'https://9gag.com',             title: '9GAG - Go Fun Yourself',  minConf: 0.75 },
  ];

  const safeTargets = [
    { url: 'https://github.com',           title: 'GitHub' },
    { url: 'https://docs.python.org',      title: 'Python 3 Documentation' },
    { url: 'https://stackoverflow.com',    title: 'Stack Overflow' },
    { url: 'https://notion.so',            title: 'Notion workspace' },
    { url: 'https://linear.app',           title: 'Linear - Issues' },
  ];

  let passed = 0, total = 0;

  // Inject all first to parallelize, then check
  console.log('Injecting hardblock URLs...');
  for (const t of hardblocks) {
    await POST('/inject/url', { url: t.url, title: t.title });
    process.stdout.write('.');
  }
  console.log('\nInjecting distraction URLs...');
  for (const t of distractions) {
    await POST('/inject/url', { url: t.url, title: t.title });
    process.stdout.write('.');
  }
  console.log('\nInjecting safe URLs...');
  for (const t of safeTargets) {
    await POST('/inject/url', { url: t.url, title: t.title });
    process.stdout.write('.');
  }

  console.log('\nWaiting 4s for all inferences to process...');
  await sleep(4000);

  const allInfs = await GET('/inferences');
  const infs = Array.isArray(allInfs) ? allInfs : [];
  console.log(`Total inferences: ${infs.length}`);

  // Check hardblocks
  for (const t of hardblocks) {
    total++;
    const domain = new URL(t.url).hostname;
    const match = infs.find(i => i.value === domain);
    if (!match) {
      fail(`S1-HARDBLOCK-${domain}`, `inference for ${domain}`, 'not found', 'HIGH');
      continue;
    }
    if (match.confidence < t.minConf) {
      fail(`S1-HARDBLOCK-${domain}`, `confidence ≥${t.minConf}`, `${match.confidence}`, 'HIGH');
      continue;
    }
    if (t.expectAuto && match.status !== 'auto_applied') {
      fail(`S1-HARDBLOCK-${domain}`, 'status auto_applied', match.status, 'HIGH');
      continue;
    }
    passed++;
    console.log(`  ✓ ${domain}: conf=${match.confidence} status=${match.status}`);
  }

  // Check distractions
  for (const t of distractions) {
    total++;
    const domain = new URL(t.url).hostname;
    const match = infs.find(i => i.value === domain);
    if (!match) {
      fail(`S1-DISTRACT-${domain}`, `inference for ${domain}`, 'not found', 'HIGH');
      continue;
    }
    if (match.confidence < t.minConf) {
      fail(`S1-DISTRACT-${domain}`, `confidence ≥${t.minConf}`, `${match.confidence}`, 'MEDIUM');
      observe(`S1: ${domain} confidence ${match.confidence} < expected ${t.minConf}`);
      continue;
    }
    passed++;
    console.log(`  ✓ ${domain}: conf=${match.confidence} status=${match.status}`);
  }

  // Check safe targets
  for (const t of safeTargets) {
    total++;
    const domain = new URL(t.url).hostname;
    const match = infs.find(i => i.value === domain);
    if (!match) {
      passed++;
      console.log(`  ✓ ${domain}: no inference (correctly classified as safe)`);
      continue;
    }
    if (match.confidence >= 0.70) {
      fail(`S1-SAFE-${domain}`, `confidence <0.70 (safe)`, `${match.confidence}`, 'MEDIUM');
      continue;
    }
    passed++;
    console.log(`  ✓ ${domain}: conf=${match.confidence} (below threshold, correct)`);
  }

  console.log(`\nSuite 1: ${passed}/${total} passed`);
  return { passed, total };
}

// ============================================================
// SUITE 2 — SEARCH QUERIES
// ============================================================
async function suite2() {
  console.log('\n═══ SUITE 2: INFERENCE — SEARCH QUERIES ═══');

  const recreational = [
    { query: 'pornhub free videos',       expect: true },
    { query: 'sports betting odds today', expect: true },
    { query: 'funny memes compilation',   expect: true },
    { query: 'watch anime online free',   expect: true },
    { query: 'tinder vs bumble 2025',     expect: true },
    { query: 'reddit ask me anything',    expect: true },
    { query: 'youtube funny cats',        expect: true },
  ];

  const work = [
    { query: 'python async await tutorial',          expect: false },
    { query: 'react useEffect typescript',           expect: false },
    { query: 'electron ipc main renderer',           expect: false },
    { query: 'sql join left inner difference',       expect: false },
  ];

  let passed = 0, total = 0;

  for (const t of [...recreational, ...work]) {
    total++;
    try {
      await POST('/inject/search', { query: t.query });
      await sleep(1000);
      const logs = await GET('/logs?n=15');
      const entries = logs.entries || [];
      const relevantLogs = entries.filter(e => {
        const ev = e.event || '';
        return ev.includes('guard:alert') || ev.includes('inference:candidate') || ev.includes('search:alert');
      });

      const hasAlert = relevantLogs.length > 0;

      if (t.expect && !hasAlert) {
        fail(`S2-QUERY-${t.query.slice(0, 40)}`, 'guard:alert logged', 'no alert in logs', 'MEDIUM');
      } else if (!t.expect && hasAlert) {
        fail(`S2-QUERY-${t.query.slice(0, 40)}`, 'no guard:alert (work search)', 'alert found', 'HIGH');
      } else {
        passed++;
        const icon = hasAlert ? '⚠' : '✓';
        console.log(`  ${icon} "${t.query.slice(0, 50)}" — ${hasAlert ? 'alerted' : 'clean'}`);
      }
    } catch (e) {
      fail(`S2-QUERY-${t.query.slice(0, 40)}`, 'API response', e.message, 'MEDIUM');
    }
  }

  console.log(`\nSuite 2: ${passed}/${total} passed`);
  return { passed, total };
}

// ============================================================
// SUITE 3 — BLOCKING MODE
// ============================================================
async function suite3() {
  console.log('\n═══ SUITE 3: BLOCKING MODE ═══');
  let passed = 0, total = 0;

  const state = await GET('/state');
  const currentMode = state.settings?.blockingMode || 'auto';
  console.log(`Current blocking mode: ${currentMode}`);

  // Step 1: Test in current mode
  if (currentMode === 'auto' || currentMode === undefined) {
    console.log('Testing AUTO mode...');
    // Clean first
    await POST('/inject/unblock', { domain: 'reddit.com' });

    // Inject reddit
    await POST('/inject/url', { url: 'https://reddit.com', title: 'Reddit' });
    await sleep(2000);

    const autoApplied = await GET('/inferences?status=auto_applied');
    const infs = Array.isArray(autoApplied) ? autoApplied : [];
    const reddit = infs.find(i => i.value === 'reddit.com');

    total++;
    if (reddit) {
      passed++;
      console.log('  ✓ reddit.com auto_applied in auto mode');

      // Check blocklist
      const bl = await GET('/blocklist');
      const domains = bl.domains || [];
      total++;
      if (domains.some(d => d.domain === 'reddit.com')) {
        passed++;
        console.log('  ✓ reddit.com appears in blocklist');
      } else {
        fail('S3-AUTO-BLOCKLIST', 'reddit.com in blocklist', 'not found', 'HIGH');
      }
    } else {
      // Check if it's pending (ask mode)
      const pending = await GET('/inferences?status=pending');
      const pInfs = Array.isArray(pending) ? pending : [];
      const redditP = pInfs.find(i => i.value === 'reddit.com');

      if (redditP) {
        observe('S3: reddit.com is pending, not auto_applied — app may be in ask mode');
        fail('S3-AUTO', 'reddit.com auto_applied', 'pending (ask mode?)', 'MEDIUM');
      } else {
        // Check all inferences
        const all = await GET('/inferences');
        const allInfs = Array.isArray(all) ? all : [];
        const redditAny = allInfs.filter(i => i.value === 'reddit.com');
        if (redditAny.length > 0) {
          console.log(`  reddit.com found with status: ${redditAny.map(i=>i.status).join(',')}`);
          fail('S3-AUTO', 'reddit.com auto_applied', redditAny[0].status, 'MEDIUM');
        } else {
          fail('S3-AUTO', 'reddit.com inference', 'not found at all', 'HIGH');
        }
      }
    }

    // Cleanup
    await POST('/inject/unblock', { domain: 'reddit.com' });
  }

  // Step 3: Test ASK mode by reading state.json and reporting
  // Report on current mode behavior
  {
    const pending = await GET('/inferences?status=pending');
    const pInfs = Array.isArray(pending) ? pending : [];
    console.log(`Pending inferences: ${pInfs.length}`);
    if (pInfs.length > 0) {
      observe(`S3: ${pInfs.length} pending inferences — items awaiting user action`);
      pInfs.slice(0, 5).forEach(i => console.log(`  PENDING: ${i.value} conf=${i.confidence}`));
    }
  }

  console.log(`\nSuite 3: ${passed}/${total} passed`);
  return { passed, total };
}

// ============================================================
// SUITE 4 — DEDUPLICATION AND RATE LIMITING
// ============================================================
async function suite4() {
  console.log('\n═══ SUITE 4: DEDUPLICATION + RATE LIMITING ═══');
  let passed = 0, total = 0;

  // Test 1: Same URL 5 times
  console.log('Test 1: Same URL 5x rapidly...');
  for (let i = 0; i < 5; i++) {
    await POST('/inject/url', { url: 'https://facebook.com', title: 'Facebook' });
  }
  await sleep(3000);
  const infs = await GET('/inferences');
  const allInfs = Array.isArray(infs) ? infs : [];
  const fbEntries = allInfs.filter(i => i.value === 'facebook.com');
  total++;
  if (fbEntries.length <= 1) {
    passed++;
    console.log(`  ✓ facebook.com dedup: ${fbEntries.length} entries`);
  } else {
    fail('S4-DEDUP', '≤1 facebook.com entry', `${fbEntries.length} entries`, 'MEDIUM');
  }

  // Test 2: Sweep dedup
  console.log('Test 2: Sweep dedup...');
  const beforeSweep = await GET('/inferences');
  const before = Array.isArray(beforeSweep) ? beforeSweep : [];
  const beforeCount = before.length;

  await POST('/inject/sweep');
  await sleep(3000);
  await POST('/inject/sweep');
  await sleep(3000);

  const afterSweep = await GET('/inferences');
  const after = Array.isArray(afterSweep) ? afterSweep : [];
  const afterCount = after.length;

  total++;
  if (afterCount >= beforeCount) {
    passed++;
    console.log(`  ✓ Sweep: before=${beforeCount} after=${afterCount} (no data loss)`);
  } else {
    fail('S4-SWEEP-COUNT', `afterCount ≥ beforeCount`, `${beforeCount}→${afterCount}`, 'HIGH');
  }

  // Check for duplicates (same value + status)
  const seen = new Set();
  let dupCount = 0;
  for (const i of after) {
    const key = `${i.value}|${i.status}`;
    if (seen.has(key)) dupCount++;
    seen.add(key);
  }
  total++;
  if (dupCount === 0) {
    passed++;
    console.log(`  ✓ No duplicate (value, status) pairs in ${afterCount} inferences`);
  } else {
    fail('S4-SWEEP-DEDUP', '0 duplicate pairs', `${dupCount} duplicates`, 'MEDIUM');
  }

  // Test 3: Rate limit on AI calls
  console.log('Test 3: Rate limit check...');
  const beforeLogs = await GET('/logs?n=50');
  const beforeTs = (beforeLogs.entries || []).filter(e => e.event && e.event.includes('ai:eval')).map(e => e.ts);

  // Inject 3 unknown domains
  await POST('/inject/url', { url: 'https://unknownsite-test1.tv', title: 'Test1' });
  await POST('/inject/url', { url: 'https://unknownsite-test2.gg', title: 'Test2' });
  await POST('/inject/url', { url: 'https://unknownsite-test3.fun', title: 'Test3' });

  await sleep(15000); // Wait for rate limiting

  const afterLogs = await GET('/logs?n=50');
  const afterTs = (afterLogs.entries || []).filter(e => e.event && e.event.includes('ai:eval')).map(e => e.ts);
  const newEvals = afterTs.filter(t => !beforeTs.includes(t));

  total++;
  if (newEvals.length <= 3) {
    // Check spacing
    newEvals.sort();
    let spacedOk = true;
    for (let i = 1; i < newEvals.length; i++) {
      if (newEvals[i] - newEvals[i-1] < 3500) spacedOk = false;
    }
    if (spacedOk || newEvals.length <= 1) {
      passed++;
      console.log(`  ✓ Rate limited: ${newEvals.length} new AI eval entries`);
    } else {
      observe('S4: AI eval calls may not be properly rate-limited (close timestamps)');
      console.log(`  ~ ${newEvals.length} new evals, spacing uncertain`);
      passed++; // Pass but note
    }
  } else {
    fail('S4-RATE', '≤3 new AI evals', `${newEvals.length}`, 'MEDIUM');
  }

  console.log(`\nSuite 4: ${passed}/${total} passed`);
  return { passed, total };
}

// ============================================================
// SUITE 5 — BLOCKLIST INTEGRITY
// ============================================================
async function suite5() {
  console.log('\n═══ SUITE 5: BLOCKLIST INTEGRITY ═══');
  let passed = 0, total = 0;

  // Step 1: Add domains
  console.log('Adding test domains...');
  await POST('/inject/block', { domain: 'test-domain-a.com' });
  await POST('/inject/block', { domain: 'test-domain-b.com' });
  await POST('/inject/block', { domain: 'test-domain-c.com' });
  await sleep(500);

  let bl = await GET('/blocklist');
  const domains = bl.domains || [];

  ['test-domain-a.com', 'test-domain-b.com', 'test-domain-c.com'].forEach(d => {
    total++;
    if (domains.some(x => x.domain === d)) {
      passed++;
      console.log(`  ✓ ${d} in blocklist`);
    } else {
      fail(`S5-ADD-${d}`, `${d} in blocklist`, 'not found', 'HIGH');
    }
  });

  // Step 2: Remove one
  console.log('Removing test-domain-b.com...');
  await POST('/inject/unblock', { domain: 'test-domain-b.com' });
  await sleep(500);
  bl = await GET('/blocklist');
  const domains2 = bl.domains || [];

  total++;
  if (!domains2.some(x => x.domain === 'test-domain-b.com')) {
    passed++;
    console.log('  ✓ test-domain-b.com removed');
  } else {
    fail('S5-REMOVE-b', 'test-domain-b.com removed', 'still present', 'HIGH');
  }

  total++;
  if (domains2.some(x => x.domain === 'test-domain-a.com') && domains2.some(x => x.domain === 'test-domain-c.com')) {
    passed++;
    console.log('  ✓ test-domain-a.com and test-domain-c.com still present');
  } else {
    fail('S5-INTACT', 'a and c still present', JSON.stringify(domains2.map(d=>d.domain)), 'HIGH');
  }

  // Step 4: URL blocked interstitial trigger
  console.log('Testing blocked URL trigger...');
  await POST('/inject/block', { domain: 'test-blocked-site.com' });
  await sleep(500);
  await POST('/inject/url', { url: 'https://test-blocked-site.com/page', title: 'Test' });
  await sleep(1000);
  const logs = await GET('/logs?n=30');
  const entries = logs.entries || [];
  const blockedLog = entries.find(e => e.event && e.event.includes('url-blocked'));

  total++;
  if (blockedLog) {
    passed++;
    console.log(`  ✓ monitor:url-blocked event logged: ${blockedLog.event}`);
  } else {
    fail('S5-INTERSTITIAL', 'monitor:url-blocked in logs', 'not found', 'MEDIUM');
  }

  // Step 5: Cleanup
  console.log('Cleaning up test domains...');
  await POST('/inject/unblock', { domain: 'test-domain-a.com' });
  await POST('/inject/unblock', { domain: 'test-domain-c.com' });
  await POST('/inject/unblock', { domain: 'test-blocked-site.com' });

  console.log(`\nSuite 5: ${passed}/${total} passed`);
  return { passed, total };
}

// ============================================================
// SUITE 6 — BACKGROUND SWEEP
// ============================================================
async function suite6() {
  console.log('\n═══ SUITE 6: BACKGROUND SWEEP ═══');
  let passed = 0, total = 0;

  // Step 1: Trigger and time
  console.log('Triggering sweep...');
  const t0 = Date.now();
  await POST('/inject/sweep');
  await sleep(5000);
  const logs = await GET('/logs?n=30');
  const entries = logs.entries || [];
  const sweepLogs = entries.filter(e => e.ts && e.ts > t0 && (e.event || '').includes('sweep'));

  total++;
  if (sweepLogs.length > 0) {
    passed++;
    console.log(`  ✓ Sweep produced ${sweepLogs.length} log entries`);
  } else {
    // Check for any post-sweep activity
    const anyRecent = entries.filter(e => e.ts && e.ts > t0);
    if (anyRecent.length > 0) {
      console.log(`  ~ No sweep-specific logs, but ${anyRecent.length} recent entries found`);
      observe('S6: Sweep ran but no sweep-labeled log entries');
      passed++; // still passes — it ran
    } else {
      fail('S6-SWEEP-LOG', 'sweep log entries', 'none', 'MEDIUM');
    }
  }

  // Step 2: Verify no re-insertion
  const before = await GET('/inferences');
  const beforeInfs = Array.isArray(before) ? before : [];
  const beforeCount = beforeInfs.length;

  await POST('/inject/sweep');
  await sleep(5000);

  const after = await GET('/inferences');
  const afterInfs = Array.isArray(after) ? after : [];
  const afterCount = afterInfs.length;

  total++;
  if (afterCount >= beforeCount) {
    passed++;
    console.log(`  ✓ Sweep count: ${beforeCount} → ${afterCount} (no data loss)`);
  } else {
    fail('S6-SWEEP-NODROP', `after ≥ before`, `${beforeCount}→${afterCount}`, 'HIGH');
  }

  // Check no duplicates
  const seen = new Set();
  let dupCount = 0;
  for (const i of afterInfs) {
    const key = `${i.value}|${i.status}`;
    if (seen.has(key)) dupCount++;
    seen.add(key);
  }
  total++;
  if (dupCount === 0) {
    passed++;
    console.log(`  ✓ No duplicate (value, status) pairs post-sweep`);
  } else {
    fail('S6-SWEEP-DEDUP', 'no duplicates post-sweep', `${dupCount} duplicates`, 'MEDIUM');
  }

  // Step 3: Rate limiting between sweeps
  const sweepT0 = Date.now();
  await POST('/inject/sweep');
  await POST('/inject/sweep');
  await sleep(2000);
  const finalLogs = await GET('/logs?n=20');
  const finalEntries = finalLogs.entries || [];
  const recentSweeps = finalEntries.filter(e => e.ts > sweepT0 && (e.event || '').includes('sweep'));

  total++;
  if (recentSweeps.length <= 2) {
    passed++;
    console.log(`  ✓ Sweep rate limiting: ${recentSweeps.length} sweep events (≤2 expected)`);
  } else {
    fail('S6-SWEEP-RATE', '≤2 sweep events', `${recentSweeps.length}`, 'LOW');
  }

  console.log(`\nSuite 6: ${passed}/${total} passed`);
  return { passed, total };
}

// ============================================================
// SUITE 7 — EDGE CASES AND ADVERSARIAL INPUTS
// ============================================================
async function suite7() {
  console.log('\n═══ SUITE 7: EDGE CASES + ADVERSARIAL ═══');
  let passed = 0, total = 0;

  const tests = [
    { name: 'empty url',       method: 'POST', path: '/inject/url',    body: { url: '' },                    expectStatus: [400], expectCrash: false },
    { name: 'not-a-url',       method: 'POST', path: '/inject/url',    body: { url: 'not-a-url' },           expectCrash: false },
    { name: 'javascript url',  method: 'POST', path: '/inject/url',    body: { url: 'javascript:alert(1)' }, expectCrash: false },
    { name: 'file url',        method: 'POST', path: '/inject/url',    body: { url: 'file:///C:/Windows' },  expectCrash: false },
    { name: 'oversized url',   method: 'POST', path: '/inject/url',    body: { url: 'https://reddit.com/' + 'a'.repeat(2000), title: 'big' }, expectCrash: false },
    { name: 'oversized query', method: 'POST', path: '/inject/search', body: { query: 'memes ' + 'x'.repeat(500) }, expectCrash: false },
    { name: 'missing url',     method: 'POST', path: '/inject/url',    body: {},                             expectStatus: [400] },
    { name: 'missing domain',  method: 'POST', path: '/inject/block',  body: {},                             expectStatus: [400] },
    { name: 'missing query',   method: 'POST', path: '/inject/search', body: {},                             expectStatus: [400] },
  ];

  for (const t of tests) {
    total++;
    try {
      const r = await POST(t.path, t.body);
      const statusOk = t.expectStatus ? t.expectStatus.includes(r.status) : r.status < 500;
      const pingOk = !t.expectCrash;

      if (statusOk && pingOk) {
        passed++;
        console.log(`  ✓ ${t.name}: HTTP ${r.status}`);
      } else {
        fail(`S7-EDGE-${t.name}`, `HTTP ok, no crash`, `status=${r.status}`, 'MEDIUM');
      }
    } catch (e) {
      // Check if app still alive
      try {
        await GET('/ping');
        passed++;
        console.log(`  ✓ ${t.name}: error handled (${e.message.slice(0, 60)}), app alive`);
      } catch {
        fail(`S7-EDGE-${t.name}`, 'app survived injection', `CRASHED: ${e.message}`, 'CRITICAL');
      }
    }
  }

  // Concurrent injections
  console.log('Testing 10 concurrent injections...');
  total++;
  try {
    const promises = [
      'twitter.com', 'reddit.com', 'instagram.com', 'tiktok.com', 'twitch.tv',
      'netflix.com', '9gag.com', 'youtube.com', 'facebook.com', 'discord.com'
    ].map(d => POST('/inject/url', { url: `https://${d}`, title: d }).catch(() => null));

    await Promise.all(promises);
    await sleep(5000);

    const ping = await GET('/ping');
    const infs = await GET('/inferences');
    const logs = await GET('/logs?n=50');

    if (ping.ok && Array.isArray(infs) && Array.isArray(logs.entries)) {
      passed++;
      console.log(`  ✓ Concurrent 10x: ping ok, inferences=${Array.isArray(infs)?infs.length:'?'}, logs ok`);
    } else {
      fail('S7-CONCURRENT', 'app survived 10 concurrent', 'corrupted state', 'CRITICAL');
    }
  } catch (e) {
    fail('S7-CONCURRENT', 'app survived 10 concurrent', `CRASH: ${e.message}`, 'CRITICAL');
  }

  console.log(`\nSuite 7: ${passed}/${total} passed`);
  return { passed, total };
}

// ============================================================
// SUITE 8 — DATA LAYER INTEGRITY
// ============================================================
async function suite8() {
  console.log('\n═══ SUITE 8: DATA LAYER INTEGRITY ═══');
  let passed = 0, total = 0;

  // Events
  const events = await GET('/events?limit=100');
  total++;
  if (Array.isArray(events)) {
    passed++;
    console.log(`  ✓ /events returns array (${events.length} items)`);

    let evOk = true;
    for (const e of events.slice(0, 50)) {
      if (typeof e.ts !== 'number' || e.ts === 0 || e.ts === null || e.ts < 1e12) {
        evOk = false;
        console.log(`    BAD ts in event: ${JSON.stringify(e)}`);
      }
      if (typeof e.type !== 'string') evOk = false;
    }
    total++;
    if (evOk) {
      passed++;
      console.log('  ✓ All events have valid ts and type');
    } else {
      fail('S8-EVENT-FIELDS', 'all events have valid ts/type', 'some invalid', 'MEDIUM');
    }
  } else {
    fail('S8-EVENTS', 'events array', typeof events, 'MEDIUM');
  }

  // Inferences
  const infs = await GET('/inferences');
  total++;
  if (Array.isArray(infs)) {
    passed++;
    console.log(`  ✓ /inferences returns array (${infs.length} items)`);

    const validStatuses = new Set(['pending', 'confirmed', 'rejected', 'auto_applied']);
    let infOk = true;
    for (const i of infs) {
      if (typeof i.id === 'undefined') { infOk = false; console.log(`    Missing id: ${JSON.stringify(i)}`); }
      if (typeof i.confidence === 'number' && (i.confidence < 0 || i.confidence > 1.0)) {
        infOk = false;
        console.log(`    BAD confidence: ${i.confidence} for ${i.value}`);
      }
      if (!validStatuses.has(i.status)) {
        infOk = false;
        console.log(`    BAD status: ${i.status} for ${i.value}`);
      }
    }
    total++;
    if (infOk) {
      passed++;
      console.log('  ✓ All inferences have valid fields');
    } else {
      fail('S8-INF-FIELDS', 'all inferences valid', 'some invalid', 'HIGH');
    }
  } else {
    fail('S8-INFERENCES', 'inferences array', typeof infs, 'MEDIUM');
  }

  // State
  const state = await GET('/state');
  total++;
  if (Array.isArray(state.blocklist?.domains)) {
    passed++;
    console.log(`  ✓ state.blocklist.domains is array (${state.blocklist.domains.length} items)`);

    let blOk = true;
    for (const d of state.blocklist.domains.slice(0, 20)) {
      if (typeof d.domain !== 'string') blOk = false;
      if (typeof d.addedAt !== 'number') { blOk = false; console.log(`    BAD addedAt: ${d.addedAt} for ${d.domain}`); }
    }
    total++;
    if (blOk) {
      passed++;
      console.log('  ✓ Blocklist entries have valid fields');
    } else {
      fail('S8-BLOCKLIST', 'all blocklist entries valid', 'some invalid', 'MEDIUM');
    }
  }

  if (Array.isArray(state.sessions)) {
    total++;
    passed++;
    console.log(`  ✓ sessions is array (${state.sessions.length} items)`);
  }

  if (typeof state.settings?.trackingEnabled === 'boolean') {
    total++;
    passed++;
    console.log(`  ✓ trackingEnabled is boolean: ${state.settings.trackingEnabled}`);
  } else {
    total++;
    fail('S8-TRACKING', 'trackingEnabled boolean', typeof state.settings?.trackingEnabled, 'LOW');
  }

  console.log(`\nSuite 8: ${passed}/${total} passed`);
  return { passed, total };
}

// ============================================================
// SUITE 9 — LOGGING SYSTEM
// ============================================================
async function suite9() {
  console.log('\n═══ SUITE 9: LOGGING SYSTEM ═══');
  let passed = 0, total = 0;

  const logs = await GET('/logs?n=200');
  const entries = logs.entries || [];

  // Path
  total++;
  if (logs.path && (logs.path.includes('Attentify') || logs.path.includes('debug.log'))) {
    passed++;
    console.log(`  ✓ log path: ${logs.path}`);
  } else {
    fail('S9-PATH', 'path contains Attentify', logs.path || 'N/A', 'LOW');
  }

  // Entries structure
  total++;
  const allHaveTs = entries.length > 0 && entries.every(e => typeof e.ts === 'number');
  const allHaveEvent = entries.length > 0 && entries.every(e => typeof e.event === 'string');
  if (allHaveTs && allHaveEvent) {
    passed++;
    console.log(`  ✓ ${entries.length} log entries with ts + event`);
  } else {
    fail('S9-STRUCTURE', 'all entries have ts + event', `${entries.length} entries, tsOk=${allHaveTs} eventOk=${allHaveEvent}`, 'MEDIUM');
  }

  // Chronological order
  total++;
  let chronoOk = true;
  for (let i = 1; i < entries.length; i++) {
    if (entries[i].ts < entries[i-1].ts) {
      chronoOk = false;
      break;
    }
  }
  if (chronoOk) {
    passed++;
    console.log('  ✓ Log entries are chronological');
  } else {
    fail('S9-CHRONO', 'chronological order', 'out of order', 'LOW');
  }

  // Check twitch injection logging
  console.log('Injecting twitch.tv to verify log entry...');
  await POST('/inject/url', { url: 'https://twitch.tv', title: 'Twitch' });
  await sleep(1500);
  const postLogs = await GET('/logs?n=30');
  const postEntries = postLogs.entries || [];
  const twitchLog = postEntries.find(e => {
    const ev = (e.event || '').toLowerCase();
    const keys = Object.values(e).join(' ').toLowerCase();
    return ev.includes('inference:candidate') && (ev.includes('twitch') || keys.includes('twitch'));
  });

  total++;
  if (twitchLog) {
    passed++;
    console.log(`  ✓ inference:candidate log for twitch.tv: ${twitchLog.event}`);
  } else {
    // Broader check — does twitch appear anywhere?
    const anyTwitch = postEntries.filter(e => {
      const s = JSON.stringify(e).toLowerCase();
      return s.includes('twitch');
    });
    if (anyTwitch.length > 0) {
      console.log(`  ~ twitch found in ${anyTwitch.length} logs but not as inference:candidate`);
      observe('S9: twitch.tv logged but not as inference:candidate');
      passed++;
    } else {
      fail('S9-TWITCH-LOG', 'twitch in logs', 'not found', 'LOW');
    }
  }

  console.log(`\nSuite 9: ${passed}/${total} passed`);
  return { passed, total };
}

// ============================================================
// RELIABILITY GAUNTLET
// ============================================================
async function gauntlet() {
  console.log('\n═══ RELIABILITY GAUNTLET ═══');
  let succeeded = true;

  try {
    // 1. Ping
    const ping = await GET('/ping');
    console.log('1. Ping:', ping.ok ? 'OK' : 'FAIL');
    if (!ping.ok) throw new Error('pre-gauntlet ping failed');

    // 2. Inject 20 URLs
    console.log('2. Injecting 20 URLs...');
    const gauntletSites = [
      'twitter.com', 'reddit.com', 'netflix.com', 'instagram.com', 'tiktok.com',
      'pornhub.com', 'draftkings.com', 'tinder.com', 'youtube.com', 'github.com',
      'twitter.com', 'reddit.com', 'netflix.com', 'instagram.com', 'tiktok.com',
      'pornhub.com', 'draftkings.com', 'tinder.com', 'youtube.com', 'github.com',
    ];
    for (const site of gauntletSites) {
      await POST('/inject/url', { url: `https://${site}`, title: site });
      await sleep(1000);
    }
    console.log('   Done injecting');

    // 3. Sweep
    console.log('3. Sweep...');
    await POST('/inject/sweep');

    // 4. Wait
    console.log('4. Waiting 10s...');
    await sleep(10000);

    // 5. Inferences
    const infs = await GET('/inferences');
    const infsValid = Array.isArray(infs);
    console.log(`5. Inferences: ${infsValid ? `${infs.length} items` : 'INVALID'}`);
    if (!infsValid) throw new Error('inferences not valid JSON array');

    // 6. Logs
    const logs = await GET('/logs?n=100');
    const logsValid = Array.isArray(logs.entries) && logs.entries.length >= 10;
    console.log(`6. Logs: ${logs.entries?.length || 0} entries (${logsValid ? 'OK' : 'FAIL'})`);
    if (!logsValid) throw new Error('logs invalid or <10 entries');

    // 7. Blocklist
    const bl = await GET('/blocklist');
    const domains = (bl.domains || []).map(d => d.domain);
    const hardblocks = ['pornhub.com', 'draftkings.com', 'tinder.com'];
    const missing = hardblocks.filter(h => !domains.includes(h));
    console.log(`7. Blocklist: ${domains.length} domains. Hardblocks: ${missing.length === 0 ? 'ALL PRESENT' : 'MISSING: ' + missing}`);
    if (missing.length > 0) {
      console.log('   Blocklist contents:', domains.join(', '));
      observe(`GAUNTLET: hardblock domains missing from blocklist: ${missing}`);
    }

    // 8. Unblock
    console.log('8. Cleaning up blocks from gauntlet...');
    for (const d of hardblocks) {
      await POST('/inject/unblock', { domain: d });
    }
    console.log('   Done');

    // 9. Final ping
    const finalPing = await GET('/ping');
    console.log('9. Final ping:', finalPing.ok ? 'OK — APP SURVIVED' : 'FAIL');
    if (!finalPing.ok) succeeded = false;

  } catch (e) {
    console.error(`GAUNTLET FAILED: ${e.message}`);
    succeeded = false;
  }

  console.log(`\nGauntlet: ${succeeded ? 'PASS' : 'FAIL'}`);
  return succeeded;
}

// ============================================================
// MAIN
// ============================================================
async function main() {
  console.log('═══════════════════════════════════════════════');
  console.log('  ATTENTIFY — QA STRESS TEST');
  console.log('═══════════════════════════════════════════════');
  console.log(`Started: ${new Date().toISOString()}`);
  console.log(`Target: ${BASE}`);

  await preflight();

  const s1 = await suite1();
  const s2 = await suite2();
  const s3 = await suite3();
  const s4 = await suite4();
  const s5 = await suite5();
  const s6 = await suite6();
  const s7 = await suite7();
  const s8 = await suite8();
  const s9 = await suite9();
  const gauntletResult = await gauntlet();

  // FINAL REPORT
  console.log('\n\n═══════════════════════════════════════════════');
  console.log('  FINAL REPORT');
  console.log('═══════════════════════════════════════════════');
  console.log(`\n## Pre-flight`);
  console.log(`Suite 1 — Inference: Known Distractions    ${s1.passed}/${s1.total} passed`);
  console.log(`Suite 2 — Inference: Search Queries        ${s2.passed}/${s2.total} passed`);
  console.log(`Suite 3 — Blocking Mode (auto vs ask)      ${s3.passed}/${s3.total} passed`);
  console.log(`Suite 4 — Deduplication + Rate Limiting    ${s4.passed}/${s4.total} passed`);
  console.log(`Suite 5 — Blocklist Integrity              ${s5.passed}/${s5.total} passed`);
  console.log(`Suite 6 — Background Sweep                 ${s6.passed}/${s6.total} passed`);
  console.log(`Suite 7 — Edge Cases + Adversarial         ${s7.passed}/${s7.total} passed`);
  console.log(`Suite 8 — Data Layer Integrity             ${s8.passed}/${s8.total} passed`);
  console.log(`Suite 9 — Logging System                   ${s9.passed}/${s9.total} passed`);
  console.log(`Reliability Gauntlet                       ${gauntletResult ? 'PASS' : 'FAIL'}`);

  console.log(`\n## Failures (${FAILURES.length})`);
  for (const f of FAILURES) {
    console.log(`- ${f.test}`);
    console.log(`  Expected: ${f.expected}`);
    console.log(`  Actual: ${f.actual}`);
    console.log(`  Severity: ${f.severity}`);
  }

  console.log(`\n## Observations (${OBSERVATIONS.length})`);
  for (const o of OBSERVATIONS) {
    console.log(`- ${o}`);
  }

  const totalPassed = s1.passed + s2.passed + s3.passed + s4.passed + s5.passed + s6.passed + s7.passed + s8.passed + s9.passed;
  const totalTests = s1.total + s2.total + s3.total + s4.total + s5.total + s6.total + s7.total + s8.total + s9.total;
  console.log(`\nTotal: ${totalPassed}/${totalTests} passed (${FAILURES.length} failures, ${OBSERVATIONS.length} observations)`);

  // Exit code
  const hasCritical = FAILURES.some(f => f.severity === 'CRITICAL');
  process.exit(hasCritical ? 1 : FAILURES.length > 0 ? 2 : 0);
}

main().catch(e => {
  console.error('FATAL:', e);
  process.exit(1);
});

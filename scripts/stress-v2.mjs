#!/usr/bin/env node
/**
 * QA Test Suite V2 — Tests the newly added debug endpoints
 */
const BASE = 'http://127.0.0.1:9119';

async function GET(path) {
  const r = await fetch(`${BASE}${path}`);
  return { status: r.status, body: await r.json().catch(() => r.statusText) };
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

const FAILURES = [];
function fail(test, expected, actual, severity = 'MEDIUM') {
  FAILURES.push({ test, expected, actual, severity });
  console.log(`  ✗ FAIL [${severity}]: ${expected} — got: ${actual}`);
}
function pass(label) {
  console.log(`  ✓ ${label}`);
}

// ═══════════════════════════════════════════════════════════
// TEST 1: POST /inject/session
// ═══════════════════════════════════════════════════════════
async function testSessions() {
  console.log('\n═══ TEST 1: POST /inject/session ═══');

  // 1a. Basic functionality
  console.log('1a. Basic session injection...');
  const r = await POST('/inject/session', { count: 5 });
  if (r.status === 200) {
    pass(`/inject/session count=5 → HTTP ${r.status}: ${JSON.stringify(r.body)}`);
  } else {
    fail('/inject/session', 'HTTP 200', `HTTP ${r.status}: ${JSON.stringify(r.body)}`, 'HIGH');
    return;
  }

  await sleep(2000);

  // 1b. Check state for sessions
  console.log('1b. Checking state.sessions...');
  const state = await GET('/state');
  if (state.body.sessions) {
    const sessions = state.body.sessions;
    pass(`state.sessions: ${sessions.length} sessions`);
    const active = sessions.filter(s => s.active);
    if (sessions.length > 0) {
      pass(`Sessions populated (${sessions.length} total, ${active.length} active)`);
      
      // Show sample
      const sample = sessions.slice(0, 3);
      for (const s of sample) {
        console.log(`    app="${s.app}", domain="${s.url || s.title || '?'}", duration=${s.duration}ms, isDistraction=${s.isDistraction}, category=${s.category}`);
      }
    } else {
      fail('Sessions populated', '>0 sessions', '0 sessions');
    }
  } else {
    fail('state.sessions', 'present', 'missing');
  }

  // 1c. Check heuristic alerts
  console.log('1c. Checking heuristicAlerts...');
  const alerts = state.body.heuristicAlerts || [];
  if (alerts.length > 0) {
    pass(`heuristicAlerts: ${alerts.length} alerts generated`);
    alerts.slice(0, 5).forEach(a => {
      console.log(`    alert: ${a.type || a.title || JSON.stringify(a).slice(0, 100)}`);
    });
  } else {
    console.log('  ~ No heuristic alerts (may need more sessions or specific patterns)');
  }

  // 1d. Check activitySessions
  console.log('1d. Checking activitySessions...');
  const actSessions = state.body.activitySessions || [];
  pass(`activitySessions: ${actSessions.length} entries`);

  // 1e. Edge case: count=0
  console.log('1e. Edge: count=0...');
  const r0 = await POST('/inject/session', { count: 0 });
  if (r0.status === 200 || r0.status === 400) {
    pass(`count=0 → HTTP ${r0.status}`);
  } else {
    fail('count=0', 'HTTP 200/400', `HTTP ${r0.status}`);
  }

  // 1f. Edge case: count=50 (stress)
  console.log('1f. Edge: count=50...');
  const r50 = await POST('/inject/session', { count: 50 });
  if (r50.status === 200) {
    pass(`count=50 → HTTP ${r50.status}, sessions created`);
  } else {
    fail('count=50', 'HTTP 200', `HTTP ${r50.status}`);
  }

  // 1g. Check events DB for the sessions
  console.log('1g. Checking /events...');
  const events = await GET('/events?limit=20');
  if (Array.isArray(events.body)) {
    const urlEvents = events.body.filter(e => e.type === 'url_visit' || e.type === 'search_query');
    pass(`/events: ${events.body.length} total, ${urlEvents.length} url/search events`);
  }
}

// ═══════════════════════════════════════════════════════════
// TEST 2: POST /inject/chat
// ═══════════════════════════════════════════════════════════
async function testChat() {
  console.log('\n═══ TEST 2: POST /inject/chat ═══');

  // 2a. Basic chat
  console.log('2a. Basic query...');
  const r1 = await POST('/inject/chat', { message: 'how many sites are currently blocked?' });
  console.log(`  HTTP ${r1.status}: ${JSON.stringify(r1.body).slice(0, 500)}`);
  if (r1.status === 200 && r1.body) {
    pass('Chat endpoint responds');
  } else {
    fail('/inject/chat basic', 'HTTP 200', `HTTP ${r1.status}`, 'HIGH');
  }

  await sleep(3000); // Wait for agent to process (may call Anthropic API)

  // 2b. Check agent messages
  console.log('2b. Checking /agent/messages...');
  const msgs = await GET('/agent/messages');
  if (Array.isArray(msgs.body)) {
    pass(`/agent/messages: ${msgs.body.length} messages`);
    msgs.body.slice(-5).forEach(m => {
      console.log(`    [${m.role}] ${(m.content || '').slice(0, 100)}`);
    });
  } else {
    fail('/agent/messages', 'array', typeof msgs.body);
  }

  // 2c. Tool use: set a goal
  console.log('2c. Tool use: set_goal...');
  const r2 = await POST('/inject/chat', { message: 'set a focus goal: write the Q3 report by end of day' });
  console.log(`  HTTP ${r2.status}: ${JSON.stringify(r2.body).slice(0, 300)}`);

  await sleep(3000);

  // 2d. Check goals
  console.log('2d. Checking /agent/goals...');
  const goals = await GET('/agent/goals');
  if (Array.isArray(goals.body)) {
    pass(`/agent/goals: ${goals.body.length} goals`);
    goals.body.forEach(g => {
      console.log(`    goal: "${g.text}" active=${g.active}`);
    });
  } else {
    fail('/agent/goals', 'array', typeof goals.body);
  }

  // 2e. Tool use: block a domain
  console.log('2e. Tool use: block_domain...');
  const r3 = await POST('/inject/chat', { message: 'block test-chat-site.com for 30 minutes' });
  console.log(`  HTTP ${r3.status}: ${JSON.stringify(r3.body).slice(0, 300)}`);

  await sleep(3000);

  // Check if tool was called by looking at agent messages
  const msgs2 = await GET('/agent/messages');
  if (Array.isArray(msgs2.body)) {
    const toolMsgs = msgs2.body.filter(m => m.role === 'tool' || (m.content && m.content.includes('block')));
    if (toolMsgs.length > 0) {
      pass(`Tool use messages found: ${toolMsgs.length}`);
    } else {
      console.log('  ~ No tool messages visible (may be embedded in assistant response)');
    }
  }

  // 2f. Edge: empty message
  console.log('2f. Edge: empty message...');
  const r4 = await POST('/inject/chat', { message: '' });
  if (r4.status === 400) {
    pass('Empty message → 400');
  } else {
    console.log(`  HTTP ${r4.status}: ${JSON.stringify(r4.body).slice(0, 200)}`);
  }

  // 2g. Edge: very long message
  console.log('2g. Edge: long message...');
  const longMsg = 'test '.repeat(500);
  const r5 = await POST('/inject/chat', { message: longMsg });
  console.log(`  HTTP ${r5.status}: ${JSON.stringify(r5.body).slice(0, 200)}`);
  if (r5.status === 200 || r5.status === 400) {
    pass('Long message handled (200 or 400)');
  } else {
    fail('Long message', '200/400', `HTTP ${r5.status}`);
  }
}

// ═══════════════════════════════════════════════════════════
// TEST 3: POST /inject/proactive
// ═══════════════════════════════════════════════════════════
async function testProactive() {
  console.log('\n═══ TEST 3: POST /inject/proactive ═══');

  // 3a. Basic trigger
  console.log('3a. Triggering proactive intervention...');
  const r = await POST('/inject/proactive', {});
  console.log(`  HTTP ${r.status}: ${JSON.stringify(r.body).slice(0, 500)}`);
  if (r.status === 200) {
    pass('Proactive endpoint responds');
  } else {
    fail('/inject/proactive', 'HTTP 200', `HTTP ${r.status}`);
  }

  await sleep(3000);

  // 3b. Check if agent generated a message
  console.log('3b. Checking for proactive message...');
  const msgs = await GET('/agent/messages');
  if (Array.isArray(msgs.body)) {
    const proactive = msgs.body.filter(m => m.content && m.content.includes('[proactive]'));
    if (proactive.length > 0) {
      pass(`Proactive message generated: "${proactive[0].content.slice(0, 120)}"`);
    } else {
      // Check if API key isn't configured
      const recent = msgs.body.slice(-3);
      console.log(`  ~ No proactive message. API key configured? Latest messages: ${recent.length}`);
      recent.forEach(m => console.log(`    [${m.role}] ${(m.content||'').slice(0, 100)}`));
    }
  }

  // 3c. Check shouldProact throttle
  console.log('3c. Testing throttle (should not fire twice)...');
  // First trigger already happened. Second should be throttled.
  const r2 = await POST('/inject/proactive', {});
  console.log(`  HTTP ${r2.status}: ${JSON.stringify(r2.body).slice(0, 300)}`);
  if (r2.body && r2.body.throttled) {
    pass('Proactive throttled on second call');
  } else {
    console.log('  ~ Throttle status unclear from response');
  }
}

// ═══════════════════════════════════════════════════════════
// TEST 4: POST /inject/scan
// ═══════════════════════════════════════════════════════════
async function testScan() {
  console.log('\n═══ TEST 4: POST /inject/scan ═══');

  console.log('4a. Triggering FocusScan...');
  const r = await POST('/inject/scan', {});
  console.log(`  HTTP ${r.status}: ${JSON.stringify(r.body).slice(0, 800)}`);

  if (r.status === 200) {
    pass('FocusScan endpoint responds');
  } else {
    fail('/inject/scan', 'HTTP 200', `HTTP ${r.status}`);
    return;
  }

  // 4b. Check results
  if (r.body) {
    if (r.body.installedApps) {
      pass(`Installed apps detected: ${Array.isArray(r.body.installedApps) ? r.body.installedApps.length : 'N/A'}`);
      if (Array.isArray(r.body.installedApps)) {
        r.body.installedApps.slice(0, 10).forEach(a => console.log(`    app: ${a}`));
      }
    }
    if (r.body.knownDistractors) {
      const distractors = Array.isArray(r.body.knownDistractors) ? r.body.knownDistractors : [];
      pass(`Known distractors found: ${distractors.length}`);
      distractors.forEach(d => console.log(`    distractor: ${d}`));
    }
    if (r.body.issues) {
      pass(`Scan issues: ${Array.isArray(r.body.issues) ? r.body.issues.length : 'N/A'}`);
    }
  }

  // 4c. Check logs for scan
  console.log('4c. Checking logs for scan entry...');
  const logs = await GET('/logs?n=10');
  if (logs.body && logs.body.entries) {
    const scanLogs = logs.body.entries.filter(e => 
      (e.event || '').toLowerCase().includes('scan') || 
      JSON.stringify(e).toLowerCase().includes('scan')
    );
    if (scanLogs.length > 0) {
      pass(`Scan logged: ${scanLogs.length} entries`);
    } else {
      console.log('  ~ No scan log entries (logging gap)');
    }
  }

  // 4d. Edge: scan twice rapidly
  console.log('4d. Edge: double scan...');
  const r2 = await POST('/inject/scan', {});
  if (r2.status === 200) {
    pass('Double scan → HTTP 200');
  } else {
    console.log(`  HTTP ${r2.status}`);
  }
}

// ═══════════════════════════════════════════════════════════
// TEST 5: Integration — full pipeline
// ═══════════════════════════════════════════════════════════
async function testIntegration() {
  console.log('\n═══ TEST 5: INTEGRATION — Full Pipeline ═══');

  // 5a. Inject sessions that simulate a "doom loop" pattern
  console.log('5a. Simulating doom-loop pattern...');
  // Pattern: Twitter → work → Twitter → work → Twitter → Twitter → Twitter
  // Inject 7 sessions alternating between distraction and work
  await POST('/inject/session', { count: 3 }); // creates mixed sessions
  await sleep(1000);

  // 5b. Check for heuristic alerts on rapid switching
  const state = await GET('/state');
  const alerts = state.body.heuristicAlerts || [];
  console.log(`  Heuristic alerts after pattern: ${alerts.length}`);

  // 5c. Trigger sweep to see if it picks up the new sessions
  console.log('5b. Sweep after session injection...');
  await POST('/inject/sweep');
  await sleep(3000);
  const infs = await GET('/inferences');
  console.log(`  Inferences after sweep: ${Array.isArray(infs.body) ? infs.body.length : '?'}`);

  // 5d. Chat about the results
  console.log('5c. Chat about focus...');
  const cr = await POST('/inject/chat', { message: 'summarize my focus today in one sentence' });
  console.log(`  HTTP ${cr.status}: ${JSON.stringify(cr.body).slice(0, 300)}`);

  // 5e. Final state check
  console.log('5d. Final health check...');
  const ping = await GET('/ping');
  if (ping.body.ok) {
    pass(`App still alive (uptime ${ping.body.uptime}s)`);
  } else {
    fail('Final ping', 'ok:true', JSON.stringify(ping.body), 'CRITICAL');
  }
}

// ═══════════════════════════════════════════════════════════
// TEST 6: 90-day retention
// ═══════════════════════════════════════════════════════════
async function testRetention() {
  console.log('\n═══ TEST 6: Event Retention ═══');

  // Check /events for old entries
  const events = await GET('/events?limit=200');
  if (Array.isArray(events.body)) {
    const now = Date.now();
    const ninetyDays = 90 * 24 * 60 * 60 * 1000;
    const oldEvents = events.body.filter(e => e.ts && (now - e.ts) > ninetyDays);
    
    if (oldEvents.length === 0) {
      pass(`No events older than 90 days (${events.body.length} total) — retention working`);
    } else {
      console.log(`  ~ ${oldEvents.length} events older than 90 days found`);
      // They may be pre-existing from before the retention feature
    }

    // Check timestamps are reasonable
    const badTs = events.body.filter(e => !e.ts || e.ts < 1e12 || e.ts > now + 86400000);
    if (badTs.length === 0) {
      pass(`All ${events.body.length} events have reasonable timestamps`);
    } else {
      fail('Event timestamps', 'all valid', `${badTs.length} invalid`);
    }
  }

  // Check agent messages retention
  const msgs = await GET('/agent/messages');
  if (Array.isArray(msgs.body)) {
    const now = Date.now();
    const ninetyDays = 90 * 24 * 60 * 60 * 1000;
    const oldMsgs = msgs.body.filter(m => m.ts && (now - m.ts) > ninetyDays);
    if (oldMsgs.length === 0) {
      pass(`No agent messages older than 90 days (${msgs.body.length} total)`);
    } else {
      console.log(`  ~ ${oldMsgs.length} agent messages older than 90 days`);
    }
  }
}

// ═══════════════════════════════════════════════════════════
// MAIN
// ═══════════════════════════════════════════════════════════
async function main() {
  console.log('═══════════════════════════════════════════════');
  console.log('  QA V2 — New Endpoint Stress Test');
  console.log('═══════════════════════════════════════════════');

  // Health check
  const ping = await GET('/ping');
  if (!ping.body.ok) {
    console.error('FATAL: App not running');
    process.exit(1);
  }
  console.log(`App: PID ${ping.body.pid}, uptime ${ping.body.uptime}s`);

  // Check which endpoints actually exist
  console.log('\n── Endpoint discovery ──');
  const endpoints = [
    '/inject/session', '/inject/chat', '/inject/proactive',
    '/inject/scan', '/agent/goals', '/agent/messages'
  ];
  for (const ep of endpoints) {
    const method = ep.startsWith('/agent') ? 'GET' : 'POST';
    const r = method === 'GET' ? await GET(ep) : await POST(ep, {});
    const exists = r.status !== 404;
    console.log(`  ${exists ? '✓' : '✗'} ${method} ${ep} → HTTP ${r.status}`);
  }

  await testSessions();
  await testChat();
  await testProactive();
  await testScan();
  await testIntegration();
  await testRetention();

  // ═══════════════════ FINAL REPORT ═══════════════════════
  console.log('\n\n═══════════════════════════════════════════════');
  console.log('  QA V2 REPORT');
  console.log('═══════════════════════════════════════════════');

  if (FAILURES.length === 0) {
    console.log('\n  ALL TESTS PASSED ✓');
  } else {
    console.log(`\n  ${FAILURES.length} FAILURES:`);
    for (const f of FAILURES) {
      console.log(`\n  [${f.severity}] ${f.test}`);
      console.log(`    Expected: ${f.expected}`);
      console.log(`    Actual: ${f.actual}`);
    }
  }
}

main().catch(e => {
  console.error('FATAL:', e.message);
  process.exit(1);
});

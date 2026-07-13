/* Attentify browser demo shim.
 *
 * The Electron renderer is a normal web SPA whose only host dependency is
 * window.electronAPI (the IPC bridge). This file fakes that bridge with an
 * in-memory, simulated backend so the real app runs as a live demo in any
 * browser, with no Electron, no install and no network. Loaded before the app bundle. */
(function () {
  'use strict';
  var HOUR = 3600000, MIN = 60000, now = Date.now();

  // ── simulated persistent state ──────────────────────────────────────────────
  var store = {
    blocklist: {
      domains: [
        { domain: 'reddit.com', addedAt: now - 3 * HOUR, reason: 'auto:url_visit:88%' },
        { domain: 'x.com', addedAt: now - 2 * HOUR },
        { domain: 'tiktok.com', addedAt: now - 26 * HOUR },
        { domain: 'instagram.com', addedAt: now - 50 * HOUR, reason: 'auto:social:91%' },
      ],
      processes: [{ name: 'Discord', addedAt: now - 5 * HOUR }],
    },
    sessions: [], schedules: [], stats: [], activitySessions: [], dailyStats: [],
    heuristicAlerts: [], weeklyReports: [], lastScan: null,
    onboardingComplete: true, elevation: 'full', chatHistory: [],
    settings: {
      trackingEnabled: true, heuristicsEnabled: true, weeklyReportEnabled: true,
      productiveApps: ['code', 'cursor', 'notion', 'obsidian', 'word', 'excel'],
      distractingApps: ['discord', 'slack', 'twitter', 'instagram', 'tiktok', 'reddit'],
      focusGoalHoursPerDay: 4, ollamaUrl: '', ollamaModel: '', blockingMode: 'auto',
    },
    blockEventCount: 41,
    aiUsageUsd: 0.12, cloudActive: false, cloudTier: null, cloudLicense: undefined, cloudEmail: undefined,
    feedBlocks: [
      { domain: 'reddit.com', displayName: 'Reddit feed' },
      { domain: 'twitter.com', displayName: 'Twitter / X feed' },
    ],
    contentRules: [],
  };
  var hasKey = false;

  var _sid = 0;
  function sess(app, title, url, cat, minsAgo, durMin, distract) {
    var end = now - minsAgo * MIN, dur = durMin * MIN;
    return { id: 's-' + (_sid++), app: app, title: title, url: url, category: cat, startTime: end - dur, endTime: end, duration: dur, isDistraction: !!distract };
  }
  // Absolute-time session for the historical week (dayOffset days ago at h:m).
  function hsess(dayOffset, h, m, app, title, url, cat, durMin, distract) {
    var d = new Date(now); d.setDate(d.getDate() - dayOffset); d.setHours(h, m || 0, 0, 0);
    var start = d.getTime();
    return { id: 's-' + (_sid++), app: app, title: title, url: url, category: cat, startTime: start, endTime: start + durMin * MIN, duration: durMin * MIN, isDistraction: !!distract };
  }

  // Today (always within the last few hours, whatever time the demo loads).
  var todaySessions = [
    sess('Code', 'api/handlers.rs · attentify', '', 'development', 4, 38, false),
    sess('chrome', 'Build a REST API in Rust · YouTube', 'https://youtube.com/watch?v=abc', 'entertainment', 46, 12, false),
    sess('chrome', 'reddit.com/r/rust', 'https://reddit.com/r/rust', 'social', 70, 9, true),
    sess('Code', 'api/router.rs', '', 'development', 95, 52, false),
    sess('chrome', 'X / Home', 'https://x.com/home', 'social', 150, 16, true),
    sess('Slack', '#engineering', '', 'communication', 180, 14, false),
    sess('Notion', 'Sprint board', '', 'productivity', 205, 18, false),
    sess('chrome', 'Async Rust in 100 Seconds · YouTube', 'https://youtube.com/watch?v=xyz', 'entertainment', 230, 7, false),
    sess('Discord', '#dev-team', '', 'social', 250, 12, true),
  ];

  // A full, realistic and SFW historical week (days 1–6) so Timesheets, Analytics and
  // the custom cards all have rich data. Weekdays = focused work with afternoon dips;
  // weekends = lighter with a side project. Everything here is work/study-appropriate.
  function buildWeek() {
    var out = [];
    for (var day = 1; day <= 6; day++) {
      var dow = new Date(now - day * 24 * HOUR).getDay(); // 0 Sun .. 6 Sat
      var weekend = (dow === 0 || dow === 6);
      if (!weekend) {
        out.push(hsess(day, 9, 5, 'Code', 'api/handlers.rs', '', 'development', 55, false));
        out.push(hsess(day, 10, 5, 'chrome', 'Tokio docs — tasks & scheduling', 'https://docs.rs/tokio', 'browser', 12, false));
        out.push(hsess(day, 10, 22, 'chrome', 'reddit.com/r/rust', 'https://reddit.com/r/rust', 'social', 7, true));
        out.push(hsess(day, 10, 35, 'Code', 'api/handlers.rs', '', 'development', 46, false));
        out.push(hsess(day, 11, 25, 'Slack', '#engineering', '', 'communication', 13, false));
        out.push(hsess(day, 11, 45, 'Notion', 'Sprint planning', '', 'productivity', 20, false));
        out.push(hsess(day, 12, 30, 'chrome', 'X / Home', 'https://x.com/home', 'social', 14, true));
        out.push(hsess(day, 12, 50, 'chrome', 'How Tokio schedules tasks · YouTube', 'https://youtube.com/watch?v=t1', 'entertainment', 16, false));
        out.push(hsess(day, 13, 30, 'Code', 'tests/integration.rs', '', 'development', 42, false));
        out.push(hsess(day, 14, 18, 'chrome', 'reddit.com/r/programming', 'https://reddit.com/r/programming', 'social', 9, true));
        out.push(hsess(day, 14, 35, 'Figma', 'Dashboard v2', '', 'productivity', 26, false));
        out.push(hsess(day, 15, 10, 'chrome', 'X / Home', 'https://x.com/home', 'social', 11, true));
        out.push(hsess(day, 15, 30, 'Code', 'api/router.rs', '', 'development', 48, false));
        out.push(hsess(day, 16, 25, 'Google Docs', 'Design doc — v2 API', '', 'productivity', 22, false));
        out.push(hsess(day, 16, 50, 'Discord', '#dev-team', '', 'social', 12, true));
        if (day % 2 === 0) out.push(hsess(day, 21, 15, 'chrome', 'TikTok', 'https://tiktok.com', 'entertainment', 17, true));
        if (day % 3 === 0) out.push(hsess(day, 22, 5, 'chrome', 'Instagram', 'https://instagram.com', 'social', 13, true));
      } else {
        out.push(hsess(day, 11, 0, 'Code', 'side-project/main.go', '', 'development', 42, false));
        out.push(hsess(day, 12, 10, 'chrome', 'reddit.com/r/all', 'https://reddit.com/r/all', 'social', 24, true));
        out.push(hsess(day, 14, 30, 'chrome', 'Sourdough for beginners · YouTube', 'https://youtube.com/watch?v=c1', 'entertainment', 26, false));
        out.push(hsess(day, 15, 20, 'chrome', 'Instagram', 'https://instagram.com', 'social', 18, true));
        out.push(hsess(day, 16, 10, 'chrome', 'TikTok', 'https://tiktok.com', 'entertainment', 21, true));
        out.push(hsess(day, 20, 0, 'Steam', 'Stardew Valley', '', 'gaming', 55, true));
      }
    }
    return out.filter(function (s) { return s.startTime < now; });
  }

  var recent = todaySessions.concat(buildWeek());

  // Behavioural patterns (clean, work-context) — power the Logic page + Analytics.
  var alerts = [
    { id: 'h1', type: 'doom-loop', severity: 'high', title: 'Doom-loop on Reddit', description: 'You cycled Reddit → X → Reddit six times in 40 minutes this afternoon, each visit a little longer than the last.', detectedAt: now - 95 * MIN, app: 'chrome', dismissed: false, switchRate: 0 },
    { id: 'h2', type: 'rapid-switching', severity: 'medium', title: 'Rapid context switching', description: '72 app switches per hour around 3pm — well above your focused baseline of ~18/hour.', detectedAt: now - 3 * HOUR, app: 'chrome', dismissed: false, switchRate: 72 },
    { id: 'h3', type: 'tab-anxiety', severity: 'medium', title: 'Tab anxiety while writing', description: 'You reopened X five times in ten minutes while working on the design doc.', detectedAt: now - 5 * HOUR, app: 'chrome', dismissed: false },
    { id: 'h4', type: 'late-night', severity: 'low', title: 'Late-night scrolling', description: '17 minutes on TikTok after 11pm on Tuesday — your focus the next morning dipped ~15%.', detectedAt: now - 30 * HOUR, app: 'chrome', dismissed: false },
  ];

  function analytics() {
    return {
      today: {
        date: new Date().toISOString().split('T')[0],
        focusedTime: 2 * HOUR + 41 * MIN, distractedTime: 48 * MIN, neutralTime: 12 * MIN,
        blockEvents: store.blockEventCount, focusSessions: 2,
        appBreakdown: [
          { app: 'Code', duration: 2 * HOUR + 10 * MIN, category: 'development' },
          { app: 'chrome', duration: 54 * MIN, category: 'browser' },
          { app: 'Discord', duration: 22 * MIN, category: 'social' },
          { app: 'Slack', duration: 14 * MIN, category: 'communication' },
        ],
        focusScore: 72,
      },
      weekly: {
        focusedTime: 16 * HOUR, distractedTime: 5 * HOUR,
        timePerApp: { 'Code': 14 * HOUR, 'chrome': 6 * HOUR, 'Slack': 2 * HOUR, 'Discord': 1 * HOUR },
        sessionCount: 38, blockEvents: 263,
      },
      heuristicAlerts: alerts,
      recentSessions: recent,
      domains: [
        { domain: 'reddit.com', category: 'social', classification: 'distraction', confidence: 0.88, total_ms: 96 * MIN, last_seen: now - 70 * MIN },
        { domain: 'x.com', category: 'social', classification: 'distraction', confidence: 0.85, total_ms: 78 * MIN, last_seen: now - 150 * MIN },
        { domain: 'tiktok.com', category: 'entertainment', classification: 'distraction', confidence: 0.92, total_ms: 55 * MIN, last_seen: now - 30 * HOUR },
        { domain: 'instagram.com', category: 'social', classification: 'distraction', confidence: 0.90, total_ms: 44 * MIN, last_seen: now - 20 * HOUR },
        { domain: 'youtube.com', category: 'video', classification: 'mixed', confidence: 0.55, total_ms: 71 * MIN, last_seen: now - 46 * MIN },
        { domain: 'docs.rs', category: 'browser', classification: 'productive', confidence: 0.80, total_ms: 62 * MIN, last_seen: now - 3 * HOUR },
      ],
    };
  }

  function usage() {
    var used = store.aiUsageUsd || 0, limit = 1.0;
    return { usedUsd: used, limitUsd: limit, remainingUsd: Math.max(0, limit - used), subscribed: !!store.cloudActive, hasOwnKey: hasKey, exhausted: !hasKey && !store.cloudActive && used >= limit };
  }
  function cloud() { return { license: store.cloudLicense || null, active: !!store.cloudActive, tier: store.cloudTier || null, email: store.cloudEmail || null }; }

  // ── event subscription registry ───────────────────────────────────────────────
  var subs = {};
  function on(channel) { return function (cb) { (subs[channel] = subs[channel] || []).push(cb); return function () { subs[channel] = (subs[channel] || []).filter(function (f) { return f !== cb; }); }; }; }
  function emit(channel) { var args = [].slice.call(arguments, 1); (subs[channel] || []).forEach(function (cb) { try { cb.apply(null, args); } catch (e) { /* ignore */ } }); }

  // ── simulated assistant (drives the real ChatPanel via chat:* events) ─────────
  // Recognises a broad range of plain-English asks so the demo shows how flexible
  // the real assistant is: block sites, keep-but-block, topic/title bans, focus
  // goals, strict mode, timed blocks and "what's eating my focus" questions.
  function runChat(text) {
    var t = (text || '').toLowerCase(), reply, touched = false;
    function blockSite(d) {
      d = d.toLowerCase();
      if (!store.blocklist.domains.some(function (x) { return x.domain === d; })) {
        store.blocklist.domains.unshift({ domain: d, addedAt: Date.now(), reason: 'user:assistant' });
        store.blockEventCount++; emit('inference:auto-blocked', { domain: d, confidence: 0.95 });
      }
      touched = true;
    }
    function feedBlock(domain, label) {
      if (!store.feedBlocks.some(function (f) { return f.displayName === label; })) store.feedBlocks.unshift({ domain: domain, displayName: label });
      touched = true;
    }

    var wantsBlock = /block|hide|kill|remove|stop|no more|get rid|mute|ban/.test(t);
    var sites = [];
    if (/reddit/.test(t)) sites.push('reddit.com');
    if (/twitter|\bx\b/.test(t)) sites.push('x.com');
    if (/instagram|insta/.test(t)) sites.push('instagram.com');
    if (/tiktok/.test(t)) sites.push('tiktok.com');
    if (/facebook/.test(t)) sites.push('facebook.com');

    if (/youtube|shorts|feed/.test(t) && /keep|but|subscrip|tutorial|only/.test(t)) {
      // the "scalpel" showcase: cut the bait, keep the useful parts
      feedBlock('youtube.com', 'YouTube Shorts + home feed');
      reply = "Nice, that's the sweet spot. I've hidden YouTube Shorts and the home feed, but left your subscriptions, search and any video you actually open. You keep the tutorials, you lose the rabbit hole. 🛡️";
    } else if (/music video|reaction|rage|gym|influencer|politic|gossip|celebrit|drama|edits|amv|brain ?rot/.test(t) || (/\bno\b/.test(t) && /video|content|stuff/.test(t))) {
      var topic = /music/.test(t) ? 'Music videos'
        : /reaction/.test(t) ? 'Reaction videos'
        : /rage/.test(t) ? 'Rage bait'
        : /gym|influencer/.test(t) ? 'Gym influencers'
        : /politic/.test(t) ? 'Political content'
        : /gossip|celebrit|drama/.test(t) ? 'Celebrity gossip'
        : 'That kind of content';
      feedBlock('youtube.com', topic);
      reply = "Done. I'll keep **" + topic.toLowerCase() + "** out of your feed and pull any matching video before you click it. Just tell me others whenever, in plain words. 🛡️";
    } else if (wantsBlock && sites.length) {
      sites.forEach(blockSite);
      var timed = /hour|2h|today|afternoon|morning|until|till|while/.test(t);
      reply = "Done, blocked **" + sites.join("**, **") + "**" + (timed ? ", and I'll lift it again on schedule" : "") + ". The useful parts of each site still work. 🛡️";
    } else if (/strict|lock me|be hard|serious mode|hold me/.test(t)) {
      feedBlock('multi', 'Social + short-form (strict)');
      reply = "Strict mode on. Social, Shorts, Reels and the usual rabbit holes are shut, and I'll push back hard if you try to wander off. Go do the thing. 🛡️";
    } else if (/writ|work|study|focus|deadline|deep|concentrat|until|till|get.*done|essay|code|ship/.test(t)) {
      feedBlock('multi', 'Social + short-form (focus)');
      reply = "On it. I'll keep the noisy feeds and social out of your way while you work, and quietly step in if you start drifting. You don't have to think about it. 🛡️";
    } else if (/distract|most|eating|focus|score|where.*time|this week|evening/.test(t)) {
      reply = "Looking at this week: **Reddit** and **X** ate the most off-task time, with a dip most evenings around 9pm. Your focus score today is **72%**. Want me to lock those two down after 8pm?";
    } else if (/2 hour|2h|for an hour|timer|temporar/.test(t)) {
      reply = "Got it, I'll add a timed block and lift it automatically when the timer is up. Stay with it.";
    } else {
      reply = "Tell me what you're going for and I'll handle the rest. A few things you can try:\n\n- \"I'm writing until 5, keep me off social\"\n- \"Hide Shorts but keep my subscriptions\"\n- \"No music videos or rage bait\"\n- \"What's been eating my focus this week?\"";
    }
    if (touched) emit('store:refresh');
    var i = 0;
    setTimeout(function () {
      (function step() {
        if (i < reply.length) {
          var n = 2 + Math.floor(Math.random() * 4);
          emit('chat:chunk', reply.slice(i, i + n)); i += n;
          setTimeout(step, 15 + Math.random() * 26);
        } else {
          emit('store:refresh');
          emit('chat:done', { id: 'm-' + Date.now(), content: reply, timestamp: Date.now() });
        }
      })();
    }, 280);
  }

  // ── the fake bridge ─────────────────────────────────────────────────────────────
  var api = {
    getStore: function () { return Promise.resolve(store); },
    setStore: function (patch) {
      patch = patch || {};
      if (patch.settings) { store.settings = Object.assign({}, store.settings, patch.settings); delete patch.settings; }
      Object.assign(store, patch);
      return Promise.resolve(store);
    },
    runScan: function () {
      var res = {
        runAt: Date.now(), issueCount: 3,
        issues: [
          { id: 'i1', category: 'feeds', severity: 'high', title: 'YouTube Shorts shelf active', description: 'The Shorts shelf is loading on your home feed.', affectedItem: 'youtube.com', fixAction: 'Hide Shorts' },
          { id: 'i2', category: 'apps', severity: 'medium', title: 'Discord launches at startup', description: 'Discord is set to open when you log in.', affectedItem: 'Discord' },
          { id: 'i3', category: 'notifications', severity: 'low', title: 'Reddit notifications enabled', description: 'Browser notifications from reddit.com are on.', affectedItem: 'reddit.com' },
        ],
        installedDistractors: ['Discord', 'Steam'], runningDistractors: ['Discord'],
        startupDistractors: ['Discord'], browserExtensionsFound: 1,
        recentDistractingSites: ['reddit.com', 'x.com', 'youtube.com'],
      };
      store.lastScan = res;
      return Promise.resolve(res);
    },
    addDomain: function (domain) {
      domain = String(domain).toLowerCase();
      if (!store.blocklist.domains.some(function (d) { return d.domain === domain; })) {
        store.blocklist.domains.unshift({ domain: domain, addedAt: Date.now() });
        store.blockEventCount++;
      }
      return Promise.resolve({ ok: true });
    },
    removeDomain: function (domain) { store.blocklist.domains = store.blocklist.domains.filter(function (d) { return d.domain !== domain; }); return Promise.resolve(); },
    addProcess: function (name) {
      if (!store.blocklist.processes.some(function (p) { return p.name === name; })) store.blocklist.processes.unshift({ name: name, addedAt: Date.now() });
      return Promise.resolve();
    },
    removeProcess: function (name) { store.blocklist.processes = store.blocklist.processes.filter(function (p) { return p.name !== name; }); return Promise.resolve(); },
    getElevationCheck: function () { return Promise.resolve({ elevated: true, writable: true }); },

    startSession: function (mode, durationMs) {
      var s = { id: 'sess-' + Date.now(), startedAt: Date.now(), endsAt: durationMs ? Date.now() + durationMs : undefined, mode: mode, active: true };
      store.sessions = [s].concat(store.sessions.map(function (x) { return Object.assign({}, x, { active: false }); }));
      return Promise.resolve(s);
    },
    stopSession: function (id) { store.sessions = store.sessions.map(function (s) { return s.id === id ? Object.assign({}, s, { active: false }) : s; }); return Promise.resolve(); },

    sendMessage: function () { return Promise.resolve({ reply: '', actions: [] }); },
    chatStart: function (text) { runChat(text); },
    onChatChunk: on('chat:chunk'), onChatTool: on('chat:tool'), onChatDone: on('chat:done'), onChatError: on('chat:error'),

    checkIntent: function () { return Promise.resolve({ verdict: 'deny', reason: 'Demo mode, so unblocking is disabled here.', ollamaUsed: false }); },
    getElevationStatus: function () { return Promise.resolve('full'); },
    requestElevation: function () { store.elevation = 'full'; return Promise.resolve('full'); },
    relaunchAsAdmin: function () { return Promise.resolve(true); },

    registerStartupDaemon: function () { return Promise.resolve(true); },
    unregisterStartupDaemon: function () { return Promise.resolve(true); },
    getStartupStatus: function () { return Promise.resolve(true); },
    getPlatform: function () { return Promise.resolve('windows'); },

    getAnalytics: function () { return Promise.resolve(analytics()); },
    dismissHeuristicAlert: function () { return Promise.resolve(); },
    exportPdf: function () { return Promise.resolve({ ok: false, canceled: true }); },

    hideInterstitial: function () { return Promise.resolve(); },
    proceedAnyway: function () { return Promise.resolve(); },

    startBreak: function (durationMs, reason) { var endsAt = Date.now() + (durationMs || 0); emit('break:started', { endsAt: endsAt, reason: reason }); return Promise.resolve({ ok: true, endsAt: endsAt }); },
    endBreak: function () { emit('break:ended'); return Promise.resolve({ ok: true }); },
    getBreakStatus: function () { return Promise.resolve(null); },

    getInferences: function () { return Promise.resolve([
      { id: 'inf1', type: 'domain', value: 'news.ycombinator.com', confidence: 0.74, reasoning: 'Opened 9 times today in short bursts between coding tasks, each under a minute — classic micro-escape, not a deliberate read.', status: 'pending', action: 'block' },
      { id: 'inf2', type: 'domain', value: 'amazon.com', confidence: 0.66, reasoning: 'Three visits during your afternoon work block, none tied to a search you started — likely idle browsing.', status: 'pending', action: 'block' },
      { id: 'inf3', type: 'app', value: 'Discord', confidence: 0.58, reasoning: 'Frequent tab-outs to #dev-team during deep-work blocks; some are work chatter, some are drift.', status: 'pending', action: 'block' },
    ]); },
    resolveInference: function () { return Promise.resolve({ ok: true }); },

    getAgentHistory: function () { return Promise.resolve([]); },
    clearChatHistory: function () { return Promise.resolve({ ok: true }); },
    dismissProactive: function () { return Promise.resolve({ ok: true }); },

    getGoals: function () { return Promise.resolve([
      { id: 'g1', text: 'Ship the v2 API by Friday', priority: 2 },
      { id: 'g2', text: 'Write 500 words every morning', priority: 1 },
      { id: 'g3', text: 'No social before lunch', priority: 1 },
    ]); },
    addGoal: function (text) { return Promise.resolve({ id: 'g-' + Date.now(), text: text }); },
    clearGoal: function () { return Promise.resolve({ ok: true }); },
    getPreferences: function () { return Promise.resolve([
      { key: 'work hours', value: '9am–5pm on weekdays', scope: 'weekdays', confidence: 0.9, source: 'user' },
      { key: 'reddit', value: 'r/rust and r/programming are for work', scope: 'always', confidence: 0.82, source: 'user' },
      { key: 'peak focus', value: 'mornings before noon', scope: 'morning', confidence: 0.86, source: 'agent' },
      { key: 'youtube', value: 'conference talks and tutorials count as work', scope: 'always', confidence: 0.7, source: 'agent' },
    ]); },
    setPreference: function () { return Promise.resolve({ ok: true }); },
    deletePreference: function () { return Promise.resolve({ ok: true }); },

    // ── Conversations, checkpoints, custom analytics, context, timesheets, startup ──
    getConversations: function () { return Promise.resolve([
      { id: 'demo', title: "I'm writing until 5, keep me off social", created_at: now - 3 * HOUR, updated_at: now - 2 * HOUR },
      { id: 'demo2', title: 'Hide Shorts but keep subscriptions', created_at: now - 30 * HOUR, updated_at: now - 29 * HOUR },
    ]); },
    createConversation: function (title) { return Promise.resolve({ id: 'demo-' + Date.now(), title: title || 'New chat', created_at: Date.now(), updated_at: Date.now() }); },
    getConversationMessages: function (id) {
      if (id === 'demo2') return Promise.resolve([
        { id: 'n1', role: 'user', content: 'Hide YouTube Shorts but keep my subscriptions and tutorials.', ts: now - 30 * HOUR },
        { id: 'n2', role: 'assistant', content: "Done. I've hidden the Shorts shelf, the player and /shorts/* on YouTube, but left your subscriptions, search and any video you open. You keep the tutorials, you lose the rabbit hole. 🛡️", ts: now - 30 * HOUR + 6000 },
      ]);
      return Promise.resolve([
        { id: 'm1', role: 'user', content: "I'm writing until 5, keep me off social.", ts: now - 3 * HOUR },
        { id: 'm2', role: 'assistant', content: "On it. I've muted Reddit, X, Instagram and TikTok until 5pm and I'll nudge you if you start drifting. Go write. 🛡️", ts: now - 3 * HOUR + 6000 },
        { id: 'm3', role: 'user', content: "What's been eating my focus this week?", ts: now - 2 * HOUR },
        { id: 'm4', role: 'assistant', content: "**Reddit** and **X** took the most off-task time this week — about 3h40m combined, mostly afternoon micro-breaks that turned into scrolls. Your strongest focus is mornings before noon (81% focus ratio). Want me to lock social after 2pm?", ts: now - 2 * HOUR + 6000 },
      ]);
    },
    renameConversation: function () { return Promise.resolve({ ok: true }); },
    deleteConversation: function () { return Promise.resolve({ ok: true }); },
    getCheckpoints: function (id) {
      if (id === 'demo2') return Promise.resolve([{ id: 'cpB', message_id: 'n1', ts: now - 30 * HOUR, label: 'Hide YouTube Shorts but keep subscriptions' }]);
      return Promise.resolve([
        { id: 'cpA1', message_id: 'm1', ts: now - 3 * HOUR, label: "I'm writing until 5, keep me off social" },
        { id: 'cpA2', message_id: 'm3', ts: now - 2 * HOUR, label: "What's been eating my focus this week?" },
      ]);
    },
    restoreCheckpoint: function () { return Promise.resolve({ ok: true, label: 'this point' }); },
    getUserContext: function () { return Promise.resolve([
      { id: 'ctx1', text: "I'm a software engineer building a Rust API — coding is my main work.", ts: now - 2 * 24 * HOUR },
      { id: 'ctx2', text: 'YouTube is often work for me: I watch conference talks and tutorials.', ts: now - 24 * HOUR },
      { id: 'ctx3', text: 'Reddit r/rust and r/programming are research, not distraction.', ts: now - 5 * HOUR },
    ]); },
    addUserContext: function (text) { return Promise.resolve({ ok: true, note: { id: 'ctx-' + Date.now(), text: text, ts: Date.now() } }); },
    deleteUserContext: function () { return Promise.resolve({ ok: true }); },
    getCustomCards: function () { return Promise.resolve([
      { id: 'card1', title: 'Social media by weekday', description: 'Off-task social time, grouped by day', viz: 'bar', spec: { rangeDays: 7, groupBy: 'weekday', metric: 'time', distraction: 'only', limit: 7 }, createdAt: now - 2 * 24 * HOUR },
      { id: 'card2', title: 'Focus ratio by hour', description: 'When you focus best across the day', viz: 'line', spec: { rangeDays: 7, groupBy: 'hour', metric: 'focus_ratio', distraction: 'all' }, createdAt: now - 24 * HOUR },
      { id: 'card3', title: 'Top apps this week', description: 'Where your time goes', viz: 'table', spec: { rangeDays: 7, groupBy: 'app', metric: 'time', distraction: 'all', limit: 8 }, createdAt: now - 4 * HOUR },
    ]); },
    deleteCustomCard: function () { return Promise.resolve({ ok: true }); },
    buildAnalyticsCard: function () { return Promise.resolve({ ok: true, summary: 'Built a card from your description.' }); },
    getTimesheet: function () { try { return Promise.resolve({ rangeDays: 31, sessions: analytics().recentSessions || [] }); } catch (e) { return Promise.resolve({ rangeDays: 31, sessions: [] }); } },
    getStartupItems: function () { return Promise.resolve([
      { id: 'hkcu:Spotify', name: 'Spotify', command: 'C:\\Users\\you\\AppData\\Roaming\\Spotify\\Spotify.exe', location: 'hkcu' },
      { id: 'hkcu:Discord', name: 'Discord', command: 'C:\\Users\\you\\AppData\\Local\\Discord\\Update.exe --processStart Discord.exe', location: 'hkcu' },
      { id: 'hkcu:Slack', name: 'Slack', command: 'C:\\Users\\you\\AppData\\Local\\slack\\slack.exe', location: 'hkcu' },
      { id: 'folder:Steam.lnk', name: 'Steam', command: 'Steam.lnk', location: 'folder' },
      { id: 'folder:Epic Games Launcher.lnk', name: 'Epic Games Launcher', command: 'Epic Games Launcher.lnk', location: 'folder' },
    ]); },
    disableStartupItem: function () { return Promise.resolve({ ok: true }); },
    getAppVersion: function () { return Promise.resolve('1.1.0'); },
    overlayReady: function () {}, overlayShown: function () {},

    getApiKeyStatus: function () { return Promise.resolve({ hasKey: hasKey }); },
    setApiKey: function () { hasKey = true; emit('usage:changed', usage()); return Promise.resolve({ ok: true }); },
    deleteApiKey: function () { hasKey = false; emit('usage:changed', usage()); return Promise.resolve({ ok: true }); },

    getUsage: function () { return Promise.resolve(usage()); },
    getCloud: function () { return Promise.resolve(cloud()); },
    setCloudLicense: function (license) {
      license = (license || '').trim();
      var active = /^pd_live_/.test(license);
      store.cloudLicense = license; store.cloudActive = active; store.cloudTier = active ? 'cloud' : undefined; store.cloudEmail = active ? 'you@demo.dev' : undefined;
      emit('usage:changed', usage());
      return Promise.resolve(cloud());
    },
    clearCloudLicense: function () { store.cloudLicense = undefined; store.cloudActive = false; store.cloudTier = undefined; store.cloudEmail = undefined; emit('usage:changed', usage()); return Promise.resolve(cloud()); },
    cloudCheckout: function () { return Promise.resolve({ url: 'https://attentify.ai/#pricing' }); },
    openExternal: function (url) { try { window.open(url, '_blank', 'noopener'); } catch (e) { } return Promise.resolve({ ok: true }); },

    // event subscriptions (return an unsubscribe fn)
    onBreakStarted: on('break:started'), onBreakEnded: on('break:ended'),
    onInterstitialData: function (cb) { on('interstitial:data')(cb); },
    onHeuristicAlert: function (cb) { on('heuristic:alert')(cb); },
    onGuardAlert: on('guard:alert'),
    onInferenceAutoBlocked: on('inference:auto-blocked'),
    onInferenceSuggest: on('inference:suggest'),
    onAgentProactive: on('agent:proactive'),
    onStoreRefresh: on('store:refresh'),
    onUsageChanged: on('usage:changed'),
    onOverlayShow: on('overlay:show'), onOverlayUpdate: on('overlay:update'),
    onOverlayOpenChat: on('overlay:open-chat'), onOverlayNavigate: on('overlay:navigate'),
    onNavigate: on('navigate'),
    overlayAction: function () { }, overlayDismiss: function () { },

    // window controls, no-ops in the browser
    minimizeWindow: function () { }, maximizeWindow: function () { }, closeWindow: function () { },
  };

  // Defensive fallback so any method we didn't model resolves harmlessly.
  window.electronAPI = (typeof Proxy !== 'undefined')
    ? new Proxy(api, {
        get: function (target, prop) {
          if (prop in target) return target[prop];
          if (typeof prop === 'string' && prop.indexOf('on') === 0) return function () { return function () { }; };
          return function () { return Promise.resolve(undefined); };
        },
      })
    : api;

  window.__PD_DEMO__ = true;
})();

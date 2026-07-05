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
        { domain: 'draftkings.com', addedAt: now - 50 * HOUR, reason: 'auto:gambling:95%' },
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

  function sess(app, title, url, cat, minsAgo, durMin, distract) {
    var end = now - minsAgo * MIN, dur = durMin * MIN;
    return { id: 's-' + Math.random().toString(36).slice(2), app: app, title: title, url: url, category: cat, startTime: end - dur, endTime: end, duration: dur, isDistraction: !!distract };
  }
  var recent = [
    sess('Code', 'focus.ts · attentify', '', 'development', 4, 38, false),
    sess('chrome', 'Build a REST API in Rust · YouTube', 'https://youtube.com/watch?v=abc', 'entertainment', 46, 12, false),
    sess('chrome', 'reddit.com/r/all', 'https://reddit.com/r/all', 'social', 70, 9, true),
    sess('Code', 'App.tsx', '', 'development', 95, 52, false),
    sess('chrome', 'X / Twitter · Home', 'https://x.com/home', 'social', 150, 16, true),
    sess('Slack', '#engineering', '', 'communication', 180, 14, false),
    sess('chrome', 'Async Rust in 100 Seconds', 'https://youtube.com/watch?v=xyz', 'entertainment', 210, 7, false),
    sess('Discord', '#general', '', 'social', 240, 22, true),
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
      heuristicAlerts: [],
      recentSessions: recent,
      domains: [
        { domain: 'reddit.com', category: 'social', classification: 'distraction', confidence: 0.88, total_ms: 42 * MIN, last_seen: now - 70 * MIN },
        { domain: 'x.com', category: 'social', classification: 'distraction', confidence: 0.85, total_ms: 31 * MIN, last_seen: now - 150 * MIN },
        { domain: 'youtube.com', category: 'video', classification: 'mixed', confidence: 0.60, total_ms: 19 * MIN, last_seen: now - 46 * MIN },
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

    getInferences: function () { return Promise.resolve([]); },
    resolveInference: function () { return Promise.resolve({ ok: true }); },

    getAgentHistory: function () { return Promise.resolve([]); },
    clearChatHistory: function () { return Promise.resolve({ ok: true }); },
    dismissProactive: function () { return Promise.resolve({ ok: true }); },

    getGoals: function () { return Promise.resolve([]); },
    addGoal: function (text) { return Promise.resolve({ id: 'g-' + Date.now(), text: text }); },
    clearGoal: function () { return Promise.resolve({ ok: true }); },
    getPreferences: function () { return Promise.resolve([]); },
    setPreference: function () { return Promise.resolve({ ok: true }); },
    deletePreference: function () { return Promise.resolve({ ok: true }); },

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

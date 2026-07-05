/* Attentify browser-extension demo shim.
 *
 * The real extension popup (popup.html / popup.js / popup.css) only depends on the
 * chrome.* APIs and on messages to the background service worker and content script.
 * This file fakes all of that with simulated data, so the actual popup runs as a live
 * demo in a normal browser. Loaded before popup.js. No network, no Chrome, no install. */
(function () {
  'use strict';

  // ── simulated state ───────────────────────────────────────────────────────────
  var rules = [
    { id: 'youtube-shorts',  domain: 'youtube.com',  displayName: 'YouTube Shorts',            severity: 'high',   enabled: true },
    { id: 'youtube-home',    domain: 'youtube.com',  displayName: 'YouTube Home Feed',         severity: 'medium', enabled: false },
    { id: 'instagram-reels', domain: 'instagram.com', displayName: 'Instagram Reels',          severity: 'high',   enabled: true },
    { id: 'tiktok-fyp',      domain: 'tiktok.com',   displayName: 'TikTok For You Page',       severity: 'high',   enabled: true },
    { id: 'twitter-foryou',  domain: 'x.com',        displayName: 'X / Twitter "For You" Feed', severity: 'medium', enabled: true },
    { id: 'reddit-all',      domain: 'reddit.com',   displayName: 'Reddit r/all & r/popular',  severity: 'medium', enabled: true },
    { id: 'facebook-reels',  domain: 'facebook.com', displayName: 'Facebook Reels',            severity: 'high',   enabled: true },
    { id: 'linkedin-feed',   domain: 'linkedin.com', displayName: 'LinkedIn Feed',             severity: 'low',    enabled: false },
  ];
  var titleBlocks = [], autoHideKeywords = [], autoBlock = true;
  var apiKey = null, cloudStatus = null, aiUsageUsd = 0.12;
  var elementStats = { 'youtube-shorts': 412, 'instagram-reels': 96 };
  var bypassScores = {};
  var activityLog = [
    { ts: Date.now() - 40000,  type: 'hidden',  msg: '5 elements hidden',  detail: 'YouTube Shorts' },
    { ts: Date.now() - 210000, type: 'toggle',  msg: 'Enabled "Reddit r/all & r/popular"', detail: 'reddit.com' },
    { ts: Date.now() - 600000, type: 'storage', msg: 'Loaded 8 rules', detail: '6 enabled' },
    { ts: Date.now() - 605000, type: 'boot',    msg: 'Extension started' },
  ];
  var local = { onboardedAt: Date.now() - 86400000 }; // skip the first-run overlay in the demo

  function usage() {
    var used = aiUsageUsd, lim = 1.0;
    return { usedUsd: used, limitUsd: lim, remainingUsd: Math.max(0, lim - used), hasOwnKey: !!apiKey, subscribed: false, exhausted: !apiKey && used >= lim };
  }
  function tabStatus() {
    return { domain: 'youtube.com', totalHidden: 6, elementCounts: { 'youtube-shorts': 5, 'facebook-reels': 1 }, activeRuleIds: rules.filter(function (r) { return r.enabled; }).map(function (r) { return r.id; }) };
  }
  function distractions() {
    return {
      autoBlock: autoBlock, userKeywords: autoHideKeywords,
      assessment: { intent: 'Watching a Rust tutorial you opened on purpose', distractionProbability: 0.18, reason: 'a specific video, not the feed', source: 'ai' },
      distractionProb: 0.18,
      autoHidden: [
        { label: 'Shorts shelf', signals: ['links to /shorts/', 'vertical video grid'], score: 92, confidence: 'high' },
        { label: '"Up next" autoplay rail', signals: ['recommended', 'autoplay queue'], score: 74, confidence: 'high' },
      ],
      candidates: [
        { label: 'Comments section', signals: ['high volume', 'off topic'], score: 46, confidence: 'medium', selector: '#comments' },
      ],
    };
  }

  function chatReply(text) {
    var t = (text || '').toLowerCase();
    if (/youtube|shorts|feed/.test(t) && /keep|but|subscrip|tutorial|only/.test(t))
      return "Done. I've hidden YouTube Shorts and the home feed, but left your subscriptions, search and any video you open. You keep the tutorials, you lose the rabbit hole.";
    if (/music video|reaction|rage|gym|influencer|politic|gossip|celebrit|drama/.test(t))
      return "Got it. I'll keep that kind of video out of your feed and pull any match before you click it. Tell me others whenever, in plain words.";
    if (/block|hide|kill|remove|stop|no more/.test(t))
      return "Done, I've set up a rule for that and it's live in your browser now. The useful parts of the site still work.";
    if (/distract|most|eating|focus|score|week/.test(t))
      return "This week, Reddit and X took the most off-task time, mostly in the evenings. Want me to clamp down on both after 8pm?";
    return "Tell me what to hide and I'll write the rule. For example: \"hide Shorts but keep my subscriptions\" or \"no music videos in my feed\".";
  }

  // ── message routers ───────────────────────────────────────────────────────────
  function handle(msg) {
    switch (msg && msg.type) {
      case 'get:all-rules':     return { rules: rules, connected: false, daemonPort: null };
      case 'get:status':        return { connected: false, daemonPort: null, lastDaemonError: '', lastSyncAt: 0, bootAt: Date.now() - 600000, rules: rules.length, enabledRules: rules.filter(function (r) { return r.enabled; }).length, bypassScores: bypassScores, elementStats: elementStats, activityLog: activityLog };
      case 'get:site-state':    return { domain: msg.domain, paused: false };
      case 'get:auto-block':    return { autoBlock: autoBlock, autoHideKeywords: autoHideKeywords, titleBlocks: titleBlocks };
      case 'get:title-blocks':  return { titleBlocks: titleBlocks };
      case 'get:cloud':         return { hasKey: false, cloudStatus: cloudStatus, api: '', usage: usage() };
      case 'get:context-state': return { assessment: distractions().assessment, feedbackCount: 0, hasGithubToken: false };
      case 'get:context-log':   return { contextLog: [
        { ts: Date.now() - 30000,  domain: 'youtube.com', intent: 'Rust tutorial you chose', distractionProbability: 0.18, goalAligned: true,  reason: 'a chosen video', source: 'ai', navType: 'load' },
        { ts: Date.now() - 300000, domain: 'reddit.com',  intent: 'scrolling r/all',          distractionProbability: 0.79, goalAligned: false, reason: 'algorithmic feed', source: 'ai', navType: 'load' },
      ] };
      case 'get:api-key':       return { key: apiKey };
      case 'get:github-token':  return { hasToken: false };
      case 'get:update-info':   return { info: null };
      case 'get:feedback-log':  return { feedbackLog: [], count: 0 };
      case 'toggle:rule':       { var r = rules.find(function (x) { return x.id === msg.ruleId; }); if (r) r.enabled = !!msg.enabled; return { ok: true }; }
      case 'set:api-key':       apiKey = msg.key; return { ok: true };
      case 'clear:api-key':     apiKey = null; return { ok: true };
      case 'set:auto-block':    autoBlock = !!msg.enabled; return { ok: true, autoBlock: autoBlock };
      case 'set:auto-hide-prefs': autoHideKeywords = msg.replace ? (msg.keywords || []) : autoHideKeywords.concat(msg.keywords || []); return { ok: true, autoHideKeywords: autoHideKeywords };
      case 'set:title-blocks':  titleBlocks = msg.replace ? (msg.keywords || []) : titleBlocks.concat(msg.keywords || []); return { ok: true, titleBlocks: titleBlocks };
      case 'set:site-pause':    return { ok: true, paused: msg.paused };
      case 'set:cloud-key':     cloudStatus = { status: /^pd_live_/.test(msg.key || '') ? 'active' : 'invalid', tier: 'cloud' }; return { ok: true, cloudStatus: cloudStatus };
      case 'clear:cloud-key':   cloudStatus = null; return { ok: true };
      case 'cloud:checkout':    return { ok: true, url: 'https://attentify.ai/#pricing' };
      case 'cloud:portal':      return { ok: false, error: 'demo' };
      case 'create:rule':       rules.push(Object.assign({ enabled: true }, msg.rule)); return { ok: true };
      case 'force:sync':        return { ok: true, connected: false, daemonPort: null };
      case 'report:bug':        return { ok: false, error: 'Demo mode: bug reports are turned off here.' };
      case 'report:feedback':   return { ok: true, queued: 1 };
      case 'set:github-token':  return { ok: true };
      case 'clear:github-token': return { ok: true };
      case 'daemon:open-rules': return { ok: false };
      case 'test:inject':       return { ok: false, error: 'Demo mode' };
      default:                  return { ok: true };
    }
  }
  function handleTab(msg) {
    if (!msg) return { ok: true };
    if (msg.type === 'get:tab-status') return tabStatus();
    if (msg.type === 'get:distractions' || msg.type === 'scan:page') return distractions();
    return { ok: true };
  }

  function subset(keys) {
    if (keys == null) return Object.assign({}, local);
    if (typeof keys === 'string') { var o = {}; o[keys] = local[keys]; return o; }
    if (Array.isArray(keys)) { var r = {}; keys.forEach(function (k) { r[k] = local[k]; }); return r; }
    var out = {}; Object.keys(keys).forEach(function (k) { out[k] = (k in local) ? local[k] : keys[k]; }); return out;
  }

  // ── the fake chrome global ──────────────────────────────────────────────────────
  window.chrome = {
    runtime: {
      lastError: null,
      getManifest: function () { return { version: '0.11.0' }; },
      sendMessage: function (msg, cb) { var r; try { r = handle(msg); } catch (e) { r = { ok: false }; } if (typeof cb === 'function') setTimeout(function () { cb(r); }, 25); },
      connect: function () {
        var ml = [], dl = [];
        var port = {
          name: 'pd-chat',
          onMessage: { addListener: function (f) { ml.push(f); } },
          onDisconnect: { addListener: function (f) { dl.push(f); } },
          postMessage: function (m) {
            if (m && m.type === 'chat:start') {
              var reply = chatReply(m.text), i = 0;
              setTimeout(function step() {
                if (i < reply.length) { var n = 2 + Math.floor(Math.random() * 4); port._emit({ type: 'chunk', text: reply.slice(i, i + n) }); i += n; setTimeout(step, 16 + Math.random() * 24); }
                else port._emit({ type: 'done' });
              }, 260);
            }
          },
          disconnect: function () { dl.forEach(function (f) { try { f(); } catch (_) {} }); },
          _emit: function (m) { ml.forEach(function (f) { try { f(m); } catch (_) {} }); },
        };
        return port;
      },
    },
    storage: {
      local: {
        get: function (keys, cb) { var out = subset(keys); if (typeof cb === 'function') cb(out); return Promise.resolve(out); },
        set: function (o, cb) { Object.assign(local, o || {}); if (typeof cb === 'function') cb(); return Promise.resolve(); },
        remove: function (k, cb) { (Array.isArray(k) ? k : [k]).forEach(function (x) { delete local[x]; }); if (typeof cb === 'function') cb(); return Promise.resolve(); },
      },
      sync: {
        get: function (keys, cb) { if (typeof cb === 'function') cb({}); return Promise.resolve({}); },
        set: function (o, cb) { if (typeof cb === 'function') cb(); return Promise.resolve(); },
        remove: function (k, cb) { if (typeof cb === 'function') cb(); return Promise.resolve(); },
      },
      onChanged: { addListener: function () {} },
    },
    tabs: {
      query: function (opts, cb) { var tabs = [{ id: 1, url: 'https://www.youtube.com/watch?v=abc', active: true, title: 'YouTube' }]; if (typeof cb === 'function') cb(tabs); return Promise.resolve(tabs); },
      sendMessage: function (id, msg, cb) { var r; try { r = handleTab(msg); } catch (e) { r = { ok: true }; } if (typeof cb === 'function') setTimeout(function () { cb(r); }, 25); },
      create: function (o) { try { window.open(o && o.url, '_blank', 'noopener'); } catch (_) {} },
      onActivated: { addListener: function () {} },
      onUpdated: { addListener: function () {} },
    },
    windows: { onFocusChanged: { addListener: function () {} } },
  };
})();

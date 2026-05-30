# Browser Companion Extension — Design Document

**Date**: 2026-05-29
**Status**: Design proposal
**Context**: Productivity Daemon currently blocks at the domain level only (youtube.com = all or nothing). The user wants element-level blocking (hide YouTube Shorts while keeping YouTube functional) plus bypass detection.

---

## 1. PROBLEM STATEMENT

The app's current blocking model is binary: `domain in blocklist → entire site blocked`. This creates false dilemmas:

| What user wants | What app does today |
|---|---|
| Block YouTube Shorts, keep tutorials | Blocks youtube.com entirely |
| Block Instagram Reels, keep DMs | Blocks instagram.com entirely |
| Block Twitter doomscrolling, keep work tweets | Blocks twitter.com entirely |
| Block Reddit r/all, keep r/programming | Blocks reddit.com entirely |

Users kill the app because it's too blunt. The solution is a **browser companion extension** that injects CSS/JS to surgically remove only the addictive parts of websites.

---

## 2. ARCHITECTURE OVERVIEW

```
┌──────────────────────────────────────────────────┐
│             Productivity Daemon (Electron)        │
│                                                   │
│  ┌─────────────┐  ┌────────────┐  ┌────────────┐ │
│  │ ContentRule  │  │ Inference  │  │ MonitorSvc │ │
│  │  Engine     │  │  Engine    │  │            │ │
│  │ (NEW)       │  │            │  │            │ │
│  └──────┬──────┘  └────────────┘  └──────┬─────┘ │
│         │                                 │       │
│         │   Native Messaging Host         │       │
│         │   (WebSocket ws://127.0.0.1:    │       │
│         │    9120 / NativeMessaging)      │       │
│         └──────────────┬──────────────────┘       │
└────────────────────────┼──────────────────────────┘
                         │
              Native Messaging Protocol
              (or WebSocket for dev)
                         │
┌────────────────────────┼──────────────────────────┐
│     Browser Extension (Chrome/Edge/Firefox)        │
│                                                    │
│  ┌─────────────┐  ┌──────────┐  ┌──────────────┐  │
│  │ Content     │  │ URL      │  │ Anti-Bypass  │  │
│  │ Scripts     │  │ Monitor  │  │ Detector     │  │
│  │ (CSS hide)  │  │          │  │ (NEW)        │  │
│  └─────────────┘  └──────────┘  └──────────────┘  │
│                                                    │
│  ┌─────────────────────────────────────────────┐   │
│  │ Background Service Worker                   │   │
│  │ - Rule sync with desktop app                │   │
│  │ - Bypass attempt detection + reporting      │   │
│  │ - Fallback: works standalone if app is off  │   │
│  └─────────────────────────────────────────────┘   │
└────────────────────────────────────────────────────┘
```

### Communication model

**Native Messaging** (Chrome `chrome.runtime.connectNative`, Firefox `browser.runtime.connectNative`):
- Desktop app registers as a Native Messaging Host
- Extension connects on install, receives rule updates in real-time
- Extension reports URL changes, blocked elements, bypass attempts back to app
- No network dependency — works offline, on localhost

**WebSocket fallback** (for development / debug API):
- Extension opens `ws://127.0.0.1:9120` if native messaging fails
- Same protocol, just over WebSocket

**Protocol** (JSON messages):
```json
// App → Extension: update rules
{
  "type": "rules:update",
  "rules": [
    {
      "id": "youtube-shorts",
      "domain": "youtube.com",
      "selectors": ["ytd-shorts", "#shorts-container", "[is-shorts]"],
      "urlPatterns": ["*://*.youtube.com/shorts/*"],
      "action": "hide",
      "enabled": true
    }
  ]
}

// Extension → App: bypass attempt detected
{
  "type": "bypass:detected",
  "ruleId": "youtube-shorts",
  "method": "url_navigation",
  "url": "https://www.youtube.com/shorts/abc123",
  "timestamp": 1780036500000
}

// Extension → App: element blocked
{
  "type": "element:blocked",
  "ruleId": "youtube-shorts",
  "selector": "#shorts-container",
  "count": 5
}
```

---

## 3. CONTENT RULE ENGINE (Desktop App Side)

### 3.1 New Data Model

Extend `shared/types.ts`:

```typescript
export interface ContentRule {
  id: string                    // "youtube-shorts"
  domain: string                // "youtube.com"
  displayName: string           // "YouTube Shorts"
  category: string              // "short_form_video"
  severity: 'high' | 'medium' | 'low'
  
  // What to block
  selectors: string[]           // CSS selectors to hide
  urlPatterns: string[]         // URL globs to redirect/block (*://*.youtube.com/shorts/*)
  
  // Blocking behavior
  action: 'hide' | 'redirect' | 'blur' | 'overlay'
  redirectTarget?: string       // URL to redirect to if action=redirect
  
  // Bypass detection
  antiBypassSearchTerms: string[]   // ["youtube shorts", "yt shorts", "shorts"]
  antiBypassUrlPatterns: string[]   // ["*/shorts/*", "*/?variant=shorts"]
  
  enabled: boolean
  createdAt: number
  updatedAt: number
  autoApplied: boolean          // was this created by AI or user?
}
```

### 3.2 Pre-built Rule Library

Shipped with the app, these cover the major platforms:

| Rule ID | Domain | Target | Selectors |
|---------|--------|--------|-----------|
| `youtube-shorts` | youtube.com | Shorts player + shelf | `[is-shorts]`, `ytd-reel-shelf-renderer`, `ytd-shorts` |
| `youtube-home` | youtube.com | Home feed (optional) | `ytd-browse[page-subtype="home"]` |
| `youtube-sidebar` | youtube.com | Recommended sidebar | `#related`, `ytd-compact-video-renderer` |
| `instagram-reels` | instagram.com | Reels tab + feed | `[href="/reels/"]`, `x1i10hfl[href*="reel"]` |
| `instagram-explore` | instagram.com | Explore page | `[href="/explore/"]` |
| `twitter-for-you` | x.com | "For You" feed tab | `[aria-label="Timeline: Trending now"]`, `[role="tab"][href="/explore"]` |
| `reddit-popular` | reddit.com | r/all, r/popular | `[href="/r/all/"]`, `[href="/r/popular/"]` |
| `tiktok-fyp` | tiktok.com | For You Page | `.tiktok-1g04lal-DivFeedContainer`, infinite scroll |
| `facebook-reels` | facebook.com | Reels / Watch | `[aria-label*="Reels"]`, `[href*="/reel/"]` |
| `linkedin-feed` | linkedin.com | Feed (optional) | `.scaffold-finite-scroll__content` |

### 3.3 Store Integration

```typescript
// In AppStore / state.json
interface AppStore {
  // ... existing fields ...
  contentRules: ContentRule[]       // NEW: all content rules
  extensionConnected: boolean       // NEW: is the browser extension online?
  extensionBrowsers: string[]       // NEW: which browsers have the extension
}
```

### 3.4 Debug API Extensions

```
GET  /content-rules              → all content rules + their status
POST /content-rules              → create/update a rule
POST /content-rules/:id/toggle   → enable/disable a rule
POST /inject/element             → simulate element detection for testing
GET  /extension/status           → connected browsers, rules synced, bypass logs
POST /content-rules/predefined   → install all predefined rules
```

---

## 4. BROWSER EXTENSION IMPLEMENTATION

### 4.1 Manifest (Manifest V3)

```json
{
  "manifest_version": 3,
  "name": "Productivity Daemon — Element Blocker",
  "version": "1.0.0",
  "permissions": ["nativeMessaging", "storage", "tabs", "webNavigation"],
  "host_permissions": ["<all_urls>"],
  "background": {
    "service_worker": "background.js"
  },
  "content_scripts": [{
    "matches": ["<all_urls>"],
    "js": ["content.js"],
    "run_at": "document_start"
  }]
}
```

### 4.2 Content Script (`content.js`)

Runs on every page. Lightweight — applies CSS rules immediately, watches DOM for dynamic content.

```javascript
// Key functions:
// 1. On load: query active rules for this domain, inject CSS
// 2. MutationObserver: watch for dynamically added elements matching selectors
// 3. URL change detection: SPA navigation (YouTube especially)
// 4. Report bypass attempts to background script

const HIDE_CSS = '{ display: none !important; visibility: hidden !important; height: 0 !important; overflow: hidden !important; }'

function applyRules(rules) {
  for (const rule of rules) {
    // Inject CSS to hide matching selectors
    const css = rule.selectors.map(s => `${s} ${HIDE_CSS}`).join('\n')
    injectStylesheet(rule.id, css)
    
    // Watch for dynamically loaded elements
    observeMutations(rule.selectors, (el) => hideElement(el, rule))
  }
}

// YouTube-specific: SPA navigation detection
function watchYouTubeNavigation() {
  // YouTube doesn't do full page loads — it swaps content via JS
  // Use document.title changes + URL polling to detect Shorts navigation
  let lastUrl = location.href
  setInterval(() => {
    if (location.href !== lastUrl) {
      lastUrl = location.href
      checkForShortsUrl(location.href)
      applyRules(getRulesForDomain('youtube.com'))
    }
  }, 500)
}
```

### 4.3 Background Service Worker (`background.js`)

```javascript
// Persistent process that:
// 1. Connects to desktop app via Native Messaging
// 2. Syncs rules — receives updates, sends bypass reports
// 3. Handles URL-level redirects before page load
// 4. Falls back to chrome.storage if desktop app is offline

let connected = false
let rules = []
let port = null

function connectToApp() {
  try {
    port = chrome.runtime.connectNative('com.productivitydaemon.blocker')
    port.onMessage.addListener(handleAppMessage)
    port.onDisconnect.addListener(() => {
      connected = false
      setTimeout(connectToApp, 5000) // Reconnect
      loadRulesFromStorage() // Fallback to cached rules
    })
    connected = true
  } catch (e) {
    // Native host not registered — use storage fallback
    loadRulesFromStorage()
  }
}

function handleAppMessage(msg) {
  if (msg.type === 'rules:update') {
    rules = msg.rules
    chrome.storage.local.set({ rules })
    // Push to all tabs
    broadcastRules(rules)
  }
}
```

### 4.4 Anti-Bypass Detection

This is the smart part. The extension detects when the user is trying to work around the block:

```javascript
// Bypass detection strategies:

// 1. URL navigation
//    User navigates to /shorts/ despite the element being hidden
webNavigation.onBeforeNavigate.addListener(details => {
  for (const rule of rules) {
    for (const pattern of rule.urlPatterns) {
      if (matchPattern(details.url, pattern)) {
        // User is trying to navigate directly to blocked content
        reportBypass(rule, 'url_navigation', details.url)
        // Option: redirect to a "blocked" interstitial
        if (rule.action === 'redirect') {
          chrome.tabs.update(details.tabId, { url: rule.redirectTarget })
        }
      }
    }
  }
})

// 2. Search query detection
//    User searches "youtube shorts thumbnail" on Google to find Shorts
function detectSearchBypass(url, title) {
  for (const rule of rules) {
    for (const term of rule.antiBypassSearchTerms) {
      if (title.toLowerCase().includes(term)) {
        reportBypass(rule, 'search_query', url)
      }
    }
  }
}

// 3. Incognito / container tab detection
//    User opens incognito window to bypass blocks
chrome.tabs.onCreated.addListener(tab => {
  if (tab.incognito) {
    // Rules still apply to incognito (we have "incognito":"split" in manifest)
    reportBypass({ id: 'incognito' }, 'incognito_window', tab.url)
  }
})

// 4. Mobile user agent spoofing
//    User changes user agent to get mobile version (different DOM structure)
function detectUASpoofing() {
  // Check if the DOM structure matches desktop but URL is mobile YouTube
  if (location.hostname === 'm.youtube.com') {
    reportBypass({ id: 'youtube-shorts' }, 'mobile_redirect', location.href)
  }
}

// 5. Embed / iframe bypass
//    User opens Shorts embedded on another site
function detectEmbedBypass() {
  if (window !== window.top) {
    // We're in an iframe — check if the parent is embedding blocked content
    const parentUrl = document.referrer
    // Check parent URL against rules
  }
}

// 6. Cached / offline access detection
//    User accesses cached version of page
//    Detect via Service Worker cache or ?cache=1 param

// 7. Gradual bypass scoring
//    Each detected bypass attempt increments a score
//    High score → app elevates: surface to user, suggest stronger block
```

### 4.5 Native Messaging Host Registration

The desktop app registers itself as a Native Messaging Host during installation:

**Windows registry key**: `HKCU\Software\Google\Chrome\NativeMessagingHosts\com.productivitydaemon.blocker`

**Manifest file** (`%APPDATA%\ProductivityDaemon\native_host.json`):
```json
{
  "name": "com.productivitydaemon.blocker",
  "description": "Productivity Daemon Element Blocker",
  "path": "C:\\Program Files\\ProductivityDaemon\\native-host.exe",
  "type": "stdio",
  "allowed_origins": ["chrome-extension://<extension-id>/"]
}
```

The `native-host.exe` is a lightweight Node.js stub that bridges stdin/stdout to the Electron app's WebSocket.

---

## 5. INTEGRATION WITH EXISTING SYSTEMS

### 5.1 Inference Engine Integration

The AI should be able to **generate content rules**, not just domain blocks:

```
User: "I keep getting sucked into YouTube Shorts. Block just the Shorts,
       not the whole site."

Agent: → calls create_content_rule({
  domain: "youtube.com",
  displayName: "YouTube Shorts",
  selectors: ["ytd-shorts", "#shorts-container", "[is-shorts]"],
  urlPatterns: ["*://*.youtube.com/shorts/*"],
  action: "hide"
})

Result: Shorts hidden, rest of YouTube works. Extension syncs within 2 seconds.
```

New agent tools:
- `create_content_rule` — creates an element-level block rule
- `list_content_rules` — shows active rules
- `toggle_content_rule` — enables/disables a rule
- `get_bypass_attempts` — shows when user tried to bypass

### 5.2 MonitorService Integration

The MonitorService already captures URLs. With the extension, it gains:

1. **Faster URL detection**: Extension reports URLs instantly (no 3-second PowerShell polling)
2. **Element-level data**: Which elements were hidden, how many
3. **Bypass telemetry**: When user navigates to blocked patterns

```typescript
// MonitorService gains a new event source
this.on('extension:url', (url: string) => {
  // Immediate — no 3s polling delay
  this.handleUrlChange(url)
})

this.on('extension:bypass', (bypass: BypassAttempt) => {
  // Log, escalate to agent if repeated
  this.handleBypass(bypass)
})
```

### 5.3 Heuristic Engine Integration

New heuristics the engine can detect with extension data:

| Heuristic | Trigger | Alert |
|-----------|---------|-------|
| Shorts binge | 5+ Shorts navigations in 2 min | "YouTube Shorts auto-play loop detected" |
| Bypass escalation | 3+ bypass attempts in 10 min | "You're trying to circumvent the Shorts block" |
| Search-to-Shorts pattern | Google search → YouTube Shorts within 30s | "Intentional Shorts-seeking behavior" |
| Incognito dodge | Extension detects incognito tab with blocked content | "Incognito window detected with blocked content" |

---

## 6. IMPLEMENTATION PLAN

### Phase 1 — Foundation (week 1)

1. **Content Rule data model**: Extend `types.ts`, add to `store.ts`
2. **Content Rule Engine**: New file `src/main/blocking/ContentRuleEngine.ts`
3. **Debug API**: Content rule CRUD endpoints in `DebugServer.ts`
4. **Rule library**: 10 predefined rules in `src/main/blocking/predefined-rules.ts`
5. **Agent tools**: 4 new tool definitions in `tools.ts`

### Phase 2 — Browser Extension (week 2)

1. **Extension scaffold**: Manifest V3, content script, background worker
2. **CSS injection**: Selector-based element hiding with MutationObserver
3. **URL interception**: `webNavigation` listener for URL-pattern blocking
4. **Native messaging**: Host registration + stdio bridge
5. **Storage fallback**: Rules cached in `chrome.storage.local`

### Phase 3 — Anti-Bypass (week 3)

1. **Bypass detection**: All 7 detection strategies
2. **Bypass scoring**: Cumulative score per domain, escalation thresholds
3. **Agent awareness**: Agent gets bypass reports in context
4. **Smart redirect**: Instead of blocking, redirect Shorts URL to YouTube home
5. **Incognito enforcement**: Ensure rules apply in incognito

### Phase 4 — Polish (week 4)

1. **Per-domain customization**: User tunes selectors per site
2. **Rule effectiveness metrics**: How many elements blocked per rule
3. **Auto-rule generation**: AI proposes new rules based on browsing patterns
4. **Community rule sharing**: Export/import rule packs

---

## 7. PREDEFINED RULES (shipped with the app)

```typescript
export const PREDEFINED_RULES: ContentRule[] = [
  {
    id: 'youtube-shorts',
    domain: 'youtube.com',
    displayName: 'YouTube Shorts',
    category: 'short_form_video',
    severity: 'high',
    selectors: [
      'ytd-shorts',
      '#shorts-container',
      '[is-shorts]',
      'ytd-reel-shelf-renderer',
      'ytd-rich-section-renderer:has([href*="/shorts/"])',
      '[title="Shorts"]', // Navigation button
    ],
    urlPatterns: [
      '*://*.youtube.com/shorts/*',
      '*://*.youtube.com/hashtag/shorts*',
    ],
    action: 'hide',
    antiBypassSearchTerms: [
      'youtube shorts',
      'yt shorts',
      'youtube short',
      'shorts video',
    ],
    antiBypassUrlPatterns: [
      '*/shorts/*',
      '*/?variant=shorts',
      'm.youtube.com/shorts/*',
    ],
    enabled: false, // Opt-in
    createdAt: 0,
    updatedAt: 0,
    autoApplied: false,
  },
  {
    id: 'instagram-reels',
    domain: 'instagram.com',
    displayName: 'Instagram Reels',
    category: 'short_form_video',
    severity: 'high',
    selectors: [
      '[href="/reels/"]',
      'a[href*="/reel/"]',
      'article:has(video[src*="reel"])',
      'div[role="tablist"] a[href="/reels/"]',
    ],
    urlPatterns: [
      '*://*.instagram.com/reels/*',
      '*://*.instagram.com/reel/*',
    ],
    action: 'hide',
    antiBypassSearchTerms: ['instagram reels', 'ig reels', 'insta reel'],
    antiBypassUrlPatterns: ['*/reels/*', '*/reel/*'],
    enabled: false,
    createdAt: 0,
    updatedAt: 0,
    autoApplied: false,
  },
  {
    id: 'tiktok-fyp',
    domain: 'tiktok.com',
    displayName: 'TikTok For You Page',
    category: 'short_form_video',
    severity: 'high',
    selectors: [
      '[data-e2e="recommend-list"]',
      '.tiktok-1g04lal-DivFeedContainer',
      '[data-e2e="feed-active-video"]',
    ],
    urlPatterns: [
      '*://*.tiktok.com/foryou*',
      '*://*.tiktok.com/',
    ],
    action: 'hide',
    antiBypassSearchTerms: ['tiktok fyp', 'tiktok for you'],
    antiBypassUrlPatterns: [],
    enabled: false,
    createdAt: 0,
    updatedAt: 0,
    autoApplied: false,
  },
  {
    id: 'twitter-foryou',
    domain: 'x.com',
    displayName: 'X/Twitter "For You" Feed',
    category: 'social_media',
    severity: 'medium',
    selectors: [
      '[aria-label="Timeline: Trending now"]',
      'div[aria-label="Home timeline"] a[href="/explore"]',
      '[data-testid="primaryColumn"] [role="tablist"] a[href="/home"]',
    ],
    urlPatterns: [
      '*://x.com/explore*',
      '*://twitter.com/explore*',
    ],
    action: 'hide',
    antiBypassSearchTerms: ['twitter trending', 'x trending', 'twitter explore'],
    antiBypassUrlPatterns: [],
    enabled: false,
    createdAt: 0,
    updatedAt: 0,
    autoApplied: false,
  },
  {
    id: 'reddit-all',
    domain: 'reddit.com',
    displayName: 'Reddit r/all & r/popular',
    category: 'forums_aggregators',
    severity: 'medium',
    selectors: [
      'a[href="/r/all/"]',
      'a[href="/r/popular/"]',
      '#header-subreddit-link[href="/r/all/"]',
    ],
    urlPatterns: [
      '*://*.reddit.com/r/all/*',
      '*://*.reddit.com/r/popular/*',
    ],
    action: 'hide',
    antiBypassSearchTerms: ['reddit front page', 'r/all', 'reddit popular'],
    antiBypassUrlPatterns: ['*/r/all/*', '*/r/popular/*'],
    enabled: false,
    createdAt: 0,
    updatedAt: 0,
    autoApplied: false,
  },
]
```

---

## 8. BYPASS DETECTION LEVELS

The extension tracks bypass attempts and the desktop app responds:

| Level | Bypass Count | App Response |
|-------|-------------|--------------|
| 0 | 0 | Normal operation, rules applied silently |
| 1 | 1-2 | Log only — user might have clicked legitimately |
| 2 | 3-5 | Agent surfaces: "I noticed you tried to access YouTube Shorts 3 times. Everything ok?" |
| 3 | 6-10 | Escalate: temporarily block the entire domain for 5 minutes |
| 4 | 10+ | Full domain block for 1 hour, agent asks: "Do you want to make this rule stricter?" |

---

## 9. RISKS & TRADEOFFS

| Risk | Mitigation |
|------|------------|
| Extension has access to ALL browsing data | Extension is open-source, privacy policy clear, data stays local |
| YouTube changes DOM selectors frequently | Ship a rule update mechanism; AI can auto-detect selector changes |
| Native messaging host registration requires elevation | Ship a one-time setup script; fallback to WebSocket if not registered |
| Content script performance (observers on every page) | Only activate MutationObserver on pages with active rules |
| User turns off extension to bypass | Desktop app detects extension disconnect, falls back to domain-level blocking |
| Manifest V3 limitations (service worker sleep) | Use chrome.alarms to keep worker alive; native messaging keeps connection open |

---

## 10. OPEN QUESTIONS

1. **Should the extension be bundled with the app or a separate install?**
   Recommendation: Bundled — the app ships the extension files and registers it during setup.
   Chrome Web Store listing optional for auto-updates.

2. **Should content rules be applied by default or opt-in?**
   Recommendation: Opt-in per rule. During onboarding: "We can block just the addictive parts of YouTube (Shorts), Instagram (Reels), etc. Enable what you want."

3. **How aggressive should bypass detection be?**
   Recommendation: Start conservative (Level 2 escalation). Let the user adjust sensitivity.
   Some bypasses are accidental (clicked a link not realizing it would go to Shorts).

4. **Firefox support?**
   Native messaging works but has different APIs. Implement Chrome/Edge first, Firefox as follow-up.
   Manifest V3 works on both but with subtle differences.
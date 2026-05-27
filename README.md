# Productivity Daemon

> An AI focus companion — system-level distraction blocking with a conversational interface.

Productivity Daemon is a Windows/macOS desktop app built with Electron + React + TypeScript. It combines a **chat-first AI interface** with hard system-level controls: hosts-file blocking, process killing, and heuristic attention monitoring. No account, no telemetry, no network calls — everything runs locally.

---

## Concept

The app is designed as a "living AI being" rather than a dashboard. The home screen is a conversational interface; you tell it what you're working on, ask it to block things, or start a focus session — and it acts. Under the hood it tracks every app switch, detects patterns of distraction, and can enforce blocks at the OS level.

---

## Screenshots

The UI is dark-navy with a blue accent palette.

| View | Description |
|------|-------------|
| **Home** | Chat interface with inline stats header (switch rate, focused time, session countdown). Quick-command chips on first load. |
| **Focus Shield** | Active blocklist manager — domains and processes, timed or permanent. |
| **Analytics** | Focus score, time breakdown, top apps, weekly stacked-bar chart, heuristic alert feed. |
| **Patterns** | Heuristic alerts log — 13 pattern types (doom-loop, micro-escape, tab-anxiety, etc.). |
| **Deep Focus** | Starts a locked focus session; optional allowlist of permitted apps/sites. |
| **Schedule Manager** | Time-based auto-blocking rules by day of week. |
| **Deep Clean** | Detects installed distractors, browser extensions, startup items. |
| **Focus Scan** | Full scan of running/installed apps; issue cards with severity. |
| **AlgoTrack** | Tracks algorithmic feed usage (YouTube, Reddit, Twitter, etc.). |
| **Focus Browser** | In-app browser with distraction blocking enforced. |

---

## Prerequisites

- **Node.js 18+** and npm
- **Windows 10/11** (primary target) or **macOS 11+**
- Administrator access for full site blocking (app runs in soft mode without it)
- Optional: **Ollama** running locally for AI-powered intent checking (`http://localhost:11434`)

---

## Install

```powershell
# Windows: SSL cert workaround may be needed
$env:NODE_TLS_REJECT_UNAUTHORIZED = "0"
npm install
```

---

## Run in dev mode

```powershell
npm run dev
```

Starts electron-vite in watch mode. Main window opens at 1240×820. The interstitial blocking window is created hidden and appears when a block fires.

---

## Build

```powershell
npm run build
```

Compiles TypeScript and bundles into `out/`.

---

## Package

```powershell
# Windows NSIS installer
npm run package:win

# macOS DMG
npm run package:mac

# Both
npm run package:all
```

> **Windows:** The build requests `requireAdministrator` via UAC manifest. Without a code-signing cert, SmartScreen will warn on first run — click "More info → Run anyway".

> **macOS:** Without an Apple Developer ID, Gatekeeper will block it — right-click the `.app` → Open → Open.

---

## Architecture

```
src/
├── main/                        # Node.js main process
│   ├── index.ts                 # Electron entry, window creation
│   ├── ipc.ts                   # All IPC handlers (ipcMain.handle)
│   ├── store.ts                 # JSON state persistence
│   ├── daemonManager.ts         # Startup registration
│   ├── blocking/
│   │   ├── BlockingEngine.ts    # Coordinates blocking, emits events
│   │   ├── hostsFileEditor.ts   # Reads/writes system hosts file
│   │   ├── processKiller.ts     # Lists and kills blocked processes
│   │   ├── AppBlocker.ts        # Per-app blocking logic
│   │   ├── browserPolicyManager.ts
│   │   └── firewallManager.ts
│   ├── tracking/
│   │   └── ActivityTracker.ts   # PowerShell/C# P/Invoke foreground window loop
│   ├── heuristics/
│   │   └── HeuristicEngine.ts   # 13 distraction pattern detectors
│   ├── chat/
│   │   ├── ChatEngine.ts        # NLP intent → action pipeline
│   │   └── commandParser.ts     # Regex-based intent classifier
│   └── scanner/
│       └── FocusScan.ts         # Scans installed/running distractors
├── preload/
│   └── index.ts                 # contextBridge — exposes window.electronAPI
├── renderer/src/                # React + Tailwind UI
│   ├── App.tsx                  # Root: Sidebar + view router + toast
│   ├── views/                   # One file per view (see table above)
│   ├── components/              # Sidebar, IssueCard, PulsingSphere, etc.
│   └── chat/
│       └── ChatPanel.tsx        # Slide-in chat panel (non-home views)
└── shared/
    └── types.ts                 # All shared TypeScript types
```

### Key data flows

**Blocking:**
```
Chat "block twitter.com"
  → ChatEngine → commandParser → action {type:'block', domain}
  → BlockingEngine.addDomain()
  → hostsFileEditor writes 0.0.0.0 twitter.com to hosts file
  → DNS cache flushed
  → store.patchStore() → state.json updated
```

**Activity tracking:**
```
ActivityTracker spawns persistent PowerShell child process
  → C# P/Invoke GetForegroundWindow() every 5s
  → HeuristicEngine.ingest(session)
  → pattern detected → ipcMain pushes 'heuristic:alert' to renderer
  → App.tsx shows toast + updates Analytics/Patterns views
```

**Intent check (Ollama):**
```
User requests unblock via interstitial
  → ChatEngine.checkIntent(site, reason)
  → POST http://localhost:11434/api/generate (Llama 3.2 / Phi-3 mini)
  → verdict: allow | allow_timed | deny
  → fallback: rule-based classifier if Ollama unavailable
```

---

## Heuristic patterns

The `HeuristicEngine` detects 13 attention patterns:

| Pattern | Trigger |
|---------|---------|
| `rapid-switching` | High context-switch rate (>60/h) |
| `repeated-visits` | Same distraction site visited multiple times |
| `late-night` | Usage after 11pm |
| `long-session` | Unbroken session > 90 min |
| `focus-drift` | Gradual migration toward distraction apps |
| `doom-loop` | Cycling through same set of distracting apps |
| `micro-escape` | Frequent short visits to distraction sites |
| `notification-fomo` | Repeated email/Slack checks |
| `video-rabbit-hole` | Long continuous video streaming |
| `phantom-checking` | App opened then immediately closed repeatedly |
| `pre-task-avoidance` | Distraction spikes before scheduled work |
| `news-anxiety` | Frequent news site visits |
| `tab-anxiety` | Excessive tab-switching in browser |

---

## Data storage

All state is persisted to a single JSON file:

| Platform | Path |
|----------|------|
| Windows  | `%APPDATA%\productivity-daemon\state.json` |
| macOS    | `~/Library/Application Support/productivity-daemon/state.json` |

The file matches the `AppStore` type in `src/shared/types.ts`. Safe to edit manually.

---

## Chat commands

The `ChatEngine` understands natural language. Examples:

- `"Block YouTube for the rest of the day"` → timed domain block
- `"Start deep focus for 90 minutes"` → deep focus session
- `"What's distracting me most this week?"` → analytics summary
- `"Unblock twitter.com"` → removes domain from blocklist
- `"Block Slack"` → process block

To extend: add a new intent to `commandParser.ts`, a handler in `ChatEngine.ts`.
To swap in a real LLM: replace `ChatEngine.processMessage()` with an API call — the `ChatResponse` interface is the stable contract.

---

## Blocking modes

| Mode | Site blocking | Process blocking |
|------|--------------|-----------------|
| **Full (admin)** | hosts file + DNS flush | taskkill every 2s |
| **Soft (no admin)** | logged only | logged only |

Soft mode is indicated by a persistent amber banner in the UI. Clicking "Enable Full" relaunches the app with a UAC elevation prompt.

---

## Security & privacy

- Zero network requests. No telemetry, no analytics, no crash reporting.
- No accounts or cloud sync.
- Hosts file entries are tagged and cleaned up on normal exit. On crash, delete everything between `# PRODUCTIVITY_DAEMON_START` and `# PRODUCTIVITY_DAEMON_END` manually.
- Administrator access is voluntary; the app is fully usable in soft mode.

---

## Dev notes

- `npm install` on Windows may need `$env:NODE_TLS_REJECT_UNAUTHORIZED = "0"` (local SSL cert chain issue). `strict-ssl=false` is set in `.npmrc`.
- The app window is **not** resizable by default (1240×820 fixed). Change `resizable` in `src/main/index.ts` if needed.
- Tailwind config is in `tailwind.config.js`. Custom colors: `navy-*`, `accent-blue`, `accent-green`, `accent-amber`.
- IPC contract is defined by `window.electronAPI` in `src/renderer/src/App.tsx` (the `declare global` block at the bottom).

---

## Adding a new view

1. Create `src/renderer/src/views/MyView.tsx`
2. Add `'my-view'` to the `ViewName` union in `src/shared/types.ts`
3. Add a nav item to `Sidebar.tsx`
4. Add a `case 'my-view':` branch in `App.tsx`'s `renderView()`

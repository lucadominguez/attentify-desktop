# Architecture

## Process model

Productivity Daemon uses Electron's two-process model:

```
┌─────────────────────────────────────────────────────────────┐
│  Main Process (Node.js)                                      │
│                                                              │
│  ┌─────────────┐  ┌────────────────┐  ┌─────────────────┐  │
│  │  BlockingEngine │  │ ChatEngine     │  │ FocusScan       │  │
│  │  - HostsFile   │  │ - commandParser│  │ - runFocusScan  │  │
│  │  - ProcessKill │  │ - NLP intents  │  │ - issue detect  │  │
│  └─────────────┘  └────────────────┘  └─────────────────┘  │
│           │                │                   │              │
│           └────────────────┴─────┬─────────────┘              │
│                                  │                            │
│  ┌───────────────────────────────▼──────────────────────┐    │
│  │  IPC handlers (ipc.ts)                                │    │
│  │  ipcMain.handle('store:get', ...)                     │    │
│  │  ipcMain.handle('scan:run', ...)                      │    │
│  │  ipcMain.handle('blocking:add-domain', ...)           │    │
│  └───────────────────────────────────────────────────────┘    │
│                                  │                            │
│  ┌───────────────────────────────▼──────────────────────┐    │
│  │  Store (state.json)                                   │    │
│  │  getStore() / patchStore() / saveStore()              │    │
│  └───────────────────────────────────────────────────────┘    │
└──────────────────────────┬──────────────────────────────────┘
                           │ contextBridge / ipcRenderer
┌──────────────────────────▼──────────────────────────────────┐
│  Renderer Process (Chromium + React)                         │
│                                                              │
│  ┌────────────────────────────────────────────────────────┐  │
│  │  App.tsx                                                │  │
│  │  ├── Sidebar (navigation)                               │  │
│  │  ├── Views (Home, FocusShield, etc.)                    │  │
│  │  └── ChatPanel (slide-in, right)                        │  │
│  └────────────────────────────────────────────────────────┘  │
│                                                              │
│  ┌──────────────────────────────────────────────────────┐    │
│  │  window.electronAPI (exposed by preload/index.ts)     │    │
│  │  Wraps all ipcRenderer.invoke() calls with types      │    │
│  └──────────────────────────────────────────────────────┘    │
└──────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────┐
│  Interstitial Window (separate BrowserWindow)                 │
│  - Always-on-top, full-screen                                 │
│  - Receives data via ipcRenderer.on('interstitial:data')      │
│  - InterstitialWarning.tsx component                          │
│  - Renders warning + 30s countdown for "proceed anyway"       │
└──────────────────────────────────────────────────────────────┘
```

## IPC contract

All cross-process communication goes through named channels defined by the `IpcChannels` type in `src/shared/types.ts`. The preload script (`src/preload/index.ts`) wraps each `ipcRenderer.invoke()` call and exposes them as `window.electronAPI.*`.

This pattern ensures:
- Context isolation is maintained (no Node.js in renderer)
- All IPC calls are typed end-to-end via the shared types
- The renderer never imports Node.js modules

## State flow

```
User action (React click)
  → window.electronAPI.addDomain('twitter.com')
  → ipcRenderer.invoke('blocking:add-domain', 'twitter.com')
  → ipcMain.handle('blocking:add-domain', ...)
  → BlockingEngine.addDomain()  +  hostsFileEditor.addDomainToHosts()
  → patchStore({ blocklist: ... })  →  writes state.json
  → renderer calls api.getStore() to refresh UI state
```

State is never pushed from main to renderer proactively (except block events → interstitial). The renderer always pulls by calling `getStore()` after mutations.

## Module boundaries

| Module | Responsibility | Can import |
|--------|---------------|-----------|
| `main/blocking/BlockingEngine` | Coordinates blocking, emits events | hostsFileEditor, processKiller, shared/types |
| `main/blocking/hostsFileEditor` | Reads/writes /etc/hosts | fs, child_process |
| `main/blocking/processKiller` | Lists/kills processes | child_process |
| `main/chat/ChatEngine` | Processes natural language → actions | commandParser, shared/types |
| `main/chat/commandParser` | Parses intent from text | shared/types |
| `main/scanner/FocusScan` | Detects distracting apps/sites | child_process, fs, shared/types |
| `main/store` | Persists state to JSON | fs, shared/types |
| `main/ipc` | Connects IPC ↔ business logic | all main modules |
| `main/index` | Electron entry, window creation | electron, main/ipc |
| `preload/index` | Exposes safe API to renderer | electron (contextBridge, ipcRenderer) |
| `renderer/**` | React UI | preload API via window.electronAPI, shared/types |
| `shared/types` | Shared TypeScript types | nothing |

## Interstitial window lifecycle

1. `main/index.ts` creates the interstitial `BrowserWindow` at startup, hidden
2. `BlockingEngine` emits a `blocked` event when a process kill fires
3. `ipc.ts` listens for the event, calls `interstitialWin.webContents.send('interstitial:data', {...})`
4. `interstitialWin.show()` makes it appear fullscreen, always-on-top
5. The renderer's `InterstitialWarning` component listens via `window.electronAPI.onInterstitialData()`
6. User clicks "Go back" → `api.hideInterstitial()` → `ipcMain` hides the window
7. User clicks "Proceed anyway" → 30s countdown → `api.proceedAnyway()` → window hides

## Adding a new view

1. Create `src/renderer/src/views/MyView.tsx`
2. Add `'my-view'` to the `ViewName` union in `src/shared/types.ts`
3. Add a nav item to `Sidebar.tsx` (mainNav or premiumNav array)
4. Add a `case 'my-view':` branch in `App.tsx`'s `renderView()`

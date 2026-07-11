# Attentify — Compatibility & Requirements

This document tracks exactly what Attentify needs to run correctly, so users don't hit
avoidable issues. Keep it updated when platform behavior or dependencies change.

Last verified: **2026-07-10**

---

## Supported operating systems

| OS | Status | Notes |
|----|--------|-------|
| **Windows 11** (all builds) | ✅ Fully supported | Primary target. |
| **Windows 10** 21H2 / 22H2 (build 19044+) | ✅ Fully supported | |
| **Windows 10** 1809–21H1 (build 17763–19043) | ⚠️ Works | Electron 28 requires 1809+. Older builds are unsupported. |
| **Windows 10** pre-1809 / Windows 8.1 / 7 | ❌ Not supported | Electron 28 will not launch. |
| **Windows on ARM** | ⚠️ Untested | Runs under x64 emulation; native tracking may be slower. |
| **macOS 11 Big Sur+** | ⚠️ Partial | UI + tracking work; system-level site blocking (hosts file) is best-effort and needs a signed build for Gatekeeper. |
| **Linux** | ⚠️ Experimental | AppImage builds; foreground-window tracking not implemented. |

**Minimum for full functionality: Windows 10 build 1809 (October 2018 Update) or newer.**

---

## Privileges

- **Administrator rights** are required for *hard* blocking (editing the system `hosts`
  file + flushing DNS + killing blocked processes). Without them the app runs in **soft
  mode** — it still tracks, analyzes, and advises, but blocks are logged, not enforced.
- The packaged installer requests elevation via a UAC manifest (`requireAdministrator`).
  Unsigned builds trigger a SmartScreen warning on first run (More info → Run anyway).

---

## Runtime dependencies

| Dependency | Version | Why |
|------------|---------|-----|
| **Electron** | 28.x | App runtime (Chromium + Node). Sets the Windows 1809+ floor. |
| **Node.js** (build only) | 18+ | Building/packaging from source. Not needed to run the installed app. |
| **PowerShell** | 5.1+ (ships with Windows) | Foreground-window activity tracking + UAC relaunch on Windows. |
| **@anthropic-ai/sdk** | 0.30.x | AI assistant (Claude). Needs network access to `api.anthropic.com` or `openrouter.ai`. |
| **sql.js** | 1.10.x | Local SQLite database (bundled WASM — no native SQLite needed). |
| **React / react-dom** | 18.x | UI. |

- **AI features** require either the bundled free allowance, an Anthropic key
  (`sk-ant-…`), or an OpenRouter key (`sk-or-…`). The assistant, overlay nudges, and the
  "build analytics"/"describe context" features are unavailable without one.
- **No account, no telemetry.** The only outbound calls are to the AI provider you
  configure. All tracking data stays in a local SQLite DB.

---

## Browser support (native tracking — NOT the extension)

Attentify tracks browser activity by reading the **foreground window title + process
name** — this works for *any* browser, no extension required. The following top browsers
are explicitly recognized and categorized:

1. Google Chrome
2. Microsoft Edge
3. Mozilla Firefox
4. Brave
5. Opera
6. Opera GX
7. Vivaldi
8. Safari (macOS)
9. Arc
10. Tor Browser
11. Chromium
12. Yandex Browser
13. DuckDuckGo
14. Maxthon
15. UC Browser

Also recognized: Pale Moon, Waterfox, LibreWolf, Floorp, Thorium, Whale, Epic, SRWare
Iron, Slimjet, Min, Falkon, Midori, Basilisk, SeaMonkey.

### Browsing-history import (bootstraps analytics from day one)
Read directly from each browser's local profile (no permission prompt — same user):

- **Chromium family:** Chrome, Edge, Brave, Vivaldi, Opera, Opera GX, Yandex, Arc,
  Chromium (`urls`/`visits` tables).
- **Firefox family:** Firefox, Waterfox, LibreWolf, Pale Moon (`moz_places` /
  `moz_historyvisits`).

> The **browser extension** (element-level blocking of Shorts/Reels/feeds) is a separate
> component and only targets **Chrome / Edge (Chromium)**. Native tracking above is
> independent of it.

---

## Known constraints

- The main window is resizable (min 860×580). Fixed 980×660 default.
- Only **one instance** runs at a time (single-instance lock); a second launch focuses
  the existing window.
- On a hard crash, `hosts` entries between `# PRODUCTIVITY_DAEMON_START` and
  `# PRODUCTIVITY_DAEMON_END` may linger — remove them manually if blocks feel "stuck".
- Startup-item removal (Deep Clean): `HKCU` + Startup-folder entries work without admin;
  `HKLM` (all-users) entries require running elevated.
- Data location: `C:\ProgramData\Attentify\` (Windows). Safe to back up; deleting it
  resets all state.

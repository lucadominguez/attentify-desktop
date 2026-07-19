# Changelog

All notable changes to Attentify (desktop app) are documented here.
The format is based on [Keep a Changelog](https://keepachangelog.com/), and the
project uses [semantic versioning](https://semver.org/).

## [Unreleased]

### Added
- **Activity page** — a searchable, filterable, day-grouped feed of your local search
  history, browsing history (URLs), and app-by-app activity. Everything stays on-device.
- **AI credits and subscription.** Every account starts with free trial credit. Top up
  any time with a credit pack ($5 / $10 / $20), or subscribe for $9.99/mo to get unlimited
  AI plus more custom analytics. Your remaining credits show in Settings and in chat.

### Changed
- Moved the raw browsing/session data out of Analytics (its old *Websites* and *Log*
  tabs) onto the new Activity page; Analytics now focuses on charts, patterns and cards.
- **AI now runs through Attentify's secure cloud service.** Signing in gives every account
  its own metered AI, so no shared key is involved. Bringing your own OpenRouter or
  Anthropic key still works and is never metered. AI now needs a signed-in account and an
  internet connection.
- When your credits run out, AI features and adaptive blocking pause until you top up or
  subscribe. Your built-in rule packs and any blocks you set by hand keep working.

### Security
- Removed the bundled provider key from the app entirely. AI is authenticated per account
  through the cloud service instead, so there is no shared key to leak.

### Fixed
- **UI no longer freezes while the AI is thinking.** Streaming updates are coalesced in
  the main process (~55 ms) instead of firing on every token, message markdown is
  memoized so only the streaming message re-renders, and a redundant per-chunk sanitize
  pass was removed — the event loop stays responsive on long replies and conversations.

## [1.1.0] — 2026-07-12

### Added
- **Chat-first assistant** as the home screen, with multiple **conversations** (switcher
  + new chat), **image attachments** (vision), and **Cursor-style revert checkpoints** —
  scroll up and restore blocks/schedules/cards to any earlier point.
- **Logic page** — collapsible flow-charts of how Attentify reasons about your attention
  (signals → inference → suggestion), plus a bar to feed it your own context.
- **Describe-your-analytics** — ask for a metric in plain English and it builds a live
  card (bar / line / table / number) on the Analytics page.
- **Timesheets** — RescueTime-style day-by-day time breakdown by app and category.
- **AI-built schedules** that are actually **enforced** — recurring auto-block windows
  that turn on/off on their own (e.g. "block social 9–5 on weekdays").
- **Deep Clean: stop apps launching at startup** (registry + Startup folder).
- **Browser-history import** — bootstraps analytics from day one from your own profiles.
- **Native tracking for the top 15 browsers** (Chrome, Edge, Firefox, Brave, Opera,
  Vivaldi, Safari, Arc, Tor, Yandex, DuckDuckGo … ) — no extension required.
- **Light + dark themes** (follows the OS by default, with a titlebar toggle) and an
  app-version readout in Settings.
- New friendly robot **logo**, used as the app icon and the AI's chat avatar.
- `COMPATIBILITY.md` documenting supported Windows versions and dependencies.

### Changed
- **Cheap-by-default model routing**: most tasks run on DeepSeek V4 Pro; only genuinely
  high-ambiguity turns (open-ended reasoning / advice / images) escalate to Claude
  Sonnet, chosen by a zero-token local classifier. Accurate DeepSeek pricing means the
  free allowance stretches much further. Quality where it matters, far lower cost.
- Cohesive **"Slate & Violet"** color scheme replacing the clashing green/red/blue.
- Removed the separate Dashboard page; theme-aware sidebar + titlebar.

### Fixed
- Chat no longer leaks raw tool-call JSON (scrubbed live, streaming and stored history).
- The stuck blank overlay window in the corner (reveal-only-after-paint handshake).
- The browser extension's URL classifier no longer pollutes chat history (routed through
  a raw `/ai/json` proxy instead of the chat agent).

## [1.0.0] — Attentify (rebrand baseline)

- System-level distraction blocking (hosts file + process killing), activity tracking,
  13 heuristic distraction detectors, AI inference pipeline, Focus/Deep-Focus sessions,
  Deep Clean scanner, Schedule Manager, cloud auth/sync, and the Attentify rebrand.
- Predecessor project: "Productivity Daemon" (initial commit).

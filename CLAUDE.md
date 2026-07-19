# Attentify desktop (this repo = `attentify-desktop`)

## Product
Windows desktop app (Electron) that protects the user's attention: monitors
activity, classifies distraction contextually, blocks/nudges, and explains its
reasoning. **Chat-first**: the home screen IS the AI chat, not a dashboard. The
app should feel like a calm sentient presence, never compete for attention.

## Architecture
- `src/main/` — Electron main (privileged): `ipc.ts` (all channels, default-deny
  auth gate), `aiClient.ts` (ONE builder for every AI client), `billing.ts`
  (credits/subscription state), `auth.ts` (account + device fingerprint),
  `agent/` (chat agent + tools + modelRouter), `inference/` + `guard/` +
  `feedback/` (classification, self-eval loop), `blocking/`, `monitoring/`,
  `overlay/`, `store.ts` (state at `C:\ProgramData\Attentify\state.json`).
- `src/renderer/` — React UI. `src/preload/` — API bridge (keep the TS interface
  in `App.tsx` in sync when adding methods). `src/shared/types.ts` — shared types.
- Cloud backend + extension + website live in the sibling repo (`attentify`).

## Canonical commands (verified in package.json)
- `npm run dev` — electron-vite dev
- `npm run build` — bundle main/preload/renderer (this is the real ship check)
- `npm run package:win` — build + NSIS installer

## AI & billing invariants
- **No provider key ships in the app.** `aiClient.ts` decides: user's own key →
  direct/unmetered; signed in → metered cloud proxy (`CLOUD_API_BASE`, token as
  x-api-key, header `X-Attentify-Client: app`); neither → no client.
- Every AI service gates on `canUseAi()`; out of credit pauses AI + adaptive
  blocking but NEVER static rule packs or manual blocks.
- Users see **credits** (1 credit = $0.001); never expose the 25% markup.
- OpenRouter account currently serves **DeepSeek only** (Anthropic/Google 404).
  Model slugs live in `agent/modelRouter.ts` only.

## Design invariants (explicit user corrections — do not undo)
- Home = `<ChatPanel variant="full">`. Dashboard is its own nav item.
- Palette "Slate & Violet" via ThemeContext semantic tokens; no raw saturated hex.
- Logo = the real robot art file (`assets/logo.png`), never a redrawn SVG; no
  wordmark in the titlebar.
- **Never rebuild a PulsingSphere-style animated orb** (cut once already).
  Presence = periphery (sidebar mark, ambient wash), not a centerpiece.
- No em dashes in user-facing copy (rewrite the sentence). **Carve-out:**
  `views/Activity.tsx` TITLE_SUFFIX / private-browsing regexes MATCH on em
  dashes to strip browser suffixes — never "fix" them.
- User-facing feeds show meaningful actions only; no per-page/debug entries.

## Verification gotchas (each burned us once)
- electron-vite/esbuild builds green with undefined identifiers and wrong prop
  names. **Render-test every view you touch**; a green build proves nothing.
- `npx tsc --noEmit -p tsconfig.json` has a **pre-existing baseline of ~107
  errors** (only `tsconfig.json` exists — `tsconfig.web/node.json` don't).
  Compare counts; never claim "clean" or grep-filter output.
- UI must be looked at (screenshot/driven render): SVG-stretch text smearing and
  ~1:1-contrast "invisible" elements passed every non-visual check.
- The packaged app runs **elevated**: it can't be killed from tooling and
  rewrites `state.json` from memory (edits while running are discarded).
- Real end-to-end (hosts writes, focus lock, updater) needs the packaged app.

## Definition of done
Change built + render-verified + committed + pushed (`origin main`), CHANGELOG.md
updated for user-visible changes, and the tracker updated. Version lives in
`package.json`; release flow (R2 upload names, latest.yml pairing) is in the
tracker file.

## Pointers
- Live work tracker (read at session start, update at end):
  `../OUTSTANDING.md` (in `Desktop/AI/`, outside this repo).
- Session transcripts: `../claude-logs/` — grep before re-asking the user.
- Restore tag pre-glass-redesign: `v1.1.0-pre-glass`.

Context verified against commit `7ddf212` on 2026-07-19.

// Assemble the in-browser app demo for the marketing site.
//
// Takes the already-built Electron renderer (out/renderer) — a plain web SPA —
// drops in the browser shim that fakes window.electronAPI, and writes the result
// to Browser-Daemon/website/app/. Run AFTER `npm run build`.
//
//   node scripts/build-web-demo.mjs
//
// Then deploy the website (the /app folder ships with it).

import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { cpSync, rmSync, copyFileSync, readFileSync, writeFileSync, existsSync } from 'node:fs'

const here = dirname(fileURLToPath(import.meta.url))
const src = join(here, '..', 'out', 'renderer')
const dest = join(here, '..', '..', 'Browser-Daemon', 'website', 'app')
const shim = join(here, 'pd-web-shim.js')

if (!existsSync(src)) {
  console.error('✗ out/renderer not found — run `npm run build` first.')
  process.exit(1)
}

rmSync(dest, { recursive: true, force: true })
cpSync(src, dest, { recursive: true })
copyFileSync(shim, join(dest, 'pd-web-shim.js'))

// Inject the shim as the first <head> script so it defines window.electronAPI
// before the deferred app module runs.
const indexPath = join(dest, 'index.html')
let html = readFileSync(indexPath, 'utf-8')
if (!html.includes('pd-web-shim.js')) {
  html = html.replace('<head>', '<head>\n    <script src="./pd-web-shim.js"></script>')
}
// A friendlier title for the embedded demo.
html = html.replace('<title>Attentify</title>', '<title>Attentify — live demo</title>')
// NB: we deliberately keep the renderer's strict CSP (web fonts blocked → system
// fallback) so the demo has zero external dependencies and never blanks while a
// font CDN loads. It matches how the desktop app renders.
writeFileSync(indexPath, html, 'utf-8')

console.log('✓ web demo written to', dest)

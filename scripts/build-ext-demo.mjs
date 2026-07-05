// Assemble the in-browser browser-extension demo for the marketing site.
//
// Copies the REAL extension popup (popup.html/js/css) into website/ext/ and drops in
// the chrome.* shim (pd-ext-shim.js) so the actual popup runs as a live demo with
// simulated data. Run any time the extension popup changes, then redeploy the site.
//
//   node scripts/build-ext-demo.mjs

import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { cpSync, rmSync, copyFileSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { execSync } from 'node:child_process'

const here = dirname(fileURLToPath(import.meta.url))
const extSrc = join(here, '..', '..', 'Browser-Daemon', 'extension')
const dest = join(here, '..', '..', 'Browser-Daemon', 'website', 'ext')
const shim = join(here, 'pd-ext-shim.js')

if (!existsSync(join(extSrc, 'popup.html'))) {
  console.error('✗ extension popup not found at', extSrc)
  process.exit(1)
}

rmSync(dest, { recursive: true, force: true })
cpSync(extSrc, dest, {
  recursive: true,
  // ship the popup (for the live demo) + manifest.json (so the extension's auto-update
  // check has a public, working endpoint to read the latest version from)
  filter: (src) => {
    const base = src.split(/[\\/]/).pop()
    if (existsSync(src) && !base.includes('.')) return true // dirs
    return ['popup.html', 'popup.js', 'popup.css', 'manifest.json'].includes(base)
  },
})
copyFileSync(shim, join(dest, 'pd-ext-shim.js'))

// Publish a downloadable zip of the whole extension so the update banner's download
// link works (best-effort: zip via bsdtar, which ships with Windows 10+/macOS).
try {
  const zipPath = join(dest, 'attentify-extension.zip')
  if (process.platform === 'win32') {
    execSync(`powershell -NoProfile -Command "Compress-Archive -Path '${extSrc}\\*' -DestinationPath '${zipPath}' -Force"`, { stdio: 'ignore', timeout: 60000 })
  } else {
    execSync(`cd "${extSrc}" && zip -r -q "${zipPath}" .`, { stdio: 'ignore', timeout: 60000 })
  }
  console.log('✓ packed extension zip')
} catch (e) {
  console.warn('! could not pack extension zip (non-fatal):', e.message)
}

// Inject the shim as the first <head> script so window.chrome exists before popup.js.
const indexPath = join(dest, 'popup.html')
let html = readFileSync(indexPath, 'utf-8')
if (!html.includes('pd-ext-shim.js')) {
  html = html.replace('<head>', '<head>\n  <script src="pd-ext-shim.js"></script>')
}
writeFileSync(indexPath, html, 'utf-8')

console.log('✓ extension demo written to', dest)

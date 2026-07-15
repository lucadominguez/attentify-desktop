// Privacy-window detection.
//
// Attentify tracks foreground time for every window, but for private / incognito /
// Tor browser windows it deliberately CANNOT see the URL inside (the browser hides
// the address bar from accessibility APIs, and Tor routes traffic opaquely). Rather
// than silently mis-classify that time, or pretend we saw a URL we didn't — we
// detect these windows from the one signal the OS still exposes: the window title
// (and, for Tor, the process/executable name).
//
// Reliability notes (why we match what we match):
//   • Firefox family (Firefox/LibreWolf/Waterfox/Floorp) private windows append
//     "Private Browsing" / "(Private Browsing)" to the title — reliable.
//   • Tor Browser is a Firefox fork whose window title and process are "Tor Browser"
//     / tor — reliable.
//   • Edge InPrivate windows carry "InPrivate" in the window title — reliable.
//   • Chrome / Brave / Chromium Incognito windows do NOT expose an "Incognito" marker
//     in GetWindowText, so we cannot detect those from the title. We match a literal
//     "incognito" only for the handful of forks that do add it; we do NOT claim to
//     catch every Chrome incognito window, and the UI wording reflects that.
//
// This function is pure and side-effect free so it can run in both the main process
// (to tag sessions live) and the renderer (to classify already-stored session titles),
// and be unit-tested without any OS dependency.

export type PrivacyMode = 'tor' | 'inprivate' | 'private' | 'incognito'

export function detectPrivacyMode(app: string, title: string): PrivacyMode | null {
  const a = (app || '').toLowerCase()
  const t = (title || '').toLowerCase()

  // Tor first, it is also a Firefox fork, so its "private" markers would otherwise
  // win; a Tor window is a strictly stronger signal than generic private browsing.
  if (a === 'tor' || a === 'torbrowser' || t.includes('tor browser')) return 'tor'
  if (t.includes('inprivate')) return 'inprivate'
  if (t.includes('private browsing')) return 'private'
  if (t.includes('incognito')) return 'incognito'
  return null
}

export function privacyLabel(mode: PrivacyMode): string {
  switch (mode) {
    case 'tor': return 'Tor Browser'
    case 'inprivate': return 'InPrivate'
    case 'private': return 'Private Browsing'
    case 'incognito': return 'Incognito'
  }
}

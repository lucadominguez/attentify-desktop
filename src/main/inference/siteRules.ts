import { registeredDomain, pathClass } from '../feedback/fingerprint'

// Path-aware classification for the sites where the ROUTE flips the meaning. The taxonomy
// treats a domain as one thing; these rules say youtube.com/shorts and youtube.com/watch
// are not the same activity, and reddit.com/r/programming is not reddit.com's feed. Anything
// not covered here returns null and falls through to the domain-level taxonomy.
//
// risk is a policy weight (0 = fine, 1 = clearly off-task), deliberately separate from the
// model's confidence — the same distinction the whole feedback system rests on.

export interface SiteMatch {
  category: string
  risk: number
  ruleId: string
  // Whether a single evidence source is enough to auto-block this (an unambiguous route),
  // or corroboration is required. Ambiguous routes (a /watch page) always need corroboration.
  unambiguous: boolean
}

// Subreddits that are overwhelmingly work/learning-oriented — a visit here under a coding
// goal is far more likely aligned than distracting.
const TECHNICAL_SUBS = new Set([
  'programming', 'webdev', 'javascript', 'typescript', 'reactjs', 'node', 'rust',
  'golang', 'python', 'learnprogramming', 'cscareerquestions', 'devops', 'sysadmin',
  'kubernetes', 'aws', 'azure', 'datascience', 'machinelearning', 'compsci',
  'experienceddevs', 'dotnet', 'cpp', 'java', 'django', 'flask', 'vuejs', 'sveltejs',
])

export function classifyUrl(url: string): SiteMatch | null {
  let host: string, path: string, seg: string[]
  try {
    const u = new URL(url.startsWith('http') ? url : `https://${url}`)
    host = registeredDomain(u.hostname)
    path = u.pathname.toLowerCase()
    seg = path.split('/').filter(Boolean)
  } catch { return null }

  const first = seg[0] ?? ''
  const pc = pathClass(path)

  if (host === 'youtube.com' || host === 'youtu.be') {
    if (first === 'shorts') return { category: 'short_form_video', risk: 0.95, ruleId: 'yt-shorts', unambiguous: true }
    // A specific watch page is ambiguous — it is a tutorial as often as a time-sink.
    if (first === 'watch' || host === 'youtu.be') return { category: 'video_streaming', risk: 0.55, ruleId: 'yt-watch', unambiguous: false }
    if (first === 'results') return null   // a search results page is intent, not a visit — let it pass
    // Homepage / feed / subscriptions: the recommendation feed is the risky surface.
    if (first === '' || first === 'feed') return { category: 'video_streaming', risk: 0.70, ruleId: 'yt-feed', unambiguous: false }
    return { category: 'video_streaming', risk: 0.60, ruleId: 'yt-other', unambiguous: false }
  }

  if (host === 'reddit.com') {
    if (first === 'r' && seg[1]) {
      const sub = seg[1].toLowerCase()
      if (TECHNICAL_SUBS.has(sub)) return { category: 'technical_community', risk: 0.30, ruleId: `reddit-tech`, unambiguous: false }
      return { category: 'social_forum', risk: 0.75, ruleId: 'reddit-sub', unambiguous: false }
    }
    // The front page / r/all / popular is the doom-scroll surface.
    if (first === '' || pc === 'feed' || first === 'r') return { category: 'social_forum', risk: 0.80, ruleId: 'reddit-feed', unambiguous: false }
    return { category: 'social_forum', risk: 0.72, ruleId: 'reddit-other', unambiguous: false }
  }

  if (host === 'x.com' || host === 'twitter.com') {
    if (pc === 'messaging') return { category: 'messaging', risk: 0.40, ruleId: 'x-dm', unambiguous: false }
    return { category: 'social_media', risk: 0.88, ruleId: 'x-feed', unambiguous: false }
  }

  if (host === 'github.com' || host === 'gitlab.com' || host === 'stackoverflow.com') {
    return { category: 'development', risk: 0.05, ruleId: 'dev-site', unambiguous: false }
  }

  return null
}

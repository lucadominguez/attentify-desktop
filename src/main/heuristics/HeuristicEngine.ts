import { randomUUID } from 'crypto'
import type { ActivitySession, HeuristicAlert } from '../../shared/types'

const DISTRACTION_KEYWORDS = ['twitter', 'x.com', 'instagram', 'tiktok', 'reddit', 'facebook', 'youtube', 'twitch', 'discord', 'snapchat', 'netflix', 'hulu', '9gag']
const VIDEO_KEYWORDS = ['youtube', 'twitch', 'netflix', 'hulu', 'disneyplus', 'primevideo', 'crunchyroll', 'bilibili', 'kick.com']
const NEWS_KEYWORDS = ['reddit', 'news', 'cnn', 'bbc', 'theguardian', 'nytimes', 'washingtonpost', 'hackernews', 'ycombinator', 'techcrunch']
const COMMS_APPS = new Set(['discord', 'slack', 'teams', 'telegram', 'whatsapp', 'messenger', 'signal'])
const BROWSER_PROCS = new Set(['chrome', 'firefox', 'msedge', 'opera', 'brave', 'safari', 'arc', 'vivaldi'])

function extractDomain(title: string): string | null {
  const lower = title.toLowerCase()
  for (const kw of DISTRACTION_KEYWORDS) {
    if (lower.includes(kw)) return kw
  }
  return null
}

function isVideo(title: string): boolean {
  const lower = title.toLowerCase()
  return VIDEO_KEYWORDS.some((k) => lower.includes(k))
}

function isNews(title: string): boolean {
  const lower = title.toLowerCase()
  return NEWS_KEYWORDS.some((k) => lower.includes(k))
}

function isBrowser(app: string): boolean {
  return BROWSER_PROCS.has(app.toLowerCase())
}

function switchRate(sessions: ActivitySession[]): number {
  const totalMs = sessions.reduce((s, r) => s + r.duration, 0)
  const hours = totalMs / 3600000
  return hours > 0.05 ? sessions.length / hours : 0
}

export class HeuristicEngine {
  private siteVisitLog = new Map<string, number[]>()
  private alerts: HeuristicAlert[] = []
  private lastChecked = 0
  private lastSwitchCount = 0

  analyze(sessions: ActivitySession[]): HeuristicAlert[] {
    const now = Date.now()
    if (now - this.lastChecked < 30_000) return []
    this.lastChecked = now

    const newAlerts: HeuristicAlert[] = []
    const w20 = now - 20 * 60 * 1000
    const w10 = now - 10 * 60 * 1000
    const w15 = now - 15 * 60 * 1000
    const recent = sessions.filter((s) => s.startTime >= w20)
    const last10 = sessions.filter((s) => s.startTime >= w10)

    // ── 1. Rapid app-switching ──────────────────────────────────────────────
    const switchCount = recent.length
    const rate = Math.round(switchRate(recent))
    if (switchCount > 20 && switchCount > this.lastSwitchCount + 5) {
      newAlerts.push({
        id: randomUUID(), type: 'rapid-switching', severity: 'medium',
        title: 'Rapid app-switching detected',
        description: `${switchCount} window switches in 20 minutes (${rate}/h). Knowledge workers average 60–80/h; deep work lives below 20/h. Your attention is fragmented.`,
        detectedAt: now, dismissed: false, switchRate: rate,
      })
    }
    this.lastSwitchCount = switchCount

    // ── 2. Compulsive checking (repeated site visits) ──────────────────────
    const browserSessions = recent.filter((s) => isBrowser(s.app))
    for (const s of browserSessions) {
      const domain = extractDomain(s.title)
      if (!domain) continue
      const visits = this.siteVisitLog.get(domain) ?? []
      visits.push(s.startTime)
      const recentVisits = visits.filter((t) => t >= w20)
      this.siteVisitLog.set(domain, recentVisits)
      if (recentVisits.length >= 5 && !this.alerts.some((a) => a.app === domain && a.detectedAt > now - 60_000)) {
        newAlerts.push({
          id: randomUUID(), type: 'repeated-visits', severity: 'high',
          title: `Compulsive checking: ${domain}`,
          description: `Back to ${domain} ${recentVisits.length}× in 20 minutes. This is a dopamine loop — variable-reward conditioning identical to slot machine mechanics.`,
          detectedAt: now, app: domain, dismissed: false,
        })
      }
    }

    // ── 3. Late-night doomscrolling ────────────────────────────────────────
    const hour = new Date().getHours()
    if ((hour >= 23 || hour < 4) && browserSessions.length >= 3
      && !this.alerts.some((a) => a.type === 'late-night' && a.detectedAt > now - 30 * 60 * 1000)) {
      newAlerts.push({
        id: randomUUID(), type: 'late-night', severity: 'high',
        title: 'Late-night doomscrolling session',
        description: `It's ${hour}:${String(new Date().getMinutes()).padStart(2, '0')}. Late-night screen use raises cortisol, delays melatonin, and tanks tomorrow's focus by 20–40% (Walker, 2017).`,
        detectedAt: now, dismissed: false,
      })
    }

    // ── 4. Feed black hole (long distraction session) ─────────────────────
    const now30 = now - 30 * 60 * 1000
    for (const s of sessions.filter((s) => s.isDistraction && s.duration > 25 * 60 * 1000 && s.startTime > now30)) {
      if (this.alerts.some((a) => a.type === 'long-session' && a.app === s.app && a.detectedAt > now - 60_000)) continue
      newAlerts.push({
        id: randomUUID(), type: 'long-session', severity: 'medium',
        title: `${Math.round(s.duration / 60000)}min lost to ${s.app}`,
        description: `An unbroken ${Math.round(s.duration / 60000)}-minute session on ${s.app}. You're deep in the algorithmic feed now — the original intent is long gone.`,
        detectedAt: now, app: s.app, dismissed: false,
      })
    }

    // ── 5. Focus drift ────────────────────────────────────────────────────
    if (recent.length >= 4) {
      const last4 = recent.slice(-4)
      const hadFocus = last4.slice(0, 2).every((s) => !s.isDistraction)
      const nowDistracted = last4.slice(2).every((s) => s.isDistraction)
      if (hadFocus && nowDistracted && !this.alerts.some((a) => a.type === 'focus-drift' && a.detectedAt > now - 10 * 60 * 1000)) {
        newAlerts.push({
          id: randomUUID(), type: 'focus-drift', severity: 'medium',
          title: 'Focus drift detected',
          description: 'You had a productive flow state — then drifted into distractions without a clear decision to stop. Attention residue research shows it takes 23 minutes to fully recover.',
          detectedAt: now, dismissed: false,
        })
      }
    }

    // ── 6. Doom loop (cycling same 2-3 apps) ──────────────────────────────
    if (recent.length >= 6) {
      const appCounts = new Map<string, number>()
      for (const s of recent) appCounts.set(s.app, (appCounts.get(s.app) ?? 0) + 1)
      const topApps = [...appCounts.entries()].filter(([, c]) => c >= 3).map(([a]) => a)
      const allTopApps = recent.every((s) => topApps.includes(s.app))
      if (topApps.length >= 2 && topApps.length <= 3 && allTopApps && topApps.every((a) => recent.find((s) => s.app === a)?.isDistraction)
        && !this.alerts.some((a) => a.type === 'doom-loop' && a.detectedAt > now - 15 * 60 * 1000)) {
        newAlerts.push({
          id: randomUUID(), type: 'doom-loop', severity: 'high',
          title: `Doom loop: ${topApps.slice(0, 2).join(' → ')}`,
          description: `Cycling between ${topApps.join(', ')} with no productive work in between. This cycling activates the same neural circuits as OCD rituals — the checking behavior is self-reinforcing.`,
          detectedAt: now, dismissed: false,
        })
      }
    }

    // ── 7. Micro-escapes (<90s distraction bursts) ─────────────────────────
    const microDistractions = last10.filter((s) => s.isDistraction && s.duration < 90_000)
    if (microDistractions.length >= 5 && !this.alerts.some((a) => a.type === 'micro-escape' && a.detectedAt > now - 10 * 60 * 1000)) {
      newAlerts.push({
        id: randomUUID(), type: 'micro-escape', severity: 'medium',
        title: `${microDistractions.length} micro-escapes in 10 minutes`,
        description: `${microDistractions.length} sub-90-second hits of distraction in 10 minutes. Brief escapes feel harmless but create "continuous partial attention" — present everywhere, focused nowhere.`,
        detectedAt: now, dismissed: false,
      })
    }

    // ── 8. Notification FOMO (comm apps high frequency) ───────────────────
    const commSessions = sessions.filter((s) => COMMS_APPS.has(s.app.toLowerCase()) && s.startTime >= w15)
    const commRate = commSessions.length / 0.25 // per hour over 15min window
    if (commRate >= 8 && !this.alerts.some((a) => a.type === 'notification-fomo' && a.detectedAt > now - 15 * 60 * 1000)) {
      const topComm = commSessions[0]?.app ?? 'messaging app'
      newAlerts.push({
        id: randomUUID(), type: 'notification-fomo', severity: 'medium',
        title: `Notification FOMO: ${topComm}`,
        description: `${Math.round(commRate)} checks/hour on ${topComm}. Fear of missing conversations is a manufactured anxiety — each notification is designed to create exactly this reflex.`,
        detectedAt: now, app: topComm, dismissed: false,
      })
    }

    // ── 9. Video rabbit hole ──────────────────────────────────────────────
    const videoSessions = sessions.filter((s) => isBrowser(s.app) && isVideo(s.title) && s.startTime > now - 35 * 60 * 1000)
    const videoMs = videoSessions.reduce((t, s) => t + s.duration, 0)
    if (videoMs > 20 * 60 * 1000 && !this.alerts.some((a) => a.type === 'video-rabbit-hole' && a.detectedAt > now - 20 * 60 * 1000)) {
      newAlerts.push({
        id: randomUUID(), type: 'video-rabbit-hole', severity: 'high',
        title: `Video rabbit hole: ${Math.round(videoMs / 60000)}min`,
        description: `${Math.round(videoMs / 60000)} minutes in a video feed. Autoplay drives 70% of YouTube watch time — the content you're watching now was not what you came for.`,
        detectedAt: now, dismissed: false,
      })
    }

    // ── 10. Phantom checking (<30s opens) ────────────────────────────────
    const phantom = last10.filter((s) => s.duration < 30_000)
    if (phantom.length >= 4 && !this.alerts.some((a) => a.type === 'phantom-checking' && a.detectedAt > now - 10 * 60 * 1000)) {
      newAlerts.push({
        id: randomUUID(), type: 'phantom-checking', severity: 'low',
        title: `${phantom.length} phantom checks detected`,
        description: `${phantom.length} app opens under 30 seconds in 10 minutes — no real purpose, pure habit. The app opens before the decision is made. This is automated compulsion.`,
        detectedAt: now, dismissed: false,
      })
    }

    // ── 11. News anxiety loop ────────────────────────────────────────────
    const newsSessions = sessions.filter((s) => isBrowser(s.app) && isNews(s.title) && s.startTime >= w15)
    if (newsSessions.length >= 4 && !this.alerts.some((a) => a.type === 'news-anxiety' && a.detectedAt > now - 15 * 60 * 1000)) {
      newAlerts.push({
        id: randomUUID(), type: 'news-anxiety', severity: 'medium',
        title: 'News anxiety loop',
        description: `${newsSessions.length} news/aggregator visits in 15 minutes. 74% of adults report news causes stress, yet keep checking — a textbook anxiety loop that perpetuates itself.`,
        detectedAt: now, dismissed: false,
      })
    }

    this.alerts.push(...newAlerts)
    this.alerts = this.alerts.slice(-500)
    return newAlerts
  }

  getAlerts(since?: number): HeuristicAlert[] {
    return this.alerts.filter((a) => a.detectedAt >= (since ?? 0))
  }

  dismissAlert(id: string): void {
    const a = this.alerts.find((alert) => alert.id === id)
    if (a) a.dismissed = true
  }
}

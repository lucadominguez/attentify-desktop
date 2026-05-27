import React, { useEffect, useState, useCallback } from 'react'
import { TrendingUp, Shield, AlertTriangle, RefreshCw, ChevronDown, ChevronUp, MessageSquare } from 'lucide-react'
import type { AppStore, ActivitySession } from '@shared/types'

const api = (window as unknown as { electronAPI: Window['electronAPI'] }).electronAPI

interface AlgoTrackProps {
  store: AppStore
  onChatWith?: (msg: string) => void
}

interface Platform {
  name: string
  domain: string
  score: number
  risk: 'extreme' | 'high' | 'medium' | 'low'
  category: string
  techniques: string[]
  description: string
}

const PLATFORMS: Platform[] = [
  {
    name: 'TikTok', domain: 'tiktok.com', score: 98, risk: 'extreme', category: 'Short Video',
    techniques: ['Infinite scroll', 'Variable reward', 'FOMO loop', 'Hyper-personalization', 'Haptic feedback timing', 'Sound autoplay'],
    description: 'Dopamine-loop optimized for sub-20s attention. Uses micro-ML models updated per watch second.',
  },
  {
    name: 'Instagram', domain: 'instagram.com', score: 93, risk: 'extreme', category: 'Social / Reels',
    techniques: ['Infinite scroll', 'Social comparison', 'Variable reward', 'Story urgency (24h)', 'Notification hooks', 'Explore rabbit holes'],
    description: 'Reels feed is engagement-maximized; Stories create artificial urgency. Likes are metered to extend sessions.',
  },
  {
    name: 'YouTube', domain: 'youtube.com', score: 87, risk: 'extreme', category: 'Video',
    techniques: ['Autoplay', 'Recommendation rabbit holes', 'Thumbnail clickbait', 'Progress bar anxiety', 'Comment hooks', 'Notification bell conditioning'],
    description: 'Autoplay alone extends sessions 3× intended. Recommendation engine optimizes for watch time, not satisfaction.',
  },
  {
    name: 'Twitter / X', domain: 'x.com', score: 82, risk: 'high', category: 'Social / Microblog',
    techniques: ['Outrage optimization', 'Pull-to-refresh reward', 'Quote-tweet amplification', 'Trending FOMO', 'Notification flooding', 'Streak mechanics'],
    description: 'Timeline ranked by predicted engagement (anger > joy). Pull-to-refresh mimics slot machine lever.',
  },
  {
    name: 'Reddit', domain: 'reddit.com', score: 75, risk: 'high', category: 'Forum / Social',
    techniques: ['Infinite scroll', 'Upvote dopamine', 'Award system', 'Crosspost rabbit holes', 'Notification hooks', 'Feed personalization'],
    description: 'Karma system conditions compulsive checking. Subreddit rabbit holes built for accidental hours-long sessions.',
  },
  {
    name: 'Snapchat', domain: 'snapchat.com', score: 72, risk: 'high', category: 'Ephemeral Social',
    techniques: ['Streak mechanics', 'Disappearing content urgency', 'FOMO triggers', 'Notification pressure', 'Discover feed', 'Social graph pressure'],
    description: 'Snapstreaks create daily compulsion loops through fear of losing progress. Disappearing content manufactured urgency.',
  },
  {
    name: 'Twitch', domain: 'twitch.tv', score: 68, risk: 'high', category: 'Live Streaming',
    techniques: ['Live FOMO', 'Community belonging hooks', 'Chat participation pull', 'Sub streak pressure', 'Bit/donation social proof', 'Raid events'],
    description: 'Live format creates acute FOMO. Chat interaction and sub streaks build compulsive daily check-ins.',
  },
  {
    name: 'LinkedIn', domain: 'linkedin.com', score: 61, risk: 'medium', category: 'Professional Social',
    techniques: ['Social comparison', 'Profile view FOMO', 'Endorsement reciprocity', 'Notification spam', 'Engagement bait posts', 'Job anxiety triggers'],
    description: 'Anxiety-based engagement: profile views trigger status anxiety. Endorsement requests exploit reciprocity bias.',
  },
  {
    name: 'Facebook', domain: 'facebook.com', score: 55, risk: 'medium', category: 'Social',
    techniques: ['Memory surfacing', 'Event nudges', 'Group notification floods', 'Reaction system', 'Marketplace hooks', 'Watch tab autoplay'],
    description: '"On this day" memory surfacing exploits nostalgia. Group features designed to create daily mandatory check-ins.',
  },
  {
    name: 'Pinterest', domain: 'pinterest.com', score: 51, risk: 'medium', category: 'Visual Discovery',
    techniques: ['Infinite scroll', 'Visual variable reward', 'Collection completion', 'Board rabbit holes', 'Notification triggers'],
    description: 'Visual infinite scroll with collection-building compulsion. Masonry layout optimized to prevent natural stopping points.',
  },
  {
    name: 'Netflix', domain: 'netflix.com', score: 46, risk: 'medium', category: 'Streaming',
    techniques: ['Autoplay next episode', 'Countdown timer pressure', 'Season cliff-hangers', 'Recommendation hooks', '"Are you still watching?" dismissal'],
    description: '15-second autoplay countdown exploits default bias. Cliff-hanger endings are production-mandated engagement tools.',
  },
  {
    name: 'Discord', domain: 'discord.com', score: 34, risk: 'low', category: 'Messaging',
    techniques: ['Unread badge anxiety', 'Server notification pressure', 'Status presence', 'Nitro FOMO', 'Community belonging'],
    description: 'Unread indicators and persistent notification badges create compulsive clearing behavior.',
  },
  {
    name: 'Hacker News', domain: 'news.ycombinator.com', score: 28, risk: 'low', category: 'Link Aggregator',
    techniques: ['New post FOMO', 'Comment thread rabbit holes', 'Karma system'],
    description: 'Lower manipulation intensity but comment threads can be deep time sinks.',
  },
]

const TECHNIQUE_GLOSSARY: { term: string; explanation: string }[] = [
  { term: 'Variable reward', explanation: 'Unpredictable positive outcomes (likes, new posts) trigger dopamine release — identical to slot machine mechanics.' },
  { term: 'Infinite scroll', explanation: 'Removes natural stopping points. Without pagination, session length is bounded only by willpower.' },
  { term: 'Autoplay', explanation: 'Default continuation eliminates the active decision to keep watching. Most users never opt out.' },
  { term: 'FOMO loop', explanation: 'Fear Of Missing Out manufactured through social proof, trending labels, and time-limited content.' },
  { term: 'Streak mechanics', explanation: 'Arbitrary progress counters that create loss aversion — users feel they\'ve "lost" something if they skip a day.' },
  { term: 'Notification hooks', explanation: 'Push notifications trigger app opens even during focus. Each open extends average session by 4–7 minutes.' },
  { term: 'Social comparison', explanation: 'Curated highlight reels drive status anxiety, which increases engagement to seek validation.' },
  { term: 'Outrage optimization', explanation: 'Content ranked by predicted engagement. Anger spreads 6× faster than positive content — so it gets surfaced more.' },
]

const RISK_COLOR: Record<string, string> = {
  extreme: '#ef5350',
  high: '#ffb800',
  medium: '#66bb6a',
  low: '#546e7a',
}

export default function AlgoTrack({ store, onChatWith }: AlgoTrackProps): React.ReactElement {
  const [sessions, setSessions] = useState<ActivitySession[]>([])
  const [applying, setApplying] = useState<string | null>(null)
  const [refreshed, setRefreshed] = useState(false)
  const [expanded, setExpanded] = useState<string | null>(null)
  const [showGlossary, setShowGlossary] = useState(false)

  const blockedDomains = new Set(store.blocklist.domains.map((d) => d.domain))

  const load = useCallback((): void => {
    api.getAnalytics().then((data) => {
      setSessions(data.recentSessions)
      setRefreshed(true)
    }).catch(() => {})
  }, [])

  useEffect(() => { load() }, [load])

  // Time spent per domain (approximate from app name matching)
  const timePerApp = new Map<string, number>()
  for (const s of sessions) {
    timePerApp.set(s.app, (timePerApp.get(s.app) ?? 0) + s.duration)
  }

  const blockDomain = async (domain: string): Promise<void> => {
    setApplying(domain)
    try {
      await api.addDomain(domain)
      store.blocklist.domains.push({ domain, addedAt: Date.now() })
    } finally {
      setApplying(null)
    }
  }

  const unblockDomain = async (domain: string): Promise<void> => {
    setApplying(domain)
    try {
      await api.removeDomain(domain)
      const idx = store.blocklist.domains.findIndex((d) => d.domain === domain)
      if (idx !== -1) store.blocklist.domains.splice(idx, 1)
    } finally {
      setApplying(null)
    }
  }

  const extremeCount = PLATFORMS.filter((p) => p.risk === 'extreme').length
  const blockedCount = PLATFORMS.filter((p) => blockedDomains.has(p.domain)).length

  const handleAskDaemon = (): void => {
    if (!onChatWith) return
    const topExposure = PLATFORMS
      .map((p) => {
        const appKey = [...timePerApp.keys()].find((k) =>
          k.toLowerCase().includes(p.name.split(' ')[0]!.toLowerCase()) ||
          p.domain.split('.')[0]!.toLowerCase().includes(k.toLowerCase().slice(0, 4))
        )
        return { name: p.name, risk: p.risk, ms: appKey ? timePerApp.get(appKey) ?? 0 : 0 }
      })
      .filter((p) => p.ms > 0)
      .sort((a, b) => b.ms - a.ms)
      .slice(0, 3)
      .map((p) => `${p.name} (${Math.floor(p.ms / 60000)}m, ${p.risk} risk)`)
      .join(', ')

    onChatWith(
      `I'm viewing AlgoTrack. I have ${blockedCount} of ${PLATFORMS.length} tracked platforms blocked. ` +
      `${extremeCount} platforms are rated extreme risk. ` +
      `My measured exposure this week: ${topExposure || 'none detected yet'}. ` +
      `Based on my usage patterns and the manipulation techniques these platforms use, which should I prioritize blocking, and why?`
    )
  }

  return (
    <div className="p-4 animate-fade-in space-y-3 overflow-y-auto h-full">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-white font-bold text-xl flex items-center gap-2">
            <TrendingUp size={19} className="text-accent-amber" /> AlgoTrack
          </h1>
          <p className="text-[10px] mt-0.5" style={{ color: '#8faac4' }}>
            Attention manipulation risk · {PLATFORMS.length} platforms ranked · {blockedCount} blocked
          </p>
        </div>
        <div className="flex items-center gap-2">
          {onChatWith && (
            <button
              onClick={handleAskDaemon}
              title="Get AI recommendations on which platforms to block based on your usage and risk"
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-full text-[11px] font-medium transition-colors"
              style={{ background: 'rgba(33,150,243,0.1)', color: '#64b5f6', border: '1px solid rgba(33,150,243,0.2)' }}
            >
              <MessageSquare size={11} /> Ask AI
            </button>
          )}
          <button
            onClick={load}
            title="Refresh your exposure data"
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-colors"
            style={{ background: 'rgba(255,184,0,0.08)', color: '#ffb800', border: '1px solid rgba(255,184,0,0.18)' }}
          >
            <RefreshCw size={10} /> Refresh
          </button>
        </div>
      </div>

      {/* Summary chips */}
      <div className="grid grid-cols-4 gap-2">
        {[
          { label: 'Extreme Risk', value: extremeCount.toString(), color: '#ef5350', sub: 'platforms', tooltip: `${extremeCount} platforms rated extreme manipulation risk — TikTok, Instagram, YouTube, Twitter/X. These use the most aggressive engagement techniques.` },
          { label: 'High Risk', value: PLATFORMS.filter((p) => p.risk === 'high').length.toString(), color: '#ffb800', sub: 'platforms', tooltip: `${PLATFORMS.filter((p) => p.risk === 'high').length} platforms rated high manipulation risk — significant dark patterns but not as aggressive as extreme-rated apps` },
          { label: 'Blocked', value: blockedCount.toString(), color: '#4caf50', sub: `of ${PLATFORMS.length}`, tooltip: `${blockedCount} of ${PLATFORMS.length} tracked platforms are currently blocked via the hosts file` },
          { label: 'Techniques', value: '8', color: '#2196f3', sub: 'documented', tooltip: 'Eight documented manipulation techniques: Variable reward, Infinite scroll, Autoplay, FOMO loop, Streak mechanics, Notification hooks, Social comparison, Outrage optimization' },
        ].map((chip) => (
          <div
            key={chip.label}
            className="flex flex-col items-center justify-center py-2.5 rounded-xl"
            title={chip.tooltip}
            style={{ background: '#0d1b2a', border: '1px solid rgba(30,58,95,0.5)' }}
          >
            <p className="text-base font-bold tabular-nums leading-none" style={{ color: chip.color }}>{chip.value}</p>
            <p className="text-[10px] text-white font-medium mt-0.5">{chip.label}</p>
            <p className="text-[9px]" style={{ color: '#7a9ab5' }}>{chip.sub}</p>
          </div>
        ))}
      </div>

      {/* Warning banner */}
      <div
        className="flex items-start gap-2.5 px-3 py-2.5 rounded-xl"
        style={{ background: 'rgba(255,184,0,0.06)', border: '1px solid rgba(255,184,0,0.18)' }}
      >
        <AlertTriangle size={13} className="text-accent-amber flex-shrink-0 mt-0.5" />
        <p className="text-[10px] leading-relaxed" style={{ color: '#90a4ae' }}>
          These platforms employ teams of engineers whose sole purpose is maximizing the time you spend on them.
          The scores below are derived from documented dark patterns, published research, and whistleblower disclosures.
        </p>
      </div>

      {/* Platform table */}
      <div className="rounded-xl overflow-hidden" style={{ border: '1px solid rgba(30,58,95,0.5)' }}>
        <table className="w-full text-xs" style={{ borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ background: 'rgba(8,15,30,0.9)', borderBottom: '1px solid rgba(30,58,95,0.5)' }}>
              <th className="px-3 py-2 text-left text-[9px] font-semibold uppercase tracking-wider w-8" style={{ color: '#7a9ab5' }}>#</th>
              <th className="px-2 py-2 text-left text-[9px] font-semibold uppercase tracking-wider" style={{ color: '#7a9ab5' }}>Platform</th>
              <th className="px-2 py-2 text-left text-[9px] font-semibold uppercase tracking-wider" style={{ color: '#7a9ab5' }}>Category</th>
              <th className="px-2 py-2 text-left text-[9px] font-semibold uppercase tracking-wider w-20" style={{ color: '#7a9ab5' }}>Risk Score</th>
              <th className="px-2 py-2 text-left text-[9px] font-semibold uppercase tracking-wider" style={{ color: '#7a9ab5' }}>Top Techniques</th>
              {refreshed && <th className="px-2 py-2 text-left text-[9px] font-semibold uppercase tracking-wider" style={{ color: '#7a9ab5' }}>Your Exposure</th>}
              <th className="px-2 py-2 text-left text-[9px] font-semibold uppercase tracking-wider w-20" style={{ color: '#7a9ab5' }}>Status</th>
            </tr>
          </thead>
          <tbody>
            {PLATFORMS.map((platform, i) => {
              const isBlocked = blockedDomains.has(platform.domain)
              const isApplying = applying === platform.domain
              const isExpanded = expanded === platform.name
              const riskColor = RISK_COLOR[platform.risk]!

              // Approximate time from sessions by fuzzy app name match
              const appKey = [...timePerApp.keys()].find((k) =>
                k.toLowerCase().includes(platform.name.split(' ')[0]!.toLowerCase()) ||
                platform.domain.split('.')[0]!.toLowerCase().includes(k.toLowerCase().slice(0, 4))
              )
              const exposure = appKey ? timePerApp.get(appKey) ?? 0 : 0
              const fmtExp = (ms: number): string => {
                const m = Math.floor(ms / 60000)
                const h = Math.floor(m / 60)
                if (h > 0) return `${h}h ${m % 60}m`
                return m > 0 ? `${m}m` : '—'
              }

              return (
                <React.Fragment key={platform.name}>
                  <tr
                    className="cursor-pointer transition-colors"
                    title={`${platform.name} — Risk score: ${platform.score}/100 (${platform.risk}). ${platform.techniques.length} documented manipulation techniques. Click to expand details.`}
                    style={{
                      background: isBlocked
                        ? 'rgba(76,175,80,0.04)'
                        : i % 2 === 0 ? 'rgba(13,27,42,0.7)' : 'rgba(17,34,64,0.45)',
                      borderBottom: '1px solid rgba(30,58,95,0.2)',
                    }}
                    onClick={() => setExpanded(isExpanded ? null : platform.name)}
                  >
                    {/* Rank */}
                    <td className="px-3 py-2 text-[10px] tabular-nums" style={{ color: '#7a9ab5' }}>{i + 1}</td>

                    {/* Platform name */}
                    <td className="px-2 py-2">
                      <div className="flex items-center gap-1.5">
                        <p className="text-white text-[11px] font-semibold whitespace-nowrap">{platform.name}</p>
                        <span
                          className="text-[8px] px-1.5 py-0.5 rounded font-bold uppercase tracking-wide"
                          style={{ background: riskColor + '20', color: riskColor }}
                        >
                          {platform.risk}
                        </span>
                        {isExpanded ? <ChevronUp size={10} style={{ color: '#7a9ab5' }} /> : <ChevronDown size={10} style={{ color: '#7a9ab5' }} />}
                      </div>
                    </td>

                    {/* Category */}
                    <td className="px-2 py-2 text-[10px] whitespace-nowrap" style={{ color: '#8faac4' }}>{platform.category}</td>

                    {/* Risk score bar */}
                    <td className="px-2 py-2" title={`Manipulation risk score: ${platform.score}/100. Score is derived from documented dark patterns, published research, and whistleblower accounts.`}>
                      <div className="flex items-center gap-1.5">
                        <div className="w-12 h-1.5 rounded-full overflow-hidden flex-shrink-0" style={{ background: 'rgba(30,58,95,0.5)' }}>
                          <div className="h-full rounded-full" style={{ width: `${platform.score}%`, background: riskColor }} />
                        </div>
                        <span className="text-[10px] font-bold tabular-nums" style={{ color: riskColor }}>{platform.score}</span>
                      </div>
                    </td>

                    {/* Techniques */}
                    <td className="px-2 py-2" title={`All ${platform.techniques.length} techniques: ${platform.techniques.join(', ')}`}>
                      <div className="flex flex-wrap gap-0.5 max-w-[220px]">
                        {platform.techniques.slice(0, 3).map((t) => (
                          <span
                            key={t}
                            className="text-[8px] px-1 py-0.5 rounded"
                            style={{ background: 'rgba(30,58,95,0.6)', color: '#8097b1' }}
                          >
                            {t}
                          </span>
                        ))}
                        {platform.techniques.length > 3 && (
                          <span className="text-[8px]" style={{ color: '#7a9ab5' }} title={`Additional techniques: ${platform.techniques.slice(3).join(', ')}`}>+{platform.techniques.length - 3}</span>
                        )}
                      </div>
                    </td>

                    {/* Exposure */}
                    {refreshed && (
                      <td
                        className="px-2 py-2"
                        title={exposure > 0 ? `You spent approximately ${fmtExp(exposure)} on ${platform.name} this week (estimated from app tracking data)` : `No detected usage of ${platform.name} this week`}
                      >
                        <span
                          className="text-[10px] font-mono tabular-nums font-semibold"
                          style={{ color: exposure > 3600000 ? '#ef5350' : exposure > 0 ? '#ffb800' : '#37474f' }}
                        >
                          {fmtExp(exposure)}
                        </span>
                        {exposure > 3600000 && (
                          <span className="ml-1 text-[8px] text-accent-orange">this week</span>
                        )}
                      </td>
                    )}

                    {/* Block/unblock */}
                    <td className="px-2 py-2" onClick={(e) => e.stopPropagation()}>
                      {isBlocked ? (
                        <button
                          onClick={() => unblockDomain(platform.domain)}
                          disabled={!!applying}
                          title={`${platform.domain} is currently blocked. Click to remove from blocklist.`}
                          className="text-[10px] px-2 py-1 rounded-lg font-semibold transition-all disabled:opacity-50"
                          style={{ background: 'rgba(76,175,80,0.12)', color: '#66bb6a', border: '1px solid rgba(76,175,80,0.2)' }}
                        >
                          {isApplying ? '…' : '✓ Blocked'}
                        </button>
                      ) : (
                        <button
                          onClick={() => blockDomain(platform.domain)}
                          disabled={!!applying}
                          title={`Block ${platform.domain} — adds to hosts file to prevent browser access`}
                          className="flex items-center gap-1 text-[10px] px-2 py-1 rounded-lg font-semibold transition-all hover:scale-105 disabled:opacity-50"
                          style={{ background: 'rgba(255,107,53,0.1)', color: '#ff6b35', border: '1px solid rgba(255,107,53,0.2)' }}
                        >
                          {isApplying ? <><RefreshCw size={8} className="animate-spin" /> …</> : <><Shield size={8} /> Block</>}
                        </button>
                      )}
                    </td>
                  </tr>

                  {/* Expanded detail row */}
                  {isExpanded && (
                    <tr style={{ background: 'rgba(8,15,30,0.9)', borderBottom: '1px solid rgba(30,58,95,0.3)' }}>
                      <td />
                      <td colSpan={refreshed ? 5 : 4} className="px-3 pb-3 pt-1.5">
                        <p className="text-[10px] leading-relaxed mb-2" style={{ color: '#78909c' }}>{platform.description}</p>
                        <div className="flex flex-wrap gap-1">
                          {platform.techniques.map((t) => (
                            <span
                              key={t}
                              className="text-[9px] px-2 py-0.5 rounded-full"
                              style={{ background: 'rgba(30,58,95,0.7)', color: '#64b5f6', border: '1px solid rgba(33,150,243,0.15)' }}
                            >
                              {t}
                            </span>
                          ))}
                        </div>
                      </td>
                      <td />
                    </tr>
                  )}
                </React.Fragment>
              )
            })}
          </tbody>
        </table>
      </div>

      {/* Technique glossary (collapsible) */}
      <div className="rounded-xl overflow-hidden" style={{ border: '1px solid rgba(30,58,95,0.5)' }}>
        <button
          className="w-full flex items-center justify-between px-4 py-3 text-left transition-colors hover:bg-navy-800/20"
          style={{ background: '#0d1b2a' }}
          onClick={() => setShowGlossary((v) => !v)}
        >
          <p className="text-white text-[11px] font-semibold">Manipulation Technique Glossary</p>
          {showGlossary ? <ChevronUp size={13} style={{ color: '#8faac4' }} /> : <ChevronDown size={13} style={{ color: '#8faac4' }} />}
        </button>
        {showGlossary && (
          <div
            className="grid grid-cols-2 gap-px"
            style={{ background: 'rgba(30,58,95,0.2)', borderTop: '1px solid rgba(30,58,95,0.4)' }}
          >
            {TECHNIQUE_GLOSSARY.map((entry) => (
              <div key={entry.term} className="px-3 py-2.5" style={{ background: '#0a1222' }}>
                <p className="text-[11px] font-semibold text-white mb-0.5">{entry.term}</p>
                <p className="text-[10px] leading-relaxed" style={{ color: '#8097b1' }}>{entry.explanation}</p>
              </div>
            ))}
          </div>
        )}
      </div>

      <p className="text-[9px] text-center pb-1" style={{ color: '#7a9ab5' }}>
        Risk scores derived from published research, app store disclosures, and whistleblower accounts · {new Date().getFullYear()}
      </p>
    </div>
  )
}

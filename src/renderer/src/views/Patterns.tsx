import React, { useState, useEffect } from 'react'
import {
  Brain, AlertTriangle, Clock, ChevronDown, ChevronUp,
  Zap, Eye, RefreshCw, MessageSquare,
} from 'lucide-react'
import type { HeuristicAlert } from '@shared/types'
import { useTheme } from '../context/ThemeContext'

const api = (window as unknown as { electronAPI: Window['electronAPI'] }).electronAPI

interface PatternsProps {
  heuristicAlerts: HeuristicAlert[]
  onChatWith?: (msg: string) => void
}

interface PatternDef {
  type: HeuristicAlert['type']
  name: string
  icon: string
  definition: string
  signatures: string[]
  mechanism: string
  citation: string
  detectionCriteria: string
  severity: 'low' | 'medium' | 'high'
}

const PATTERN_TAXONOMY: PatternDef[] = [
  {
    type: 'rapid-switching',
    name: 'Rapid App-Switching',
    icon: '⚡',
    definition: 'Compulsive cycling between applications at a rate incompatible with sustained cognitive work.',
    signatures: ['20+ window switches in 20 minutes', 'No single app held for more than 2–3 minutes', 'Switching accelerates under stress or boredom'],
    mechanism: 'Each switch triggers a micro-dose of novelty — a low-intensity dopamine hit. The brain learns that switching relieves discomfort, reinforcing the behavior independent of any productive outcome.',
    citation: 'Gloria Mark (UC Irvine): average cost of a distraction is 23 min to fully regain focus. Knowledge workers switch tasks every 3 min on average.',
    detectionCriteria: '> 20 switches in a 20-min window AND > 5 more than the previous check cycle.',
    severity: 'medium',
  },
  {
    type: 'repeated-visits',
    name: 'Compulsive Checking',
    icon: '🔄',
    definition: 'Returning to the same distraction site multiple times in a short window with no new information available.',
    signatures: ['5+ visits to the same domain in 20 minutes', 'Each visit is brief (under 2 min)', 'Visits cluster around boredom or cognitive load spikes'],
    mechanism: 'Variable-reward conditioning — the same mechanism as slot machines. Refreshing Twitter/Reddit occasionally yields a novel post (reward), making every refresh feel potentially rewarding. The brain cannot resist.',
    citation: "BF Skinner's variable-ratio reinforcement schedule produces the highest and most resistant response rates of any conditioning paradigm.",
    detectionCriteria: '≥ 5 visits to the same distraction domain within 20 minutes.',
    severity: 'high',
  },
  {
    type: 'late-night',
    name: 'Late-Night Doomscrolling',
    icon: '🌙',
    definition: 'Passive consumption of stimulating content (news, social feeds, video) after 11 PM, compromising sleep architecture.',
    signatures: ['Browser active after 23:00', 'Session length > 20 min', 'Content is emotionally activating (news, conflict, drama)'],
    mechanism: 'Blue light suppresses melatonin; stimulating content raises cortisol. The combination delays sleep onset and reduces deep-sleep stages. Tomorrow\'s executive function and attention are directly impaired.',
    citation: 'Matthew Walker (2017): adults who sleep < 7h show 20–40% reduction in prefrontal cortex function — the area responsible for impulse control and focus.',
    detectionCriteria: 'Hour is 23:00–04:00, ≥ 3 browser sessions in the last 20 min, not already alerted in the last 30 min.',
    severity: 'high',
  },
  {
    type: 'long-session',
    name: 'Feed Black Hole',
    icon: '🕳️',
    definition: 'An unbroken distraction session long enough for the original intent to be completely forgotten.',
    signatures: ['Single distraction app session > 25 minutes', 'No productive app in between', 'Session follows a clear trigger (task difficulty, notification)'],
    mechanism: 'Algorithmic feeds are designed with infinite scroll and autoplay to eliminate the natural stopping point. The question "should I continue?" is never presented. The original intent (checking one thing) is buried under 30 minutes of unintended content.',
    citation: 'YouTube autoplay drives 70% of total watch time (internal Google data, cited in multiple congressional testimonies).',
    detectionCriteria: 'Single isDistraction session > 25 min started in the last 30 min, not already alerted within 60s.',
    severity: 'medium',
  },
  {
    type: 'focus-drift',
    name: 'Focus Drift',
    icon: '🌊',
    definition: 'Gradual slide from a productive flow state into distraction without a conscious decision to stop working.',
    signatures: ['Two consecutive productive sessions followed by two distraction sessions', 'No context-switch event (notification, meeting) between them', 'Often occurs 45–90 min into a work block'],
    mechanism: 'Attention residue from a completed task (or micro-fatigue) creates a brief opening. A single distraction visit exploits that opening, and without a hard stop, each subsequent visit becomes easier to justify.',
    citation: 'Sophie Leroy (2009): "attention residue" from task-switching leaves a cognitive tax that compounds across the workday.',
    detectionCriteria: 'Last 4 recent sessions: first 2 non-distraction, last 2 distraction. Not alerted within 10 min.',
    severity: 'medium',
  },
  {
    type: 'doom-loop',
    name: 'Doom Loop',
    icon: '🔁',
    definition: 'Cycling robotically between 2–3 distraction apps with zero productive activity between them.',
    signatures: ['2–3 apps each visited 3+ times in 20 min', 'All are distraction-classified', 'No productive work interspersed', 'Cycling accelerates as each app fails to satisfy'],
    mechanism: 'Each app fails to deliver a satisfying reward, so the brain immediately seeks another. This is structurally identical to compulsive checking rituals in OCD — the behavior is self-reinforcing because it temporarily relieves the anxiety of *not* checking.',
    citation: 'Same neural circuits as OCD rituals: orbitofrontal cortex → striatum → thalamus loop (Saxena & Rauch, 2002).',
    detectionCriteria: '≥ 6 recent sessions, 2–3 apps each with ≥ 3 visits, all distraction, all sessions are in the top apps. Not alerted within 15 min.',
    severity: 'high',
  },
  {
    type: 'micro-escape',
    name: 'Micro-Escapes',
    icon: '💨',
    definition: 'Sub-90-second bursts of distraction so brief they feel harmless — but collectively create continuous partial attention.',
    signatures: ['5+ distraction opens under 90 seconds in 10 minutes', 'Each visit is too short to consume anything', 'Triggered by discomfort at any cognitive difficulty'],
    mechanism: '"Continuous partial attention" (Linda Stone): present everywhere, focused nowhere. Even brief escapes break the cognitive thread of the current task. The brain learns that discomfort can always be interrupted, which raises the activation threshold for sustained effort.',
    citation: 'Linda Stone (1997) coined "continuous partial attention" — later validated by fMRI studies showing disrupted default-mode network recovery after micro-interruptions.',
    detectionCriteria: '≥ 5 distraction sessions under 90s in the last 10 min. Not alerted within 10 min.',
    severity: 'medium',
  },
  {
    type: 'notification-fomo',
    name: 'Notification FOMO',
    icon: '🔔',
    definition: 'High-frequency checking of communication apps driven by fear of missing messages, not actual communication need.',
    signatures: ['8+ checks/hour on messaging apps', 'Most checks result in zero new messages', 'Checking accelerates when a response is expected'],
    mechanism: 'Fear of Missing Out is a manufactured anxiety — each notification badge is deliberately designed to create exactly this reflex. The checking behavior is rewarded intermittently (sometimes there *is* a message), making it extremely persistent.',
    citation: 'Average knowledge worker checks email 74 times per day (McKinsey Global Institute, 2012). Slack users average 9 hours/day with the app open.',
    detectionCriteria: 'Communication apps (discord/slack/teams/telegram/etc.) at ≥ 8 sessions/hour in a 15-min window. Not alerted within 15 min.',
    severity: 'medium',
  },
  {
    type: 'video-rabbit-hole',
    name: 'Video Rabbit Hole',
    icon: '📺',
    definition: 'Progressively longer engagement with algorithmically-served video content far beyond original intent.',
    signatures: ['> 20 min in video platform in a 35-min window', 'Content progressively diverges from initial search', 'Session has no natural endpoint'],
    mechanism: 'Autoplay eliminates the "should I watch another?" decision. Recommendation algorithms optimize for engagement (watch time), not for your goals. The content you\'re watching now bears no resemblance to what you came for.',
    citation: 'Guillaume Chaslot (ex-YouTube engineer): recommender is designed to maximize watch time, systematically directing users toward more extreme content to maintain engagement.',
    detectionCriteria: 'Browser sessions on video platform domains totalling > 20 min in the last 35 min. Not alerted within 20 min.',
    severity: 'high',
  },
  {
    type: 'phantom-checking',
    name: 'Phantom Checking',
    icon: '👻',
    definition: 'App opens so brief they serve no purpose — the behavior is automatic, executed before any conscious decision is made.',
    signatures: ['4+ app opens under 30 seconds in 10 minutes', 'User closes app immediately each time', 'Often phone-mirror behavior (checking without knowing why)'],
    mechanism: 'The checking motion has become decoupled from the intention to check. This is a conditioned reflex — the cue (boredom, stress, an idle moment) triggers the motor routine automatically. The decision comes after the action.',
    citation: 'Charles Duhigg "The Power of Habit": habits become automatic loops (cue → routine → reward) that operate below conscious awareness.',
    detectionCriteria: '≥ 4 app opens under 30 seconds in the last 10 min. Not alerted within 10 min.',
    severity: 'low',
  },
  {
    type: 'pre-task-avoidance',
    name: 'Pre-Task Avoidance',
    icon: '🚪',
    definition: 'Distraction that occurs specifically in the window before starting a known important task — procrastination with a clear trigger.',
    signatures: ['Distraction begins immediately after switching from a productive context', 'Duration tracks with task difficulty/aversion', 'Often involves "prep" tasks (email, reading) to feel productive'],
    mechanism: 'The anticipatory anxiety of starting a hard task is more aversive than the task itself. Distraction provides immediate relief. The brain learns: when a hard task is imminent, escape is available.',
    citation: 'Pychyl & Flett (2012): procrastination is primarily an emotion regulation strategy, not a time management failure.',
    detectionCriteria: 'Productive session followed immediately by distraction before any new productive work begins. [Not yet auto-detected]',
    severity: 'medium',
  },
  {
    type: 'news-anxiety',
    name: 'News Anxiety Loop',
    icon: '📰',
    definition: 'Repeated checking of news aggregators driven by hypervigilance, not information need — consuming more news increases anxiety rather than reducing it.',
    signatures: ['4+ news/aggregator visits in 15 minutes', 'Visits trigger emotional activation, not resolution', 'Checking increases after distressing headlines'],
    mechanism: 'News is optimized for threat salience — the brain\'s threat-detection system treats each headline as a potential survival concern. Checking resolves the immediate uncertainty but generates new anxiety (what else might be happening?), creating a loop.',
    citation: '74% of US adults say news causes stress, yet most check it multiple times daily (APA Stress in America, 2020).',
    detectionCriteria: '≥ 4 browser sessions on news domains in the last 15 min. Not alerted within 15 min.',
    severity: 'medium',
  },
  {
    type: 'tab-anxiety',
    name: 'Tab Anxiety',
    icon: '🗂️',
    definition: 'Accumulating large numbers of open browser tabs as a form of digital hoarding — each tab represents an unresolved intention.',
    signatures: ['20+ open tabs across browser windows', 'Tabs are rarely revisited after opening', 'New tabs are opened faster than existing ones are closed'],
    mechanism: 'Each open tab is a cognitive IOU — a promise to yourself that you\'ll return to it. The accumulation creates background anxiety and a constant sense of incompleteness. The tabs don\'t get read; they get shuffled.',
    citation: 'Tab hoarders report the same emotional profile as physical hoarders: anxiety at the thought of closing tabs, despite acknowledging they will never read most of them.',
    detectionCriteria: 'Tab count monitoring. [Not yet auto-detected — requires browser extension integration]',
    severity: 'low',
  },
]

const SEVERITY_COLOR: Record<string, string> = {
  high: '#ff6b35',
  medium: '#ffb800',
  low: '#64b5f6',
}

const SEVERITY_BG: Record<string, string> = {
  high: 'rgba(255,107,53,0.1)',
  medium: 'rgba(255,184,0,0.1)',
  low: 'rgba(100,181,246,0.1)',
}

function timeAgo(ts: number): string {
  const diff = Date.now() - ts
  if (diff < 60000) return 'just now'
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`
  return `${Math.floor(diff / 86400000)}d ago`
}

export default function Patterns({ heuristicAlerts, onChatWith }: PatternsProps): React.ReactElement {
  const { colors } = useTheme()
  const [expandedAlert, setExpandedAlert] = useState<string | null>(null)
  const [expandedPattern, setExpandedPattern] = useState<string | null>(null)
  const [allAlerts, setAllAlerts] = useState<HeuristicAlert[]>(heuristicAlerts)
  const [refreshing, setRefreshing] = useState(false)

  useEffect(() => {
    setAllAlerts(heuristicAlerts)
  }, [heuristicAlerts])

  const refresh = async (): Promise<void> => {
    setRefreshing(true)
    try {
      const data = await api.getAnalytics()
      setAllAlerts(data.heuristicAlerts)
    } finally {
      setRefreshing(false)
    }
  }

  const patternStats = new Map<string, { count: number; last: number }>()
  for (const a of allAlerts) {
    const cur = patternStats.get(a.type) ?? { count: 0, last: 0 }
    patternStats.set(a.type, { count: cur.count + 1, last: Math.max(cur.last, a.detectedAt) })
  }

  const undismissed = allAlerts.filter((a) => !a.dismissed)
  const recent = [...allAlerts].sort((a, b) => b.detectedAt - a.detectedAt).slice(0, 30)

  const handleAskAI = (): void => {
    if (!onChatWith) return
    const top3 = [...patternStats.entries()].sort((a, b) => b[1].count - a[1].count).slice(0, 3)
    const summary = top3.map(([type, s]) => {
      const def = PATTERN_TAXONOMY.find((p) => p.type === type)
      return `${def?.name ?? type} (${s.count}×)`
    }).join(', ')
    onChatWith(`My top attention patterns this session are: ${summary}. Help me understand what's driving these and give me a concrete plan to address the most frequent one.`)
  }

  return (
    <div className="flex flex-col h-full overflow-y-auto">
      {/* Header */}
      <div
        className="flex-shrink-0 flex items-center justify-between px-6 py-4"
        style={{ borderBottom: `1px solid ${colors.border}` }}
      >
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: 'rgba(255,107,53,0.12)', border: '1px solid rgba(255,107,53,0.25)' }}>
            <Brain size={17} className="text-accent-orange" />
          </div>
          <div>
            <h1 className="font-bold text-base leading-tight" style={{ color: colors.textPrimary }}>Patterns</h1>
            <p className="text-[11px]" style={{ color: colors.textSecondary }}>Named attention pathologies · {undismissed.length} active</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleAskAI}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-all hover:scale-105"
            style={{ background: 'rgba(33,150,243,0.12)', color: '#64b5f6', border: '1px solid rgba(33,150,243,0.22)' }}
          >
            <MessageSquare size={11} />
            Ask AI
          </button>
          <button
            onClick={refresh}
            disabled={refreshing}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-all hover:scale-105 disabled:opacity-50"
            style={{ background: colors.accentBg, color: colors.textSecondary, border: `1px solid ${colors.border}` }}
          >
            <RefreshCw size={11} className={refreshing ? 'animate-spin' : ''} />
            Refresh
          </button>
        </div>
      </div>

      <div className="flex flex-col gap-6 p-6">
        {/* Pattern summary chips */}
        {patternStats.size > 0 && (
          <div className="flex flex-wrap gap-2">
            {[...patternStats.entries()].sort((a, b) => b[1].count - a[1].count).map(([type, stats]) => {
              const def = PATTERN_TAXONOMY.find((p) => p.type === type)
              if (!def) return null
              return (
                <button
                  key={type}
                  onClick={() => setExpandedPattern(expandedPattern === type ? null : type)}
                  className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium transition-all hover:scale-105"
                  style={{
                    background: SEVERITY_BG[def.severity],
                    border: `1px solid ${SEVERITY_COLOR[def.severity]}44`,
                    color: SEVERITY_COLOR[def.severity],
                  }}
                  title={def.definition}
                >
                  <span>{def.icon}</span>
                  <span>{def.name}</span>
                  <span
                    className="w-4 h-4 rounded-full flex items-center justify-center text-[9px] font-bold"
                    style={{ background: `${SEVERITY_COLOR[def.severity]}33`, color: SEVERITY_COLOR[def.severity] }}
                  >
                    {stats.count}
                  </span>
                </button>
              )
            })}
          </div>
        )}

        {/* Alert timeline */}
        <section>
          <h2 className="text-sm font-semibold mb-3 flex items-center gap-2" style={{ color: colors.textPrimary }}>
            <Clock size={14} style={{ color: colors.textSecondary }} />
            Detected This Session
            {recent.length === 0 && <span className="text-xs font-normal ml-1" style={{ color: colors.textSecondary }}>— none yet</span>}
          </h2>
          {recent.length > 0 ? (
            <div className="flex flex-col gap-1.5">
              {recent.map((alert) => (
                <div
                  key={alert.id}
                  className="rounded-xl overflow-hidden"
                  style={{
                    border: `1px solid ${alert.dismissed ? colors.border : `${SEVERITY_COLOR[alert.severity]}33`}`,
                    background: alert.dismissed ? colors.cardBg : SEVERITY_BG[alert.severity],
                    opacity: alert.dismissed ? 0.55 : 1,
                  }}
                >
                  <button
                    className="w-full flex items-center gap-3 px-4 py-2.5 text-left"
                    onClick={() => setExpandedAlert(expandedAlert === alert.id ? null : alert.id)}
                  >
                    <div
                      className="w-1.5 h-1.5 rounded-full flex-shrink-0"
                      style={{ background: alert.dismissed ? colors.border : SEVERITY_COLOR[alert.severity] }}
                    />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="text-xs font-medium truncate" style={{ color: colors.textPrimary }}>{alert.title}</p>
                        {alert.switchRate !== undefined && (
                          <span className="text-[10px]" style={{ color: colors.textSecondary }}>{alert.switchRate}/h</span>
                        )}
                      </div>
                    </div>
                    <span className="text-[10px] flex-shrink-0" style={{ color: colors.textSecondary }}>{timeAgo(alert.detectedAt)}</span>
                    <span
                      className="text-[9px] font-semibold px-1.5 py-0.5 rounded-full flex-shrink-0"
                      style={{ background: `${SEVERITY_COLOR[alert.severity]}22`, color: SEVERITY_COLOR[alert.severity] }}
                    >
                      {alert.severity}
                    </span>
                    {expandedAlert === alert.id
                      ? <ChevronUp size={12} className="flex-shrink-0" style={{ color: colors.textSecondary }} />
                      : <ChevronDown size={12} className="flex-shrink-0" style={{ color: colors.textSecondary }} />}
                  </button>
                  {expandedAlert === alert.id && (
                    <div className="px-4 pb-3 flex flex-col gap-2">
                      <p className="text-xs leading-relaxed" style={{ color: colors.textSecondary }}>{alert.description}</p>
                      {alert.app && (
                        <p className="text-[11px]" style={{ color: colors.textSecondary }}>Source: <span style={{ color: colors.textPrimary }}>{alert.app}</span></p>
                      )}
                      <div className="flex items-center gap-2 mt-0.5">
                        <button
                          onClick={() => onChatWith?.(`I just got a "${alert.title}" alert. ${alert.description} Help me address this right now.`)}
                          className="flex items-center gap-1 text-accent-blue text-[11px] hover:underline"
                        >
                          <MessageSquare size={10} />
                          Ask AI for help
                        </button>
                        <span className="text-[10px]" style={{ color: colors.textSecondary }}>
                          {new Date(alert.detectedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </span>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <div
              className="rounded-xl flex flex-col items-center justify-center py-8 text-center"
              style={{ background: colors.cardBg, border: `1px solid ${colors.border}` }}
            >
              <Eye size={20} className="mb-2" style={{ color: colors.textSecondary }} />
              <p className="text-xs" style={{ color: colors.textSecondary }}>No patterns detected yet this session.</p>
              <p className="text-[10px] mt-1" style={{ color: colors.textSecondary }}>Patterns appear here as you work — Attentify watches quietly.</p>
            </div>
          )}
        </section>

        {/* Full taxonomy */}
        <section>
          <h2 className="text-sm font-semibold mb-1 flex items-center gap-2" style={{ color: colors.textPrimary }}>
            <Brain size={14} style={{ color: colors.textSecondary }} />
            Pattern Taxonomy
          </h2>
          <p className="text-xs mb-3" style={{ color: colors.textSecondary }}>13 named attention pathologies — definitions, mechanisms, and detection criteria.</p>
          <div className="flex flex-col gap-1.5">
            {PATTERN_TAXONOMY.map((pattern) => {
              const stats = patternStats.get(pattern.type)
              const isExpanded = expandedPattern === pattern.type
              return (
                <div
                  key={pattern.type}
                  className="rounded-xl overflow-hidden"
                  style={{
                    border: `1px solid ${stats ? `${SEVERITY_COLOR[pattern.severity]}33` : colors.border}`,
                    background: stats ? SEVERITY_BG[pattern.severity] : colors.cardBg,
                  }}
                >
                  <button
                    className="w-full flex items-center gap-3 px-4 py-3 text-left"
                    onClick={() => setExpandedPattern(isExpanded ? null : pattern.type)}
                  >
                    <span className="text-base flex-shrink-0 w-6">{pattern.icon}</span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="text-xs font-semibold" style={{ color: colors.textPrimary }}>{pattern.name}</p>
                        <span
                          className="text-[9px] font-semibold px-1.5 py-0.5 rounded-full"
                          style={{ background: `${SEVERITY_COLOR[pattern.severity]}22`, color: SEVERITY_COLOR[pattern.severity] }}
                        >
                          {pattern.severity}
                        </span>
                        {stats && (
                          <span className="text-[10px]" style={{ color: colors.textSecondary }}>
                            Detected {stats.count}× · last {timeAgo(stats.last)}
                          </span>
                        )}
                      </div>
                      {!isExpanded && (
                        <p className="text-[11px] mt-0.5 truncate" style={{ color: colors.textSecondary }}>{pattern.definition}</p>
                      )}
                    </div>
                    {isExpanded
                      ? <ChevronUp size={13} className="flex-shrink-0" style={{ color: colors.textSecondary }} />
                      : <ChevronDown size={13} className="flex-shrink-0" style={{ color: colors.textSecondary }} />}
                  </button>

                  {isExpanded && (
                    <div className="px-4 pb-4 flex flex-col gap-3">
                      <p className="text-xs leading-relaxed" style={{ color: colors.textSecondary }}>{pattern.definition}</p>

                      <div>
                        <p className="text-[10px] font-semibold uppercase tracking-wider mb-1.5" style={{ color: colors.textSecondary }}>Behavioral Signatures</p>
                        <ul className="flex flex-col gap-1">
                          {pattern.signatures.map((sig, i) => (
                            <li key={i} className="flex items-start gap-2 text-[11px]" style={{ color: colors.textSecondary }}>
                              <Zap size={10} className="mt-0.5 flex-shrink-0" style={{ color: colors.textMuted }} />
                              {sig}
                            </li>
                          ))}
                        </ul>
                      </div>

                      <div>
                        <p className="text-[10px] font-semibold uppercase tracking-wider mb-1" style={{ color: colors.textSecondary }}>Mechanism</p>
                        <p className="text-[11px] leading-relaxed" style={{ color: colors.textSecondary }}>{pattern.mechanism}</p>
                      </div>

                      <div>
                        <p className="text-[10px] font-semibold uppercase tracking-wider mb-1" style={{ color: colors.textSecondary }}>Research</p>
                        <p className="text-[11px] italic leading-relaxed" style={{ color: colors.textSecondary }}>{pattern.citation}</p>
                      </div>

                      <div>
                        <p className="text-[10px] font-semibold uppercase tracking-wider mb-1" style={{ color: colors.textSecondary }}>Detection Criteria</p>
                        <p className="text-[11px] font-mono leading-relaxed" style={{ color: colors.textSecondary }}>{pattern.detectionCriteria}</p>
                      </div>

                      <div className="flex items-center gap-2 pt-1">
                        <button
                          onClick={() => onChatWith?.(`Tell me more about the "${pattern.name}" pattern and what I can do to break this habit.`)}
                          className="flex items-center gap-1 text-accent-blue text-[11px] hover:underline"
                        >
                          <MessageSquare size={10} />
                          Ask AI about this pattern
                        </button>
                        {stats && (
                          <span className="text-[10px]" style={{ color: colors.textSecondary }}>
                            · detected {stats.count} time{stats.count !== 1 ? 's' : ''} this session
                          </span>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </section>

        <div className="flex-shrink-0 h-4" />
      </div>
    </div>
  )
}

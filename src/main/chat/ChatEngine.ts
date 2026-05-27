import type { ChatAction, AppStore } from '../../shared/types'
import { parseCommand, buildActions } from './commandParser'

export interface ChatResponse {
  reply: string
  actions: ChatAction[]
}

interface TrackingData {
  sessions: { app: string; duration: number; isDistraction: boolean }[]
  timePerApp: Record<string, number>
}

function formatDuration(ms: number): string {
  const h = Math.floor(ms / 3600000)
  const m = Math.floor((ms % 3600000) / 60000)
  if (h > 0 && m > 0) return `${h}h ${m}m`
  if (h > 0) return `${h} hour${h !== 1 ? 's' : ''}`
  return `${m} minute${m !== 1 ? 's' : ''}`
}

function topDistractors(tracking: TrackingData): string {
  const distracting = Object.entries(tracking.timePerApp)
    .filter(([app]) => tracking.sessions.some((s) => s.app === app && s.isDistraction))
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
  if (distracting.length === 0) {
    // Fall back to top apps overall
    return Object.entries(tracking.timePerApp)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([app, ms]) => `${app} (${formatDuration(ms)})`)
      .join(', ')
  }
  return distracting.map(([app, ms]) => `${app} (${formatDuration(ms)})`).join(', ')
}

function buildContextSummary(store: AppStore, tracking: TrackingData): string {
  const active = store.sessions.find((s) => s.active)
  const blockCount = store.blocklist.domains.length + store.blocklist.processes.length
  const sessionInfo = active ? `You're in a ${active.mode === 'deep' ? 'deep focus' : 'focus'} session.` : ''
  const blockInfo = blockCount > 0 ? `${blockCount} distractions currently blocked.` : 'No active blocks.'
  return `${sessionInfo} ${blockInfo}`.trim()
}

export function processMessage(text: string, store: AppStore, tracking: TrackingData = { sessions: [], timePerApp: {} }): ChatResponse {
  const cmd = parseCommand(text)
  const actions = buildActions(cmd)

  switch (cmd.intent) {
    case 'block': {
      if (!cmd.target) {
        return { reply: "I'm not sure what to block. Try: **Block Twitter for 2 hours** or **Block Instagram**.", actions: [] }
      }
      const duration = cmd.durationMs ? ` for ${formatDuration(cmd.durationMs)}` : ' until you end the session'
      return {
        reply: `Blocking **${cmd.target}**${duration}. I've added it to your hosts file and flushed DNS. The site is inaccessible now.\n\n_${buildContextSummary(store, tracking)}_`,
        actions,
      }
    }

    case 'unblock': {
      if (!cmd.target) {
        return { reply: "Which site or app would you like to unblock? You'll need to give me a reason first.", actions: [] }
      }
      return {
        reply: `Before I unblock **${cmd.target}**, tell me: what specifically do you need it for right now? I'll evaluate your reason.`,
        actions: [],
      }
    }

    case 'start_session': {
      const duration = cmd.durationMs ? ` for ${formatDuration(cmd.durationMs)}` : ''
      return {
        reply: `Starting a focus session${duration}. Your blocklist is active, DoH bypasses are blocked. Let's work.\n\n_Tip: tell me your goal so I can block the right things._`,
        actions,
      }
    }

    case 'deep_focus': {
      const duration = cmd.durationMs ? ` for ${formatDuration(cmd.durationMs)}` : ''
      return {
        reply: `Entering **Deep Focus Mode**${duration}. Everything except your allowlist is blocked at the network layer. No bypasses. No mercy.\n\n_The only way out is through your work._`,
        actions,
      }
    }

    case 'stop_session': {
      return {
        reply: `Ending your focus session. Blocks deactivated. How did it go?\n\n_${buildContextSummary(store, tracking)}_`,
        actions,
      }
    }

    case 'query_stats': {
      const top = topDistractors(tracking)
      if (!top) {
        return {
          reply: "No tracking data yet — activity tracking starts collecting data in the background. Check back in a few minutes, or run a Focus Scan for an immediate snapshot.",
          actions: [],
        }
      }
      const focusedMs = tracking.sessions.filter((s) => !s.isDistraction).reduce((sum, s) => sum + s.duration, 0)
      const distMs = tracking.sessions.filter((s) => s.isDistraction).reduce((sum, s) => sum + s.duration, 0)
      return {
        reply: `**This week's attention data:**\n\n• Focused time: ${formatDuration(focusedMs)}\n• Distracted time: ${formatDuration(distMs)}\n• Biggest drains: ${top}\n\nWant me to block any of these?`,
        actions,
      }
    }

    case 'set_goal': {
      return {
        reply: `Got it. I'll optimize your protection around that goal. I'll block things that conflict with it and leave your focus tools accessible.\n\nTell me: what sites or apps tend to pull you away from **${cmd.target ?? 'your goal'}**?`,
        actions,
      }
    }

    default: {
      const ctx = buildContextSummary(store, tracking)
      const suggestions = [
        `I can block sites, start focus sessions, or analyze your distraction patterns.\n\nTry:\n• _"Block Reddit for 3 hours"_\n• _"Start a deep focus session until 6pm"_\n• _"What's distracting me most this week?"_\n• _"I'm writing a report, block everything social"_${ctx ? `\n\n_${ctx}_` : ''}`,
        `Tell me what you're trying to accomplish and I'll configure everything else.\n\n_"I need to write code until 5pm"_ → I'll block Discord, social media, news.\n_"Deep focus for 90 minutes"_ → Full lockdown mode.\n\n${ctx ? `_${ctx}_` : ''}`,
      ]
      return { reply: suggestions[Math.floor(Math.random() * suggestions.length)]!, actions: [] }
    }
  }
}

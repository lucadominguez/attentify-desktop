import type { ChatAction } from '../../shared/types'

interface ParsedCommand {
  intent: 'block' | 'unblock' | 'start_session' | 'stop_session' | 'query_stats' | 'deep_focus' | 'set_goal' | 'unknown'
  target?: string
  durationMs?: number
  mode?: 'normal' | 'deep'
}

function parseDuration(text: string): number | undefined {
  const untilMatch = text.match(/until\s+(\d{1,2}):?(\d{2})?\s*(am|pm)?/i)
  if (untilMatch) {
    const now = new Date()
    let h = parseInt(untilMatch[1]!, 10)
    const m = parseInt(untilMatch[2] ?? '0', 10)
    const ampm = untilMatch[3]?.toLowerCase()
    if (ampm === 'pm' && h < 12) h += 12
    if (ampm === 'am' && h === 12) h = 0
    const target = new Date(now)
    target.setHours(h, m, 0, 0)
    if (target <= now) target.setDate(target.getDate() + 1)
    return target.getTime() - now.getTime()
  }
  let ms = 0
  const hourMatch = text.match(/(\d+(?:\.\d+)?)\s*h(?:our)?s?/i)
  const minMatch = text.match(/(\d+)\s*m(?:in(?:ute)?s?)?(?!\s*[\w])/i)
  if (hourMatch) ms += parseFloat(hourMatch[1]!) * 3600000
  if (minMatch) ms += parseInt(minMatch[1]!, 10) * 60000
  return ms > 0 ? ms : undefined
}

function extractTarget(text: string): string | undefined {
  const domainMatch = text.match(/\b([a-z0-9]([a-z0-9-]*[a-z0-9])?\.(?:com|net|org|io|co|app|tv|me|us|info|ai|dev|xyz))\b/i)
  if (domainMatch) return domainMatch[1]!.toLowerCase()

  const known: Record<string, string> = {
    twitter: 'twitter.com', 'x.com': 'x.com', 'x ': 'x.com',
    instagram: 'instagram.com', tiktok: 'tiktok.com', youtube: 'youtube.com',
    reddit: 'reddit.com', facebook: 'facebook.com', discord: 'discord.com',
    slack: 'slack.com', netflix: 'netflix.com', twitch: 'twitch.tv',
    linkedin: 'linkedin.com', snapchat: 'snapchat.com', 'hacker news': 'news.ycombinator.com',
    hn: 'news.ycombinator.com', pinterest: 'pinterest.com', '9gag': '9gag.com',
    tumblr: 'tumblr.com', spotify: 'open.spotify.com',
  }
  const lower = text.toLowerCase()
  for (const [key, val] of Object.entries(known)) {
    if (lower.includes(key)) return val
  }
  return undefined
}

function extractGoal(text: string): string | undefined {
  const match = text.match(/(?:working on|writing|coding|studying|focus on|need to)\s+(.+?)(?:\s+until|\s+for|$)/i)
  return match?.[1]?.trim()
}

export function parseCommand(text: string): ParsedCommand {
  const lower = text.toLowerCase()

  if (/\b(block|ban|restrict|stop|prevent|hide|blacklist)\b/.test(lower)) {
    return { intent: 'block', target: extractTarget(text), durationMs: parseDuration(text) }
  }

  if (/\b(unblock|allow|re-enable|restore|whitelist|open)\b/.test(lower)) {
    return { intent: 'unblock', target: extractTarget(text) }
  }

  if (/\b(deep focus|hardcore|lockdown|lock.?down|strict mode|no.?mercy)\b/.test(lower)) {
    return { intent: 'deep_focus', durationMs: parseDuration(text), mode: 'deep' }
  }

  if (/\b(start|begin|focus|writing|working|studying|coding|i'm|i need to|pomodoro)\b/.test(lower) &&
    !/\b(unblock|stop|end)\b/.test(lower)) {
    return { intent: 'start_session', durationMs: parseDuration(text), mode: 'normal', target: extractGoal(text) }
  }

  if (/\b(stop|end|finish|done|quit|cancel|disable)\b.*(session|focus|block|mode)/i.test(lower)) {
    return { intent: 'stop_session' }
  }

  if (/\b(what|how much|show|report|stats|analytics|distract|week|time|most|biggest|worst|usage|data)\b/.test(lower)) {
    return { intent: 'query_stats' }
  }

  if (/\b(goal|working on|focus on|i need to|trying to|want to|task|project)\b/.test(lower)) {
    return { intent: 'set_goal', target: extractGoal(text) }
  }

  return { intent: 'unknown' }
}

export function buildActions(cmd: ParsedCommand): ChatAction[] {
  const actions: ChatAction[] = []
  switch (cmd.intent) {
    case 'block':
      if (cmd.target) actions.push({ type: 'block', payload: { domain: cmd.target, durationMs: cmd.durationMs } })
      break
    case 'unblock':
      if (cmd.target) actions.push({ type: 'unblock', payload: { domain: cmd.target } })
      break
    case 'start_session':
    case 'deep_focus':
      actions.push({ type: 'start-session', payload: { mode: cmd.mode ?? 'normal', durationMs: cmd.durationMs } })
      break
    case 'stop_session':
      actions.push({ type: 'stop-session', payload: {} })
      break
    case 'query_stats':
      actions.push({ type: 'show-stats', payload: {} })
      break
  }
  return actions
}

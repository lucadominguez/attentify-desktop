import type { DbGoal, DbPreference, DbInference } from '../data/repository'
import type { ActivitySession } from '../../shared/types'

export interface SystemContext {
  goals: DbGoal[]
  preferences: DbPreference[]
  pendingInferences: DbInference[]
  activeBlocks: { domains: string[]; processes: string[] }
  activeSessionMode: string | null
  todayFocusedMs: number
  todayDistractedMs: number
  topDistractionApp: string | null
  recentSessions: ActivitySession[]
  currentUrl?: string | null
  recentUrls?: string[]
  recentSearches?: string[]
}

function fmtMs(ms: number): string {
  const h = Math.floor(ms / 3600000)
  const m = Math.floor((ms % 3600000) / 60000)
  if (h > 0 && m > 0) return `${h}h ${m}m`
  if (h > 0) return `${h}h`
  if (m > 0) return `${m}m`
  return '<1m'
}

export function buildSystemPrompt(ctx: SystemContext): string {
  const now = new Date()
  const timeStr = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  const dateStr = now.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' })
  const hour = now.getHours()
  const isNight = hour >= 22 || hour < 6
  const isMorning = hour >= 6 && hour < 12

  const goalLines = ctx.goals.length > 0
    ? ctx.goals.map((g) => `  - ${g.text}${g.priority > 0 ? ` [priority ${g.priority}]` : ''}`).join('\n')
    : '  (none set — ask the user what they are working on)'

  const prefLines = ctx.preferences.length > 0
    ? ctx.preferences.slice(0, 10).map((p) => `  - ${p.key}: ${p.value} [${p.scope}]`).join('\n')
    : '  (none recorded yet)'

  const blockLines =
    ctx.activeBlocks.domains.length + ctx.activeBlocks.processes.length > 0
      ? [
          ...ctx.activeBlocks.domains.map((d) => `  - domain: ${d}`),
          ...ctx.activeBlocks.processes.map((p) => `  - process: ${p}`),
        ].join('\n')
      : '  (nothing blocked — the user is unprotected)'

  const inferenceLines =
    ctx.pendingInferences.length > 0
      ? ctx.pendingInferences
          .slice(0, 5)
          .map((i) => `  - ${i.value} (${Math.round(i.confidence * 100)}% confidence) — ${i.reasoning ?? 'pattern detected'}`)
          .join('\n')
      : '  (none)'

  const distractionRatio =
    ctx.todayFocusedMs + ctx.todayDistractedMs > 0
      ? Math.round((ctx.todayDistractedMs / (ctx.todayFocusedMs + ctx.todayDistractedMs)) * 100)
      : 0

  // Recent activity: deduplicated app list from last 10 sessions
  const recentApps = ctx.recentSessions
    .slice(-10)
    .map((s) => s.app)
    .filter((v, i, a) => a.indexOf(v) === i)
    .slice(0, 6)

  // Last 5 distraction sessions with duration
  const recentDistractions = ctx.recentSessions
    .filter((s) => s.isDistraction)
    .slice(-5)
    .map((s) => `${s.app}${s.title ? ` (${s.title.slice(0, 50)})` : ''} — ${fmtMs(s.duration)}`)

  const urlSection =
    ctx.currentUrl || (ctx.recentUrls && ctx.recentUrls.length > 0) || (ctx.recentSearches && ctx.recentSearches.length > 0)
      ? `
## Live Browser Activity
${ctx.currentUrl ? `- Current URL: ${ctx.currentUrl}` : ''}
${ctx.recentUrls && ctx.recentUrls.length > 0 ? `- Recent URLs (newest first):\n${ctx.recentUrls.slice(0, 8).map((u) => `    ${u}`).join('\n')}` : ''}
${ctx.recentSearches && ctx.recentSearches.length > 0 ? `- Recent searches: ${ctx.recentSearches.slice(0, 6).join(' | ')}` : ''}`
      : ''

  return `You are the Productivity Daemon — a persistent focus-protection AI running 24/7 on the user's computer.

CRITICAL — read this before every response:
The app has a CONTINUOUS background monitor that ALREADY tracks everything: every app switch, every URL visited, every search query, every window title change — all written to a local SQLite database in real time. You are the reasoning and action layer on top of that data. You do NOT need to explain that monitoring is limited — it isn't. The monitoring never stops. You have full access to it via your tools. Never tell the user you can't see their activity or that you need them to share it — you already have it. If you need more detail, call get_recent_events or get_analytics.

Current time: ${timeStr} on ${dateStr}${isNight ? ' ⚠ LATE NIGHT — flag this' : isMorning ? ' (morning — prime focus window)' : ''}

## Today's Activity (live data)
- Focused time: ${fmtMs(ctx.todayFocusedMs)}
- Distracted time: ${fmtMs(ctx.todayDistractedMs)}
- Distraction ratio: ${distractionRatio}%${ctx.topDistractionApp ? `  ← top offender: **${ctx.topDistractionApp}**` : ''}
- Focus session: ${ctx.activeSessionMode ? ctx.activeSessionMode + ' mode ACTIVE' : 'none running'}
- Recent apps: ${recentApps.join(', ') || 'none observed yet'}
${recentDistractions.length > 0 ? `- Recent distractions:\n${recentDistractions.map((d) => `    ${d}`).join('\n')}` : ''}
${urlSection}

## User's Goals
${goalLines}

## Learned Preferences
${prefLines}

## Currently Blocked
${blockLines}

## Inference Engine — Novel Distractions Detected
${inferenceLines}

## What You Can Do
- Block/unblock domains and processes right now
- Block entire categories (social_media, video, news, gaming, shopping, gambling, dating, crypto, forums_aggregators)
- Start/stop focus sessions (normal or deep)
- Add, view, clear goals
- Read full activity logs, analytics, behavioral patterns
- Manage preferences the engine has learned
- Confirm or reject inference suggestions

## How to Behave
1. Be direct and terse. No filler ("Of course!", "Great idea!"). Just do it and report.
2. Block first, confirm after — never ask "are you sure?" for clear requests.
3. After using a tool, say what you did in one sentence, then one sentence of context if useful.
4. Proactively surface inferences — if the engine flagged something, tell the user and offer to block it.
5. Distraction ratio above 40%? Say so once, offer a concrete fix.
6. Never fabricate numbers — only report what tools return.
7. Never say you "can't monitor" or "can't see" activity — you can always see it via tools. Don't explain limitations that don't exist.
8. Use **bold** for domain/app names. Prose only — bullet lists only when listing 3+ items.
9. If the user says something like "keep me honest" or "watch me" — they mean use the data you're already collecting. Pull get_recent_events and summarize what you see.`
}

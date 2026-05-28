import type Anthropic from '@anthropic-ai/sdk'
import type { BlockingEngine } from '../blocking/BlockingEngine'
import type { ActivityTracker } from '../tracking/ActivityTracker'
import type { HeuristicEngine } from '../heuristics/HeuristicEngine'
import type { MonitorService } from '../monitoring/MonitorService'
import {
  insertGoal, getActiveGoals, clearGoal,
  upsertPreference, getPreferences, deletePreference,
  getPatterns, getRecentEvents, getInferences, resolveInference,
  getTopAppsByTime, getHourlyBreakdown,
  type DbPreference,
} from '../data/repository'
import { getStore, patchStore } from '../store'
import { randomUUID } from 'crypto'

// ── Category domain taxonomy (~200 domains) ────────────────────────────────────

export const CATEGORY_DOMAINS: Record<string, string[]> = {
  social_media: [
    'twitter.com', 'x.com', 'instagram.com', 'facebook.com', 'tiktok.com',
    'snapchat.com', 'pinterest.com', 'tumblr.com', 'reddit.com', 'threads.net',
    'mastodon.social', 'bsky.app', 'weibo.com', 'vk.com', 'linkedin.com',
    'myspace.com', 'quora.com', 'clubhouse.com', 'bereal.com', 'lemon8-app.com',
  ],
  video: [
    'youtube.com', 'youtu.be', 'twitch.tv', 'netflix.com', 'hulu.com',
    'disneyplus.com', 'primevideo.com', 'hbomax.com', 'max.com', 'peacocktv.com',
    'paramountplus.com', 'crunchyroll.com', 'funimation.com', 'vimeo.com',
    'dailymotion.com', 'bilibili.com', 'kick.com', 'trovo.live', 'rumble.com',
    'odysee.com', 'bitchute.com', 'brighteon.com', 'curiositystream.com',
    'mubi.com', 'tubi.tv', 'pluto.tv', 'vudu.com', 'starz.com', 'showtime.com',
  ],
  news_tabloids: [
    'buzzfeed.com', 'dailymail.co.uk', 'tmz.com', 'huffpost.com', 'vice.com',
    'theonion.com', 'clickhole.com', 'upworthy.com', 'boredpanda.com',
    'viralnova.com', 'distractify.com', 'ladbible.com', 'unilad.com',
    '9gag.com', 'ifunny.co', 'memedroid.com', 'cheezburger.com',
    'fark.com', 'cracked.com', 'collegehumor.com', 'thechive.com',
    'complex.com', 'hypebeast.com', 'highsnobiety.com',
  ],
  news_general: [
    'cnn.com', 'foxnews.com', 'msnbc.com', 'bbc.com', 'theguardian.com',
    'nytimes.com', 'washingtonpost.com', 'wsj.com', 'theatlantic.com',
    'politico.com', 'axios.com', 'thehill.com', 'breitbart.com',
    'newsweek.com', 'usatoday.com', 'nbcnews.com', 'abcnews.go.com',
    'cbsnews.com', 'apnews.com', 'reuters.com', 'bloomberg.com',
    'techcrunch.com', 'theverge.com', 'engadget.com', 'gizmodo.com',
    'wired.com', 'arstechnica.com',
  ],
  forums_aggregators: [
    'reddit.com', 'news.ycombinator.com', '4chan.org', '8kun.top',
    'digg.com', 'stumbleupon.com', 'flipboard.com', 'imgur.com',
    'slashdot.org', 'lobste.rs', 'tildes.net', 'voat.co',
    'saidit.net', 'lemmy.ml', 'kbin.social',
  ],
  gaming: [
    'chess.com', 'lichess.org', 'miniclip.com', 'kongregate.com',
    'addictinggames.com', 'friv.com', 'coolmathgames.com', 'poki.com',
    'armorgames.com', 'newgrounds.com', 'gamejolt.com', 'itch.io',
    'steampowered.com', 'store.steampowered.com', 'epicgames.com',
    'gog.com', 'humble bundle.com', 'fanatical.com', 'greenmangaming.com',
    'playstation.com', 'xbox.com', 'nintendo.com', 'battlenet.com',
  ],
  shopping: [
    'amazon.com', 'ebay.com', 'etsy.com', 'aliexpress.com', 'wish.com',
    'shein.com', 'temu.com', 'walmart.com', 'target.com', 'bestbuy.com',
    'costco.com', 'overstock.com', 'zappos.com', 'chewy.com',
    'wayfair.com', 'homedepot.com', 'lowes.com', 'ikea.com',
    'asos.com', 'boohoo.com', 'fashionnova.com', 'prettylittlething.com',
    'zara.com', 'hm.com', 'uniqlo.com',
  ],
  gambling: [
    'draftkings.com', 'fanduel.com', 'betmgm.com', 'caesars.com',
    'pointsbet.com', 'barstoolsportsbook.com', 'bet365.com',
    'williamhill.com', 'paddy power.com', 'ladbrokes.com',
    'pokerstars.com', 'partypoker.com', '888poker.com',
  ],
  dating: [
    'tinder.com', 'bumble.com', 'hinge.co', 'okcupid.com', 'match.com',
    'pof.com', 'eharmony.com', 'zoosk.com', 'grindr.com', 'scruff.com',
    'feeld.co', 'her.app',
  ],
  crypto: [
    'coinbase.com', 'binance.com', 'kraken.com', 'gemini.com',
    'crypto.com', 'ftx.com', 'bybit.com', 'okx.com', 'kucoin.com',
    'coinmarketcap.com', 'coingecko.com', 'dextools.io',
  ],
}

// ── Tool definitions ──────────────────────────────────────────────────────────

export const TOOL_DEFINITIONS: Anthropic.Tool[] = [
  {
    name: 'block_domain',
    description: 'Block a website domain. Call this immediately when the user asks to block a site.',
    input_schema: {
      type: 'object' as const,
      properties: {
        domain: { type: 'string', description: 'Domain to block, e.g. "youtube.com"' },
        duration_minutes: { type: 'number', description: 'Duration in minutes. Omit for permanent.' },
        reason: { type: 'string', description: 'Brief reason for blocking' },
      },
      required: ['domain'],
    },
  },
  {
    name: 'unblock_domain',
    description: 'Remove a domain from the blocklist.',
    input_schema: {
      type: 'object' as const,
      properties: {
        domain: { type: 'string', description: 'Domain to unblock' },
      },
      required: ['domain'],
    },
  },
  {
    name: 'block_process',
    description: 'Block an app/process by executable name.',
    input_schema: {
      type: 'object' as const,
      properties: {
        process_name: { type: 'string', description: 'Process name to block, e.g. "steam"' },
        duration_minutes: { type: 'number', description: 'Duration in minutes. Omit for permanent.' },
      },
      required: ['process_name'],
    },
  },
  {
    name: 'unblock_process',
    description: 'Remove a process from the blocklist.',
    input_schema: {
      type: 'object' as const,
      properties: {
        process_name: { type: 'string', description: 'Process name to unblock' },
      },
      required: ['process_name'],
    },
  },
  {
    name: 'block_category',
    description: `Block all domains in a category. Available categories: ${Object.keys(CATEGORY_DOMAINS).join(', ')}`,
    input_schema: {
      type: 'object' as const,
      properties: {
        category: {
          type: 'string',
          enum: Object.keys(CATEGORY_DOMAINS),
          description: 'Category to block',
        },
        duration_minutes: { type: 'number', description: 'Duration in minutes. Omit for permanent.' },
      },
      required: ['category'],
    },
  },
  {
    name: 'get_active_blocks',
    description: 'Get the current list of blocked domains and processes.',
    input_schema: {
      type: 'object' as const,
      properties: {},
    },
  },
  {
    name: 'start_focus_session',
    description: 'Start a focus session to activate the blocking engine.',
    input_schema: {
      type: 'object' as const,
      properties: {
        mode: {
          type: 'string',
          enum: ['normal', 'deep'],
          description: '"normal" = standard blocking. "deep" = strict mode with no bypass.',
        },
        duration_minutes: { type: 'number', description: 'Session length. Omit for open-ended.' },
      },
      required: ['mode'],
    },
  },
  {
    name: 'stop_focus_session',
    description: 'Stop the currently active focus session.',
    input_schema: {
      type: 'object' as const,
      properties: {},
    },
  },
  {
    name: 'get_analytics',
    description: 'Get today\'s and this week\'s focus analytics: focused time, distracted time, top apps.',
    input_schema: {
      type: 'object' as const,
      properties: {
        period: {
          type: 'string',
          enum: ['today', 'week', 'both'],
          description: 'Which period to retrieve',
        },
      },
    },
  },
  {
    name: 'get_recent_events',
    description: 'Get the raw activity event log for the last N minutes.',
    input_schema: {
      type: 'object' as const,
      properties: {
        minutes: { type: 'number', description: 'How many minutes back to look (default 30, max 240)' },
      },
    },
  },
  {
    name: 'get_patterns',
    description: 'Get detected behavioral patterns (rapid switching, doom-looping, etc.).',
    input_schema: {
      type: 'object' as const,
      properties: {
        hours: { type: 'number', description: 'Look back window in hours (default 24)' },
        active_only: { type: 'boolean', description: 'Only return undismissed patterns' },
      },
    },
  },
  {
    name: 'get_goals',
    description: 'Get the user\'s currently active goals.',
    input_schema: {
      type: 'object' as const,
      properties: {},
    },
  },
  {
    name: 'add_goal',
    description: 'Add a new focus goal for the user.',
    input_schema: {
      type: 'object' as const,
      properties: {
        text: { type: 'string', description: 'Goal description' },
        priority: { type: 'number', description: 'Priority 0-10 (default 0)' },
      },
      required: ['text'],
    },
  },
  {
    name: 'clear_goal',
    description: 'Mark a goal as completed/cleared.',
    input_schema: {
      type: 'object' as const,
      properties: {
        goal_id: { type: 'string', description: 'The goal ID to clear' },
      },
      required: ['goal_id'],
    },
  },
  {
    name: 'get_preferences',
    description: 'Retrieve recorded user preferences.',
    input_schema: {
      type: 'object' as const,
      properties: {
        query: { type: 'string', description: 'Optional keyword filter' },
      },
    },
  },
  {
    name: 'set_preference',
    description: 'Record or update a user preference.',
    input_schema: {
      type: 'object' as const,
      properties: {
        key: { type: 'string', description: 'Preference key' },
        value: { type: 'string', description: 'Preference value' },
        scope: {
          type: 'string',
          enum: ['always', 'session', 'weekdays', 'weekends', 'morning', 'evening'],
          description: 'When this preference applies',
        },
      },
      required: ['key', 'value'],
    },
  },
  {
    name: 'get_inferences',
    description: 'Get novel distraction candidates detected by the inference engine.',
    input_schema: {
      type: 'object' as const,
      properties: {
        status: {
          type: 'string',
          enum: ['pending', 'confirmed', 'rejected', 'auto_applied'],
          description: 'Filter by status. Omit for all.',
        },
      },
    },
  },
  {
    name: 'resolve_inference',
    description: 'Accept or reject an inference suggestion. Accepted ones get added to the blocklist.',
    input_schema: {
      type: 'object' as const,
      properties: {
        inference_id: { type: 'string', description: 'The inference ID to resolve' },
        action: {
          type: 'string',
          enum: ['confirm', 'reject'],
          description: '"confirm" to block it, "reject" to dismiss',
        },
      },
      required: ['inference_id', 'action'],
    },
  },
]

// ── Tool executor ─────────────────────────────────────────────────────────────

export interface ToolDeps {
  engine: BlockingEngine
  tracker: ActivityTracker
  heuristics: HeuristicEngine
  monitor?: MonitorService
}

export type ToolResult = Record<string, unknown>

export async function executeTool(
  name: string,
  input: Record<string, unknown>,
  deps: ToolDeps
): Promise<ToolResult> {
  const store = getStore()

  switch (name) {
    case 'block_domain': {
      const domain = input['domain'] as string
      const durationMs = input['duration_minutes'] ? (input['duration_minutes'] as number) * 60000 : undefined
      const result = deps.engine.addDomain(domain, durationMs)
      if (result.ok) {
        const s = getStore()
        if (!s.blocklist.domains.find((d) => d.domain === domain)) {
          patchStore({
            blocklist: {
              ...s.blocklist,
              domains: [...s.blocklist.domains, {
                domain, addedAt: Date.now(),
                expiresAt: durationMs ? Date.now() + durationMs : undefined,
                reason: input['reason'] as string | undefined,
              }],
            },
          })
        }
        return { ok: true, domain, permanent: !durationMs, duration_minutes: input['duration_minutes'] ?? null }
      }
      return { ok: false, error: result.error }
    }

    case 'unblock_domain': {
      const domain = input['domain'] as string
      deps.engine.removeDomain(domain)
      const s = getStore()
      patchStore({ blocklist: { ...s.blocklist, domains: s.blocklist.domains.filter((d) => d.domain !== domain) } })
      return { ok: true, domain }
    }

    case 'block_process': {
      const name2 = input['process_name'] as string
      const durationMs = input['duration_minutes'] ? (input['duration_minutes'] as number) * 60000 : undefined
      deps.engine.addProcess(name2, durationMs)
      const s = getStore()
      patchStore({
        blocklist: {
          ...s.blocklist,
          processes: [...s.blocklist.processes, {
            name: name2, addedAt: Date.now(),
            expiresAt: durationMs ? Date.now() + durationMs : undefined,
          }],
        },
      })
      return { ok: true, process: name2 }
    }

    case 'unblock_process': {
      const proc = input['process_name'] as string
      deps.engine.removeProcess(proc)
      const s = getStore()
      patchStore({ blocklist: { ...s.blocklist, processes: s.blocklist.processes.filter((p) => p.name !== proc) } })
      return { ok: true, process: proc }
    }

    case 'block_category': {
      const cat = input['category'] as string
      const domains = CATEGORY_DOMAINS[cat] ?? []
      const durationMs = input['duration_minutes'] ? (input['duration_minutes'] as number) * 60000 : undefined
      let added = 0
      for (const domain of domains) {
        const r = deps.engine.addDomain(domain, durationMs)
        if (r.ok) {
          added++
          const s = getStore()
          if (!s.blocklist.domains.find((d) => d.domain === domain)) {
            patchStore({
              blocklist: {
                ...getStore().blocklist,
                domains: [...getStore().blocklist.domains, {
                  domain, addedAt: Date.now(),
                  expiresAt: durationMs ? Date.now() + durationMs : undefined,
                  reason: `category:${cat}`,
                }],
              },
            })
          }
        }
      }
      return { ok: true, category: cat, domains_added: added, total_in_category: domains.length }
    }

    case 'get_active_blocks': {
      return {
        domains: store.blocklist.domains.map((d) => ({
          domain: d.domain,
          reason: d.reason,
          expires_at: d.expiresAt ? new Date(d.expiresAt).toISOString() : null,
        })),
        processes: store.blocklist.processes.map((p) => ({ name: p.name, expires_at: p.expiresAt ? new Date(p.expiresAt).toISOString() : null })),
      }
    }

    case 'start_focus_session': {
      const mode = (input['mode'] as 'normal' | 'deep') ?? 'normal'
      const durationMs = input['duration_minutes'] ? (input['duration_minutes'] as number) * 60000 : undefined
      const session = {
        id: randomUUID(),
        startedAt: Date.now(),
        endsAt: durationMs ? Date.now() + durationMs : undefined,
        mode,
        active: true,
      }
      const s = getStore()
      patchStore({ sessions: [session, ...s.sessions.map((sess) => ({ ...sess, active: false }))] })
      deps.engine.start()
      return { ok: true, session_id: session.id, mode, ends_at: session.endsAt ? new Date(session.endsAt).toISOString() : null }
    }

    case 'stop_focus_session': {
      const s = getStore()
      const active = s.sessions.find((sess) => sess.active)
      if (!active) return { ok: false, error: 'No active session' }
      patchStore({ sessions: s.sessions.map((sess) => (sess.id === active.id ? { ...sess, active: false } : sess)) })
      deps.engine.stop()
      return { ok: true, session_id: active.id }
    }

    case 'get_analytics': {
      const period = (input['period'] as string) ?? 'both'
      const now = Date.now()
      const todaySessions = deps.tracker.getSessions(new Date().setHours(0, 0, 0, 0))
      const weeklySessions = deps.tracker.getSessions(now - 7 * 24 * 3600000)

      const focToday = todaySessions.filter((s) => !s.isDistraction).reduce((a, s) => a + s.duration, 0)
      const distToday = todaySessions.filter((s) => s.isDistraction).reduce((a, s) => a + s.duration, 0)
      const focWeek = weeklySessions.filter((s) => !s.isDistraction).reduce((a, s) => a + s.duration, 0)
      const distWeek = weeklySessions.filter((s) => s.isDistraction).reduce((a, s) => a + s.duration, 0)

      const topApps = getTopAppsByTime(now - 7 * 24 * 3600000, 10)
      const hourly = getHourlyBreakdown(new Date().setHours(0, 0, 0, 0))

      const result: ToolResult = {}
      if (period !== 'week') {
        result['today'] = {
          focused_ms: focToday,
          distracted_ms: distToday,
          focus_score: focToday + distToday > 0 ? Math.round((focToday / (focToday + distToday)) * 100) : 50,
          session_count: todaySessions.length,
          hourly_breakdown: hourly,
        }
      }
      if (period !== 'today') {
        result['week'] = {
          focused_ms: focWeek,
          distracted_ms: distWeek,
          session_count: weeklySessions.length,
          top_apps: topApps.slice(0, 8),
        }
      }
      return result
    }

    case 'get_recent_events': {
      const minutes = Math.min(240, (input['minutes'] as number) ?? 30)
      const events = getRecentEvents(Date.now() - minutes * 60000, 100)
      return {
        events: events.map((e) => ({
          ts: new Date(e.ts).toISOString(),
          type: e.type,
          app: e.app,
          title: e.title?.slice(0, 80),
          url: e.url,
          category: e.category,
          is_distraction: e.is_distraction,
          duration_ms: e.duration_ms,
        })),
      }
    }

    case 'get_patterns': {
      const hours = (input['hours'] as number) ?? 24
      const activeOnly = (input['active_only'] as boolean) ?? false
      const patterns = getPatterns(Date.now() - hours * 3600000, activeOnly)
      return { patterns: patterns.map((p) => ({ id: p.id, type: p.type, severity: p.severity, title: p.title, description: p.description, detected_at: new Date(p.detected_at).toISOString() })) }
    }

    case 'get_goals':
      return { goals: getActiveGoals().map((g) => ({ id: g.id, text: g.text, priority: g.priority })) }

    case 'add_goal': {
      const goal = insertGoal(input['text'] as string, (input['priority'] as number) ?? 0)
      return { ok: true, goal_id: goal.id, text: goal.text }
    }

    case 'clear_goal':
      clearGoal(input['goal_id'] as string)
      return { ok: true }

    case 'get_preferences':
      return { preferences: getPreferences(input['query'] as string | undefined) }

    case 'set_preference':
      upsertPreference(
        input['key'] as string,
        input['value'] as string,
        (input['scope'] as DbPreference['scope']) ?? 'always',
        0.9,
        'agent'
      )
      return { ok: true }

    case 'delete_preference':
      deletePreference(input['key'] as string)
      return { ok: true }

    case 'get_inferences': {
      const infs = getInferences(input['status'] as Parameters<typeof getInferences>[0])
      return { inferences: infs.map((i) => ({ id: i.id, type: i.type, value: i.value, confidence: i.confidence, reasoning: i.reasoning, status: i.status, action: i.action })) }
    }

    case 'resolve_inference': {
      const inf = getInferences().find((i) => i.id === (input['inference_id'] as string))
      if (!inf) return { ok: false, error: 'Inference not found' }
      const action = input['action'] as string
      if (action === 'confirm') {
        resolveInference(inf.id, 'confirmed')
        // Also block it
        if (inf.type === 'domain') {
          deps.engine.addDomain(inf.value)
          const s = getStore()
          if (!s.blocklist.domains.find((d) => d.domain === inf.value)) {
            patchStore({
              blocklist: {
                ...s.blocklist,
                domains: [...s.blocklist.domains, { domain: inf.value, addedAt: Date.now(), reason: 'inference_confirmed' }],
              },
            })
          }
        }
        return { ok: true, action: 'confirmed', value: inf.value, blocked: inf.type === 'domain' }
      } else {
        resolveInference(inf.id, 'rejected')
        return { ok: true, action: 'rejected', value: inf.value }
      }
    }

    default:
      return { error: `Unknown tool: ${name}` }
  }
}

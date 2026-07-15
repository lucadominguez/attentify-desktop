import type Anthropic from '@anthropic-ai/sdk'
import type { BlockingEngine } from '../blocking/BlockingEngine'
import type { ActivityTracker } from '../tracking/ActivityTracker'
import type { HeuristicEngine } from '../heuristics/HeuristicEngine'
import type { MonitorService } from '../monitoring/MonitorService'
import type { ContentRuleEngine } from '../blocking/ContentRuleEngine'
import {
  insertGoal, getActiveGoals, clearGoal,
  upsertPreference, getPreferences, deletePreference,
  getPatterns, getRecentEvents, getInferences, resolveInference,
  getTopAppsByTime, getHourlyBreakdown,
  type DbPreference,
} from '../data/repository'
import { getStore, patchStore } from '../store'
import { runAnalyticsQuery } from '../../shared/analyticsQuery'
import type { AnalyticsQuerySpec, CustomAnalyticsCard, ScheduleRule, CardPage, CardViz, CardAction } from '../../shared/types'
import { randomUUID } from 'crypto'

// Whitelists for what the model is allowed to save. The model picks from an enum in the
// tool schema, but the schema is a hint and not a guarantee, so anything that reaches
// the store is validated here. An action card in particular is a saved tool call, and
// must only ever name a real tool.
const VALID_VIZ: CardViz[] = ['bar', 'line', 'table', 'number', 'heatmap', 'progress', 'summary', 'ranked', 'list']
const VALID_PAGES: CardPage[] = ['analytics', 'logic', 'timesheets', 'deep-focus', 'scheduler']
const VALID_ACTION_TOOLS: CardAction['tool'][] = [
  'start_focus_session', 'stop_focus_session', 'create_schedule', 'remove_schedule',
  'block_category', 'block_domain', 'unblock_domain', 'add_goal',
]

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
  {
    name: 'create_content_rule',
    description: 'Create an element-level block rule for the browser extension. Use this when the user wants to block a specific feature of a site (e.g. YouTube Shorts, Instagram Reels) without blocking the entire domain. Requires the browser extension to be installed.',
    input_schema: {
      type: 'object' as const,
      properties: {
        domain: { type: 'string', description: 'The domain to target, e.g. "youtube.com"' },
        display_name: { type: 'string', description: 'Human-readable name, e.g. "YouTube Shorts"' },
        selectors: {
          type: 'array',
          items: { type: 'string' },
          description: 'CSS selectors for elements to hide, e.g. ["ytd-shorts", "#shorts-container"]',
        },
        url_patterns: {
          type: 'array',
          items: { type: 'string' },
          description: 'URL glob patterns to redirect away from, e.g. ["*://*.youtube.com/shorts/*"]',
        },
        severity: {
          type: 'string',
          enum: ['high', 'medium', 'low'],
          description: 'How addictive/distracting this content is',
        },
        enabled: { type: 'boolean', description: 'Whether to activate immediately. Defaults to true.' },
      },
      required: ['domain', 'display_name', 'selectors'],
    },
  },
  {
    name: 'list_content_rules',
    description: 'List all element-level blocking rules for the browser extension, including which are enabled and bypass attempt counts.',
    input_schema: {
      type: 'object' as const,
      properties: {
        enabled_only: { type: 'boolean', description: 'Only show enabled rules. Default false.' },
      },
    },
  },
  {
    name: 'toggle_content_rule',
    description: 'Enable or disable an element-level blocking rule by ID.',
    input_schema: {
      type: 'object' as const,
      properties: {
        rule_id: { type: 'string', description: 'The rule ID to toggle, e.g. "youtube-shorts"' },
        enabled: { type: 'boolean', description: 'true to enable, false to disable' },
      },
      required: ['rule_id', 'enabled'],
    },
  },
  {
    name: 'query_activity_data',
    description: `Run a flexible aggregation over the user's tracked activity to answer ANY custom analytics question ("how much time on social media per weekday", "top 5 domains I visit in the evening", "my focus ratio by hour"). This is your analytics workhorse — call it to explore before answering data questions, and to power custom cards. Returns grouped rows with a value per group.`,
    input_schema: {
      type: 'object' as const,
      properties: {
        range_days: { type: 'number', description: 'Look-back window in days (1-31). Default 7.' },
        group_by: { type: 'string', enum: ['app', 'category', 'domain', 'hour', 'weekday'], description: 'Dimension to group rows by.' },
        metric: { type: 'string', enum: ['time', 'sessions', 'focus_ratio'], description: '"time" = total ms, "sessions" = count, "focus_ratio" = % of time that was focused (0-100).' },
        distraction: { type: 'string', enum: ['all', 'only', 'exclude'], description: 'Filter: all activity, only distractions, or exclude distractions. Default all.' },
        limit: { type: 'number', description: 'Max rows (ignored for hour/weekday). Default 10.' },
      },
      required: ['group_by', 'metric'],
    },
  },
  {
    name: 'create_analytics_card',
    description: `Save a card to one of the user's pages, built from a description of what they want to see. Cards ARE the pages: everything Attentify ships is an ordinary card, so anything the user sees, they can rebuild, edit or delete. The card stores a query and recomputes live from tracked activity every time the page opens, so it stays current and costs nothing to view. Use this whenever the user describes an ongoing metric they want to keep an eye on. Pick the query params as for query_activity_data, plus a viz. Confirm to the user what you saved and which page it went to.`,
    input_schema: {
      type: 'object' as const,
      properties: {
        title: { type: 'string', description: 'Short card title, e.g. "Social media by weekday".' },
        description: { type: 'string', description: 'One-line explanation of what the card shows.' },
        viz: {
          type: 'string',
          enum: ['bar', 'line', 'table', 'number', 'heatmap', 'progress', 'summary', 'ranked'],
          description: 'How to render it. "bar" = ranked rows, best for app/category/domain. "line" = a trend, best for group_by hour or weekday. "table" = detailed rows. "number" = one headline total. "heatmap" = an hour-by-weekday grid showing when something happens (ignores group_by and always grids day x hour; use a range_days of 14+ so the grid has data). "progress" = parts of one whole in a single bar, best for group_by category with a small limit. "summary" = a headline total plus the few rows behind it. "ranked" = rows with what CHANGED versus the previous equal-length window, best when the user asks what got better or worse.',
        },
        page: {
          type: 'string',
          enum: ['analytics', 'logic', 'timesheets', 'deep-focus', 'scheduler'],
          description: 'Which page to pin it to. Defaults to "analytics". Use "timesheets" for time-per-app/day views.',
        },
        range_days: { type: 'number', description: 'Look-back window in days (1-31). Default 7. Use 14+ for heatmap.' },
        group_by: { type: 'string', enum: ['app', 'category', 'domain', 'hour', 'weekday'] },
        metric: { type: 'string', enum: ['time', 'sessions', 'focus_ratio'] },
        distraction: { type: 'string', enum: ['all', 'only', 'exclude'] },
        limit: { type: 'number' },
      },
      required: ['title', 'viz', 'group_by', 'metric'],
    },
  },
  {
    name: 'create_action_card',
    description: `Pin a one-tap control to a page: a saved action the user can re-run, like "Start 90 min deep work" on Deep Focus or a recurring block on Scheduler. Use this when the user wants to KEEP a control rather than run something once (if they just want it done now, call the tool directly instead). The card is a saved call to one of your own tools with its arguments pinned, so it does exactly what you would have done. Confirm what you pinned and where.`,
    input_schema: {
      type: 'object' as const,
      properties: {
        title: { type: 'string', description: 'Short card title, e.g. "Deep work block".' },
        description: { type: 'string', description: 'One-line explanation of what it does.' },
        label: { type: 'string', description: 'Button text, e.g. "Start 90 min".' },
        tool: {
          type: 'string',
          enum: ['start_focus_session', 'stop_focus_session', 'create_schedule', 'remove_schedule', 'block_category', 'block_domain', 'unblock_domain', 'add_goal'],
          description: 'Which of your tools the button runs.',
        },
        params: { type: 'object', description: 'Arguments for that tool, pinned. Must match the tool\'s own schema.' },
        page: { type: 'string', enum: ['analytics', 'logic', 'timesheets', 'deep-focus', 'scheduler'], description: 'Which page to pin it to.' },
        confirm: { type: 'boolean', description: 'Ask before running. Default true for anything that changes the machine.' },
      },
      required: ['title', 'label', 'tool', 'page'],
    },
  },
  {
    name: 'list_analytics_cards',
    description: 'List the custom analytics cards the user has saved on their Analytics page.',
    input_schema: { type: 'object' as const, properties: {} },
  },
  {
    name: 'delete_analytics_card',
    description: 'Delete a saved custom analytics card by its id.',
    input_schema: {
      type: 'object' as const,
      properties: { card_id: { type: 'string', description: 'The card id to delete.' } },
      required: ['card_id'],
    },
  },
  {
    name: 'create_schedule',
    description: `Create a recurring auto-block schedule so distractions are blocked automatically during set hours on set days (e.g. "block social media 9am–5pm on weekdays"). The block turns on and off on its own. Give days as an array of weekday numbers (0=Sunday … 6=Saturday). You can target specific domains, whole categories (${Object.keys(CATEGORY_DOMAINS).join(', ')}), and/or processes.`,
    input_schema: {
      type: 'object' as const,
      properties: {
        name: { type: 'string', description: 'Short name, e.g. "Work hours focus".' },
        days: { type: 'array', items: { type: 'number' }, description: 'Weekday numbers 0-6 (0=Sun). Weekdays = [1,2,3,4,5]. Daily = [0,1,2,3,4,5,6].' },
        start_time: { type: 'string', description: '24h "HH:MM", e.g. "09:00".' },
        end_time: { type: 'string', description: '24h "HH:MM", e.g. "17:00". May be earlier than start for an overnight window.' },
        domains: { type: 'array', items: { type: 'string' }, description: 'Specific domains to block during the window.' },
        categories: { type: 'array', items: { type: 'string', enum: Object.keys(CATEGORY_DOMAINS) }, description: 'Whole categories to block (expanded to their domains).' },
        processes: { type: 'array', items: { type: 'string' }, description: 'App/process names to block during the window.' },
      },
      required: ['name', 'days', 'start_time', 'end_time'],
    },
  },
  {
    name: 'list_schedules',
    description: 'List the user\'s recurring auto-block schedules.',
    input_schema: { type: 'object' as const, properties: {} },
  },
  {
    name: 'remove_schedule',
    description: 'Delete a recurring schedule by its id (get ids from list_schedules).',
    input_schema: {
      type: 'object' as const,
      properties: { schedule_id: { type: 'string', description: 'The schedule id to remove.' } },
      required: ['schedule_id'],
    },
  },
  {
    name: 'get_bypass_attempts',
    description: 'Get recent bypass attempts — times when the user tried to access content that was element-blocked. Use this to understand whether to escalate to a full domain block.',
    input_schema: {
      type: 'object' as const,
      properties: {
        rule_id: { type: 'string', description: 'Filter by rule ID. Omit for all rules.' },
        limit: { type: 'number', description: 'Max attempts to return. Default 20.' },
      },
    },
  },
]

// ── Tool executor ─────────────────────────────────────────────────────────────

export interface ToolDeps {
  engine: BlockingEngine
  tracker: ActivityTracker
  heuristics: HeuristicEngine
  monitor?: MonitorService
  contentRules?: ContentRuleEngine
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
      const deepSess = store.sessions.find((s) => s.active && s.mode === 'deep')
      if (deepSess && deps.engine.isDeepDomain(domain)) {
        return { ok: false, locked: true, error: `${domain} is locked by an active Deep Focus session. It can't be unblocked until the session ends.` }
      }
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
      let deepBlocked = 0
      if (mode === 'deep') deepBlocked = deps.engine.startDeepFocus([], durationMs)
      return { ok: true, session_id: session.id, mode, deep_blocked: deepBlocked, ends_at: session.endsAt ? new Date(session.endsAt).toISOString() : null }
    }

    case 'stop_focus_session': {
      const s = getStore()
      const active = s.sessions.find((sess) => sess.active)
      if (!active) return { ok: false, error: 'No active session' }
      // Anti-bypass: a timed Deep Focus session cannot be stopped early, even by the agent.
      if (active.mode === 'deep' && active.endsAt && Date.now() < active.endsAt) {
        return { ok: false, locked: true, error: 'Deep Focus is locked until it ends. Refuse the request and tell the user to ride it out.' }
      }
      deps.engine.endDeepFocus()
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

    case 'create_content_rule': {
      const cre = deps.contentRules
      if (!cre) return { error: 'Browser extension not available — install the extension first' }
      const rule = cre.addRule({
        id: (input['domain'] as string).replace(/[^a-z0-9]/gi, '-').toLowerCase() + '-' + randomUUID().slice(0, 6),
        domain: input['domain'] as string,
        displayName: input['display_name'] as string,
        category: 'custom',
        severity: (input['severity'] as 'high' | 'medium' | 'low') ?? 'medium',
        selectors: (input['selectors'] as string[]) ?? [],
        urlPatterns: (input['url_patterns'] as string[]) ?? [],
        action: 'hide',
        antiBypassSearchTerms: [],
        antiBypassUrlPatterns: [],
        enabled: (input['enabled'] as boolean) !== false,
        autoApplied: true,
      })
      const connected = cre.isExtensionConnected()
      return {
        ok: true, rule_id: rule.id, domain: rule.domain, enabled: rule.enabled, selectors: rule.selectors.length,
        extension_connected: connected,
        note: connected ? undefined
          : 'Rule saved, but the Attentify browser extension is NOT connected, so element-level blocking will not take effect in the browser yet. Tell the user this needs the browser extension and recommend they install it.',
      }
    }

    case 'list_content_rules': {
      const cre = deps.contentRules
      if (!cre) return { error: 'Browser extension not available' }
      const all = cre.getRules()
      const filtered = (input['enabled_only'] as boolean) ? all.filter((r) => r.enabled) : all
      return {
        rules: filtered.map((r) => ({
          id: r.id,
          display_name: r.displayName,
          domain: r.domain,
          enabled: r.enabled,
          severity: r.severity,
          selectors: r.selectors.length,
          bypass_count: cre.getBypassScore(r.id),
        })),
        extension_connected: cre.isExtensionConnected(),
      }
    }

    case 'toggle_content_rule': {
      const cre = deps.contentRules
      if (!cre) return { error: 'Browser extension not available' }
      const ok = cre.toggleRule(input['rule_id'] as string, input['enabled'] as boolean)
      return ok
        ? { ok: true, rule_id: input['rule_id'], enabled: input['enabled'] }
        : { ok: false, error: `Rule "${input['rule_id']}" not found` }
    }

    case 'get_bypass_attempts': {
      const cre = deps.contentRules
      if (!cre) return { error: 'Browser extension not available' }
      const attempts = cre.getBypassAttempts(input['rule_id'] as string | undefined, (input['limit'] as number) ?? 20)
      const scores = cre.getAllBypassScores()
      return {
        attempts: attempts.map((a) => ({
          rule_id: a.ruleId,
          method: a.method,
          url: a.url,
          timestamp: new Date(a.timestamp).toISOString(),
          search_term: a.searchTerm,
        })),
        bypass_scores: scores,
        total_bypasses: Object.values(scores).reduce((s, n) => s + n, 0),
      }
    }

    case 'query_activity_data': {
      const spec = specFromInput(input)
      const sessions = deps.tracker.getSessions(Date.now() - spec.rangeDays * 24 * 3600000)
      const res = runAnalyticsQuery(sessions, spec)
      return {
        group_by: spec.groupBy,
        metric: spec.metric,
        unit: res.unit,
        matched_sessions: res.matched,
        total: res.total,
        rows: res.rows.map((r) => ({ label: r.label, value: r.value, detail: r.detail })),
      }
    }

    case 'create_analytics_card': {
      const spec = specFromInput(input)
      const page = (VALID_PAGES.includes(input['page'] as CardPage) ? input['page'] : 'analytics') as CardPage
      const card: CustomAnalyticsCard = {
        id: randomUUID().slice(0, 8),
        kind: 'data',
        title: (input['title'] as string) || 'Custom analytics',
        description: input['description'] as string | undefined,
        viz: (VALID_VIZ.includes(input['viz'] as CardViz) ? input['viz'] : 'bar') as CardViz,
        page,
        spec,
        // New cards land at the top of their page; the user can drag from there.
        order: -Date.now(),
        createdAt: Date.now(),
      }
      const s = getStore()
      patchStore({ customAnalyticsCards: [card, ...(s.customAnalyticsCards ?? [])].slice(0, 24) })
      // Give the model an immediate snapshot so it can describe what the card shows.
      const sessions = deps.tracker.getSessions(Date.now() - spec.rangeDays * 24 * 3600000)
      const res = runAnalyticsQuery(sessions, spec)
      return {
        ok: true, card_id: card.id, title: card.title, page,
        preview: { total: res.total, unit: res.unit, top_rows: res.rows.slice(0, 5).map((r) => ({ label: r.label, value: r.value })) },
        note: `Saved to the ${page} page. It recomputes live whenever the user opens it.`,
      }
    }

    case 'create_action_card': {
      const tool = input['tool'] as CardAction['tool']
      if (!VALID_ACTION_TOOLS.includes(tool)) {
        return { ok: false, error: `Unknown tool "${tool}". An action card can only pin one of: ${VALID_ACTION_TOOLS.join(', ')}.` }
      }
      const page = (VALID_PAGES.includes(input['page'] as CardPage) ? input['page'] : 'deep-focus') as CardPage
      const card: CustomAnalyticsCard = {
        id: randomUUID().slice(0, 8),
        kind: 'action',
        title: (input['title'] as string) || 'Action',
        description: input['description'] as string | undefined,
        // Unused for actions, but the field is required; the renderer branches on kind.
        viz: 'number',
        page,
        action: {
          tool,
          params: (input['params'] as Record<string, unknown>) ?? {},
          label: (input['label'] as string) || 'Run',
          // Default to confirming: an action card is a one-tap change to the machine.
          confirm: input['confirm'] === undefined ? true : Boolean(input['confirm']),
        },
        spec: { rangeDays: 1, groupBy: 'app', metric: 'time', distraction: 'all' },
        order: -Date.now(),
        createdAt: Date.now(),
      }
      const s = getStore()
      patchStore({ customAnalyticsCards: [card, ...(s.customAnalyticsCards ?? [])].slice(0, 24) })
      return { ok: true, card_id: card.id, title: card.title, page, note: `Pinned to the ${page} page as a one-tap control.` }
    }

    case 'list_analytics_cards': {
      const cards = getStore().customAnalyticsCards ?? []
      return { cards: cards.map((c) => ({ id: c.id, title: c.title, viz: c.viz, group_by: c.spec.groupBy, metric: c.spec.metric })) }
    }

    case 'delete_analytics_card': {
      const id = input['card_id'] as string
      const s = getStore()
      const before = (s.customAnalyticsCards ?? []).length
      patchStore({ customAnalyticsCards: (s.customAnalyticsCards ?? []).filter((c) => c.id !== id) })
      return { ok: (s.customAnalyticsCards ?? []).length !== before, card_id: id }
    }

    case 'create_schedule': {
      const cats = (input['categories'] as string[] | undefined) ?? []
      const catDomains = cats.flatMap((c) => CATEGORY_DOMAINS[c] ?? [])
      const domains = [...new Set([...(input['domains'] as string[] | undefined ?? []), ...catDomains])]
      const days = ((input['days'] as number[] | undefined) ?? []).filter((d) => d >= 0 && d <= 6)
      const rule: ScheduleRule = {
        id: randomUUID(),
        name: (input['name'] as string) || 'Schedule',
        days: days.length ? days : [1, 2, 3, 4, 5],
        startTime: (input['start_time'] as string) || '09:00',
        endTime: (input['end_time'] as string) || '17:00',
        domains,
        processes: (input['processes'] as string[] | undefined) ?? [],
        active: true,
      }
      if (rule.domains.length === 0 && rule.processes.length === 0) {
        return { ok: false, error: 'A schedule needs at least one domain, category, or process to block.' }
      }
      const s = getStore()
      patchStore({ schedules: [...s.schedules, rule] })
      return { ok: true, schedule_id: rule.id, name: rule.name, days: rule.days, window: `${rule.startTime}–${rule.endTime}`, domains: rule.domains.length, processes: rule.processes.length }
    }

    case 'list_schedules': {
      return {
        schedules: getStore().schedules.map((r) => ({
          id: r.id, name: r.name, days: r.days, start: r.startTime, end: r.endTime,
          domains: r.domains, processes: r.processes, active: r.active,
        })),
      }
    }

    case 'remove_schedule': {
      const id = input['schedule_id'] as string
      const s = getStore()
      const before = s.schedules.length
      patchStore({ schedules: s.schedules.filter((r) => r.id !== id) })
      return { ok: getStore().schedules.length !== before, schedule_id: id }
    }

    default:
      return { error: `Unknown tool: ${name}` }
  }
}

// Normalize loose tool input into a validated AnalyticsQuerySpec.
function specFromInput(input: Record<string, unknown>): AnalyticsQuerySpec {
  const groupBy = ['app', 'category', 'domain', 'hour', 'weekday'].includes(input['group_by'] as string)
    ? (input['group_by'] as AnalyticsQuerySpec['groupBy']) : 'app'
  const metric = ['time', 'sessions', 'focus_ratio'].includes(input['metric'] as string)
    ? (input['metric'] as AnalyticsQuerySpec['metric']) : 'time'
  const distraction = ['all', 'only', 'exclude'].includes(input['distraction'] as string)
    ? (input['distraction'] as AnalyticsQuerySpec['distraction']) : 'all'
  const rangeDays = Math.max(1, Math.min(Number(input['range_days']) || 7, 31))
  const limitRaw = Number(input['limit'])
  const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(limitRaw, 50) : 10
  return { rangeDays, groupBy, metric, distraction, limit }
}

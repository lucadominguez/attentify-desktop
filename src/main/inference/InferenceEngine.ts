import Anthropic from '@anthropic-ai/sdk'
import { getDb } from '../data/db'
import {
  insertInference, getInferences, getActiveGoals,
  type DbInference,
} from '../data/repository'
import { getStore, patchStore } from '../store'
import { canUseAi, recordUsage } from '../billing'
import { resolveModel } from '../agent/modelRouter'
import { debugLog } from '../debug/logger'
import type { BlockingEngine } from '../blocking/BlockingEngine'
import type { ActivitySession } from '../../shared/types'

// ── Thresholds ─────────────────────────────────────────────────────────────────

const CONFIDENCE_AUTO_BLOCK = 0.85
const CONFIDENCE_SUGGEST    = 0.60
const BACKGROUND_SWEEP_MS   = 5 * 60 * 1000
const MIN_TIME_MS           = 3 * 60 * 1000
const MIN_VISITS            = 2
const DEDUP_TTL             = 5 * 60 * 1000
const AI_CACHE_TTL          = 20 * 60 * 1000
const AI_RATE_LIMIT_MS      = 4000  // min ms between AI calls

const OPENROUTER_BASE  = 'https://openrouter.ai/api'

const SAFE_CATEGORIES = new Set(['development', 'productivity', 'system'])
// These categories always use their full base confidence — never discounted for "no active goals".
// adult/gambling/dating: obviously harmful; social_media/video_streaming: unambiguously distracting.
// Without this, e.g. instagram (base 0.88) drops to max(0.55, 0.78) = 0.78 with no goals —
// below the 0.85 auto-block threshold — and stays pending instead of auto-blocking.
const HARDBLOCK_CATEGORIES = new Set(['adult', 'gambling', 'dating', 'social_media', 'video_streaming'])
const BROWSER_PROCESSES_SET = new Set(['chrome', 'firefox', 'msedge', 'brave', 'vivaldi', 'opera', 'arc', 'thorium', 'librewolf', 'waterfox', 'floorp'])

// ── Comprehensive distraction domain taxonomy ─────────────────────────────────
// Organised by category so scoring can be category-aware.

export const DISTRACTION_MAP: Record<string, string[]> = {
  social_media: [
    'twitter.com', 'x.com', 'instagram.com', 'facebook.com', 'tiktok.com',
    'snapchat.com', 'pinterest.com', 'tumblr.com', 'threads.net', 'linkedin.com',
    'mastodon.social', 'bsky.app', 'bluesky.social', 'weibo.com', 'vk.com',
    'ok.ru', 'ask.fm', 'meetme.com', 'tagged.com', 'hi5.com', 'badoo.com',
    'myspace.com', 'friendster.com', 'quora.com', 'clubhouse.com', 'bereal.com',
    'lemon8-app.com', 'cafemom.com', 'nextdoor.com', 'parler.com', 'gab.com',
    'mewe.com', 'minds.com',
  ],
  video_streaming: [
    'youtube.com', 'youtu.be', 'twitch.tv', 'netflix.com', 'hulu.com',
    'disneyplus.com', 'primevideo.com', 'hbomax.com', 'max.com', 'peacocktv.com',
    'paramountplus.com', 'crunchyroll.com', 'funimation.com', 'vimeo.com',
    'dailymotion.com', 'bilibili.com', 'bilibili.tv', 'kick.com', 'trovo.live',
    'rumble.com', 'odysee.com', 'bitchute.com', 'brighteon.com', 'banned.video',
    'curiositystream.com', 'mubi.com', 'tubi.tv', 'pluto.tv', 'vudu.com',
    'starz.com', 'showtime.com', 'epix.com', 'acorn.tv', 'britbox.com',
    'appletv.apple.com', 'tv.apple.com', 'fxnow.fxnetworks.com',
    'crackle.com', 'popcornflix.com', 'kanopy.com', 'hoopladigital.com',
    'veoh.com', 'metacafe.com', 'break.com', 'liveleak.com',
  ],
  news_tabloids: [
    'buzzfeed.com', 'dailymail.co.uk', 'tmz.com', 'huffpost.com', 'vice.com',
    'gawker.com', 'jezebel.com', 'theonion.com', 'clickhole.com', 'upworthy.com',
    'boredpanda.com', 'viralnova.com', 'distractify.com', 'ladbible.com',
    'unilad.com', '9gag.com', 'ifunny.co', 'memedroid.com', 'cheezburger.com',
    'fark.com', 'cracked.com', 'collegehumor.com', 'thechive.com',
    'complex.com', 'hypebeast.com', 'highsnobiety.com', 'pigeons.andplanes.com',
    'worldstarhiphop.com', 'liveleak.com', 'break.com', 'ebaumsworld.com',
    'runt-of-the-web.com', 'smosh.com', 'dorkly.com', 'collegecandy.com',
  ],
  news_general: [
    'cnn.com', 'foxnews.com', 'msnbc.com', 'bbc.com', 'bbc.co.uk',
    'theguardian.com', 'nytimes.com', 'washingtonpost.com', 'wsj.com',
    'theatlantic.com', 'politico.com', 'axios.com', 'thehill.com',
    'breitbart.com', 'newsweek.com', 'usatoday.com', 'nbcnews.com',
    'abcnews.go.com', 'cbsnews.com', 'apnews.com', 'reuters.com',
    'bloomberg.com', 'ft.com', 'economist.com', 'time.com', 'fortune.com',
    'forbes.com', 'businessinsider.com', 'marketwatch.com', 'cnbc.com',
    'techcrunch.com', 'theverge.com', 'engadget.com', 'gizmodo.com',
    'wired.com', 'arstechnica.com', 'zdnet.com', 'venturebeat.com',
    'mashable.com', 'cnet.com', 'pcmag.com', 'tomshardware.com',
    'anandtech.com', 'slashdot.org', 'drudgereport.com', 'rawstory.com',
    'salon.com', 'slate.com', 'vox.com', 'motherjones.com', 'thedailybeast.com',
  ],
  forums_aggregators: [
    'reddit.com', 'news.ycombinator.com', '4chan.org', '4channel.org',
    '8kun.top', '8chan.se', 'digg.com', 'imgur.com', 'slashdot.org',
    'lobste.rs', 'tildes.net', 'lemmy.ml', 'lemmy.world', 'kbin.social',
    'beehaw.org', 'feddit.de', 'sopuli.xyz', 'sh.itjust.works',
    'saidit.net', 'voat.co', 'ruqqus.com', 'scored.co',
    'stacksocial.com', 'productforums.google.com',
  ],
  gaming: [
    'chess.com', 'lichess.org', 'chessbase.com', 'chesskid.com',
    'miniclip.com', 'kongregate.com', 'addictinggames.com', 'friv.com',
    'coolmathgames.com', 'poki.com', 'armorgames.com', 'newgrounds.com',
    'gamejolt.com', 'itch.io', 'steampowered.com', 'store.steampowered.com',
    'epicgames.com', 'gog.com', 'humblebundle.com', 'fanatical.com',
    'greenmangaming.com', 'playstation.com', 'xbox.com', 'nintendo.com',
    'battlenet.com', 'leagueclient.com', 'riotgames.com', 'valorant.com',
    'overwolf.com', 'curse.com', 'curseforge.com', 'nexusmods.com',
    'moddb.com', 'gamespot.com', 'ign.com', 'kotaku.com', 'polygon.com',
    'pcgamer.com', 'eurogamer.net', 'rockpapershotgun.com', 'vg247.com',
    'destructoid.com', 'giantbomb.com', 'fandom.com',
  ],
  shopping: [
    'amazon.com', 'amazon.co.uk', 'amazon.ca', 'amazon.de', 'amazon.fr',
    'ebay.com', 'ebay.co.uk', 'etsy.com', 'aliexpress.com', 'aliexpress.ru',
    'wish.com', 'shein.com', 'temu.com', 'walmart.com', 'target.com',
    'bestbuy.com', 'costco.com', 'overstock.com', 'zappos.com', 'chewy.com',
    'wayfair.com', 'homedepot.com', 'lowes.com', 'ikea.com', 'ikea.us',
    'asos.com', 'boohoo.com', 'fashionnova.com', 'prettylittlething.com',
    'zara.com', 'hm.com', 'uniqlo.com', 'gap.com', 'oldnavy.com',
    'macys.com', 'nordstrom.com', 'saksoff5th.com', 'bloomingdales.com',
    'newegg.com', 'bhphotovideo.com', 'adorama.com', 'microcenter.com',
    'rakuten.com', 'groupon.com', 'slickdeals.net', 'dealnews.com',
    'camelcamelcamel.com', 'honey.com',
  ],
  gambling: [
    'draftkings.com', 'fanduel.com', 'betmgm.com', 'caesars.com',
    'pointsbet.com', 'barstoolsportsbook.com', 'bet365.com', 'bet365.us',
    'williamhill.com', 'paddypower.com', 'ladbrokes.com', 'coral.co.uk',
    'unibet.com', 'betway.com', 'skybet.com', '888sport.com',
    'pokerstars.com', 'partypoker.com', '888poker.com', 'ggpoker.com',
    'bovada.lv', 'betonline.ag', 'mybookie.ag', 'sportsbetting.ag',
    'betrivers.com', 'sugarhouse.com', 'foxbet.com', 'wynnbet.com',
    'betfred.com', 'mrgreen.com', 'casumo.com', 'leovegas.com',
  ],
  dating: [
    'tinder.com', 'bumble.com', 'hinge.co', 'okcupid.com', 'match.com',
    'pof.com', 'eharmony.com', 'zoosk.com', 'grindr.com', 'scruff.com',
    'feeld.co', 'her.app', 'jackd.com', 'adam4adam.com', 'manhunt.net',
    'benaughty.com', 'adultfriendfinder.com', 'seeking.com', 'elite singles.com',
    'silversingles.com', 'ourtime.com', 'christianmingle.com', 'jdate.com',
    'farmersonly.com', 'blackpeoplemeet.com', 'asiandate.com',
    'shaadi.com', 'matrimony.com', 'bharatmatrimony.com',
  ],
  crypto_speculation: [
    'coinbase.com', 'binance.com', 'kraken.com', 'gemini.com', 'crypto.com',
    'bybit.com', 'okx.com', 'kucoin.com', 'gate.io', 'bitfinex.com',
    'bittrex.com', 'poloniex.com', 'huobi.com', 'mexc.com', 'bitmex.com',
    'coinmarketcap.com', 'coingecko.com', 'dextools.io', 'dexscreener.com',
    'poocoin.app', 'pancakeswap.finance', 'uniswap.org', 'sushiswap.org',
    'aave.com', 'compound.finance', 'opensea.io', 'rarible.com', 'niftygateway.com',
    'coindesk.com', 'cointelegraph.com', 'decrypt.co', 'theblock.co',
    'blockworks.co', 'cryptoslate.com', 'bitcoinist.com', 'newsbtc.com',
  ],
  adult: [
    'pornhub.com', 'xvideos.com', 'xnxx.com', 'redtube.com', 'youporn.com',
    'tube8.com', 'spankbang.com', 'xhamster.com', 'beeg.com', 'drtuber.com',
    'tnaflix.com', 'txxx.com', 'hclips.com', 'hdtube.porn', 'empflix.com',
    'onlyfans.com', 'fansly.com', 'manyvids.com', 'clips4sale.com',
    'brazzers.com', 'bangbros.com', 'reality kings.com', 'naughtyamerica.com',
  ],
  sports: [
    'espn.com', 'bleacherreport.com', 'nfl.com', 'nba.com', 'mlb.com',
    'nhl.com', 'mls soccer.com', 'goal.com', 'skysports.com', 'bbc sport',
    'cbssports.com', 'sports illustrated.com', 'theathletic.com',
    'sports reference.com', 'baseball reference.com', 'basketball reference.com',
    'pro football reference.com', 'hockey reference.com', 'fbref.com',
    'sofascore.com', 'whoscored.com', 'flashscore.com', 'livescore.com',
    'soccerway.com', '365scores.com', 'theringer.com', 'fivethirtyeight.com',
    'rotowire.com', 'fantasypros.com', 'cbssports.com',
  ],
  music_distraction: [
    'spotify.com', 'open.spotify.com', 'soundcloud.com', 'bandcamp.com',
    'last.fm', 'genius.com', 'azlyrics.com', 'metrolyrics.com',
    'songlyrics.com', 'musixmatch.com', 'shazam.com', 'tunefind.com',
    'hypem.com', 'audiomack.com', 'reverbnation.com',
  ],
}

// Flat set for O(1) lookup
const ALL_DISTRACTION_DOMAINS = new Set<string>(
  Object.values(DISTRACTION_MAP).flat()
)

// Domain → category mapping for scoring
const DOMAIN_TO_CATEGORY = new Map<string, string>()
for (const [cat, domains] of Object.entries(DISTRACTION_MAP)) {
  for (const d of domains) DOMAIN_TO_CATEGORY.set(d, cat)
}

// ── High-confidence category weights ─────────────────────────────────────────

const CATEGORY_AUTO_BLOCK_SCORE: Record<string, number> = {
  adult: 0.97,
  gambling: 0.92,
  social_media: 0.88,
  video_streaming: 0.85,
  gaming: 0.82,
  dating: 0.80,
  crypto_speculation: 0.78,
  forums_aggregators: 0.75,
  shopping: 0.70,
  news_tabloids: 0.72,
  news_general: 0.60,
  sports: 0.65,
  music_distraction: 0.55,
}

// ── Search → likely destination predictions ───────────────────────────────────

interface SearchPrediction {
  keywords: string[]
  domain: string
  category: string
  confidence: number
}

const SEARCH_DESTINATIONS: SearchPrediction[] = [
  // Direct site names
  { keywords: ['reddit', 'subreddit', '/r/', 'upvote', 'downvote'], domain: 'reddit.com', category: 'social forum', confidence: 0.95 },
  { keywords: ['youtube', 'yt ', 'ytb ', 'youtube video'], domain: 'youtube.com', category: 'video', confidence: 0.95 },
  { keywords: ['twitter', 'tweet', 'x.com', '@handle'], domain: 'twitter.com', category: 'social media', confidence: 0.95 },
  { keywords: ['instagram', 'insta ', ' ig ', 'instagram reel'], domain: 'instagram.com', category: 'social media', confidence: 0.95 },
  { keywords: ['tiktok', 'tik tok', 'tiktok video'], domain: 'tiktok.com', category: 'short video', confidence: 0.95 },
  { keywords: ['netflix', 'netflix show', 'netflix series'], domain: 'netflix.com', category: 'streaming', confidence: 0.95 },
  { keywords: ['twitch', 'twitch stream', 'twitch streamer'], domain: 'twitch.tv', category: 'streaming', confidence: 0.95 },
  { keywords: ['facebook', ' fb ', 'facebook post', 'facebook group'], domain: 'facebook.com', category: 'social media', confidence: 0.95 },
  { keywords: ['9gag', '9 gag', 'memes 9gag'], domain: '9gag.com', category: 'entertainment', confidence: 0.95 },
  { keywords: ['4chan', '4 chan', 'greentext', 'anon boards'], domain: '4chan.org', category: 'imageboard', confidence: 0.95 },
  { keywords: ['discord server', 'discord channel', 'discord.gg'], domain: 'discord.com', category: 'social', confidence: 0.90 },
  { keywords: ['pinterest', 'pinterest board', 'pinterest ideas'], domain: 'pinterest.com', category: 'social media', confidence: 0.90 },
  { keywords: ['tumblr', 'tumblr post', 'tumblr blog'], domain: 'tumblr.com', category: 'social media', confidence: 0.90 },
  { keywords: ['chess.com', 'play chess online', 'chess game'], domain: 'chess.com', category: 'gaming', confidence: 0.90 },
  { keywords: ['lichess', 'lichess.org', 'free chess'], domain: 'lichess.org', category: 'gaming', confidence: 0.90 },
  { keywords: ['hulu', 'hulu show'], domain: 'hulu.com', category: 'streaming', confidence: 0.92 },
  { keywords: ['disney plus', 'disneyplus', 'disney+', 'disney plus show'], domain: 'disneyplus.com', category: 'streaming', confidence: 0.92 },
  { keywords: ['hbo max', 'hbomax', 'max show', 'hbo series'], domain: 'max.com', category: 'streaming', confidence: 0.92 },
  { keywords: ['amazon prime video', 'prime video', 'prime series'], domain: 'primevideo.com', category: 'streaming', confidence: 0.90 },
  { keywords: ['crunchyroll', 'anime crunchyroll'], domain: 'crunchyroll.com', category: 'streaming', confidence: 0.92 },
  { keywords: ['twitch clips', 'twitch highlights'], domain: 'twitch.tv', category: 'streaming', confidence: 0.88 },
  { keywords: ['pornhub', 'xvideos', 'xnxx', 'onlyfans', 'porn site', 'adult video'], domain: 'pornhub.com', category: 'adult', confidence: 0.99 },
  { keywords: ['draftkings', 'fanduel', 'sports betting', 'bet online', 'gambling site'], domain: 'draftkings.com', category: 'gambling', confidence: 0.97 },
  { keywords: ['tinder', 'bumble app', 'hinge app', 'dating app', 'match.com'], domain: 'tinder.com', category: 'dating', confidence: 0.93 },
  { keywords: ['binance', 'coinbase', 'crypto exchange', 'buy bitcoin', 'buy eth', 'altcoin', 'defi', 'nft'], domain: 'binance.com', category: 'crypto', confidence: 0.88 },
  { keywords: ['espn', 'nfl scores', 'nba scores', 'mlb scores', 'sports scores', 'football scores'], domain: 'espn.com', category: 'sports', confidence: 0.82 },
  { keywords: ['amazon deals', 'buy on amazon', 'ebay listing', 'shop online', 'aliexpress'], domain: 'amazon.com', category: 'shopping', confidence: 0.75 },
  // Intent-based predictions (content that implies destination)
  { keywords: ['watch anime', 'anime episode', 'anime stream'], domain: 'crunchyroll.com', category: 'streaming', confidence: 0.88 },
  { keywords: ['funny videos', 'viral videos', 'video compilation'], domain: 'youtube.com', category: 'video', confidence: 0.85 },
  { keywords: ['watch movie free', 'free movies online', 'stream movies'], domain: 'tubi.tv', category: 'streaming', confidence: 0.85 },
  { keywords: ['memes', 'dank memes', 'funny memes', 'meme compilation'], domain: 'reddit.com', category: 'entertainment', confidence: 0.80 },
  { keywords: ['stream live', 'live gaming', 'watch stream'], domain: 'twitch.tv', category: 'streaming', confidence: 0.82 },
  { keywords: ['twitter drama', 'twitter beef', 'ratio twitter'], domain: 'twitter.com', category: 'social media', confidence: 0.88 },
  { keywords: ['instagram explore', 'instagram reels', 'ig story'], domain: 'instagram.com', category: 'social media', confidence: 0.90 },
  { keywords: ['reddit thread', 'reddit post', 'reddit ama', 'ask reddit'], domain: 'reddit.com', category: 'forum', confidence: 0.92 },
  { keywords: ['hn front page', 'hacker news', 'ask hn'], domain: 'news.ycombinator.com', category: 'forum', confidence: 0.88 },
  { keywords: ['free online games', 'browser games', 'unblocked games', 'play games'], domain: 'poki.com', category: 'gaming', confidence: 0.88 },
  { keywords: ['news today', 'breaking news', 'news feed', 'headlines today'], domain: 'cnn.com', category: 'news', confidence: 0.72 },
  { keywords: ['celebrity news', 'celebrity gossip', 'who is dating'], domain: 'tmz.com', category: 'tabloid', confidence: 0.88 },
  { keywords: ['lofi music', 'music playlist', 'listen music'], domain: 'youtube.com', category: 'music/video', confidence: 0.78 },
  { keywords: ['podcast', 'listen podcast', 'podcast episode'], domain: 'spotify.com', category: 'audio', confidence: 0.70 },
]

// Recreational intent signals — if these appear in a search with active goals, elevate risk
const RECREATIONAL_SIGNALS = [
  'funny', 'meme', 'memes', 'lol', 'lmao', 'rofl', 'epic', 'fail',
  'watch', 'movie', 'show', 'series', 'episode', 'season', 'trailer',
  'game', 'gaming', 'gamer', 'gameplay', 'walkthrough', 'speedrun',
  'anime', 'manga', 'webtoon', 'manhwa', 'light novel',
  'stream', 'streamer', 'vtuber', 'let\'s play',
  'celebrity', 'gossip', 'drama', 'beef', 'cancelled', 'exposed',
  'viral', 'trending', 'tiktoker', 'youtuber', 'influencer',
  'news feed', 'scroll', 'browse', 'just browsing',
  'bored', 'procrastinat', 'take a break', 'distract',
  'nfl', 'nba', 'mlb', 'nhl', 'fifa', 'scores today', 'highlights',
  'bet', 'odds', 'parlay', 'fantasy league',
  'crypto', 'bitcoin price', 'eth price', 'altcoin', 'moon', 'rug pull',
  'shop', 'buy', 'deal', 'discount', 'sale', 'coupon',
  'dating', 'hookup', 'match me', 'crush',
]

// ── InferenceEngine ────────────────────────────────────────────────────────────

export class InferenceEngine {
  private blockingEngine: BlockingEngine
  private client: Anthropic | null = null
  private model = resolveModel('cheap', false)
  private sweepTimer: ReturnType<typeof setInterval> | null = null
  private active = false

  private onAutoBlock?: (domain: string, confidence: number) => void
  private onSuggest?: (inf: DbInference) => void
  private onSearchAlert?: (query: string, predictedDomain: string, category: string) => void
  private blockingMode: 'auto' | 'ask' = 'auto'

  // Dedup: recently processed keys
  private recentlyProcessed = new Map<string, number>()
  // AI result cache: domain/query → { result, cachedAt }
  private aiCache = new Map<string, { distraction: boolean; category: string; confidence: number; reasoning: string; cachedAt: number }>()
  // Rate limiting for AI calls
  private lastAiCallTs = 0
  // Queue of pending AI evaluations
  private aiQueue: Array<{ key: string; prompt: string; onResult: (r: AiEval) => void }> = []
  private aiProcessing = false

  constructor(engine: BlockingEngine) {
    this.blockingEngine = engine
  }

  init(apiKey: string): void {
    const isOpenRouter = apiKey.startsWith('sk-or-')
    this.model = resolveModel('cheap', isOpenRouter)
    this.client = new Anthropic({
      apiKey,
      ...(isOpenRouter ? {
        baseURL: OPENROUTER_BASE,
        defaultHeaders: { 'HTTP-Referer': 'https://attentify.ai', 'X-Title': 'Attentify' },
      } : {}),
    })
  }

  setCallbacks(opts: {
    onAutoBlock?: (domain: string, confidence: number) => void
    onSuggest?: (inf: DbInference) => void
    onSearchAlert?: (query: string, predictedDomain: string, category: string) => void
  }): void {
    this.onAutoBlock = opts.onAutoBlock
    this.onSuggest = opts.onSuggest
    this.onSearchAlert = opts.onSearchAlert
  }

  setBlockingMode(mode: 'auto' | 'ask'): void {
    this.blockingMode = mode
  }

  start(): void {
    if (this.active) return
    this.active = true
    this.sweepTimer = setInterval(() => this.runBackgroundSweep(), BACKGROUND_SWEEP_MS)
    setTimeout(() => this.runBackgroundSweep(), 60 * 1000)
  }

  stop(): void {
    this.active = false
    if (this.sweepTimer) { clearInterval(this.sweepTimer); this.sweepTimer = null }
  }

  // ── Hot path 1: immediate URL analysis ───────────────────────────────────

  analyzeUrl(url: string, title: string): void {
    if (!this.active) return
    let domain: string
    try {
      domain = new URL(url.startsWith('http') ? url : `https://${url}`)
        .hostname.replace(/^www\./, '').toLowerCase()
    } catch { return }

    const store = getStore()
    if (store.blocklist.domains.some((d) => domain === d.domain || domain.endsWith('.' + d.domain))) return
    if (this.wasRecentlyProcessed(`url:${domain}`)) return

    // Exact match in taxonomy
    if (ALL_DISTRACTION_DOMAINS.has(domain)) {
      this.markProcessed(`url:${domain}`)
      const category = DOMAIN_TO_CATEGORY.get(domain) ?? 'distraction'
      const baseScore = CATEGORY_AUTO_BLOCK_SCORE[category] ?? 0.75
      const goals = getActiveGoals()
      // Hard-block categories (adult/gambling/dating) always auto-block — don't reduce for no goals
      const hardBlock = HARDBLOCK_CATEGORIES.has(category)
      const confidence = hardBlock
        ? Math.min(0.99, baseScore + 0.05)
        : goals.length > 0 ? Math.min(0.99, baseScore + 0.05) : Math.max(0.55, baseScore - 0.1)
      const reasoning = goals.length > 0
        ? `visited ${domain} (${category}) while goal "${goals[0]!.text}" is active`
        : `${domain} is a known ${category} site`
      this.handleCandidate('domain', domain, confidence, { reasoning, source: 'url_visit', title })
      return
    }

    // Subdomain / partial match
    for (const known of ALL_DISTRACTION_DOMAINS) {
      if (domain.endsWith('.' + known) || domain.includes(known.split('.')[0]!)) {
        if (this.wasRecentlyProcessed(`url:${domain}`)) return
        this.markProcessed(`url:${domain}`)
        const category = DOMAIN_TO_CATEGORY.get(known) ?? 'distraction'
        this.handleCandidate('domain', domain, 0.72, {
          reasoning: `subdomain/variant of known distraction ${known} (${category})`,
          source: 'url_visit', title,
        })
        return
      }
    }

    // Unknown domain — queue for AI reasoning
    if (this.client) {
      const goals = getActiveGoals()
      if (goals.length > 0 || this.shouldAiCheckUnknown(domain)) {
        this.queueAiUrlCheck(domain, title, goals.map((g) => g.text))
      }
    }
  }

  // ── Hot path 2: immediate search query analysis ───────────────────────────

  analyzeSearchQuery(query: string): void {
    if (!this.active) return
    if (!query || query.length < 2) return

    const lower = query.toLowerCase().trim()
    const store = getStore()
    const goals = getActiveGoals()

    // Check explicit site name predictions
    for (const pred of SEARCH_DESTINATIONS) {
      if (pred.keywords.some((kw) => lower.includes(kw.toLowerCase()))) {
        const domain = pred.domain
        if (store.blocklist.domains.some((d) => d.domain === domain)) continue
        if (this.wasRecentlyProcessed(`search:${domain}`)) continue
        this.markProcessed(`search:${domain}`)

        this.onSearchAlert?.(query, domain, pred.category)
        console.log(`[InferenceEngine] search "${query}" → predicted ${domain} (${pred.category})`)

        if (goals.length > 0) {
          const existing = getInferences().find(
            (i) => i.value === domain && ['pending', 'auto_applied'].includes(i.status)
          )
          if (!existing) {
            const confidence = goals.length > 0
              ? Math.min(0.99, pred.confidence)
              : Math.max(0.55, pred.confidence - 0.15)
            this.handleCandidate('domain', domain, confidence, {
              reasoning: `search query "${query}" predicts navigation to ${pred.category} site`,
              source: 'search_prediction',
            })
          }
        }
        return
      }
    }

    // Recreational signal without explicit destination
    const signals = RECREATIONAL_SIGNALS.filter((s) => lower.includes(s))
    if (signals.length >= 2 && goals.length > 0 && !this.wasRecentlyProcessed(`rec:${lower.slice(0, 30)}`)) {
      this.markProcessed(`rec:${lower.slice(0, 30)}`)
      this.onSearchAlert?.(query, '', 'recreational browsing')
    }

    // AI reasoning for ambiguous search queries (when goals are active)
    if (this.client && goals.length > 0 && !this.wasRecentlyProcessed(`aisearch:${lower.slice(0, 40)}`)) {
      this.markProcessed(`aisearch:${lower.slice(0, 40)}`)
      this.queueAiSearchCheck(query, goals.map((g) => g.text))
    }
  }

  // ── Session analysis (called when session closes) ─────────────────────────

  analyzeSession(session: ActivitySession): void {
    if (!this.active) return
    if (SAFE_CATEGORIES.has(session.category)) return
    if (session.duration < 15000) return

    const store = getStore()
    if (store.blocklist.processes.some((p) => session.app === p.name)) return

    // ── URL path (enriched by MonitorService or UIAutomation) ────────────────
    if (session.url) {
      if (store.blocklist.domains.some((d) => session.url!.includes(d.domain))) return
      try {
        const domain = new URL(session.url.startsWith('http') ? session.url : `https://${session.url}`)
          .hostname.replace(/^www\./, '')
        if (this.wasRecentlyProcessed(`session:${domain}`)) return
        this.markProcessed(`session:${domain}`)
        const confidence = this.scoreDomain(domain, session)
        if (confidence >= CONFIDENCE_SUGGEST) {
          this.handleCandidate('domain', domain, confidence, {
            reasoning: this.buildSessionReasoning(domain, confidence, session),
            source: 'session',
          })
        }
      } catch { /* ignore */ }
      return
    }

    // ── Title-based fallback: scan window title for known distraction domains ─
    // Used when UIAutomation URL capture hasn't fired yet or failed.
    if (BROWSER_PROCESSES_SET.has(session.app.toLowerCase())) {
      const titleLower = session.title.toLowerCase()
      for (const [dom, cat] of DOMAIN_TO_CATEGORY) {
        // Extract the primary keyword from the domain (e.g. 'reddit' from 'reddit.com')
        const keyword = dom.replace(/\.(com|tv|org|net|co|io|gg|app|me|xyz|live|uk|us|ca|au)(\.[a-z]{2})?$/, '')
        if (keyword.length < 4) continue
        if (!titleLower.includes(keyword)) continue
        if (store.blocklist.domains.some((d) => d.domain === dom)) continue
        if (this.wasRecentlyProcessed(`title:${dom}`)) continue
        this.markProcessed(`title:${dom}`)

        const baseScore = CATEGORY_AUTO_BLOCK_SCORE[cat] ?? 0.70
        const goals = getActiveGoals()
        const hardBlock = HARDBLOCK_CATEGORIES.has(cat)
        // Title-based is slightly less certain than URL-based; reduce by 0.05 (except hard-block categories)
        const confidence = hardBlock || goals.length > 0
          ? Math.min(0.94, baseScore)
          : Math.max(0.50, baseScore - 0.08)

        if (confidence >= CONFIDENCE_SUGGEST) {
          this.handleCandidate('domain', dom, confidence, {
            reasoning: `window title matched ${cat} site (${dom})`,
            source: 'title_match',
          })
        }
        return // one match per session is enough
      }
      return // browser session, nothing matched — skip app scoring
    }

    // ── App-based scoring for non-browser distracting apps ───────────────────
    if (!session.isDistraction) return
    const app = session.app.toLowerCase()
    if (this.wasRecentlyProcessed(`app:${app}`)) return
    this.markProcessed(`app:${app}`)
    const confidence = this.scoreApp(app, session)
    if (confidence >= CONFIDENCE_SUGGEST) {
      this.handleCandidate('app', app, confidence, {
        reasoning: this.buildSessionReasoning(app, confidence, session),
        source: 'session',
      })
    }
  }

  // ── AI evaluation queue ───────────────────────────────────────────────────

  private queueAiUrlCheck(domain: string, title: string, goals: string[]): void {
    const cacheKey = `url:${domain}:${goals.join('|').slice(0, 60)}`
    const cached = this.aiCache.get(cacheKey)
    if (cached && Date.now() - cached.cachedAt < AI_CACHE_TTL) {
      if (cached.distraction) {
        this.handleCandidate('domain', domain, cached.confidence, {
          reasoning: cached.reasoning,
          source: 'ai_url',
        })
      }
      return
    }

    const goalText = goals.length > 0 ? `User goals: ${goals.join('; ')}` : 'User has no stated goals.'
    const prompt = `A user's computer just navigated to "${domain}" (page title: "${title.slice(0, 80)}").
${goalText}

Is this a distraction or recreational site that conflicts with their goals?
Reply with JSON only, no markdown: {"distraction":true/false,"category":"<3 words>","confidence":0.0-1.0,"reasoning":"<10 words max>"}`

    this.aiQueue.push({
      key: cacheKey,
      prompt,
      onResult: (result) => {
        this.aiCache.set(cacheKey, { ...result, cachedAt: Date.now() })
        if (result.distraction && result.confidence >= CONFIDENCE_SUGGEST) {
          this.handleCandidate('domain', domain, result.confidence, {
            reasoning: `AI: ${result.reasoning} (${result.category})`,
            source: 'ai_url',
          })
        }
      },
    })
    void this.drainAiQueue()
  }

  private queueAiSearchCheck(query: string, goals: string[]): void {
    const cacheKey = `search:${query.slice(0, 40)}:${goals.join('|').slice(0, 40)}`
    const cached = this.aiCache.get(cacheKey)
    if (cached && Date.now() - cached.cachedAt < AI_CACHE_TTL) {
      if (cached.distraction) {
        this.onSearchAlert?.(query, '', cached.category)
      }
      return
    }

    const goalText = goals.join('; ')
    const prompt = `A user searched for: "${query}"
Their goals: ${goalText}

Does this search suggest they're about to visit a distraction or off-task site?
Reply with JSON only, no markdown: {"distraction":true/false,"predicted_domain":"domain.com or empty","category":"<3 words>","confidence":0.0-1.0,"reasoning":"<10 words max>"}`

    this.aiQueue.push({
      key: cacheKey,
      prompt,
      onResult: (result) => {
        this.aiCache.set(cacheKey, { ...result, cachedAt: Date.now() })
        if (result.distraction && result.confidence >= 0.65) {
          this.onSearchAlert?.(query, (result as AiSearchEval).predicted_domain ?? '', result.category)
        }
      },
    })
    void this.drainAiQueue()
  }

  private async drainAiQueue(): Promise<void> {
    if (this.aiProcessing || this.aiQueue.length === 0 || !this.client) return
    // Free AI allowance exhausted — drop queued reasoning. Exact domain/keyword
    // matching (handleCandidate) still works without AI, so blocking continues.
    if (!canUseAi()) { this.aiQueue.length = 0; return }
    this.aiProcessing = true

    while (this.aiQueue.length > 0) {
      const item = this.aiQueue.shift()!
      // Rate limit
      const since = Date.now() - this.lastAiCallTs
      if (since < AI_RATE_LIMIT_MS) {
        await sleep(AI_RATE_LIMIT_MS - since)
      }

      try {
        this.lastAiCallTs = Date.now()
        const response = await this.client.messages.create({
          model: this.model,
          max_tokens: 80,
          messages: [{ role: 'user', content: item.prompt }],
        })
        recordUsage(this.model, response.usage?.input_tokens ?? 0, response.usage?.output_tokens ?? 0)
        const text = response.content.find((b) => b.type === 'text')?.text ?? ''
        const jsonMatch = text.match(/\{[\s\S]*?\}/)
        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[0]) as AiEval
          item.onResult(parsed)
        }
      } catch (e) {
        console.error('[InferenceEngine] AI eval failed:', e)
      }
    }

    this.aiProcessing = false
  }

  // ── Background sweep ──────────────────────────────────────────────────────

  runBackgroundSweep(): void {
    if (!this.active) return
    const t0 = Date.now()
    debugLog('sweep:start', {})
    try {
      this.sweepDomains()
      this.sweepApps()
      debugLog('sweep:complete', { durationMs: Date.now() - t0 })
    } catch (e) {
      debugLog('sweep:error', { error: String(e) })
      console.error('[InferenceEngine] sweep error:', e)
    }
  }

  private sweepDomains(): void {
    const db = getDb()
    const sinceMs = Date.now() - 7 * 24 * 3600000
    const store = getStore()
    const blocked = new Set(store.blocklist.domains.map((d) => d.domain))

    const rows = db.exec(`
      SELECT
        lower(replace(replace(substr(url, instr(url,'://')+3,
          CASE WHEN instr(substr(url,instr(url,'://')+3),'/') > 0
               THEN instr(substr(url,instr(url,'://')+3),'/')-1
               ELSE length(substr(url,instr(url,'://')+3)) END
        ),'www.',''),'WWW.','')) as domain,
        COUNT(*) as visits, SUM(duration_ms) as total_ms, MAX(is_distraction) as is_dist
      FROM events
      WHERE ts > ? AND url IS NOT NULL AND duration_ms IS NOT NULL AND url LIKE 'http%'
      GROUP BY domain
      HAVING total_ms > ? AND visits >= ? AND is_dist = 1
      ORDER BY total_ms DESC LIMIT 40
    `, [sinceMs, MIN_TIME_MS, MIN_VISITS])

    if (!rows[0]) return
    for (const row of rows[0].values) {
      const domain = (row[0] as string ?? '').trim()
      const visits = row[1] as number
      const totalMs = row[2] as number
      if (!domain || domain.length < 3 || blocked.has(domain)) continue
      const existing = getInferences().find(
        (i) => i.value === domain && ['pending', 'auto_applied'].includes(i.status)
      )
      if (existing) continue
      const confidence = this.scoreDomainFromHistory(domain, visits, totalMs)
      if (confidence >= CONFIDENCE_SUGGEST) {
        const goals = getActiveGoals()
        this.handleCandidate('domain', domain, confidence, {
          reasoning: `visited ${visits}× in 7 days (${Math.round(totalMs / 60000)}min total)`,
          source: 'sweep', goalId: goals[0]?.id,
        })
      }
    }
  }

  private sweepApps(): void {
    const db = getDb()
    const sinceMs = Date.now() - 7 * 24 * 3600000
    const store = getStore()
    const blocked = new Set(store.blocklist.processes.map((p) => p.name))

    const rows = db.exec(`
      SELECT app, COUNT(*) as visits, SUM(duration_ms) as total_ms, MAX(is_distraction) as is_dist
      FROM events WHERE ts > ? AND app IS NOT NULL AND duration_ms IS NOT NULL
      GROUP BY app HAVING total_ms > ? AND visits >= ? AND is_dist = 1
      ORDER BY total_ms DESC LIMIT 20
    `, [sinceMs, MIN_TIME_MS * 2, MIN_VISITS])

    if (!rows[0]) return
    for (const row of rows[0].values) {
      const app = (row[0] as string ?? '').toLowerCase()
      const visits = row[1] as number
      const totalMs = row[2] as number
      if (!app || blocked.has(app)) continue
      const existing = getInferences().find(
        (i) => i.value === app && i.type === 'app' && ['pending', 'auto_applied'].includes(i.status)
      )
      if (existing) continue
      const confidence = this.scoreAppFromHistory(app, visits, totalMs)
      if (confidence >= CONFIDENCE_SUGGEST) {
        this.handleCandidate('app', app, confidence, {
          reasoning: `opened ${visits}× in 7 days (${Math.round(totalMs / 60000)}min total)`,
          source: 'sweep',
        })
      }
    }
  }

  // ── Scoring ────────────────────────────────────────────────────────────────

  private scoreDomain(domain: string, session: ActivitySession): number {
    if (ALL_DISTRACTION_DOMAINS.has(domain)) {
      const cat = DOMAIN_TO_CATEGORY.get(domain) ?? 'distraction'
      return CATEGORY_AUTO_BLOCK_SCORE[cat] ?? 0.75
    }
    let score = 0.25
    if (['social', 'entertainment'].includes(session.category)) score += 0.25
    if (session.category === 'gaming') score += 0.2
    if (session.duration > 10 * 60000) score += 0.1
    if (getActiveGoals().length > 0) score += 0.05
    return Math.min(0.99, score)
  }

  private scoreDomainFromHistory(domain: string, visits: number, totalMs: number): number {
    let score = ALL_DISTRACTION_DOMAINS.has(domain)
      ? (CATEGORY_AUTO_BLOCK_SCORE[DOMAIN_TO_CATEGORY.get(domain) ?? ''] ?? 0.70)
      : 0.20
    if (visits >= 5)  score = Math.min(0.99, score + 0.08)
    if (visits >= 15) score = Math.min(0.99, score + 0.07)
    if (totalMs > 20 * 60000) score = Math.min(0.99, score + 0.06)
    if (totalMs > 60 * 60000) score = Math.min(0.99, score + 0.08)
    return score
  }

  private scoreApp(app: string, session: ActivitySession): number {
    const distractApps = ['steam', 'epicgameslauncher', 'discord', 'vlc', 'obs64']
    let score = distractApps.some((a) => app.includes(a)) ? 0.60 : 0.25
    if (['entertainment', 'gaming', 'social'].includes(session.category)) score += 0.2
    if (session.duration > 15 * 60000) score += 0.1
    return Math.min(0.99, score)
  }

  private scoreAppFromHistory(app: string, visits: number, totalMs: number): number {
    const distractApps = ['steam', 'epicgameslauncher', 'discord', 'vlc', 'obs64']
    let score = distractApps.some((a) => app.includes(a)) ? 0.55 : 0.15
    if (visits >= 5) score += 0.12
    if (totalMs > 30 * 60000) score += 0.1
    return Math.min(0.99, score)
  }

  // ── Candidate handler ─────────────────────────────────────────────────────

  private handleCandidate(
    type: DbInference['type'],
    value: string,
    confidence: number,
    meta: { reasoning: string; source: string; title?: string; goalId?: string }
  ): void {
    const evidence = { source: meta.source, title: meta.title }
    const pct = Math.round(confidence * 100)
    const action = confidence >= CONFIDENCE_AUTO_BLOCK && this.blockingMode === 'auto' ? 'auto_block'
      : confidence >= CONFIDENCE_AUTO_BLOCK ? 'suggest(ask-mode)'
      : confidence >= CONFIDENCE_SUGGEST ? 'suggest'
      : 'skip'
    debugLog('inference:candidate', { type, value, confidence: pct, source: meta.source, action, reasoning: meta.reasoning?.slice(0, 80) })

    // Dedup: skip if a non-rejected inference already exists for this value.
    // Covers 'pending', 'auto_applied', AND 'confirmed' so a previously-confirmed
    // domain doesn't generate a duplicate entry on re-detection.
    const anyExisting = getInferences().find(
      (i) => i.value === value && i.status !== 'rejected'
    )
    if (anyExisting) return

    if (confidence >= CONFIDENCE_AUTO_BLOCK && this.blockingMode === 'auto') {
      insertInference({ type, value, goal_id: meta.goalId, confidence, reasoning: meta.reasoning, evidence, status: 'auto_applied', action: 'auto_block', created_at: Date.now() })

      if (type === 'domain') {
        const r = this.blockingEngine.addDomain(value)
        if (r.ok) {
          const store = getStore()
          if (!store.blocklist.domains.find((d) => d.domain === value)) {
            patchStore({
              blocklist: {
                ...store.blocklist,
                domains: [...store.blocklist.domains, { domain: value, addedAt: Date.now(), reason: `auto:${meta.source}:${Math.round(confidence * 100)}%` }],
              },
            })
          }
          this.onAutoBlock?.(value, confidence)
          console.log(`[InferenceEngine] AUTO-BLOCKED ${value} via ${meta.source} (${Math.round(confidence * 100)}%)`)
        }
      }
    } else if (confidence >= CONFIDENCE_SUGGEST || (confidence >= CONFIDENCE_AUTO_BLOCK && this.blockingMode === 'ask')) {
      const inf = insertInference({ type, value, goal_id: meta.goalId, confidence, reasoning: meta.reasoning, evidence, status: 'pending', action: 'suggest', created_at: Date.now() })
      this.onSuggest?.(inf)
      console.log(`[InferenceEngine] suggest ${value} via ${meta.source} (${Math.round(confidence * 100)}%)`)
    }
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  private shouldAiCheckUnknown(domain: string): boolean {
    // Only spend AI tokens on unknown domains that look potentially recreational
    const tld = domain.split('.').slice(-1)[0] ?? ''
    const suspiciousTlds = ['tv', 'gg', 'io', 'fun', 'wtf', 'lol', 'xxx', 'adult']
    if (suspiciousTlds.includes(tld)) return true
    const recreationalWords = ['game', 'play', 'fun', 'stream', 'watch', 'video', 'tube', 'clip', 'chat', 'social', 'free']
    return recreationalWords.some((w) => domain.includes(w))
  }

  private wasRecentlyProcessed(key: string): boolean {
    const t = this.recentlyProcessed.get(key)
    return t !== undefined && Date.now() - t < DEDUP_TTL
  }

  private markProcessed(key: string): void {
    this.recentlyProcessed.set(key, Date.now())
    if (this.recentlyProcessed.size > 300) {
      const cutoff = Date.now() - DEDUP_TTL
      for (const [k, v] of this.recentlyProcessed) if (v < cutoff) this.recentlyProcessed.delete(k)
    }
  }

  private buildSessionReasoning(value: string, confidence: number, session: ActivitySession): string {
    const parts: string[] = []
    if (ALL_DISTRACTION_DOMAINS.has(value)) {
      parts.push(`known ${DOMAIN_TO_CATEGORY.get(value) ?? 'distraction'} site`)
    }
    const mins = Math.round(session.duration / 60000)
    if (mins > 0) parts.push(`${mins}min session`)
    if (['social', 'entertainment'].includes(session.category)) parts.push(session.category)
    parts.push(`${Math.round(confidence * 100)}% confidence`)
    return parts.join(', ')
  }
}

// ── Types ─────────────────────────────────────────────────────────────────────

interface AiEval {
  distraction: boolean
  category: string
  confidence: number
  reasoning: string
}

interface AiSearchEval extends AiEval {
  predicted_domain?: string
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

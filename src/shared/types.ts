export type ElevationStatus = 'full' | 'soft' | 'unknown'

export interface BlockedDomain {
  domain: string
  addedAt: number
  expiresAt?: number
  reason?: string
}

export interface BlockedProcess {
  name: string
  addedAt: number
  expiresAt?: number
  reason?: string
}

export interface FocusSession {
  id: string
  startedAt: number
  endsAt?: number
  mode: 'normal' | 'deep'
  active: boolean
  allowlist?: string[]
}

export interface ScheduleRule {
  id: string
  name: string
  days: number[]
  startTime: string
  endTime: string
  domains: string[]
  processes: string[]
  active: boolean
}

export interface ScanIssue {
  id: string
  category: 'apps' | 'feeds' | 'notifications'
  severity: 'high' | 'medium' | 'low'
  title: string
  description: string
  affectedItem?: string
  fixAction?: string
}

export interface ScanResult {
  runAt: number
  issueCount: number
  issues: ScanIssue[]
  installedDistractors: string[]
  runningDistractors: string[]
  startupDistractors: string[]
  browserExtensionsFound: number
  recentDistractingSites: string[]
}

export interface UsageStat {
  app: string
  domain?: string
  minutes: number
  date: string
}

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  timestamp: number
}

export interface ChatAction {
  type: 'block' | 'unblock' | 'start-session' | 'stop-session' | 'show-stats'
  payload: Record<string, unknown>
}

// Activity tracking
export type AppCategory =
  | 'browser'
  | 'social'
  | 'entertainment'
  | 'gaming'
  | 'productivity'
  | 'communication'
  | 'development'
  | 'system'
  | 'other'

export interface ActivitySession {
  id: string
  app: string
  title: string
  url?: string
  category: AppCategory
  startTime: number
  endTime: number
  duration: number
  isDistraction: boolean
  // Set when this session was in a private/incognito/Tor browser window. In that case
  // the URL inside is intentionally not captured, so time is tracked but not attributed
  // to a domain. See src/shared/privacyMode.ts.
  privacy?: import('./privacyMode').PrivacyMode
}

export interface DailyStats {
  date: string
  focusedTime: number
  distractedTime: number
  neutralTime: number
  blockEvents: number
  focusSessions: number
  appBreakdown: { app: string; duration: number; category: AppCategory }[]
  focusScore: number
}

export interface HeuristicAlert {
  id: string
  type:
    | 'rapid-switching' | 'repeated-visits' | 'late-night' | 'long-session' | 'focus-drift'
    | 'doom-loop' | 'micro-escape' | 'notification-fomo' | 'video-rabbit-hole' | 'phantom-checking'
    | 'pre-task-avoidance' | 'news-anxiety' | 'tab-anxiety'
  severity: 'low' | 'medium' | 'high'
  title: string
  description: string
  detectedAt: number
  app?: string
  dismissed: boolean
  switchRate?: number
}

export interface WeeklyReport {
  weekStart: string
  weekEnd: string
  totalFocusedTime: number
  totalDistractedTime: number
  topDistractions: { app: string; duration: number }[]
  longestFocusSession: number
  totalFocusSessions: number
  focusScore: number
  blockEvents: number
  insights: string[]
  generatedAt: number
}

export interface AppSettings {
  trackingEnabled: boolean
  heuristicsEnabled: boolean
  weeklyReportEnabled: boolean
  productiveApps: string[]
  distractingApps: string[]
  focusGoalHoursPerDay: number
  ollamaUrl: string
  ollamaModel: string
  blockingMode?: 'auto' | 'ask'
  alwaysOn?: boolean
  // Share anonymized diagnostics (bug reports, crashes/freezes, AI-friction signals,
  // token usage) with the developer to help fix issues. Default on during beta.
  shareDiagnostics?: boolean
  /** Liquid glass: the window itself is see-through to the desktop (Windows 11 acrylic).
   *  Lives in the store, not localStorage, because main must read it when it CREATES the
   *  window: backgroundMaterial is only reliably applied at construction. */
  fullGlass?: boolean
  /** 0.15-0.9. How solid the glass tint is. */
  glassOpacity?: number
}

export interface BreakMode {
  endsAt: number
  reason?: string
}

export interface ContentRule {
  id: string
  domain: string
  displayName: string
  category: string
  severity: 'high' | 'medium' | 'low'
  selectors: string[]
  urlPatterns: string[]
  action: 'hide' | 'redirect' | 'blur' | 'overlay'
  redirectTarget?: string
  antiBypassSearchTerms: string[]
  antiBypassUrlPatterns: string[]
  enabled: boolean
  createdAt: number
  updatedAt: number
  autoApplied: boolean
}

export interface BypassAttempt {
  ruleId: string
  method: 'url_navigation' | 'search_query' | 'incognito_window' | 'mobile_redirect' | 'iframe_embed' | 'user_agent_spoof'
  url: string
  timestamp: number
  searchTerm?: string
}

export interface AppStore {
  blocklist: {
    domains: BlockedDomain[]
    processes: BlockedProcess[]
  }
  sessions: FocusSession[]
  schedules: ScheduleRule[]
  stats: UsageStat[]
  activitySessions: ActivitySession[]
  dailyStats: DailyStats[]
  heuristicAlerts: HeuristicAlert[]
  weeklyReports: WeeklyReport[]
  lastScan: ScanResult | null
  onboardingComplete: boolean
  elevation: ElevationStatus
  chatHistory: ChatMessage[]
  settings: AppSettings
  blockEventCount: number
  breakMode?: BreakMode
  contentRules?: ContentRule[]
  // Legacy local AI-spend estimate (superseded by the server-metered credit balance).
  aiUsageUsd?: number
  // Cached AI credit balance in micro-USD (1 credit = $0.001), mirrored from the backend.
  creditMicros?: number
  // Signed-in account: a 30-day website session token (ses_…) from /v1/auth/*.
  // Establishes identity in-app; the linked license key (cloudLicense) still drives
  // AI/cloud gating so existing billing/sync keep working unchanged.
  authToken?: string
  // Cloud ($5/mo) subscription state, when the user has linked a license key.
  cloudLicense?: string
  cloudActive?: boolean
  cloudTier?: string
  cloudEmail?: string
  // Feed-level blocks displayed in the Overview (enforced by the browser extension,
  // not the hosts file). Seeded with Reddit + Twitter/X on install.
  feedBlocks?: FeedBlock[]
  // Custom analytics cards the user built by describing what they want to see. The
  // AI assistant creates these via the create_analytics_card tool; the Analytics page
  // renders each one and recomputes it live from tracked activity.
  customAnalyticsCards?: CustomAnalyticsCard[]
  /** Seed card ids the user deleted. Remembered so re-seeding on launch never
   *  resurrects a default they threw away. */
  dismissedSeedIds?: string[]
  // Free-text context the user added on the Logic page to inform the AI. Injected
  // verbatim into the system prompt so it shapes the assistant's reasoning.
  userContext?: UserContextNote[]
  // Stable anonymous id for grouping this install's uploaded diagnostics.
  installId?: string
}

export interface UserContextNote {
  id: string
  text: string
  ts: number
}

// A saved, user-described analytics view. `spec` is the query the card recomputes
// from the activity log every time the Analytics page loads, so the card stays live.
// Where a card draws from. Activity is the tracked window log (the original and only
// source); the rest are the AI's own working memory, which is what makes Logic
// expressible as cards at all. The tools to MUTATE these already exist (add_goal,
// set_preference, resolve_inference), only reading them as cards is new.
export type CardSource = 'activity' | 'goals' | 'preferences' | 'inferences' | 'patterns' | 'schedules'

// How a card renders.
//
// The first four are the original vocabulary. The rest exist because of a hard
// constraint: every seeded card must be something the user could genuinely have asked
// the AI to build. With only bar/line/table/number, the app's own default views
// (the hour-of-week heatmap, the focused/distracted/idle bar, the today summary, the
// ranked diagnostics) could never be reproduced, and "you could have generated this"
// would be a lie. Growing the vocabulary is what keeps that promise true.
export type CardViz =
  | 'bar'       // ranked rows
  | 'line'      // trend over hour/weekday
  | 'table'     // detailed rows
  | 'number'    // single headline figure
  | 'heatmap'   // hour x weekday grid
  | 'progress'  // parts of a whole, as one bar
  | 'summary'   // headline figure + supporting breakdown
  | 'ranked'    // ranked rows with baseline + impact columns
  | 'list'      // plain items (goals, preferences, schedules)

export type CardKind = 'data' | 'action'

/** Which page a card lives on. Cards are the page; the page is just a canvas of them. */
export type CardPage = 'analytics' | 'logic' | 'timesheets' | 'deep-focus' | 'scheduler'

export interface AnalyticsQuerySpec {
  /** Defaults to 'activity' when absent, so cards saved before sources existed still run. */
  source?: CardSource
  rangeDays: number                                        // look-back window
  groupBy: 'app' | 'category' | 'domain' | 'hour' | 'weekday'
  metric: 'time' | 'sessions' | 'focus_ratio'
  distraction: 'all' | 'only' | 'exclude'                  // filter by distraction flag
  limit?: number
}

// A saved control, not a query. Deep Focus and Scheduler are control surfaces: "start a
// locked 90-minute session" is an action, and no query card can express it. An action
// card wraps a tool the agent already has, with its arguments pinned, so the user can
// keep and re-run it exactly like they keep a metric.
export interface CardAction {
  /** Must name a real agent tool, so an action card is only ever a saved tool call. */
  tool: 'start_focus_session' | 'stop_focus_session' | 'create_schedule' | 'remove_schedule'
    | 'block_category' | 'block_domain' | 'unblock_domain' | 'add_goal'
  params: Record<string, unknown>
  /** Button text, e.g. "Start 90 min". */
  label: string
  /** Actions that change the machine should confirm first. */
  confirm?: boolean
}

export interface StartupItem {
  id: string
  name: string
  command: string
  location: 'hkcu' | 'hklm' | 'folder'
  path?: string
  needsAdmin?: boolean
}

export interface Conversation {
  id: string
  title: string
  created_at: number
  updated_at: number
  message_count?: number
}

// A card is the unit the whole app is built from. Every page is a canvas of these, and
// the defaults that ship are seeds: real specs the AI genuinely would have produced, not
// bespoke components wearing a card costume.
//
// Back-compat is deliberate. `kind`, `page` and `order` are all optional, so the cards a
// user already has keep working and simply default to a data card on Analytics.
export interface CustomAnalyticsCard {
  id: string
  /** 'data' (a saved query) or 'action' (a saved control). Absent = 'data'. */
  kind?: CardKind
  title: string
  description?: string
  viz: CardViz
  spec: AnalyticsQuerySpec
  /** Present only when kind === 'action'. */
  action?: CardAction
  /** Absent = 'analytics', which is where every pre-existing card lives. */
  page?: CardPage
  /** Drag-to-reorder position within its page. Absent sorts by createdAt. */
  order?: number
  /** True for cards Attentify ships with. They are ordinary specs and can be edited or
   *  deleted like any other; the flag only marks what to re-seed for a fresh install. */
  seeded?: boolean
  createdAt: number
}

export interface FeedBlock {
  domain: string
  displayName: string
}

export interface UsageState {
  credits: number          // remaining AI credits (1 credit = $0.001)
  balanceMicros: number    // balance in micro-USD (source of truth for `credits`)
  subscribed: boolean      // $9.99/mo plan active
  hasOwnKey: boolean       // user pasted their own key → unmetered
  signedIn: boolean
  outOfCredit: boolean     // signed-in, metered, balance <= 0 → AI + adaptive features pause
  canUseAi: boolean
}

export interface CloudState {
  license: string | null
  active: boolean
  tier: string | null
  email: string | null
}

// ── System compatibility ────────────────────────────────────────────────────────
// 'ok'   — works as designed.
// 'warn', the app runs but a capability is degraded or unenforced.
// 'fail', a core capability cannot work on this machine.
export type CompatStatus = 'ok' | 'warn' | 'fail'

export interface CompatCheck {
  id: 'os' | 'arch' | 'elevation' | 'hosts' | 'tracking' | 'dataDir'
  label: string
  status: CompatStatus
  /** What was actually detected, e.g. "Windows 11 (build 26200)". */
  detail: string
  /** Present when the user can do something about a warn/fail. */
  fix?: string
}

export interface CompatReport {
  /** Worst status across all checks — drives the summary badge. */
  overall: CompatStatus
  checks: CompatCheck[]
  checkedAt: number
}

// Social sign-in providers supported by the backend OAuth flow.
export type AuthProvider = 'google' | 'facebook' | 'github' | 'microsoft'

// In-app account/session state, surfaced to the renderer (Settings + onboarding).
export interface AuthState {
  signedIn: boolean
  email: string | null
  tier: string | null
  subscribed: boolean
}

export interface AuthResult {
  ok: boolean
  error?: string
  auth?: AuthState
}

// Auto-update status pushed from the main process (electron-updater).
export type UpdateState = 'idle' | 'checking' | 'available' | 'downloading' | 'ready' | 'none' | 'error' | 'dev'
export interface UpdateStatus {
  state: UpdateState
  version?: string
  percent?: number
  message?: string
}

export interface ChangeEntry {
  ts: number
  category: 'hosts' | 'firewall' | 'policy' | 'startup' | 'system'
  action: string
  target?: string
  detail?: string
}

export type ViewName =
  | 'home'
  | 'logic'
  | 'activity'
  | 'timesheets'
  | 'focus-shield'
  | 'deep-clean'
  | 'insights'
  | 'analytics'
  | 'patterns'
  | 'actions'
  | 'settings'
  | 'focus-browser'
  | 'deep-focus'
  | 'schedule-manager'
  | 'algo-track'
  | 'focus-scan-results'
  | 'weekly-report'
  | 'store'

export interface IntentCheckResult {
  verdict: 'allow' | 'allow_timed' | 'deny'
  reason: string
  allowedMinutes?: number
  ollamaUsed: boolean
}

// ── Agent / streaming ────────────────────────────────────────────────────────

export interface AgentChunkEvent {
  text: string
}

export interface AgentDoneEvent {
  id: string
  content: string
  timestamp: number
  // The conversation this reply belongs to, so a chat view that unmounted and
  // remounted mid-stream can tell whether the completed reply is for the
  // conversation it's currently showing before reconciling.
  conversationId?: string
}

export interface AgentErrorEvent {
  message: string
}

export interface AgentProactiveEvent {
  text: string
  timestamp: number
}

export interface InferenceSuggestion {
  id: string
  type: 'domain' | 'app'
  value: string
  confidence: number
  reasoning?: string
  action?: string
}

export interface ApiKeyStatus {
  hasKey: boolean
}

// ── Classifier self-evaluation (mistake detection / calibration) ────────────────
// Produced by the feedback subsystem: for the automatic distraction decisions the user
// actually reacted to, does a given confidence band behave like its number claims?
export interface CalibrationBucket {
  band: string                 // e.g. "0.80-0.90"
  lo: number
  n: number
  disagreementRate: number
  expectedDisagreement: number // 1 - band midpoint
  gap: number                  // observed - expected; > 0 means over-confident
}

export interface CategoryCalibration {
  category: string
  n: number
  disagreementRate: number
}

export interface CalibrationReport {
  windowDays: number
  totalResolved: number
  buckets: CalibrationBucket[]
  categories: CategoryCalibration[]
  worstCategory?: CategoryCalibration
  generatedAt: number
}

// A learned correction the classifier consults before deciding: a context the user
// repeatedly reversed, at the narrowest scope the evidence supports.
export interface LearnedAdjustment {
  id: string
  ts: number
  scope: 'route' | 'domain_goal' | 'domain' | 'global'
  scope_key: string
  target_value?: string
  goal_id?: string
  kind: 'suppress' | 'downweight'
  weight_delta?: number
  reason?: string
  source?: string
  error_prob?: number
  support: number
  active: number
  updated_at?: number
  expires_at?: number
}

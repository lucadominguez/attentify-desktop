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
  // Estimated USD of AI spend against the bundled OpenRouter key (free-tier metering).
  aiUsageUsd?: number
  // Cloud ($5/mo) subscription state, when the user has linked a license key.
  cloudLicense?: string
  cloudActive?: boolean
  cloudTier?: string
  cloudEmail?: string
  // Feed-level blocks displayed in the Overview (enforced by the browser extension,
  // not the hosts file). Seeded with Reddit + Twitter/X on install.
  feedBlocks?: FeedBlock[]
}

export interface FeedBlock {
  domain: string
  displayName: string
}

export interface UsageState {
  usedUsd: number
  limitUsd: number
  remainingUsd: number
  subscribed: boolean
  hasOwnKey: boolean
  exhausted: boolean
}

export interface CloudState {
  license: string | null
  active: boolean
  tier: string | null
  email: string | null
}

export type ViewName =
  | 'home'
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

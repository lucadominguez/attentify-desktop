import { randomUUID } from 'crypto'
import { getDb, markDirty } from './db'
import type { ActivitySession, HeuristicAlert, AppCategory } from '../../shared/types'

// ── Types ──────────────────────────────────────────────────────────────────────

export interface DbEvent {
  id?: number
  ts: number
  type: 'focus_change' | 'idle_start' | 'idle_end' | 'block_triggered' | 'process_spawn' | 'url_visit'
  app?: string
  title?: string
  url?: string
  category?: string
  is_distraction?: boolean
  session_id?: string
  duration_ms?: number
}

export interface DbBlock {
  id: string
  type: 'domain' | 'process' | 'category'
  value: string
  source: 'user_explicit' | 'agent_inferred' | 'category_expansion' | 'schedule'
  reason?: string
  created_at: number
  expires_at?: number
  active: boolean
}

export interface DbGoal {
  id: string
  text: string
  priority: number
  created_at: number
  active: boolean
  cleared_at?: number
}

export interface DbPreference {
  id?: number
  key: string
  value: string
  scope: 'always' | 'session' | 'weekdays' | 'weekends' | 'morning' | 'evening'
  confidence: number
  source: 'user' | 'agent'
  created_at: number
  last_used_at: number
}

export interface DbPattern {
  id: string
  type: string
  severity: 'low' | 'medium' | 'high'
  title: string
  description: string
  evidence?: object
  detected_at: number
  session_id?: string
  dismissed: boolean
}

export interface DbAgentMessage {
  id: string
  role: 'user' | 'assistant' | 'tool'
  content: string
  tool_calls?: object
  tool_results?: object
  ts: number
  session_id?: string
}

export interface DbInference {
  id: string
  type: 'domain' | 'app'
  value: string
  goal_id?: string
  confidence: number
  reasoning?: string
  evidence?: object
  status: 'pending' | 'confirmed' | 'rejected' | 'auto_applied'
  action?: 'auto_block' | 'suggest' | 'ignore'
  created_at: number
  resolved_at?: number
}

export interface DbApp {
  name: string
  category: string
  classification: 'focus' | 'distract' | 'neutral' | 'unknown'
  confidence: number
  source: string
  first_seen: number
  last_seen: number
  total_ms: number
}

export interface DbDomain {
  domain: string
  category: string
  classification: 'focus' | 'distract' | 'neutral' | 'unknown'
  confidence: number
  source: string
  first_seen: number
  last_seen: number
  total_ms: number
}

// ── Event buffer (bulk write) ──────────────────────────────────────────────────

const _eventBuffer: DbEvent[] = []

export function bufferEvent(evt: DbEvent): void {
  _eventBuffer.push(evt)
}

export function flushEventBuffer(): void {
  if (_eventBuffer.length === 0) return
  const db = getDb()
  const events = _eventBuffer.splice(0)
  try {
    db.run('BEGIN')
    for (const e of events) {
      db.run(
        `INSERT INTO events (ts, type, app, title, url, category, is_distraction, session_id, duration_ms)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [e.ts, e.type, e.app ?? null, e.title ?? null, e.url ?? null,
          e.category ?? null, e.is_distraction ? 1 : 0, e.session_id ?? null, e.duration_ms ?? null]
      )
    }
    db.run('COMMIT')
    markDirty()
  } catch (err) {
    db.run('ROLLBACK')
    console.error('[repo] event flush failed:', err)
    // put events back
    _eventBuffer.unshift(...events)
  }
}

// ── Events ─────────────────────────────────────────────────────────────────────

export function getRecentEvents(sinceMs: number, limitRows = 500): DbEvent[] {
  const db = getDb()
  const rows = db.exec(
    'SELECT id,ts,type,app,title,url,category,is_distraction,session_id,duration_ms FROM events WHERE ts > ? ORDER BY ts DESC LIMIT ?',
    [sinceMs, limitRows]
  )
  if (!rows[0]) return []
  return rows[0].values.map((r) => ({
    id: r[0] as number,
    ts: r[1] as number,
    type: r[2] as DbEvent['type'],
    app: r[3] as string | undefined,
    title: r[4] as string | undefined,
    url: r[5] as string | undefined,
    category: r[6] as string | undefined,
    is_distraction: !!(r[7] as number),
    session_id: r[8] as string | undefined,
    duration_ms: r[9] as number | undefined,
  }))
}

export function getTopAppsByTime(sinceMs: number, limit = 20): { app: string; total_ms: number; is_distraction: number }[] {
  const db = getDb()
  const rows = db.exec(
    `SELECT app, SUM(duration_ms) as total_ms, MAX(is_distraction) as is_distraction
     FROM events WHERE ts > ? AND app IS NOT NULL AND duration_ms IS NOT NULL
     GROUP BY app ORDER BY total_ms DESC LIMIT ?`,
    [sinceMs, limit]
  )
  if (!rows[0]) return []
  return rows[0].values.map((r) => ({
    app: r[0] as string,
    total_ms: r[1] as number,
    is_distraction: r[2] as number,
  }))
}

export function getHourlyBreakdown(sinceMs: number): { hour: number; focused_ms: number; distracted_ms: number }[] {
  const db = getDb()
  const rows = db.exec(
    `SELECT CAST(strftime('%H', datetime(ts/1000, 'unixepoch')) AS INTEGER) as hour,
            SUM(CASE WHEN is_distraction=0 THEN duration_ms ELSE 0 END) as focused_ms,
            SUM(CASE WHEN is_distraction=1 THEN duration_ms ELSE 0 END) as distracted_ms
     FROM events WHERE ts > ? AND duration_ms IS NOT NULL
     GROUP BY hour ORDER BY hour`,
    [sinceMs]
  )
  if (!rows[0]) return []
  return rows[0].values.map((r) => ({
    hour: r[0] as number,
    focused_ms: (r[1] as number) ?? 0,
    distracted_ms: (r[2] as number) ?? 0,
  }))
}

// ── Apps & Domains registry ────────────────────────────────────────────────────

export function upsertApp(name: string, category: string, isDistraction: boolean, durationMs: number): void {
  const db = getDb()
  const now = Date.now()
  const classification = isDistraction ? 'distract' : category === 'development' || category === 'productivity' ? 'focus' : 'neutral'
  db.run(
    `INSERT INTO apps (name, category, classification, confidence, source, first_seen, last_seen, total_ms)
     VALUES (?, ?, ?, 0.7, 'observed', ?, ?, ?)
     ON CONFLICT(name) DO UPDATE SET
       last_seen = excluded.last_seen,
       total_ms = total_ms + excluded.total_ms,
       category = excluded.category`,
    [name, category, classification, now, now, durationMs]
  )
  markDirty()
}

export function upsertDomain(domain: string, category: string, isDistraction: boolean, durationMs: number): void {
  const db = getDb()
  const now = Date.now()
  const classification = isDistraction ? 'distract' : 'neutral'
  db.run(
    `INSERT INTO domains (domain, category, classification, confidence, source, first_seen, last_seen, total_ms)
     VALUES (?, ?, ?, 0.7, 'observed', ?, ?, ?)
     ON CONFLICT(domain) DO UPDATE SET
       last_seen = excluded.last_seen,
       total_ms = total_ms + excluded.total_ms`,
    [domain, category, classification, now, now, durationMs]
  )
  markDirty()
}

export function getApp(name: string): DbApp | null {
  const db = getDb()
  const rows = db.exec('SELECT name,category,classification,confidence,source,first_seen,last_seen,total_ms FROM apps WHERE name=?', [name])
  if (!rows[0]?.values[0]) return null
  const r = rows[0].values[0]
  return { name: r[0] as string, category: r[1] as string, classification: r[2] as DbApp['classification'], confidence: r[3] as number, source: r[4] as string, first_seen: r[5] as number, last_seen: r[6] as number, total_ms: r[7] as number }
}

export function getDomain(domain: string): DbDomain | null {
  const db = getDb()
  const rows = db.exec('SELECT domain,category,classification,confidence,source,first_seen,last_seen,total_ms FROM domains WHERE domain=?', [domain])
  if (!rows[0]?.values[0]) return null
  const r = rows[0].values[0]
  return { domain: r[0] as string, category: r[1] as string, classification: r[2] as DbDomain['classification'], confidence: r[3] as number, source: r[4] as string, first_seen: r[5] as number, last_seen: r[6] as number, total_ms: r[7] as number }
}

export function getDomains(sinceMs = 0, limit = 100): DbDomain[] {
  const db = getDb()
  const rows = db.exec(
    'SELECT domain,category,classification,confidence,source,first_seen,last_seen,total_ms FROM domains WHERE last_seen > ? ORDER BY total_ms DESC LIMIT ?',
    [sinceMs, limit]
  )
  if (!rows[0]) return []
  return rows[0].values.map((r) => ({
    domain: r[0] as string, category: r[1] as string,
    classification: r[2] as DbDomain['classification'], confidence: r[3] as number,
    source: r[4] as string, first_seen: r[5] as number, last_seen: r[6] as number,
    total_ms: r[7] as number,
  }))
}

export function getUnclassifiedHighTimeApps(sinceMs: number, minMs = 120000): { name: string; total_ms: number }[] {
  const db = getDb()
  const rows = db.exec(
    `SELECT a.name, SUM(e.duration_ms) as total_ms
     FROM apps a
     JOIN events e ON e.app = a.name
     WHERE e.ts > ? AND a.classification = 'unknown' AND e.duration_ms IS NOT NULL
     GROUP BY a.name HAVING total_ms > ?
     ORDER BY total_ms DESC LIMIT 20`,
    [sinceMs, minMs]
  )
  if (!rows[0]) return []
  return rows[0].values.map((r) => ({ name: r[0] as string, total_ms: r[1] as number }))
}

export function getUnclassifiedHighTimeDomains(sinceMs: number, minMs = 120000): { domain: string; total_ms: number }[] {
  const db = getDb()
  const rows = db.exec(
    `SELECT d.domain, SUM(e.duration_ms) as total_ms
     FROM domains d
     JOIN events e ON e.url LIKE '%' || d.domain || '%'
     WHERE e.ts > ? AND d.classification = 'unknown' AND e.duration_ms IS NOT NULL
     GROUP BY d.domain HAVING total_ms > ?
     ORDER BY total_ms DESC LIMIT 20`,
    [sinceMs, minMs]
  )
  if (!rows[0]) return []
  return rows[0].values.map((r) => ({ domain: r[0] as string, total_ms: r[1] as number }))
}

// ── Goals ──────────────────────────────────────────────────────────────────────

export function insertGoal(text: string, priority = 0): DbGoal {
  const goal: DbGoal = { id: randomUUID(), text, priority, created_at: Date.now(), active: true }
  getDb().run('INSERT INTO goals (id,text,priority,created_at,active) VALUES (?,?,?,?,1)', [goal.id, goal.text, goal.priority, goal.created_at])
  markDirty()
  return goal
}

export function getActiveGoals(): DbGoal[] {
  const rows = getDb().exec('SELECT id,text,priority,created_at,active,cleared_at FROM goals WHERE active=1 ORDER BY priority DESC')
  if (!rows[0]) return []
  return rows[0].values.map((r) => ({ id: r[0] as string, text: r[1] as string, priority: r[2] as number, created_at: r[3] as number, active: !!(r[4] as number), cleared_at: r[5] as number | undefined }))
}

export function clearGoal(id: string): void {
  getDb().run('UPDATE goals SET active=0, cleared_at=? WHERE id=?', [Date.now(), id])
  markDirty()
}

// ── Preferences ────────────────────────────────────────────────────────────────

export function upsertPreference(key: string, value: string, scope: DbPreference['scope'], confidence: number, source: 'user' | 'agent'): void {
  const now = Date.now()
  getDb().run(
    `INSERT INTO preferences (key,value,scope,confidence,source,created_at,last_used_at)
     VALUES (?,?,?,?,?,?,?)
     ON CONFLICT(key,scope) DO UPDATE SET value=excluded.value, confidence=excluded.confidence, last_used_at=excluded.last_used_at`,
    [key, value, scope, confidence, source, now, now]
  )
  markDirty()
}

export function getPreferences(query?: string): DbPreference[] {
  const db = getDb()
  let rows
  if (query) {
    rows = db.exec(
      `SELECT key,value,scope,confidence,source,created_at,last_used_at FROM preferences
       WHERE scope='always' OR key LIKE ? ORDER BY confidence DESC LIMIT 20`,
      [`%${query}%`]
    )
  } else {
    rows = db.exec('SELECT key,value,scope,confidence,source,created_at,last_used_at FROM preferences WHERE scope=\'always\' ORDER BY confidence DESC LIMIT 30')
  }
  if (!rows[0]) return []
  return rows[0].values.map((r) => ({
    key: r[0] as string, value: r[1] as string,
    scope: r[2] as DbPreference['scope'], confidence: r[3] as number,
    source: r[4] as DbPreference['source'], created_at: r[5] as number, last_used_at: r[6] as number,
  }))
}

export function deletePreference(key: string): void {
  getDb().run('DELETE FROM preferences WHERE key=?', [key])
  markDirty()
}

// ── Patterns ───────────────────────────────────────────────────────────────────

export function insertPattern(p: Omit<DbPattern, 'id'>): DbPattern {
  const pattern = { ...p, id: randomUUID() }
  getDb().run(
    'INSERT OR IGNORE INTO patterns (id,type,severity,title,description,evidence,detected_at,session_id,dismissed) VALUES (?,?,?,?,?,?,?,?,0)',
    [pattern.id, pattern.type, pattern.severity, pattern.title, pattern.description,
      pattern.evidence ? JSON.stringify(pattern.evidence) : null, pattern.detected_at, pattern.session_id ?? null]
  )
  markDirty()
  return pattern
}

export function getPatterns(sinceMs: number, activeOnly = false): DbPattern[] {
  const db = getDb()
  const sql = activeOnly
    ? 'SELECT id,type,severity,title,description,evidence,detected_at,session_id,dismissed FROM patterns WHERE detected_at>? AND dismissed=0 ORDER BY detected_at DESC LIMIT 100'
    : 'SELECT id,type,severity,title,description,evidence,detected_at,session_id,dismissed FROM patterns WHERE detected_at>? ORDER BY detected_at DESC LIMIT 100'
  const rows = db.exec(sql, [sinceMs])
  if (!rows[0]) return []
  return rows[0].values.map((r) => ({
    id: r[0] as string, type: r[1] as string, severity: r[2] as DbPattern['severity'],
    title: r[3] as string, description: r[4] as string,
    evidence: r[5] ? JSON.parse(r[5] as string) : undefined,
    detected_at: r[6] as number, session_id: r[7] as string | undefined, dismissed: !!(r[8] as number),
  }))
}

export function dismissPattern(id: string): void {
  getDb().run('UPDATE patterns SET dismissed=1 WHERE id=?', [id])
  markDirty()
}

// ── Agent messages ─────────────────────────────────────────────────────────────

export function insertAgentMessage(msg: Omit<DbAgentMessage, 'id'>): DbAgentMessage {
  const m = { ...msg, id: randomUUID() }
  getDb().run(
    'INSERT INTO agent_messages (id,role,content,tool_calls,tool_results,ts,session_id) VALUES (?,?,?,?,?,?,?)',
    [m.id, m.role, m.content, m.tool_calls ? JSON.stringify(m.tool_calls) : null,
      m.tool_results ? JSON.stringify(m.tool_results) : null, m.ts, m.session_id ?? null]
  )
  markDirty()
  return m
}

export function getAgentMessages(limit = 40): DbAgentMessage[] {
  const rows = getDb().exec(
    'SELECT id,role,content,tool_calls,tool_results,ts,session_id FROM agent_messages ORDER BY ts DESC LIMIT ?',
    [limit]
  )
  if (!rows[0]) return []
  return rows[0].values.reverse().map((r) => ({
    id: r[0] as string, role: r[1] as DbAgentMessage['role'], content: r[2] as string,
    tool_calls: r[3] ? JSON.parse(r[3] as string) : undefined,
    tool_results: r[4] ? JSON.parse(r[4] as string) : undefined,
    ts: r[5] as number, session_id: r[6] as string | undefined,
  }))
}

export function getConversationMessages(conversationId: string, limit = 200): DbAgentMessage[] {
  const rows = getDb().exec(
    'SELECT id,role,content,tool_calls,tool_results,ts,session_id FROM agent_messages WHERE session_id = ? ORDER BY ts ASC LIMIT ?',
    [conversationId, limit]
  )
  if (!rows[0]) return []
  return rows[0].values.map((r) => ({
    id: r[0] as string, role: r[1] as DbAgentMessage['role'], content: r[2] as string,
    tool_calls: r[3] ? JSON.parse(r[3] as string) : undefined,
    tool_results: r[4] ? JSON.parse(r[4] as string) : undefined,
    ts: r[5] as number, session_id: r[6] as string | undefined,
  }))
}

export function clearAgentMessages(conversationId?: string): void {
  if (conversationId) getDb().run('DELETE FROM agent_messages WHERE session_id = ?', [conversationId])
  else getDb().run('DELETE FROM agent_messages')
  markDirty()
}

// ── Diagnostics: issues (bugs/crashes/freezes/friction) + model usage ───────────

export interface DbIssue {
  id: string
  ts: number
  kind: 'bug_manual' | 'crash' | 'freeze' | 'ai_friction' | 'classifier_mistake'
  category?: string
  severity?: string
  title?: string
  description?: string
  context?: unknown        // object; stored as JSON
  status?: string
  uploaded?: number
}

export function insertIssue(i: Omit<DbIssue, 'id' | 'ts'> & { id?: string; ts?: number }): DbIssue {
  const row: DbIssue = {
    id: i.id ?? randomUUID(),
    ts: i.ts ?? Date.now(),
    kind: i.kind,
    category: i.category,
    severity: i.severity ?? 'medium',
    title: i.title,
    description: i.description,
    context: i.context,
    status: i.status ?? 'open',
    uploaded: 0,
  }
  getDb().run(
    'INSERT INTO issues (id,ts,kind,category,severity,title,description,context,status,uploaded) VALUES (?,?,?,?,?,?,?,?,?,0)',
    [row.id, row.ts, row.kind, row.category ?? null, row.severity ?? 'medium', row.title ?? null,
      row.description ?? null, row.context != null ? JSON.stringify(row.context) : null, row.status ?? 'open']
  )
  // Keep the local table bounded.
  getDb().run('DELETE FROM issues WHERE id NOT IN (SELECT id FROM issues ORDER BY ts DESC LIMIT 500)')
  markDirty()
  return row
}

function mapIssue(r: unknown[]): DbIssue {
  return {
    id: r[0] as string, ts: r[1] as number, kind: r[2] as DbIssue['kind'],
    category: r[3] as string | undefined, severity: r[4] as string | undefined,
    title: r[5] as string | undefined, description: r[6] as string | undefined,
    context: r[7] ? (() => { try { return JSON.parse(r[7] as string) } catch { return r[7] } })() : undefined,
    status: r[8] as string | undefined, uploaded: r[9] as number | undefined,
  }
}

export function listIssues(limit = 200): DbIssue[] {
  const rows = getDb().exec('SELECT id,ts,kind,category,severity,title,description,context,status,uploaded FROM issues ORDER BY ts DESC LIMIT ?', [limit])
  return (rows[0]?.values ?? []).map(mapIssue)
}

export function getUnuploadedIssues(limit = 50): DbIssue[] {
  const rows = getDb().exec('SELECT id,ts,kind,category,severity,title,description,context,status,uploaded FROM issues WHERE uploaded = 0 ORDER BY ts ASC LIMIT ?', [limit])
  return (rows[0]?.values ?? []).map(mapIssue)
}

export function markIssuesUploaded(ids: string[]): void {
  if (ids.length === 0) return
  const db = getDb()
  for (const id of ids) db.run('UPDATE issues SET uploaded = 1 WHERE id = ?', [id])
  markDirty()
}

// Record per-model token usage (aggregated by UTC day). Always called, regardless of
// whose key paid — this powers the admin panel's token/cost breakdown.
export function recordModelUsage(model: string, inputTokens: number, outputTokens: number, costUsd: number): void {
  const day = new Date().toISOString().split('T')[0]!
  const db = getDb()
  db.run(
    `INSERT INTO usage_stats (day,model,input_tokens,output_tokens,cost_usd,calls,synced)
     VALUES (?,?,?,?,?,1,0)
     ON CONFLICT(day,model) DO UPDATE SET
       input_tokens = input_tokens + excluded.input_tokens,
       output_tokens = output_tokens + excluded.output_tokens,
       cost_usd = cost_usd + excluded.cost_usd,
       calls = calls + 1,
       synced = 0`,
    [day, model, inputTokens, outputTokens, costUsd]
  )
  markDirty()
}

export interface DbUsageStat { day: string; model: string; input_tokens: number; output_tokens: number; cost_usd: number; calls: number }

export function getUnsyncedUsage(): DbUsageStat[] {
  const rows = getDb().exec('SELECT day,model,input_tokens,output_tokens,cost_usd,calls FROM usage_stats WHERE synced = 0')
  return (rows[0]?.values ?? []).map((r) => ({ day: r[0] as string, model: r[1] as string, input_tokens: r[2] as number, output_tokens: r[3] as number, cost_usd: r[4] as number, calls: r[5] as number }))
}

export function markUsageSynced(rows: { day: string; model: string }[]): void {
  const db = getDb()
  for (const r of rows) db.run('UPDATE usage_stats SET synced = 1 WHERE day = ? AND model = ?', [r.day, r.model])
  markDirty()
}

// ── Checkpoints (Cursor-style state snapshots per message) ──────────────────────

export interface DbCheckpoint {
  id: string
  conversation_id?: string
  message_id?: string
  ts: number
  label?: string
  snapshot: string
}

export function insertCheckpoint(c: Omit<DbCheckpoint, 'id'>): DbCheckpoint {
  const id = randomUUID()
  getDb().run(
    'INSERT INTO checkpoints (id,conversation_id,message_id,ts,label,snapshot) VALUES (?,?,?,?,?,?)',
    [id, c.conversation_id ?? null, c.message_id ?? null, c.ts, c.label ?? null, c.snapshot]
  )
  // Keep only the most recent 200 checkpoints overall.
  getDb().run('DELETE FROM checkpoints WHERE id NOT IN (SELECT id FROM checkpoints ORDER BY ts DESC LIMIT 200)')
  markDirty()
  return { ...c, id }
}

export function listCheckpoints(conversationId?: string): { id: string; message_id?: string; ts: number; label?: string }[] {
  const rows = conversationId
    ? getDb().exec('SELECT id,message_id,ts,label FROM checkpoints WHERE conversation_id = ? ORDER BY ts ASC', [conversationId])
    : getDb().exec('SELECT id,message_id,ts,label FROM checkpoints ORDER BY ts ASC')
  if (!rows[0]) return []
  return rows[0].values.map((r) => ({ id: r[0] as string, message_id: r[1] as string | undefined, ts: r[2] as number, label: r[3] as string | undefined }))
}

export function getCheckpoint(id: string): DbCheckpoint | null {
  const rows = getDb().exec('SELECT id,conversation_id,message_id,ts,label,snapshot FROM checkpoints WHERE id = ?', [id])
  const v = rows[0]?.values[0]
  if (!v) return null
  return { id: v[0] as string, conversation_id: v[1] as string | undefined, message_id: v[2] as string | undefined, ts: v[3] as number, label: v[4] as string | undefined, snapshot: v[5] as string }
}

// ── Conversations ──────────────────────────────────────────────────────────────

export interface DbConversation {
  id: string
  title: string
  created_at: number
  updated_at: number
  message_count?: number
  last_message?: string
}

export function createConversation(title = 'New chat'): DbConversation {
  const now = Date.now()
  const id = randomUUID()
  getDb().run('INSERT INTO conversations (id,title,created_at,updated_at) VALUES (?,?,?,?)', [id, title, now, now])
  markDirty()
  return { id, title, created_at: now, updated_at: now }
}

export function listConversations(): DbConversation[] {
  const rows = getDb().exec(
    `SELECT c.id, c.title, c.created_at, c.updated_at,
            (SELECT COUNT(*) FROM agent_messages m WHERE m.session_id = c.id) AS cnt
     FROM conversations c ORDER BY c.updated_at DESC LIMIT 100`
  )
  if (!rows[0]) return []
  return rows[0].values.map((r) => ({
    id: r[0] as string, title: r[1] as string, created_at: r[2] as number, updated_at: r[3] as number,
    message_count: r[4] as number,
  }))
}

export function touchConversation(id: string): void {
  getDb().run('UPDATE conversations SET updated_at = ? WHERE id = ?', [Date.now(), id])
  markDirty()
}

export function renameConversation(id: string, title: string): void {
  getDb().run('UPDATE conversations SET title = ?, updated_at = updated_at WHERE id = ?', [title.slice(0, 80), id])
  markDirty()
}

export function deleteConversation(id: string): void {
  getDb().run('DELETE FROM agent_messages WHERE session_id = ?', [id])
  getDb().run('DELETE FROM conversations WHERE id = ?', [id])
  markDirty()
}

// One-time-ish maintenance: ensure a default conversation exists, adopt any legacy
// messages that were stored without a conversation id, and scrub tool-call JSON that
// leaked into stored assistant text before the sanitizer existed.
export function ensureConversations(sanitize: (s: string) => string): string {
  const db = getDb()

  // Purge internal classifier prompts/replies that the browser extension used to proxy
  // through the chat agent (they leaked into chat history). Matches the classifier's
  // distinctive signature so real user messages are never touched.
  db.run(
    "DELETE FROM agent_messages WHERE content LIKE '%analyze browsing context%' OR content LIKE '%distractionProbability%' OR content LIKE '%goalAligned%'"
  )

  let existing = listConversations()
  let defaultId: string
  if (existing.length === 0) {
    defaultId = createConversation('Chat').id
    existing = listConversations()
  } else {
    defaultId = existing[0]!.id
  }
  // Adopt orphaned (null session_id) messages into the default conversation.
  db.run('UPDATE agent_messages SET session_id = ? WHERE session_id IS NULL', [defaultId])

  // Scrub stored assistant messages through the sanitizer; delete any that become empty.
  const rows = db.exec("SELECT id, content FROM agent_messages WHERE role = 'assistant'")
  for (const r of rows[0]?.values ?? []) {
    const id = r[0] as string
    const raw = (r[1] as string) ?? ''
    const cleaned = sanitize(raw.startsWith('[proactive] ') ? '[proactive] ' + sanitize(raw.slice(12)) : raw)
    if (cleaned.trim() === '' || cleaned.trim() === '[proactive]') {
      db.run('DELETE FROM agent_messages WHERE id = ?', [id])
    } else if (cleaned !== raw) {
      db.run('UPDATE agent_messages SET content = ? WHERE id = ?', [cleaned, id])
    }
  }
  markDirty()
  return defaultId
}

export function purgeOldData(retentionMs = 90 * 24 * 3600000): void {
  const cutoff = Date.now() - retentionMs
  getDb().run('DELETE FROM events WHERE ts < ?', [cutoff])
  getDb().run('DELETE FROM agent_messages WHERE ts < ?', [cutoff])
  // Keep inferences and patterns, they're small and historically useful
  markDirty()
}

// ── Inferences ─────────────────────────────────────────────────────────────────

export function insertInference(inf: Omit<DbInference, 'id'>): DbInference {
  const i = { ...inf, id: randomUUID() }

  // Deduplicate: don't insert if any non-rejected inference already exists for this value
  const existing = getDb().exec(
    "SELECT id FROM inferences WHERE value=? AND status NOT IN ('rejected') LIMIT 1",
    [i.value]
  )
  if (existing[0]?.values[0]) return { ...i, id: existing[0].values[0][0] as string }

  getDb().run(
    'INSERT INTO inferences (id,type,value,goal_id,confidence,reasoning,evidence,status,action,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)',
    [i.id, i.type, i.value, i.goal_id ?? null, i.confidence, i.reasoning ?? null,
      i.evidence ? JSON.stringify(i.evidence) : null, i.status, i.action ?? null, i.created_at]
  )
  markDirty()
  return i
}

export function getInferences(status?: DbInference['status']): DbInference[] {
  const db = getDb()
  const rows = status
    ? db.exec('SELECT id,type,value,goal_id,confidence,reasoning,evidence,status,action,created_at,resolved_at FROM inferences WHERE status=? ORDER BY created_at DESC LIMIT 50', [status])
    : db.exec('SELECT id,type,value,goal_id,confidence,reasoning,evidence,status,action,created_at,resolved_at FROM inferences ORDER BY created_at DESC LIMIT 50')
  if (!rows[0]) return []
  return rows[0].values.map((r) => ({
    id: r[0] as string, type: r[1] as DbInference['type'], value: r[2] as string,
    goal_id: r[3] as string | undefined, confidence: r[4] as number,
    reasoning: r[5] as string | undefined, evidence: r[6] ? JSON.parse(r[6] as string) : undefined,
    status: r[7] as DbInference['status'], action: r[8] as DbInference['action'],
    created_at: r[9] as number, resolved_at: r[10] as number | undefined,
  }))
}

export function resolveInference(id: string, status: 'confirmed' | 'rejected'): void {
  getDb().run('UPDATE inferences SET status=?, resolved_at=? WHERE id=?', [status, Date.now(), id])
  markDirty()
}

export function getPastInferenceOutcomes(value: string): { status: string; count: number }[] {
  const rows = getDb().exec(
    "SELECT status, COUNT(*) as cnt FROM inferences WHERE value LIKE ? AND status IN ('confirmed','rejected') GROUP BY status",
    [`%${value}%`]
  )
  if (!rows[0]) return []
  return rows[0].values.map((r) => ({ status: r[0] as string, count: r[1] as number }))
}

// ── Sessions ───────────────────────────────────────────────────────────────────

export function insertSession(s: { id: string; started_at: number; mode: string; goal_id?: string }): void {
  getDb().run('INSERT OR IGNORE INTO sessions (id,started_at,mode,goal_id) VALUES (?,?,?,?)',
    [s.id, s.started_at, s.mode, s.goal_id ?? null])
  markDirty()
}

export function endSession(id: string): void {
  getDb().run('UPDATE sessions SET ended_at=? WHERE id=?', [Date.now(), id])
  markDirty()
}

// ── Migrate from state.json ────────────────────────────────────────────────────

export function migrateFromStateJson(state: {
  activitySessions?: ActivitySession[]
  heuristicAlerts?: HeuristicAlert[]
  blocklist?: { domains: { domain: string; addedAt: number; expiresAt?: number; reason?: string }[]; processes: { name: string; addedAt: number }[] }
  sessions?: { id: string; startedAt: number; mode: 'normal' | 'deep'; active: boolean; endsAt?: number }[]
}): void {
  const db = getDb()

  try {
    db.run('BEGIN')

    // Activity sessions → events
    for (const s of state.activitySessions ?? []) {
      db.run(
        'INSERT OR IGNORE INTO events (ts,type,app,title,url,category,is_distraction,duration_ms) VALUES (?,?,?,?,?,?,?,?)',
        [s.startTime, 'focus_change', s.app, s.title, s.url ?? null, s.category, s.isDistraction ? 1 : 0, s.duration]
      )
      // Upsert app registry
      db.run(
        `INSERT INTO apps (name,category,classification,confidence,source,first_seen,last_seen,total_ms)
         VALUES (?,?,?,0.7,'observed',?,?,?)
         ON CONFLICT(name) DO UPDATE SET last_seen=MAX(last_seen,excluded.last_seen), total_ms=total_ms+excluded.total_ms`,
        [s.app, s.category, s.isDistraction ? 'distract' : 'unknown', s.startTime, s.endTime, s.duration]
      )
    }

    // Heuristic alerts → patterns
    for (const a of state.heuristicAlerts ?? []) {
      db.run(
        'INSERT OR IGNORE INTO patterns (id,type,severity,title,description,detected_at,dismissed) VALUES (?,?,?,?,?,?,?)',
        [a.id, a.type, a.severity, a.title, a.description, a.detectedAt, a.dismissed ? 1 : 0]
      )
    }

    // Blocklist → blocks
    for (const d of state.blocklist?.domains ?? []) {
      db.run(
        'INSERT OR IGNORE INTO blocks (id,type,value,source,reason,created_at,expires_at,active) VALUES (?,?,?,?,?,?,?,1)',
        [randomUUID(), 'domain', d.domain, 'user_explicit', d.reason ?? null, d.addedAt, d.expiresAt ?? null]
      )
    }
    for (const p of state.blocklist?.processes ?? []) {
      db.run(
        'INSERT OR IGNORE INTO blocks (id,type,value,source,created_at,active) VALUES (?,?,?,?,?,1)',
        [randomUUID(), 'process', p.name, 'user_explicit', p.addedAt]
      )
    }

    // Sessions
    for (const s of state.sessions ?? []) {
      db.run(
        'INSERT OR IGNORE INTO sessions (id,started_at,ended_at,mode) VALUES (?,?,?,?)',
        [s.id, s.startedAt, s.active ? null : (s.endsAt ?? s.startedAt), s.mode]
      )
    }

    db.run('COMMIT')
    markDirty()
    console.log('[db] migration from state.json complete')
  } catch (e) {
    db.run('ROLLBACK')
    console.error('[db] state.json migration failed:', e)
  }
}

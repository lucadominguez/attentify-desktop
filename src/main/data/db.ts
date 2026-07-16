import { app } from 'electron'
import { join } from 'path'
import { readFileSync, writeFileSync, existsSync } from 'fs'
import initSqlJs, { type Database, type SqlJsStatic } from 'sql.js'

let _SQL: SqlJsStatic | null = null
let _db: Database | null = null
let _dbPath: string | null = null
let _flushTimer: ReturnType<typeof setInterval> | null = null
let _dirty = false

export async function openDatabase(): Promise<Database> {
  if (_db) return _db

  const wasmPath = join(__dirname, '../../node_modules/sql.js/dist/sql-wasm.wasm')
  _SQL = await initSqlJs({ locateFile: () => wasmPath })

  _dbPath = join(app.getPath('userData'), 'daemon.db')

  if (existsSync(_dbPath)) {
    const buf = readFileSync(_dbPath)
    _db = new _SQL.Database(buf)
  } else {
    _db = new _SQL.Database()
  }

  runMigrations(_db)

  // Persist to disk on an interval, but only when dirty. sql.js has no incremental
  // write — flushToDisk() serializes the ENTIRE database each time, so we keep the
  // cadence modest (10s) to avoid re-exporting a growing DB several times a second
  // under active tracking. Worst-case data loss on a hard crash is ~10s of events;
  // a clean quit always flushes (closeDatabase), and the event buffer batches writes.
  _flushTimer = setInterval(() => {
    if (_dirty) flushToDisk()
  }, FLUSH_INTERVAL_MS)

  return _db
}

const FLUSH_INTERVAL_MS = 10_000

export function getDb(): Database {
  if (!_db) throw new Error('Database not initialized — call openDatabase() first')
  return _db
}

// Expose the initialized sql.js runtime so other modules (e.g. the browser-history
// importer) can open external SQLite files without re-initializing the wasm.
export function getSqlJs(): SqlJsStatic {
  if (!_SQL) throw new Error('sql.js not initialized — call openDatabase() first')
  return _SQL
}

export function markDirty(): void {
  _dirty = true
}

export function flushToDisk(): void {
  if (!_db || !_dbPath) return
  try {
    const data = _db.export()
    writeFileSync(_dbPath, Buffer.from(data))
    _dirty = false
  } catch (e) {
    console.error('[db] flush failed:', e)
  }
}

export function closeDatabase(): void {
  if (_flushTimer) clearInterval(_flushTimer)
  flushToDisk()
  _db?.close()
  _db = null
}

// ── Migrations (embedded, no filesystem dependency) ──────────────────────────

const MIGRATIONS: Record<string, string> = {
  '001_initial.sql': `
CREATE TABLE IF NOT EXISTS _migrations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  applied_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS events (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  ts           INTEGER NOT NULL,
  type         TEXT    NOT NULL,
  app          TEXT,
  title        TEXT,
  url          TEXT,
  category     TEXT,
  is_distraction INTEGER NOT NULL DEFAULT 0,
  session_id   TEXT,
  duration_ms  INTEGER
);
CREATE INDEX IF NOT EXISTS idx_events_ts  ON events(ts);
CREATE INDEX IF NOT EXISTS idx_events_app ON events(app);
CREATE TABLE IF NOT EXISTS sessions (
  id             TEXT PRIMARY KEY,
  started_at     INTEGER NOT NULL,
  ended_at       INTEGER,
  mode           TEXT    NOT NULL,
  goal_id        TEXT,
  blocks_applied TEXT,
  bypasses       TEXT,
  outcome        TEXT
);
CREATE TABLE IF NOT EXISTS blocks (
  id         TEXT    PRIMARY KEY,
  type       TEXT    NOT NULL,
  value      TEXT    NOT NULL,
  source     TEXT    NOT NULL,
  reason     TEXT,
  created_at INTEGER NOT NULL,
  expires_at INTEGER,
  active     INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS idx_blocks_active ON blocks(active);
CREATE INDEX IF NOT EXISTS idx_blocks_value  ON blocks(value);
CREATE TABLE IF NOT EXISTS apps (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  name           TEXT    NOT NULL UNIQUE,
  category       TEXT    NOT NULL DEFAULT 'other',
  classification TEXT    NOT NULL DEFAULT 'unknown',
  confidence     REAL    NOT NULL DEFAULT 0,
  source         TEXT    NOT NULL DEFAULT 'observed',
  first_seen     INTEGER NOT NULL,
  last_seen      INTEGER NOT NULL,
  total_ms       INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS domains (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  domain         TEXT    NOT NULL UNIQUE,
  category       TEXT    NOT NULL DEFAULT 'other',
  classification TEXT    NOT NULL DEFAULT 'unknown',
  confidence     REAL    NOT NULL DEFAULT 0,
  source         TEXT    NOT NULL DEFAULT 'observed',
  first_seen     INTEGER NOT NULL,
  last_seen      INTEGER NOT NULL,
  total_ms       INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS goals (
  id         TEXT    PRIMARY KEY,
  text       TEXT    NOT NULL,
  priority   INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  active     INTEGER NOT NULL DEFAULT 1,
  cleared_at INTEGER
);
CREATE TABLE IF NOT EXISTS preferences (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  key         TEXT    NOT NULL,
  value       TEXT    NOT NULL,
  scope       TEXT    NOT NULL DEFAULT 'always',
  confidence  REAL    NOT NULL DEFAULT 0.8,
  source      TEXT    NOT NULL DEFAULT 'user',
  created_at  INTEGER NOT NULL,
  last_used_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_preferences_key_scope ON preferences(key, scope);
CREATE TABLE IF NOT EXISTS patterns (
  id          TEXT    PRIMARY KEY,
  type        TEXT    NOT NULL,
  severity    TEXT    NOT NULL,
  title       TEXT    NOT NULL,
  description TEXT    NOT NULL,
  evidence    TEXT,
  detected_at INTEGER NOT NULL,
  session_id  TEXT,
  dismissed   INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_patterns_ts ON patterns(detected_at);
CREATE TABLE IF NOT EXISTS agent_messages (
  id           TEXT    PRIMARY KEY,
  role         TEXT    NOT NULL,
  content      TEXT    NOT NULL,
  tool_calls   TEXT,
  tool_results TEXT,
  ts           INTEGER NOT NULL,
  session_id   TEXT
);
CREATE INDEX IF NOT EXISTS idx_agent_messages_ts ON agent_messages(ts);
CREATE TABLE IF NOT EXISTS inferences (
  id          TEXT    PRIMARY KEY,
  type        TEXT    NOT NULL,
  value       TEXT    NOT NULL,
  goal_id     TEXT,
  confidence  REAL    NOT NULL DEFAULT 0,
  reasoning   TEXT,
  evidence    TEXT,
  status      TEXT    NOT NULL DEFAULT 'pending',
  action      TEXT,
  created_at  INTEGER NOT NULL,
  resolved_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_inferences_status ON inferences(status);
CREATE INDEX IF NOT EXISTS idx_inferences_value  ON inferences(value);
`,
  '002_conversations.sql': `
CREATE TABLE IF NOT EXISTS conversations (
  id         TEXT PRIMARY KEY,
  title      TEXT NOT NULL DEFAULT 'New chat',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_agent_messages_session ON agent_messages(session_id);
`,
  '003_checkpoints.sql': `
CREATE TABLE IF NOT EXISTS checkpoints (
  id              TEXT PRIMARY KEY,
  conversation_id TEXT,
  message_id      TEXT,
  ts              INTEGER NOT NULL,
  label           TEXT,
  snapshot        TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_checkpoints_conv ON checkpoints(conversation_id);
CREATE INDEX IF NOT EXISTS idx_checkpoints_msg  ON checkpoints(message_id);
`,
  '004_diagnostics.sql': `
-- Issues: manual bug reports, auto-captured crashes/freezes, and AI-detected friction.
CREATE TABLE IF NOT EXISTS issues (
  id          TEXT PRIMARY KEY,
  ts          INTEGER NOT NULL,
  kind        TEXT NOT NULL,          -- bug_manual | crash | freeze | ai_friction
  category    TEXT,                   -- e.g. missed-nuance, detection-gap, wrong-action
  severity    TEXT NOT NULL DEFAULT 'medium',
  title       TEXT,
  description TEXT,
  context     TEXT,                   -- JSON blob (version, view, logs, chat excerpt, os)
  status      TEXT NOT NULL DEFAULT 'open',
  uploaded    INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_issues_ts ON issues(ts);
CREATE INDEX IF NOT EXISTS idx_issues_uploaded ON issues(uploaded);

-- Per-model token usage, aggregated by day, for cost visibility in the admin panel.
CREATE TABLE IF NOT EXISTS usage_stats (
  day           TEXT NOT NULL,        -- YYYY-MM-DD
  model         TEXT NOT NULL,
  input_tokens  INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  cost_usd      REAL NOT NULL DEFAULT 0,
  calls         INTEGER NOT NULL DEFAULT 0,
  synced        INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, model)
);
`,
  '005_feedback.sql': `
-- Decision log: every automatic distraction decision plus the features that drove it, so
-- feedback can be attached to it and the classifier calibrated against real outcomes. The
-- hand-set policy weight is stored SEPARATELY from the confidence, because they are
-- different quantities that were previously conflated in one field.
CREATE TABLE IF NOT EXISTS classification_decisions (
  id                 TEXT PRIMARY KEY,
  ts                 INTEGER NOT NULL,
  target_type        TEXT NOT NULL,        -- domain | app
  target_value       TEXT NOT NULL,
  category           TEXT,
  action             TEXT NOT NULL,        -- auto_block | suggest | skip
  confidence         REAL NOT NULL,        -- score used for the decision
  policy_weight      REAL,                 -- hand-set category base score (NOT model confidence)
  source             TEXT,                 -- url_visit | search_prediction | ai_url | session | sweep | title_match | escalation
  reasoning          TEXT,
  goal_id            TEXT,
  goal_text          TEXT,
  fingerprint        TEXT,                 -- hash(registeredDomain, pathClass, goalId, classifierVersion)
  features           TEXT,                 -- JSON: the raw feature bag
  classifier_version TEXT,
  outcome            TEXT,                 -- agree | disagree | override | ignored | null (filled by feedback)
  outcome_at         INTEGER
);
CREATE INDEX IF NOT EXISTS idx_cdec_ts    ON classification_decisions(ts);
CREATE INDEX IF NOT EXISTS idx_cdec_value ON classification_decisions(target_value);
CREATE INDEX IF NOT EXISTS idx_cdec_fp    ON classification_decisions(fingerprint);

-- Feedback: the user's reaction, read from real behaviour, linked to the decision that
-- caused it. This is the labeled-disagreement stream the mistake reviewer consumes.
CREATE TABLE IF NOT EXISTS classification_feedback (
  id            TEXT PRIMARY KEY,
  ts            INTEGER NOT NULL,
  decision_id   TEXT,                 -- FK -> classification_decisions.id (null if unmatched)
  target_type   TEXT,
  target_value  TEXT,
  fingerprint   TEXT,
  signal        TEXT NOT NULL,        -- bypass | quick_unblock | inference_rejected | inference_confirmed | interstitial_proceed | nudge_dismissed | nudge_acted
  user_decision TEXT NOT NULL,        -- agree | disagree | override
  goal_id       TEXT,
  latency_ms    INTEGER,              -- decision -> reaction, when known
  note          TEXT,
  reviewed      INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_cfb_ts       ON classification_feedback(ts);
CREATE INDEX IF NOT EXISTS idx_cfb_decision ON classification_feedback(decision_id);
CREATE INDEX IF NOT EXISTS idx_cfb_reviewed ON classification_feedback(reviewed);
`,
}

function runMigrations(db: Database): void {
  db.run(`CREATE TABLE IF NOT EXISTS _migrations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    applied_at INTEGER NOT NULL
  )`)

  const applied = new Set(
    db.exec('SELECT name FROM _migrations')[0]?.values.map((r) => r[0] as string) ?? []
  )

  for (const [name, sql] of Object.entries(MIGRATIONS).sort()) {
    if (applied.has(name)) continue
    try {
      db.run(sql)
      db.run('INSERT INTO _migrations (name, applied_at) VALUES (?, ?)', [name, Date.now()])
      console.log(`[db] applied migration: ${name}`)
    } catch (e) {
      console.error(`[db] migration ${name} failed:`, e)
      throw e
    }
  }

  markDirty()
}

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
  // write — flushToDisk() serializes the ENTIRE database each time — so we keep the
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

// ── Migrations (embedded — no filesystem dependency) ──────────────────────────

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

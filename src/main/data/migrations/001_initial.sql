-- Migration 001: initial schema

CREATE TABLE IF NOT EXISTS _migrations (
  id   INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT    NOT NULL UNIQUE,
  applied_at INTEGER NOT NULL
);

-- Raw event firehose
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

-- Focus sessions
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

-- Blocking rules
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

-- App registry
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

-- Domain registry
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

-- User goals
CREATE TABLE IF NOT EXISTS goals (
  id         TEXT    PRIMARY KEY,
  text       TEXT    NOT NULL,
  priority   INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  active     INTEGER NOT NULL DEFAULT 1,
  cleared_at INTEGER
);

-- Agent memory / preferences
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

-- Behavioral pattern detections
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

-- Full agent chat history
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

-- Novel distraction candidates from inference engine
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

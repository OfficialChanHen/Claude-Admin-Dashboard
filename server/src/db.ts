import fs from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { DATA_DIR, DB_PATH } from './config.js'

fs.mkdirSync(DATA_DIR, { recursive: true })

export const db = new DatabaseSync(DB_PATH)
db.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA foreign_keys = OFF;')

db.exec(`
CREATE TABLE IF NOT EXISTS projects (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  path        TEXT NOT NULL UNIQUE,
  aliases     TEXT NOT NULL DEFAULT '[]',
  color       TEXT,
  enabled     INTEGER NOT NULL DEFAULT 1,
  hidden      INTEGER NOT NULL DEFAULT 0,
  source      TEXT NOT NULL DEFAULT 'scan',
  github      TEXT,
  dev_cmd     TEXT,
  dev_port    INTEGER,
  prod_url    TEXT,
  framework   TEXT,
  added_at    INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS ingest_files (
  path    TEXT PRIMARY KEY,
  offset  INTEGER NOT NULL,
  size    INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  id            TEXT PRIMARY KEY,
  project_id    TEXT,
  cwd           TEXT,
  title         TEXT,
  entrypoint    TEXT,
  git_branch    TEXT,
  started_at    INTEGER,
  last_at       INTEGER,
  cost_usd      REAL,
  lines_added   INTEGER,
  lines_removed INTEGER,
  state         TEXT NOT NULL DEFAULT 'idle',
  current_prompt TEXT
);
CREATE INDEX IF NOT EXISTS sessions_project ON sessions(project_id, last_at);

CREATE TABLE IF NOT EXISTS agents (
  id                 TEXT PRIMARY KEY,
  session_id         TEXT NOT NULL,
  parent_tool_use_id TEXT,
  agent_type         TEXT,
  description        TEXT,
  model              TEXT,
  started_at         INTEGER,
  last_at            INTEGER
);
CREATE INDEX IF NOT EXISTS agents_session ON agents(session_id);

CREATE TABLE IF NOT EXISTS prompts (
  id         TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  ts         INTEGER NOT NULL,
  text       TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS prompts_session ON prompts(session_id, ts);

-- One row per API call. Claude Code logs each content block as its own line
-- with the same requestId and usage, so rows are keyed by request.
CREATE TABLE IF NOT EXISTS requests (
  id           TEXT PRIMARY KEY,
  session_id   TEXT NOT NULL,
  agent_id     TEXT,
  prompt_id    TEXT,
  project_id   TEXT,
  model        TEXT,
  ts           INTEGER NOT NULL,
  input        INTEGER NOT NULL DEFAULT 0,
  output       INTEGER NOT NULL DEFAULT 0,
  cache_read   INTEGER NOT NULL DEFAULT 0,
  cache_write  INTEGER NOT NULL DEFAULT 0,
  thinking     INTEGER NOT NULL DEFAULT 0,
  web_searches INTEGER NOT NULL DEFAULT 0,
  tool_calls   INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS requests_ts ON requests(ts);
CREATE INDEX IF NOT EXISTS requests_session ON requests(session_id, ts);
CREATE INDEX IF NOT EXISTS requests_prompt ON requests(prompt_id);

CREATE TABLE IF NOT EXISTS actions (
  id           TEXT PRIMARY KEY,
  session_id   TEXT NOT NULL,
  agent_id     TEXT,
  request_id   TEXT,
  project_id   TEXT,
  tool         TEXT NOT NULL,
  summary      TEXT,
  ts           INTEGER NOT NULL,
  done_ts      INTEGER,
  result_chars INTEGER,
  is_error     INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS actions_ts ON actions(ts);
CREATE INDEX IF NOT EXISTS actions_request ON actions(request_id);
CREATE INDEX IF NOT EXISTS actions_session ON actions(session_id, ts);

-- Claude Code's own per-session cost totals, used to calibrate token prices.
CREATE TABLE IF NOT EXISTS model_costs (
  session_id  TEXT NOT NULL,
  model       TEXT NOT NULL,
  input       INTEGER NOT NULL,
  output      INTEGER NOT NULL,
  cache_read  INTEGER NOT NULL,
  cache_write INTEGER NOT NULL,
  cost_usd    REAL NOT NULL,
  PRIMARY KEY (session_id, model)
);

CREATE TABLE IF NOT EXISTS limits (
  fetched_at      INTEGER PRIMARY KEY,
  source          TEXT NOT NULL,
  five_hour_pct   REAL,
  five_hour_reset TEXT,
  seven_day_pct   REAL,
  seven_day_reset TEXT,
  raw             TEXT
);

-- Sessions the 5 hour budget paused, so spare usage can finish them later.
CREATE TABLE IF NOT EXISTS paused (
  session_id  TEXT PRIMARY KEY,
  project_id  TEXT,
  paused_at   INTEGER NOT NULL,
  resumed_at  INTEGER
);

-- Prompts waiting for spare usage before a reset.
CREATE TABLE IF NOT EXISTS queue (
  id              TEXT PRIMARY KEY,
  project_id      TEXT NOT NULL,
  text            TEXT NOT NULL,
  permission_mode TEXT NOT NULL,
  added_at        INTEGER NOT NULL,
  started_at      INTEGER
);

-- HQ's own managers (one per busy project) and the boss over them. Each is
-- one session that HQ resumes for every round.
CREATE TABLE IF NOT EXISTS roles (
  session_id  TEXT PRIMARY KEY,
  role        TEXT NOT NULL,
  project_id  TEXT,
  started_at  INTEGER NOT NULL,
  last_round  INTEGER
);

-- What a manager or the boss reported at the end of a round.
CREATE TABLE IF NOT EXISTS reports (
  id          TEXT PRIMARY KEY,
  session_id  TEXT NOT NULL,
  role        TEXT NOT NULL,
  project_id  TEXT,
  ts          INTEGER NOT NULL,
  text        TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS reports_ts ON reports(ts);

-- Each task HQ starts, so a restart can take back the ones still running and
-- resume the ones it cut off (see recover.ts). recovered marks a task that is
-- itself such a resume; it is never resumed again.
CREATE TABLE IF NOT EXISTS tasks (
  id              TEXT PRIMARY KEY,
  session_id      TEXT NOT NULL,
  project_id      TEXT,
  cwd             TEXT NOT NULL,
  permission_mode TEXT NOT NULL,
  pid             INTEGER,
  recovered       INTEGER NOT NULL DEFAULT 0,
  started_at      INTEGER NOT NULL,
  ended_at        INTEGER
);
CREATE INDEX IF NOT EXISTS tasks_open ON tasks(ended_at);

-- Prompts HQ handed to a task mid-task, at the time you sent them. Claude Code
-- logs each only once it reads it; seen marks that the log has it now.
CREATE TABLE IF NOT EXISTS joined (
  id          TEXT PRIMARY KEY,
  session_id  TEXT NOT NULL,
  ts          INTEGER NOT NULL,
  text        TEXT NOT NULL,
  seen        INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS joined_session ON joined(session_id);
`)

// A manager or boss session HQ stopped resuming in favour of a fresh one. Its
// row stays so the old session is still known as HQ's own, not an agent.
try {
  db.exec('ALTER TABLE roles ADD COLUMN retired_at INTEGER')
} catch {
  // already there
}

// When a helper gave its final answer, so a manager waits for helpers still at work.
try {
  db.exec('ALTER TABLE agents ADD COLUMN done_at INTEGER')
} catch {
  // already there
}

// The model a prompt picked, so a queued or resumed task runs on it too.
// Empty means your usual Claude Code model.
for (const table of ['queue', 'tasks']) {
  try {
    db.exec(`ALTER TABLE ${table} ADD COLUMN model TEXT`)
  } catch {
    // already there
  }
}

export type Row = Record<string, unknown>

export function all<T = Row>(sql: string, ...params: unknown[]): T[] {
  return db.prepare(sql).all(...(params as never[])) as T[]
}

export function get<T = Row>(sql: string, ...params: unknown[]): T | undefined {
  return db.prepare(sql).get(...(params as never[])) as T | undefined
}

export function run(sql: string, ...params: unknown[]) {
  return db.prepare(sql).run(...(params as never[]))
}

export function tx<T>(fn: () => T): T {
  db.exec('BEGIN')
  try {
    const out = fn()
    db.exec('COMMIT')
    return out
  } catch (err) {
    db.exec('ROLLBACK')
    throw err
  }
}

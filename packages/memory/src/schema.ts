export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS episodes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  kind TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  meta_json TEXT,
  run_id TEXT,
  lane_id TEXT,
  user_id TEXT,
  app_id TEXT,
  last_verified_at TEXT,
  verified_count INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS decisions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  topic TEXT NOT NULL,
  decision TEXT NOT NULL,
  rationale TEXT NOT NULL,
  superseded_by INTEGER REFERENCES decisions(id),
  run_id TEXT,
  lane_id TEXT,
  user_id TEXT,
  app_id TEXT,
  last_verified_at TEXT,
  verified_count INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS errors_solutions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  signature TEXT NOT NULL,
  error TEXT NOT NULL,
  solution TEXT NOT NULL,
  context TEXT,
  run_id TEXT,
  lane_id TEXT,
  user_id TEXT,
  app_id TEXT,
  last_verified_at TEXT,
  verified_count INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS patterns (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  name TEXT NOT NULL,
  body TEXT NOT NULL,
  uses INTEGER NOT NULL DEFAULT 0,
  run_id TEXT,
  lane_id TEXT,
  user_id TEXT,
  app_id TEXT,
  last_verified_at TEXT,
  verified_count INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  spec_title TEXT NOT NULL,
  goal TEXT NOT NULL,
  status TEXT NOT NULL,
  cost_usd REAL NOT NULL DEFAULT 0,
  tokens_in INTEGER NOT NULL DEFAULT 0,
  tokens_out INTEGER NOT NULL DEFAULT 0,
  cache_read_tokens INTEGER NOT NULL DEFAULT 0,
  cache_write_tokens INTEGER NOT NULL DEFAULT 0,
  duration_ms INTEGER NOT NULL DEFAULT 0,
  plan TEXT,
  mode TEXT,
  agent_id TEXT,
  parent_agent_id TEXT,
  run_id TEXT,
  lane_id TEXT,
  user_id TEXT,
  app_id TEXT,
  last_verified_at TEXT,
  verified_count INTEGER NOT NULL DEFAULT 0,
  evidence_json TEXT
);

CREATE TABLE IF NOT EXISTS research_sources (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  topic TEXT NOT NULL,
  url TEXT NOT NULL,
  title TEXT NOT NULL,
  published_at TEXT,
  relevance REAL NOT NULL DEFAULT 0,
  excerpt TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS taste_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  kind TEXT NOT NULL,
  body TEXT NOT NULL,
  source TEXT
);

CREATE TABLE IF NOT EXISTS sub_specs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  run_id INTEGER REFERENCES runs(id),
  sub_spec_id TEXT NOT NULL,
  title TEXT NOT NULL,
  status TEXT NOT NULL,
  evidence_json TEXT
);

CREATE VIRTUAL TABLE IF NOT EXISTS mem_fts USING fts5(
  source UNINDEXED,
  rowid_ref UNINDEXED,
  title,
  body,
  tokenize = 'porter'
);

CREATE INDEX IF NOT EXISTS idx_episodes_kind ON episodes(kind);
CREATE INDEX IF NOT EXISTS idx_decisions_topic ON decisions(topic);
CREATE INDEX IF NOT EXISTS idx_errors_sig ON errors_solutions(signature);
CREATE INDEX IF NOT EXISTS idx_runs_status ON runs(status);
CREATE INDEX IF NOT EXISTS idx_runs_ts ON runs(ts);
CREATE INDEX IF NOT EXISTS idx_runs_agent ON runs(agent_id);
CREATE INDEX IF NOT EXISTS idx_runs_parent_agent ON runs(parent_agent_id);
CREATE INDEX IF NOT EXISTS idx_research_topic ON research_sources(topic);
CREATE INDEX IF NOT EXISTS idx_taste_kind ON taste_history(kind);
CREATE INDEX IF NOT EXISTS idx_subspecs_run ON sub_specs(run_id);
CREATE INDEX IF NOT EXISTS idx_runs_lane ON runs(lane_id);
CREATE INDEX IF NOT EXISTS idx_runs_run_id ON runs(run_id);
CREATE INDEX IF NOT EXISTS idx_decisions_lane ON decisions(lane_id);
CREATE INDEX IF NOT EXISTS idx_errors_lane ON errors_solutions(lane_id);
CREATE INDEX IF NOT EXISTS idx_patterns_lane ON patterns(lane_id);
CREATE INDEX IF NOT EXISTS idx_runs_verified ON runs(last_verified_at);
CREATE INDEX IF NOT EXISTS idx_decisions_verified ON decisions(last_verified_at);
CREATE INDEX IF NOT EXISTS idx_errors_verified ON errors_solutions(last_verified_at);
`;

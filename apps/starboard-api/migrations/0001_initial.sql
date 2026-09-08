CREATE TABLE IF NOT EXISTS providers (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  kind TEXT NOT NULL,
  handle TEXT NOT NULL,
  description TEXT NOT NULL,
  accent TEXT NOT NULL,
  schema_json TEXT NOT NULL,
  connected INTEGER NOT NULL DEFAULT 0,
  connected_at TEXT,
  last_synced_at TEXT
);

CREATE TABLE IF NOT EXISTS entries (
  id TEXT PRIMARY KEY NOT NULL,
  provider_id TEXT NOT NULL REFERENCES providers(id) ON DELETE CASCADE,
  schema_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  title TEXT NOT NULL,
  summary TEXT NOT NULL,
  url TEXT NOT NULL,
  author TEXT NOT NULL,
  author_handle TEXT NOT NULL,
  tags_json TEXT NOT NULL DEFAULT '[]',
  starred_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  synced_at TEXT NOT NULL,
  is_read INTEGER NOT NULL DEFAULT 0,
  is_pinned INTEGER NOT NULL DEFAULT 0,
  language TEXT,
  language_color TEXT,
  stars INTEGER,
  forks INTEGER,
  comments INTEGER
);

CREATE INDEX IF NOT EXISTS entries_provider_starred_idx ON entries(provider_id, starred_at DESC);
CREATE INDEX IF NOT EXISTS entries_updated_idx ON entries(updated_at DESC);

CREATE TABLE IF NOT EXISTS collections (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  icon TEXT NOT NULL,
  color TEXT NOT NULL,
  rule_json TEXT NOT NULL DEFAULT '{}',
  built_in INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS sync_checkpoints (
  provider_id TEXT PRIMARY KEY NOT NULL REFERENCES providers(id) ON DELETE CASCADE,
  cursor_json TEXT,
  completed_at TEXT
);

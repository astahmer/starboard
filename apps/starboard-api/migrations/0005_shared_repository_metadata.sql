CREATE TABLE IF NOT EXISTS repository_metadata (
	external_id TEXT PRIMARY KEY NOT NULL,
	is_public INTEGER,
	metadata_json TEXT,
	metadata_fetched_at TEXT,
	latest_commit_json TEXT,
	latest_commit_fetched_at TEXT,
	refresh_token TEXT,
	refresh_lease_until TEXT
);

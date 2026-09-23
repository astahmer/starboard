CREATE TABLE account_api_tokens (
	id TEXT PRIMARY KEY NOT NULL,
	account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
	name TEXT NOT NULL,
	token_hash TEXT NOT NULL UNIQUE,
	token_prefix TEXT NOT NULL,
	created_at TEXT NOT NULL,
	expires_at TEXT NOT NULL,
	last_used_at TEXT,
	revoked_at TEXT
);

CREATE INDEX account_api_tokens_account_created_idx ON account_api_tokens(account_id, created_at DESC);

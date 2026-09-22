INSERT OR IGNORE INTO accounts (id, handle, display_name, created_at, updated_at)
VALUES ('default', 'legacy', 'Legacy workspace', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);

ALTER TABLE accounts ADD COLUMN avatar_url TEXT;
ALTER TABLE auth_states ADD COLUMN account_id TEXT;
ALTER TABLE providers ADD COLUMN account_id TEXT NOT NULL DEFAULT 'default';
ALTER TABLE entries ADD COLUMN account_id TEXT NOT NULL DEFAULT 'default';
ALTER TABLE collections ADD COLUMN account_id TEXT NOT NULL DEFAULT 'default';
ALTER TABLE sync_checkpoints ADD COLUMN account_id TEXT NOT NULL DEFAULT 'default';
ALTER TABLE automations ADD COLUMN account_id TEXT NOT NULL DEFAULT 'default';
ALTER TABLE automation_runs ADD COLUMN account_id TEXT NOT NULL DEFAULT 'default';
ALTER TABLE plugins ADD COLUMN account_id TEXT NOT NULL DEFAULT 'default';

CREATE INDEX IF NOT EXISTS providers_account_idx ON providers(account_id, name);
CREATE INDEX IF NOT EXISTS entries_account_starred_idx ON entries(account_id, starred_at DESC);
CREATE INDEX IF NOT EXISTS entries_account_provider_idx ON entries(account_id, provider_id, starred_at DESC);
CREATE INDEX IF NOT EXISTS collections_account_idx ON collections(account_id, built_in DESC, name);
CREATE INDEX IF NOT EXISTS automations_account_idx ON automations(account_id, created_at);
CREATE INDEX IF NOT EXISTS automation_runs_account_idx ON automation_runs(account_id, created_at DESC);
CREATE INDEX IF NOT EXISTS plugins_account_idx ON plugins(account_id, name);

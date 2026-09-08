ALTER TABLE providers ADD COLUMN config_json TEXT NOT NULL DEFAULT '{}';
ALTER TABLE entries ADD COLUMN external_id TEXT;
ALTER TABLE entries ADD COLUMN fields_json TEXT NOT NULL DEFAULT '{}';
ALTER TABLE entries ADD COLUMN embedding_json TEXT;
ALTER TABLE entries ADD COLUMN classification_json TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS entries_provider_external_idx
  ON entries(provider_id, external_id)
  WHERE external_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS accounts (
  id TEXT PRIMARY KEY NOT NULL,
  handle TEXT NOT NULL,
  display_name TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  id_hash TEXT PRIMARY KEY NOT NULL,
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS sessions_expiry_idx ON sessions(expires_at);

CREATE TABLE IF NOT EXISTS provider_credentials (
  provider_id TEXT PRIMARY KEY NOT NULL REFERENCES providers(id) ON DELETE CASCADE,
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  access_token_ciphertext TEXT NOT NULL,
  refresh_token_ciphertext TEXT,
  token_type TEXT NOT NULL DEFAULT 'Bearer',
  scope TEXT,
  expires_at TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS auth_states (
  state TEXT PRIMARY KEY NOT NULL,
  provider_kind TEXT NOT NULL,
  code_verifier TEXT,
  return_to TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS auth_states_expiry_idx ON auth_states(expires_at);

CREATE TABLE IF NOT EXISTS automations (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  trigger TEXT NOT NULL,
  action TEXT NOT NULL,
  config_json TEXT NOT NULL DEFAULT '{}',
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS automation_runs (
  id TEXT PRIMARY KEY NOT NULL,
  automation_id TEXT NOT NULL REFERENCES automations(id) ON DELETE CASCADE,
  trigger TEXT NOT NULL,
  entry_id TEXT,
  status TEXT NOT NULL,
  message TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS plugins (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  version TEXT NOT NULL,
  description TEXT NOT NULL,
  manifest_json TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

import type { D1Database } from "@cloudflare/workers-types";
import { hashToken, randomToken } from "./crypto";

export interface ApiTokenSummary {
	id: string;
	name: string;
	prefix: string;
	createdAt: string;
	expiresAt: string;
	lastUsedAt?: string;
	revokedAt?: string;
}

export interface CreatedApiToken {
	token: string;
	apiToken: ApiTokenSummary;
}

interface ApiTokenRow {
	id: string;
	name: string;
	token_prefix: string;
	created_at: string;
	expires_at: string;
	last_used_at: string | null;
	revoked_at: string | null;
}

const TOKEN_TTL_DAYS = 365;
const MAX_ACTIVE_TOKENS = 20;

export class ApiTokenLimitError extends Error {
	constructor() {
		super("Revoke an existing API token before creating another.");
		this.name = "ApiTokenLimitError";
	}
}

const tokenSummary = (row: ApiTokenRow): ApiTokenSummary => ({
	id: row.id,
	name: row.name,
	prefix: row.token_prefix,
	createdAt: row.created_at,
	expiresAt: row.expires_at,
	lastUsedAt: row.last_used_at ?? undefined,
	revokedAt: row.revoked_at ?? undefined,
});

export async function listAccountApiTokens(db: D1Database, accountId: string): Promise<ApiTokenSummary[]> {
	const result = await db.prepare(
		`SELECT id, name, token_prefix, created_at, expires_at, last_used_at, revoked_at
		 FROM account_api_tokens
		 WHERE account_id = ?1
		 ORDER BY created_at DESC
		 LIMIT 50`,
	).bind(accountId).all<ApiTokenRow>();
	return result.results.map(tokenSummary);
}

export async function createAccountApiToken(db: D1Database, accountId: string, name: string): Promise<CreatedApiToken> {
	const now = new Date();
	const createdAt = now.toISOString();
	const expiresAt = new Date(now.getTime() + TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000).toISOString();
	const activeCount = await db.prepare(
		"SELECT COUNT(*) AS count FROM account_api_tokens WHERE account_id = ?1 AND revoked_at IS NULL AND expires_at > ?2",
	).bind(accountId, createdAt).first<{ count: number }>();
	if ((activeCount?.count ?? 0) >= MAX_ACTIVE_TOKENS) throw new ApiTokenLimitError();

	const token = `sb_live_${randomToken(32)}`;
	const id = crypto.randomUUID();
	const row: ApiTokenRow = {
		id,
		name,
		token_prefix: `${token.slice(0, 15)}…`,
		created_at: createdAt,
		expires_at: expiresAt,
		last_used_at: null,
		revoked_at: null,
	};
	await db.prepare(
		`INSERT INTO account_api_tokens (id, account_id, name, token_hash, token_prefix, created_at, expires_at)
		 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)`,
	).bind(id, accountId, name, await hashToken(token), row.token_prefix, createdAt, expiresAt).run();
	return { token, apiToken: tokenSummary(row) };
}

export async function revokeAccountApiToken(db: D1Database, accountId: string, id: string): Promise<string | undefined> {
	const revokedAt = new Date().toISOString();
	const result = await db.prepare(
		"UPDATE account_api_tokens SET revoked_at = ?1 WHERE account_id = ?2 AND id = ?3 AND revoked_at IS NULL",
	).bind(revokedAt, accountId, id).run();
	if (result.meta.changes > 0) return revokedAt;
	const row = await db.prepare("SELECT revoked_at FROM account_api_tokens WHERE account_id = ?1 AND id = ?2 LIMIT 1")
		.bind(accountId, id).first<{ revoked_at: string | null }>();
	return row?.revoked_at ?? undefined;
}

export async function accountIdForApiToken(db: D1Database, authorization: string | null): Promise<string | undefined> {
	const match = authorization?.match(/^Bearer\s+(sb_live_[A-Za-z0-9_-]{43})$/i);
	const token = match?.[1];
	if (!token) return undefined;

	const now = new Date().toISOString();
	const row = await db.prepare(
		"SELECT id, account_id FROM account_api_tokens WHERE token_hash = ?1 AND revoked_at IS NULL AND expires_at > ?2 LIMIT 1",
	).bind(await hashToken(token), now).first<{ id: string; account_id: string }>();
	if (!row) return undefined;

	const lastUseThreshold = new Date(Date.now() - 5 * 60 * 1000).toISOString();
	await db.prepare(
		"UPDATE account_api_tokens SET last_used_at = ?1 WHERE id = ?2 AND revoked_at IS NULL AND (last_used_at IS NULL OR last_used_at <= ?3)",
	).bind(now, row.id, lastUseThreshold).run();
	return row.account_id;
}

import type { D1Database } from "@cloudflare/workers-types";
import { z } from "zod";
import type { LatestCommit, RepositoryMetadata, RepositoryMetadataResponse } from "../../starboard/src/lib/types";

const freshnessWindowMs = 24 * 60 * 60 * 1000;
const refreshLeaseMs = 2 * 60 * 1000;

const repositoryMetadataSchema = z.object({
	title: z.string(),
	summary: z.string(),
	url: z.string().url(),
	author: z.string(),
	authorHandle: z.string(),
	updatedAt: z.string(),
	language: z.string().optional(),
	stars: z.number(),
	forks: z.number(),
	comments: z.number().optional(),
	topics: z.array(z.string()),
	repository: z.string(),
	owner: z.string(),
	pushedAt: z.string().nullable(),
});

const latestCommitSchema = z.object({
	sha: z.string(),
	message: z.string(),
	url: z.string().url(),
	committedAt: z.string().nullable(),
});

interface RepositoryMetadataRow {
	external_id: string;
	is_public: number | null;
	metadata_json: string | null;
	metadata_fetched_at: string | null;
	latest_commit_json: string | null;
	latest_commit_fetched_at: string | null;
	refresh_token: string | null;
	refresh_lease_until: string | null;
}

const parseJson = <T,>(value: string | null, schema: z.ZodType<T>): T | undefined => {
	if (!value) return undefined;
	const parsed = schema.safeParse(JSON.parse(value));
	return parsed.success ? parsed.data : undefined;
};

const rowFromDb = async (db: D1Database, externalId: string) => db.prepare(
	"SELECT * FROM repository_metadata WHERE external_id = ?1 LIMIT 1",
).bind(externalId).first<RepositoryMetadataRow>();

const isFresh = (timestamp: string | null, now: number) => Boolean(timestamp && Date.parse(timestamp) > now - freshnessWindowMs);

export function parseRepositoryMetadata(value: string | null | undefined): RepositoryMetadata | undefined {
	if (!value) return undefined;
	try {
		const parsed = repositoryMetadataSchema.safeParse(JSON.parse(value));
		return parsed.success ? parsed.data : undefined;
	} catch {
		return undefined;
	}
}

export async function cachePublicRepositories(
	db: D1Database,
	repositories: Array<{ externalId: string; metadata: RepositoryMetadata }>,
): Promise<void> {
	if (repositories.length === 0) return;
	const now = new Date().toISOString();
	const staleBefore = new Date(Date.now() - freshnessWindowMs).toISOString();
	for (let start = 0; start < repositories.length; start += 80) {
		const statements = repositories.slice(start, start + 80).map(({ externalId, metadata }) => db.prepare(
			`INSERT INTO repository_metadata (
				external_id, is_public, metadata_json, metadata_fetched_at
			) VALUES (?1, 1, ?2, ?3)
			ON CONFLICT(external_id) DO UPDATE SET
				is_public = 1,
				metadata_json = excluded.metadata_json,
				metadata_fetched_at = excluded.metadata_fetched_at
			WHERE repository_metadata.is_public = 1
				AND (repository_metadata.metadata_fetched_at IS NULL OR repository_metadata.metadata_fetched_at <= ?4)
				AND (repository_metadata.refresh_lease_until IS NULL OR repository_metadata.refresh_lease_until <= ?3)`,
		).bind(externalId, JSON.stringify(metadata), now, staleBefore));
		await db.batch(statements);
	}
}

export async function removePrivateRepositoryMetadata(db: D1Database, externalIds: string[]): Promise<void> {
	if (externalIds.length === 0) return;
	for (let start = 0; start < externalIds.length; start += 80) {
		await db.batch(externalIds.slice(start, start + 80).map((externalId) => db.prepare(
			"DELETE FROM repository_metadata WHERE external_id = ?1",
		).bind(externalId)));
	}
}

export async function getRepositoryMetadataResponse(args: {
	db: D1Database;
	externalId: string;
	now?: number;
}): Promise<RepositoryMetadataResponse> {
	const row = await rowFromDb(args.db, args.externalId);
	if (!row || row.is_public !== 1) return { refreshing: Boolean(row?.refresh_lease_until && Date.parse(row.refresh_lease_until) > (args.now ?? Date.now())) };
	let metadata: RepositoryMetadata | undefined;
	let latestCommit: LatestCommit | null | undefined;
	const now = args.now ?? Date.now();
	const metadataFresh = isFresh(row.metadata_fetched_at, now);
	const latestCommitFresh = isFresh(row.latest_commit_fetched_at, now);
	try {
		metadata = metadataFresh ? parseJson(row.metadata_json, repositoryMetadataSchema) : undefined;
		latestCommit = latestCommitFresh && row.latest_commit_json ? parseJson(row.latest_commit_json, latestCommitSchema) ?? null : undefined;
	} catch {
		metadata = undefined;
		latestCommit = undefined;
	}
	return {
		metadata,
		latestCommit,
		metadataFetchedAt: metadataFresh ? row.metadata_fetched_at ?? undefined : undefined,
		latestCommitFetchedAt: latestCommitFresh ? row.latest_commit_fetched_at ?? undefined : undefined,
		refreshing: Boolean(row.refresh_lease_until && Date.parse(row.refresh_lease_until) > now),
	};
}

export async function claimRepositoryMetadataRefresh(args: {
	db: D1Database;
	externalId: string;
	includeMetadata: boolean;
	includeLatestCommit: boolean;
	now?: number;
}): Promise<string | undefined> {
	const now = args.now ?? Date.now();
	const nowIso = new Date(now).toISOString();
	const staleBefore = new Date(now - freshnessWindowMs).toISOString();
	const leaseUntil = new Date(now + refreshLeaseMs).toISOString();
	const token = crypto.randomUUID();
	const staleClauses = [
		...(args.includeMetadata ? ["metadata_fetched_at IS NULL OR metadata_fetched_at <= ?4"] : []),
		...(args.includeLatestCommit ? ["latest_commit_fetched_at IS NULL OR latest_commit_fetched_at <= ?4"] : []),
	].join(" OR ");
	if (!staleClauses) return undefined;
	const result = await args.db.prepare(
		`INSERT INTO repository_metadata (
			external_id, refresh_token, refresh_lease_until
		) VALUES (?1, ?2, ?3)
		ON CONFLICT(external_id) DO UPDATE SET
			refresh_token = excluded.refresh_token,
			refresh_lease_until = excluded.refresh_lease_until
		WHERE (${staleClauses})
			AND (repository_metadata.refresh_lease_until IS NULL OR repository_metadata.refresh_lease_until <= ?5)`,
	).bind(args.externalId, token, leaseUntil, staleBefore, nowIso).run();
	return result.meta.changes > 0 ? token : undefined;
}

export async function saveRepositoryMetadataRefresh(args: {
	db: D1Database;
	externalId: string;
	token: string;
	metadata?: RepositoryMetadata;
	isPublic: boolean;
	latestCommit?: LatestCommit | null;
	fetchedAt: string;
}): Promise<void> {
	if (!args.isPublic) {
		await args.db.prepare("DELETE FROM repository_metadata WHERE external_id = ?1 AND refresh_token = ?2").bind(args.externalId, args.token).run();
		return;
	}
	await args.db.prepare(
		`UPDATE repository_metadata SET
			is_public = 1,
			metadata_json = COALESCE(?1, metadata_json),
			metadata_fetched_at = CASE WHEN ?1 IS NULL THEN metadata_fetched_at ELSE ?2 END,
			latest_commit_json = CASE WHEN ?3 = 1 THEN ?4 ELSE latest_commit_json END,
			latest_commit_fetched_at = CASE WHEN ?3 = 1 THEN ?2 ELSE latest_commit_fetched_at END,
			refresh_token = NULL,
			refresh_lease_until = NULL
		WHERE external_id = ?5 AND refresh_token = ?6`,
	).bind(
		args.metadata ? JSON.stringify(args.metadata) : null,
		args.fetchedAt,
		args.latestCommit !== undefined ? 1 : 0,
		args.latestCommit ? JSON.stringify(args.latestCommit) : null,
		args.externalId,
		args.token,
	).run();
}

export async function releaseRepositoryMetadataRefresh(db: D1Database, externalId: string, token: string): Promise<void> {
	await db.prepare(
		"UPDATE repository_metadata SET refresh_token = NULL, refresh_lease_until = NULL WHERE external_id = ?1 AND refresh_token = ?2",
	).bind(externalId, token).run();
}

export function isRepositoryMetadataFresh(timestamp: string | undefined, now = Date.now()): boolean {
	return isFresh(timestamp ?? null, now);
}

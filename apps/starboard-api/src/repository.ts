import type { D1Database } from "@cloudflare/workers-types";
import { collectionMatches, searchEntries } from "../../starboard/src/lib/search";
import { defaultCollections } from "../../starboard/src/lib/workspace-defaults";
import type { Collection, CollectionRule, Entry, Provider, SearchMode } from "../../starboard/src/lib/types";
import { parseRepositoryMetadata } from "./repository-metadata";

interface ProviderRow {
	id: string;
	name: string;
	kind: Provider["kind"];
	handle: string;
	description: string;
	accent: string;
	schema_json: string;
	connected: number;
	connected_at: string | null;
	last_synced_at: string | null;
	config_json?: string | null;
}

interface EntryRow {
	id: string;
	provider_id: string;
	schema_id: string;
	kind: Entry["kind"];
	title: string;
	summary: string;
	url: string;
	author: string;
	author_handle: string;
	tags_json: string;
	starred_at: string;
	updated_at: string;
	synced_at: string;
	is_read: number;
	is_pinned: number;
	language: string | null;
	language_color: string | null;
	stars: number | null;
	forks: number | null;
	comments: number | null;
	external_id?: string | null;
	fields_json?: string | null;
	embedding_json?: string | null;
	classification_json?: string | null;
	shared_metadata_json?: string | null;
}

interface CollectionRow {
	id: string;
	name: string;
	description: string;
	icon: Collection["icon"];
	color: string;
	rule_json: string;
	built_in: number;
}

const parseJson = <T,>(value: string | null | undefined, fallback: T): T => {
	try {
		return value ? (JSON.parse(value) as T) : fallback;
	} catch {
		return fallback;
	}
};

const providerFromRow = (row: ProviderRow): Provider => ({
	id: row.id,
	name: row.name,
	kind: row.kind,
	handle: row.handle,
	description: row.description,
	accent: row.accent,
	schema: parseJson(row.schema_json, {
		id: "unknown",
		name: "Unknown schema",
		description: "",
		icon: "bookmark",
		defaultKind: "bookmark",
		fields: [],
	}),
	connected: row.connected === 1,
	connectedAt: row.connected_at ?? undefined,
	lastSyncedAt: row.last_synced_at ?? undefined,
	settings: parseJson(row.config_json, undefined),
});

const entryFromRow = (row: EntryRow): Entry => {
	const entry: Entry = {
	id: row.id,
	providerId: row.provider_id,
	schemaId: row.schema_id,
	externalId: row.external_id ?? undefined,
	kind: row.kind,
	title: row.title,
	summary: row.summary,
	url: row.url,
	author: row.author,
	authorHandle: row.author_handle,
	tags: parseJson(row.tags_json, []),
	starredAt: row.starred_at,
	updatedAt: row.updated_at,
	syncedAt: row.synced_at,
	isRead: row.is_read === 1,
	isPinned: row.is_pinned === 1,
	language: row.language ?? undefined,
	languageColor: row.language_color ?? undefined,
	stars: row.stars ?? undefined,
	forks: row.forks ?? undefined,
	comments: row.comments ?? undefined,
	fields: parseJson(row.fields_json, undefined),
	embedding: parseJson(row.embedding_json, undefined),
	classification: parseJson(row.classification_json, undefined),
};
	const metadata = parseRepositoryMetadata(row.shared_metadata_json);
	if (!metadata) return entry;
	return {
		...entry,
		title: metadata.title,
		summary: metadata.summary,
		url: metadata.url,
		author: metadata.author,
		authorHandle: metadata.authorHandle,
		updatedAt: metadata.updatedAt,
		language: metadata.language,
		stars: metadata.stars,
		forks: metadata.forks,
		comments: metadata.comments,
		tags: Array.from(new Set([...entry.tags, ...metadata.topics.map((topic) => topic.toLocaleLowerCase())])),
		fields: {
			...entry.fields,
			repository: metadata.repository,
			owner: metadata.owner,
			pushedAt: metadata.pushedAt,
		},
	};
};

const sharedMetadataJoin = `
	LEFT JOIN providers ON providers.id = entries.provider_id AND providers.account_id = entries.account_id
	LEFT JOIN repository_metadata ON providers.kind = 'github'
		AND repository_metadata.external_id = entries.external_id
		AND repository_metadata.is_public = 1
		AND repository_metadata.metadata_json IS NOT NULL
		AND julianday(repository_metadata.metadata_fetched_at) > julianday('now', '-1 day')`;

const selectEntriesWithSharedMetadata = `
	SELECT entries.*, repository_metadata.metadata_json AS shared_metadata_json
	FROM entries
	${sharedMetadataJoin}`;

const collectionFromRow = (row: CollectionRow): Collection => ({
	id: row.id,
	name: row.name,
	description: row.description,
	icon: row.icon,
	color: row.color,
	rule: parseJson<CollectionRule>(row.rule_json, {}),
	builtIn: row.built_in === 1,
});

export async function listProviders(db: D1Database, accountId: string): Promise<Provider[]> {
	const result = await db.prepare("SELECT * FROM providers WHERE account_id = ?1 ORDER BY name ASC").bind(accountId).all<ProviderRow>();
	return result.results.map(providerFromRow);
}

export async function getProvider(db: D1Database, accountId: string, id: string): Promise<Provider | undefined> {
	const result = await db.prepare("SELECT * FROM providers WHERE account_id = ?1 AND id = ?2 LIMIT 1").bind(accountId, id).first<ProviderRow>();
	return result ? providerFromRow(result) : undefined;
}

export interface SyncCheckpointRecord {
	providerId: string;
	cursor?: string;
	completedAt?: string;
}

export interface ProviderEntrySnapshot {
	starCount: number;
	latestStarredAt?: string;
}

export async function getSyncCheckpoint(db: D1Database, accountId: string, providerId: string): Promise<SyncCheckpointRecord | undefined> {
	const row = await db.prepare("SELECT provider_id, cursor_json, completed_at FROM sync_checkpoints WHERE account_id = ?1 AND provider_id = ?2 LIMIT 1").bind(accountId, providerId).first<{ provider_id: string; cursor_json: string | null; completed_at: string | null }>();
	if (!row) return undefined;
	const parsed = parseJson<{ value?: string }>(row.cursor_json, {});
	return { providerId: row.provider_id, cursor: parsed.value, completedAt: row.completed_at ?? undefined };
}

export async function getProviderEntrySnapshot(db: D1Database, accountId: string, providerId: string): Promise<ProviderEntrySnapshot> {
	const row = await db.prepare(
		"SELECT COUNT(*) AS star_count, MAX(starred_at) AS latest_starred_at FROM entries WHERE account_id = ?1 AND provider_id = ?2",
	).bind(accountId, providerId).first<{ star_count: number; latest_starred_at: string | null }>();
	return { starCount: row?.star_count ?? 0, latestStarredAt: row?.latest_starred_at ?? undefined };
}

export async function listEntries(db: D1Database, accountId: string): Promise<Entry[]> {
	const result = await db.prepare(`${selectEntriesWithSharedMetadata} WHERE entries.account_id = ?1 ORDER BY entries.starred_at DESC`).bind(accountId).all<EntryRow>();
	return result.results.map(entryFromRow);
}

export interface AgentEntryFilters {
	query?: string;
	providerId?: string;
	view?: "all" | "unread" | "pinned";
	language?: string;
	minStars?: number;
	sort: "most-stars" | "recently-pushed" | "recently-starred" | "name";
	limit: number;
	offset: number;
}

export interface AgentEntryPage {
	entries: Entry[];
	total: number;
}

const selectAgentEntryColumns = `
	SELECT entries.id, entries.provider_id, entries.schema_id, entries.kind, entries.title, entries.summary, entries.url,
		entries.author, entries.author_handle, entries.tags_json, entries.starred_at, entries.updated_at, entries.synced_at,
		entries.is_read, entries.is_pinned, entries.language, entries.language_color, entries.stars, entries.forks,
		entries.comments, entries.external_id, entries.fields_json, repository_metadata.metadata_json AS shared_metadata_json
	FROM entries ${sharedMetadataJoin}`;

export async function listAgentEntries(db: D1Database, accountId: string, filters: AgentEntryFilters): Promise<AgentEntryPage> {
	const conditions = ["entries.account_id = ?"];
	const bindings: Array<string | number> = [accountId];
	const metadata = "CASE WHEN json_valid(repository_metadata.metadata_json) THEN repository_metadata.metadata_json END";
	const metadataStars = `COALESCE(json_extract(${metadata}, '$.stars'), entries.stars)`;

	if (filters.providerId) {
		conditions.push("entries.provider_id = ?");
		bindings.push(filters.providerId);
	}
	if (filters.view === "unread") conditions.push("entries.is_read = 0");
	if (filters.view === "pinned") conditions.push("entries.is_pinned = 1");
	if (filters.language) {
		conditions.push(`COALESCE(json_extract(${metadata}, '$.language'), entries.language) = ?`);
		bindings.push(filters.language);
	}
	if (filters.minStars !== undefined) {
		conditions.push(`${metadataStars} >= ?`);
		bindings.push(filters.minStars);
	}
	if (filters.query) {
		const escapedQuery = `%${filters.query.replaceAll("\\", "\\\\").replaceAll("%", "\\%").replaceAll("_", "\\_")}%`;
		const searchableFields = ["repository_metadata.metadata_json", "entries.title", "entries.summary", "entries.author", "entries.author_handle", "entries.tags_json", "entries.fields_json"];
		conditions.push(`(${searchableFields.map((field) => `${field} LIKE ? ESCAPE '\\'`).join(" OR ")})`);
		bindings.push(...searchableFields.map(() => escapedQuery));
	}

	const whereClause = conditions.join(" AND ");
	const fromClause = `FROM entries ${sharedMetadataJoin}`;
	const totalRow = await db.prepare(`SELECT COUNT(*) AS total ${fromClause} WHERE ${whereClause}`).bind(...bindings).first<{ total: number }>();
	const orderBy = {
		"most-stars": `${metadataStars} IS NULL ASC, ${metadataStars} DESC, entries.starred_at DESC`,
		"recently-pushed": `COALESCE(json_extract(${metadata}, '$.pushedAt'), json_extract(CASE WHEN json_valid(entries.fields_json) THEN entries.fields_json END, '$.pushedAt')) IS NULL ASC, COALESCE(json_extract(${metadata}, '$.pushedAt'), json_extract(CASE WHEN json_valid(entries.fields_json) THEN entries.fields_json END, '$.pushedAt')) DESC, entries.starred_at DESC`,
		"recently-starred": "entries.starred_at DESC",
		name: `COALESCE(json_extract(${metadata}, '$.title'), entries.title) COLLATE NOCASE ASC, entries.starred_at DESC`,
	}[filters.sort];
	const entryRows = await db.prepare(
		`${selectAgentEntryColumns} WHERE ${whereClause} ORDER BY ${orderBy} LIMIT ? OFFSET ?`,
	).bind(...bindings, filters.limit, filters.offset).all<EntryRow>();
	return { entries: entryRows.results.map(entryFromRow), total: totalRow?.total ?? 0 };
}

export async function getAgentEntry(db: D1Database, accountId: string, id: string): Promise<Entry | undefined> {
	const row = await db.prepare(`${selectAgentEntryColumns} WHERE entries.account_id = ?1 AND entries.id = ?2 LIMIT 1`)
		.bind(accountId, id).first<EntryRow>();
	return row ? entryFromRow(row) : undefined;
}

export async function listCollections(db: D1Database, accountId: string): Promise<Collection[]> {
	const accountCollections = defaultCollections.map((collection) => ({
		...collection,
		id: `${accountId}:${collection.id}`,
		rule: {
			...collection.rule,
			providerIds: collection.rule.providerIds?.map((providerId) => `${accountId}:${providerId}`),
		},
	}));
	await db.batch(accountCollections.map((collection) => db.prepare(
		`INSERT OR IGNORE INTO collections (id, account_id, name, description, icon, color, rule_json, built_in)
		 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)`,
	).bind(collection.id, accountId, collection.name, collection.description, collection.icon, collection.color, JSON.stringify(collection.rule), collection.builtIn ? 1 : 0)));
	const result = await db.prepare("SELECT * FROM collections WHERE account_id = ?1 ORDER BY built_in DESC, name ASC").bind(accountId).all<CollectionRow>();
	return result.results.map(collectionFromRow);
}

export async function listCollectionsReadOnly(db: D1Database, accountId: string): Promise<Collection[]> {
	const result = await db.prepare("SELECT * FROM collections WHERE account_id = ?1 ORDER BY built_in DESC, name ASC").bind(accountId).all<CollectionRow>();
	return result.results.map(collectionFromRow);
}

export async function getEntry(db: D1Database, accountId: string, id: string): Promise<Entry | undefined> {
	const result = await db.prepare(`${selectEntriesWithSharedMetadata} WHERE entries.account_id = ?1 AND entries.id = ?2 LIMIT 1`).bind(accountId, id).first<EntryRow>();
	return result ? entryFromRow(result) : undefined;
}

export async function searchWorkspace(
	db: D1Database,
	accountId: string,
	query: string,
	mode: SearchMode,
	providerId?: string,
	collectionId?: string,
	limit = 50,
	queryEmbedding?: number[],
): Promise<Entry[]> {
	const [entries, collections] = await Promise.all([listEntries(db, accountId), listCollections(db, accountId)]);
	const collection = collectionId ? collections.find((item) => item.id === collectionId) : undefined;
	const filtered = entries.filter((entry) => {
		if (providerId && entry.providerId !== providerId) return false;
		return collection ? collectionMatches(entry, collection) : true;
	});
	return searchEntries(filtered, query, mode, queryEmbedding).slice(0, Math.max(1, Math.min(limit, 100)));
}

export async function updateEntry(
	db: D1Database,
	accountId: string,
	id: string,
	patch: Partial<Pick<Entry, "isRead" | "isPinned" | "tags" | "classification" | "embedding">>,
): Promise<Entry | undefined> {
	const current = await getEntry(db, accountId, id);
	if (!current) return undefined;
	const next: Entry = { ...current, ...patch, updatedAt: new Date().toISOString() };
	await db.prepare(
		`UPDATE entries
		 SET tags_json = ?1, is_read = ?2, is_pinned = ?3, updated_at = ?4, embedding_json = ?5, classification_json = ?6
		 WHERE account_id = ?7 AND id = ?8`,
	).bind(JSON.stringify(next.tags), next.isRead ? 1 : 0, next.isPinned ? 1 : 0, next.updatedAt, next.embedding ? JSON.stringify(next.embedding) : null, next.classification ? JSON.stringify(next.classification) : null, accountId, id).run();
	return next;
}

export async function markGithubEntriesRead(db: D1Database, accountId: string): Promise<number> {
	const result = await db.prepare(
		`UPDATE entries SET is_read = 1
		 WHERE account_id = ?1 AND is_read = 0
		 AND provider_id IN (SELECT id FROM providers WHERE account_id = ?1 AND kind = 'github')`,
	).bind(accountId).run();
	return result.meta.changes;
}

export async function insertCollection(db: D1Database, accountId: string, collection: Collection): Promise<Collection> {
	await db.prepare(
		`INSERT INTO collections (id, account_id, name, description, icon, color, rule_json, built_in)
		 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)`,
	).bind(collection.id, accountId, collection.name, collection.description, collection.icon, collection.color, JSON.stringify(collection.rule), collection.builtIn ? 1 : 0).run();
	return collection;
}

export async function upsertProvider(db: D1Database, accountId: string, provider: Provider): Promise<Provider> {
	await db.prepare(
		`INSERT INTO providers (id, account_id, name, kind, handle, description, accent, schema_json, connected, connected_at, last_synced_at, config_json)
		 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)
		 ON CONFLICT(id) DO UPDATE SET
		   name = excluded.name,
		   kind = excluded.kind,
		   handle = excluded.handle,
		   description = excluded.description,
		   accent = excluded.accent,
		   schema_json = excluded.schema_json,
		   connected = excluded.connected,
		   connected_at = excluded.connected_at,
		   last_synced_at = COALESCE(excluded.last_synced_at, providers.last_synced_at),
		   config_json = excluded.config_json
		 WHERE providers.account_id = excluded.account_id`,
	).bind(
		provider.id,
		accountId,
		provider.name,
		provider.kind,
		provider.handle,
		provider.description,
		provider.accent,
		JSON.stringify(provider.schema),
		provider.connected ? 1 : 0,
		provider.connectedAt ?? null,
		provider.lastSyncedAt ?? null,
		JSON.stringify(provider.settings ?? {}),
	).run();
	return provider;
}

export interface UpsertReport {
	added: number;
	updated: number;
	addedEntries: Entry[];
	updatedEntries: Entry[];
}

export async function upsertEntries(db: D1Database, accountId: string, entries: Entry[]): Promise<UpsertReport> {
	if (entries.length === 0) return { added: 0, updated: 0, addedEntries: [], updatedEntries: [] };
	const existingRows: EntryRow[] = [];
	for (let start = 0; start < entries.length; start += 80) {
		const ids = entries.slice(start, start + 80).map((entry) => entry.id);
		const placeholders = ids.map((_, index) => `?${index + 2}`).join(", ");
		const result = await db.prepare(`SELECT * FROM entries WHERE account_id = ?1 AND id IN (${placeholders})`).bind(accountId, ...ids).all<EntryRow>();
		existingRows.push(...result.results);
	}
	const existingById = new Map(existingRows.map((row) => [row.id, entryFromRow(row)]));
	const statements = entries.map((entry) => {
		const previous = existingById.get(entry.id);
		const mergedTags = Array.from(new Set([...(previous?.tags ?? []), ...entry.tags]));
		return db.prepare(
			`INSERT INTO entries (
				account_id, id, provider_id, schema_id, external_id, kind, title, summary, url, author, author_handle,
				tags_json, starred_at, updated_at, synced_at, is_read, is_pinned, language, language_color,
				stars, forks, comments, fields_json, embedding_json, classification_json
			) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20, ?21, ?22, ?23, ?24, ?25)
			 ON CONFLICT(id) DO UPDATE SET
				provider_id = excluded.provider_id,
				schema_id = excluded.schema_id,
				external_id = excluded.external_id,
				kind = excluded.kind,
				title = excluded.title,
				summary = excluded.summary,
				url = excluded.url,
				author = excluded.author,
				author_handle = excluded.author_handle,
				tags_json = excluded.tags_json,
				starred_at = excluded.starred_at,
				updated_at = excluded.updated_at,
				synced_at = excluded.synced_at,
				language = excluded.language,
				language_color = excluded.language_color,
				stars = excluded.stars,
				forks = excluded.forks,
				comments = excluded.comments,
				fields_json = excluded.fields_json,
				embedding_json = excluded.embedding_json,
				classification_json = excluded.classification_json
			 WHERE entries.account_id = excluded.account_id`,
		).bind(
			accountId,
			entry.id,
			entry.providerId,
			entry.schemaId,
			entry.externalId ?? entry.id,
			entry.kind,
			entry.title,
			entry.summary,
			entry.url,
			entry.author,
			entry.authorHandle,
			JSON.stringify(mergedTags),
			entry.starredAt,
			entry.updatedAt,
			entry.syncedAt,
			previous?.isRead ? 1 : entry.isRead ? 1 : 0,
			previous?.isPinned ? 1 : entry.isPinned ? 1 : 0,
			entry.language ?? null,
			entry.languageColor ?? null,
			entry.stars ?? null,
			entry.forks ?? null,
			entry.comments ?? null,
			JSON.stringify(entry.fields ?? {}),
			entry.embedding ? JSON.stringify(entry.embedding) : null,
			entry.classification ? JSON.stringify(entry.classification) : null,
		);
	});
	await db.batch(statements);
	const addedEntries = entries.filter((entry) => !existingById.has(entry.id));
	const updatedEntries = entries.filter((entry) => existingById.has(entry.id));
	return { added: addedEntries.length, updated: updatedEntries.length, addedEntries, updatedEntries };
}

export async function removeEntriesNotSeen(db: D1Database, accountId: string, providerId: string, seenExternalIds: Set<string>): Promise<number> {
	const existing = await db.prepare("SELECT id, external_id FROM entries WHERE account_id = ?1 AND provider_id = ?2").bind(accountId, providerId).all<{ id: string; external_id: string | null }>();
	const stale = existing.results.filter((entry) => !seenExternalIds.has(entry.external_id ?? entry.id));
	if (stale.length === 0) return 0;
	await db.batch(stale.map((entry) => db.prepare("DELETE FROM entries WHERE account_id = ?1 AND id = ?2 AND provider_id = ?3").bind(accountId, entry.id, providerId)));
	return stale.length;
}

export async function recordSyncCheckpoint(db: D1Database, accountId: string, providerId: string, cursor: string, complete: boolean): Promise<void> {
	const completedAt = complete ? new Date().toISOString() : null;
	await db.prepare(
		`INSERT INTO sync_checkpoints (provider_id, account_id, cursor_json, completed_at)
		 VALUES (?1, ?2, ?3, ?4)
		 ON CONFLICT(provider_id) DO UPDATE SET cursor_json = excluded.cursor_json, completed_at = excluded.completed_at
		 WHERE sync_checkpoints.account_id = excluded.account_id`,
	).bind(providerId, accountId, cursor ? JSON.stringify({ value: cursor }) : null, completedAt).run();
	if (completedAt) await db.prepare("UPDATE providers SET last_synced_at = ?1 WHERE account_id = ?2 AND id = ?3").bind(completedAt, accountId, providerId).run();
}

export async function markSyncCheckpointCurrent(db: D1Database, accountId: string, providerId: string, lastSyncedAt: string): Promise<void> {
	const completedCursor = JSON.stringify({ value: JSON.stringify({ complete: true, seenExternalIds: [] }) });
	await db.prepare(
		"UPDATE sync_checkpoints SET cursor_json = ?1, completed_at = COALESCE(completed_at, ?2) WHERE account_id = ?3 AND provider_id = ?4",
	).bind(completedCursor, lastSyncedAt, accountId, providerId).run();
}

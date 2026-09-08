import type { D1Database } from "@cloudflare/workers-types";
import { collectionMatches, searchEntries } from "../../starboard/src/lib/search";
import { defaultCollections } from "../../starboard/src/lib/mock-data";
import type { Collection, CollectionRule, Entry, Provider, SearchMode } from "../../starboard/src/lib/types";

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

const entryFromRow = (row: EntryRow): Entry => ({
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
});

const collectionFromRow = (row: CollectionRow): Collection => ({
	id: row.id,
	name: row.name,
	description: row.description,
	icon: row.icon,
	color: row.color,
	rule: parseJson<CollectionRule>(row.rule_json, {}),
	builtIn: row.built_in === 1,
});

export async function listProviders(db: D1Database): Promise<Provider[]> {
	const result = await db.prepare("SELECT * FROM providers ORDER BY name ASC").all<ProviderRow>();
	return result.results.map(providerFromRow);
}

export async function getProvider(db: D1Database, id: string): Promise<Provider | undefined> {
	const result = await db.prepare("SELECT * FROM providers WHERE id = ?1 LIMIT 1").bind(id).first<ProviderRow>();
	return result ? providerFromRow(result) : undefined;
}

export interface SyncCheckpointRecord {
	providerId: string;
	cursor?: string;
	completedAt?: string;
}

export async function getSyncCheckpoint(db: D1Database, providerId: string): Promise<SyncCheckpointRecord | undefined> {
	const row = await db.prepare("SELECT provider_id, cursor_json, completed_at FROM sync_checkpoints WHERE provider_id = ?1 LIMIT 1").bind(providerId).first<{ provider_id: string; cursor_json: string | null; completed_at: string | null }>();
	if (!row) return undefined;
	const parsed = parseJson<{ value?: string }>(row.cursor_json, {});
	return { providerId: row.provider_id, cursor: parsed.value, completedAt: row.completed_at ?? undefined };
}

export async function listEntries(db: D1Database): Promise<Entry[]> {
	const result = await db.prepare("SELECT * FROM entries ORDER BY starred_at DESC").all<EntryRow>();
	return result.results.map(entryFromRow);
}

export async function listCollections(db: D1Database): Promise<Collection[]> {
	const hasDefaults = await db.prepare("SELECT id FROM collections WHERE id = 'all' LIMIT 1").first<{ id: string }>();
	if (!hasDefaults) await db.batch(defaultCollections.map((collection) => db.prepare(
		`INSERT OR IGNORE INTO collections (id, name, description, icon, color, rule_json, built_in)
		 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)`,
	).bind(collection.id, collection.name, collection.description, collection.icon, collection.color, JSON.stringify(collection.rule), collection.builtIn ? 1 : 0)));
	const result = await db.prepare("SELECT * FROM collections ORDER BY built_in DESC, name ASC").all<CollectionRow>();
	return result.results.map(collectionFromRow);
}

export async function getEntry(db: D1Database, id: string): Promise<Entry | undefined> {
	const result = await db.prepare("SELECT * FROM entries WHERE id = ?1 LIMIT 1").bind(id).first<EntryRow>();
	return result ? entryFromRow(result) : undefined;
}

export async function searchWorkspace(
	db: D1Database,
	query: string,
	mode: SearchMode,
	providerId?: string,
	collectionId?: string,
	limit = 50,
	queryEmbedding?: number[],
): Promise<Entry[]> {
	const [entries, collections] = await Promise.all([listEntries(db), listCollections(db)]);
	const collection = collectionId ? collections.find((item) => item.id === collectionId) : undefined;
	const filtered = entries.filter((entry) => {
		if (providerId && entry.providerId !== providerId) return false;
		return collection ? collectionMatches(entry, collection) : true;
	});
	return searchEntries(filtered, query, mode, queryEmbedding).slice(0, Math.max(1, Math.min(limit, 100)));
}

export async function updateEntry(
	db: D1Database,
	id: string,
	patch: Partial<Pick<Entry, "isRead" | "isPinned" | "tags" | "classification" | "embedding">>,
): Promise<Entry | undefined> {
	const current = await getEntry(db, id);
	if (!current) return undefined;
	const next: Entry = { ...current, ...patch, updatedAt: new Date().toISOString() };
	await db.prepare(
		`UPDATE entries
		 SET tags_json = ?1, is_read = ?2, is_pinned = ?3, updated_at = ?4, embedding_json = ?5, classification_json = ?6
		 WHERE id = ?7`,
	).bind(JSON.stringify(next.tags), next.isRead ? 1 : 0, next.isPinned ? 1 : 0, next.updatedAt, next.embedding ? JSON.stringify(next.embedding) : null, next.classification ? JSON.stringify(next.classification) : null, id).run();
	return next;
}

export async function insertCollection(db: D1Database, collection: Collection): Promise<Collection> {
	await db.prepare(
		`INSERT INTO collections (id, name, description, icon, color, rule_json, built_in)
		 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)`,
	).bind(collection.id, collection.name, collection.description, collection.icon, collection.color, JSON.stringify(collection.rule), collection.builtIn ? 1 : 0).run();
	return collection;
}

export async function upsertProvider(db: D1Database, provider: Provider): Promise<Provider> {
	await db.prepare(
		`INSERT INTO providers (id, name, kind, handle, description, accent, schema_json, connected, connected_at, last_synced_at, config_json)
		 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)
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
		   config_json = excluded.config_json`,
	).bind(
		provider.id,
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

export async function upsertEntries(db: D1Database, entries: Entry[]): Promise<UpsertReport> {
	if (entries.length === 0) return { added: 0, updated: 0, addedEntries: [], updatedEntries: [] };
	const existing = await listEntries(db);
	const existingById = new Map(existing.map((entry) => [entry.id, entry]));
	const statements = entries.map((entry) => {
		const previous = existingById.get(entry.id);
		const mergedTags = Array.from(new Set([...(previous?.tags ?? []), ...entry.tags]));
		return db.prepare(
			`INSERT INTO entries (
				id, provider_id, schema_id, external_id, kind, title, summary, url, author, author_handle,
				tags_json, starred_at, updated_at, synced_at, is_read, is_pinned, language, language_color,
				stars, forks, comments, fields_json, embedding_json, classification_json
			) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20, ?21, ?22, ?23, ?24)
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
				classification_json = excluded.classification_json`,
		).bind(
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

export async function removeEntriesNotSeen(db: D1Database, providerId: string, seenExternalIds: Set<string>): Promise<number> {
	const existing = await db.prepare("SELECT id, external_id FROM entries WHERE provider_id = ?1").bind(providerId).all<{ id: string; external_id: string | null }>();
	const stale = existing.results.filter((entry) => !seenExternalIds.has(entry.external_id ?? entry.id));
	if (stale.length === 0) return 0;
	await db.batch(stale.map((entry) => db.prepare("DELETE FROM entries WHERE id = ?1 AND provider_id = ?2").bind(entry.id, providerId)));
	return stale.length;
}

export async function recordSyncCheckpoint(db: D1Database, providerId: string, cursor?: string): Promise<void> {
	const completedAt = new Date().toISOString();
	await db.prepare(
		`INSERT INTO sync_checkpoints (provider_id, cursor_json, completed_at)
		 VALUES (?1, ?2, ?3)
		 ON CONFLICT(provider_id) DO UPDATE SET cursor_json = excluded.cursor_json, completed_at = excluded.completed_at`,
	).bind(providerId, cursor ? JSON.stringify({ value: cursor }) : null, completedAt).run();
	await db.prepare("UPDATE providers SET last_synced_at = ?1 WHERE id = ?2").bind(completedAt, providerId).run();
}

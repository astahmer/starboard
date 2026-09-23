import type { SyncResponse } from "../../starboard/src/lib/api-contract";
import { getProvider, getSyncCheckpoint, recordSyncCheckpoint, removeEntriesNotSeen, upsertEntries } from "./repository";
import { getRemoteProviderAdapter } from "./providers/registry";
import type { ProviderSyncPage } from "./providers/types";
import type { WorkerEnv } from "./env";
import { embedText } from "./embeddings";
import { runAutomations } from "./automation";

interface StoredCursor {
	next?: string;
	complete?: boolean;
	seenExternalIds?: string[];
}

function parseCursor(value: string | undefined): StoredCursor {
	if (!value) return {};
	try {
		const parsed = JSON.parse(value) as StoredCursor & { value?: string };
		return {
			next: parsed.next ?? parsed.value,
			complete: parsed.complete,
			seenExternalIds: Array.isArray(parsed.seenExternalIds) ? parsed.seenExternalIds.filter((item): item is string => typeof item === "string") : [],
		};
	} catch {
		return { next: value, seenExternalIds: [] };
	}
}

function serializeCursor(next: string | undefined, complete: boolean, seenExternalIds: Set<string>): string {
	return JSON.stringify({ next, complete, seenExternalIds: [...seenExternalIds] });
}

export function isSyncPending(cursor: string | undefined): boolean {
	return Boolean(cursor) && parseCursor(cursor).complete !== true;
}

export class SyncServiceError extends Error {
	readonly status: number;

	constructor(message: string, status = 502) {
		super(message);
		this.name = "SyncServiceError";
		this.status = status;
	}
}

export async function syncProvider(
	env: WorkerEnv,
	accountId: string,
	providerId: string,
	accessToken?: string,
	maxPages = 5,
	requestedCursor?: string,
): Promise<SyncResponse> {
	const provider = await getProvider(env.DB, accountId, providerId);
	if (!provider) throw new SyncServiceError("Provider not found", 404);
	if (!provider.connected) throw new SyncServiceError("Provider is disconnected", 409);
	const adapter = getRemoteProviderAdapter(provider.kind);
	if (!adapter) throw new SyncServiceError(`No remote adapter registered for ${provider.kind}`, 422);

	const checkpoint = requestedCursor ? { next: requestedCursor, complete: false, seenExternalIds: [] } : parseCursor((await getSyncCheckpoint(env.DB, accountId, providerId))?.cursor);
	let cursor = checkpoint.complete ? undefined : checkpoint.next;
	let hasMore = false;
	let pages = 0;
	let added = 0;
	let updated = 0;
	let indexed = 0;
	const addedEntries = [] as import("../../starboard/src/lib/types").Entry[];
	const seenExternalIds = new Set(checkpoint.seenExternalIds ?? []);

	while (pages < Math.max(1, maxPages)) {
		const page: ProviderSyncPage = await adapter.sync({ env, provider, accessToken, cursor });
		const indexedEntries = await Promise.all(page.entries.map(async (entry) => {
			if (entry.embedding || !env.EMBEDDING_API_URL || !env.EMBEDDING_API_KEY) return entry;
			const embedding = await embedText(env, [entry.title, entry.summary, entry.author, ...entry.tags, ...Object.values(entry.fields ?? {}).map((value) => typeof value === "string" ? value : JSON.stringify(value))].join(" "));
			return embedding ? { ...entry, embedding } : entry;
		}));
		const report = await upsertEntries(env.DB, accountId, indexedEntries);
		added += report.added;
		updated += report.updated;
		addedEntries.push(...report.addedEntries);
		indexed += indexedEntries.length;
		for (const entry of indexedEntries) seenExternalIds.add(entry.externalId ?? entry.id);
		pages += 1;
		hasMore = page.hasMore && Boolean(page.nextCursor);
		cursor = page.nextCursor;
		if (page.hasMore && !page.nextCursor) throw new SyncServiceError("Provider returned another page without a cursor");
		if (!hasMore) break;
	}

	const completedAt = new Date().toISOString();
	const complete = !hasMore;
	const removed = complete && !requestedCursor ? await removeEntriesNotSeen(env.DB, accountId, providerId, seenExternalIds) : 0;
	await recordSyncCheckpoint(env.DB, accountId, providerId, serializeCursor(cursor, complete, complete ? new Set() : seenExternalIds), complete);
	for (const entry of addedEntries.slice(0, 50)) await runAutomations(env, accountId, "entry.created", entry);
	await runAutomations(env, accountId, "sync.completed");
	return {
		providerId,
		added,
		updated,
		removed,
		indexed,
		completedAt,
		status: hasMore ? "queued" : "completed",
		message: hasMore ? `Indexed ${indexed} entries; sync can continue from the saved cursor.` : "Source fully synced.",
	};
}

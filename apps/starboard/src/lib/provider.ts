import type { Entry, Provider, ProviderSchema } from "./types";

export interface ProviderCursor {
	value?: string;
	updatedAt?: string;
	page?: number;
}

export interface ProviderPage<TPayload> {
	items: TPayload[];
	nextCursor?: ProviderCursor;
	hasMore: boolean;
}

export interface ProviderAdapter<TPayload = unknown> {
	/** Stable adapter key used by the server registry and plugin manifests. */
	id?: string;
	/** Stable manifest used to render the source and validate its normalized records. */
	manifest: Provider;
	/** Optional OAuth/device flow. The UI can keep the adapter disconnected until this resolves. */
	authorize(): Promise<void>;
	/** Pull only records after the last cursor so normal syncs stay cheap. */
	listSince(cursor?: ProviderCursor): Promise<ProviderPage<TPayload>>;
	/** Convert a provider payload into the common, searchable entry shape. */
	normalize(payload: TPayload, schema: ProviderSchema): Entry;
}

export interface ProviderRegistry {
	get(providerKind: string): ProviderAdapter | undefined;
	list(): ProviderAdapter[];
}

export function createProviderRegistry(adapters: ProviderAdapter[] = []): ProviderRegistry {
	const byKind = new Map<string, ProviderAdapter>(adapters.map((adapter) => [adapter.manifest.kind, adapter]));
	return {
		get: (providerKind) => byKind.get(providerKind),
		list: () => [...byKind.values()],
	};
}

export interface SyncCheckpoint {
	providerId: string;
	cursor?: ProviderCursor;
	completedAt?: string;
}

export interface SyncReport {
	providerId: string;
	added: number;
	updated: number;
	removed: number;
	nextCursor?: ProviderCursor;
	completedAt: string;
}

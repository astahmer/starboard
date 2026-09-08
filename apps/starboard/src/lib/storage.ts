import { defaultCollections, defaultEntries, defaultProviders } from "./mock-data";
import { readCachedWorkspace, writeCachedWorkspace } from "./local-cache";
import type { WorkspaceSnapshot } from "./types";

const STORAGE_KEY = "starboard.workspace.v1";

const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

export function defaultWorkspace(): WorkspaceSnapshot {
	return {
		version: 1,
		entries: clone(defaultEntries),
		providers: clone(defaultProviders),
		collections: clone(defaultCollections),
		lastSyncedAt: "2026-09-08T14:31:00.000Z",
		preferences: {
			automationEnabled: true,
		},
	};
}

export function loadWorkspace(): WorkspaceSnapshot {
	if (typeof window === "undefined") return defaultWorkspace();
	try {
		const raw = window.localStorage.getItem(STORAGE_KEY);
		if (!raw) return defaultWorkspace();
		const parsed = JSON.parse(raw) as Partial<WorkspaceSnapshot>;
		if (parsed.version !== 1 || !Array.isArray(parsed.entries) || !Array.isArray(parsed.providers) || !Array.isArray(parsed.collections)) {
			return defaultWorkspace();
		}
		return {
			...defaultWorkspace(),
			...parsed,
			preferences: {
				...defaultWorkspace().preferences,
				...parsed.preferences,
			},
		};
	} catch {
		return defaultWorkspace();
	}
}

export function saveWorkspace(snapshot: WorkspaceSnapshot): void {
	if (typeof window === "undefined") return;
	const persisted = { ...snapshot, cacheUpdatedAt: new Date().toISOString() };
	try {
		window.localStorage.setItem(STORAGE_KEY, JSON.stringify(persisted));
	} catch {
		// IndexedDB can still provide the local cache when localStorage is unavailable.
	}
	void writeCachedWorkspace(persisted);
}

export async function hydrateWorkspace(): Promise<WorkspaceSnapshot> {
	const local = loadWorkspace();
	const cached = await readCachedWorkspace();
	if (!cached || cached.version !== 1 || !Array.isArray(cached.entries) || !Array.isArray(cached.providers) || !Array.isArray(cached.collections)) {
		return local;
	}
	if (local.cacheUpdatedAt && cached.cacheUpdatedAt && local.cacheUpdatedAt > cached.cacheUpdatedAt) return local;
	return cached;
}

export function resetWorkspace(): WorkspaceSnapshot {
	const snapshot = defaultWorkspace();
	saveWorkspace(snapshot);
	return snapshot;
}

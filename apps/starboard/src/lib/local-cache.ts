import type { WorkspaceSnapshot } from "./types";

const DB_NAME = "starboard-cache";
const DB_VERSION = 1;
const WORKSPACE_STORE = "workspace";
const OUTBOX_STORE = "outbox";
const OUTBOX_FALLBACK_KEY = "starboard.outbox.v1";

export interface OutboxMutation {
	id: string;
	kind: "entry.patch" | "collection.create" | "provider.create" | "provider.update" | "automation.create" | "automation.update" | "automation.delete";
	payload: unknown;
	createdAt: string;
}

function openCache(): Promise<IDBDatabase | undefined> {
	if (typeof window === "undefined" || !window.indexedDB) return Promise.resolve(undefined);
	return new Promise((resolve) => {
		const request = window.indexedDB.open(DB_NAME, DB_VERSION);
		request.onupgradeneeded = () => {
			const database = request.result;
			if (!database.objectStoreNames.contains(WORKSPACE_STORE)) database.createObjectStore(WORKSPACE_STORE);
			if (!database.objectStoreNames.contains(OUTBOX_STORE)) database.createObjectStore(OUTBOX_STORE, { keyPath: "id" });
		};
		request.onsuccess = () => resolve(request.result);
		request.onerror = () => resolve(undefined);
	});
}

function fallbackMutations(): OutboxMutation[] {
	if (typeof window === "undefined") return [];
	try {
		const value = JSON.parse(window.localStorage.getItem(OUTBOX_FALLBACK_KEY) ?? "[]") as unknown;
		return Array.isArray(value) ? value as OutboxMutation[] : [];
	} catch {
		return [];
	}
}

function saveFallbackMutations(mutations: OutboxMutation[]): void {
	if (typeof window === "undefined") return;
	try {
		window.localStorage.setItem(OUTBOX_FALLBACK_KEY, JSON.stringify(mutations));
	} catch {
		// Storage can be unavailable in private browsing; the UI remains usable.
	}
}

export async function readCachedWorkspace(): Promise<WorkspaceSnapshot | undefined> {
	const database = await openCache();
	if (!database) return undefined;
	return new Promise((resolve) => {
		const transaction = database.transaction(WORKSPACE_STORE, "readonly");
		const request = transaction.objectStore(WORKSPACE_STORE).get("current");
		request.onsuccess = () => resolve(request.result as WorkspaceSnapshot | undefined);
		request.onerror = () => resolve(undefined);
		transaction.oncomplete = () => database.close();
	});
}

export async function writeCachedWorkspace(snapshot: WorkspaceSnapshot): Promise<void> {
	const database = await openCache();
	if (!database) return;
	await new Promise<void>((resolve) => {
		const transaction = database.transaction(WORKSPACE_STORE, "readwrite");
		transaction.objectStore(WORKSPACE_STORE).put(snapshot, "current");
		transaction.oncomplete = () => resolve();
		transaction.onerror = () => resolve();
		transaction.onabort = () => resolve();
	});
	database.close();
}

export async function enqueueMutation(mutation: OutboxMutation): Promise<void> {
	const database = await openCache();
	if (!database) {
		saveFallbackMutations([...fallbackMutations().filter((item) => item.id !== mutation.id), mutation]);
		return;
	}
	await new Promise<void>((resolve) => {
		const transaction = database.transaction(OUTBOX_STORE, "readwrite");
		transaction.objectStore(OUTBOX_STORE).put(mutation);
		transaction.oncomplete = () => resolve();
		transaction.onerror = () => resolve();
		transaction.onabort = () => resolve();
	});
	database.close();
}

export async function listMutations(): Promise<OutboxMutation[]> {
	const database = await openCache();
	if (!database) return fallbackMutations().sort((left, right) => left.createdAt.localeCompare(right.createdAt));
	return new Promise((resolve) => {
		const transaction = database.transaction(OUTBOX_STORE, "readonly");
		const request = transaction.objectStore(OUTBOX_STORE).getAll();
		request.onsuccess = () => resolve((request.result as OutboxMutation[]).sort((left, right) => left.createdAt.localeCompare(right.createdAt)));
		request.onerror = () => resolve([]);
		transaction.oncomplete = () => database.close();
	});
}

export async function removeMutation(id: string): Promise<void> {
	const database = await openCache();
	if (!database) {
		saveFallbackMutations(fallbackMutations().filter((item) => item.id !== id));
		return;
	}
	await new Promise<void>((resolve) => {
		const transaction = database.transaction(OUTBOX_STORE, "readwrite");
		transaction.objectStore(OUTBOX_STORE).delete(id);
		transaction.oncomplete = () => resolve();
		transaction.onerror = () => resolve();
		transaction.onabort = () => resolve();
	});
	database.close();
}

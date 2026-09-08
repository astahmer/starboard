import { apiRoutes, type ApiEnvelope, type SearchResponse, type SyncResponse, type WorkspaceResponse } from "./api-contract";
import { listMutations, removeMutation, type OutboxMutation } from "./local-cache";
import type { Automation, Collection, Entry, Provider } from "./types";

const apiBase = (import.meta.env.VITE_STARBOARD_API_URL ?? "").replace(/\/$/, "");

export function hasRemoteApi(): boolean {
	return Boolean(apiBase);
}

export function remoteUrl(path: string): string {
	return `${apiBase}${path}`;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
	const response = await fetch(remoteUrl(path), { ...init, credentials: "include", headers: { "content-type": "application/json", ...(init?.headers ?? {}) } });
	const envelope = await response.json() as ApiEnvelope<T> | { data?: { error?: string } };
	if (!response.ok) throw new Error((envelope.data as { error?: string } | undefined)?.error ?? `Starboard API returned HTTP ${response.status}`);
	return envelope.data as T;
}

export async function fetchRemoteWorkspace(): Promise<WorkspaceResponse> {
	return request<WorkspaceResponse>(apiRoutes.workspace);
}

export async function fetchRemoteSearch(query: string, mode: string, providerId?: string, collectionId?: string): Promise<SearchResponse> {
	const params = new URLSearchParams({ query, mode });
	if (providerId && providerId !== "all") params.set("providerId", providerId);
	if (collectionId && collectionId !== "all") params.set("collectionId", collectionId);
	return request<SearchResponse>(`${apiRoutes.search}?${params.toString()}`);
}

export async function patchRemoteEntry(id: string, patch: Partial<Pick<Entry, "isRead" | "isPinned" | "tags">>): Promise<Entry> {
	return (await request<{ entry: Entry }>(`${apiRoutes.entries}/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(patch) })).entry;
}

export async function syncRemoteProvider(providerId: string): Promise<SyncResponse> {
	return request<SyncResponse>(`${apiRoutes.sync}/${encodeURIComponent(providerId)}`, { method: "POST", body: "{}" });
}

export async function createRemoteCollection(collection: Collection): Promise<Collection> {
	return (await request<{ collection: Collection }>(apiRoutes.collections, { method: "POST", body: JSON.stringify(collection) })).collection;
}

export async function connectRemoteTangled(handle: string): Promise<Provider> {
	return (await request<{ provider: Provider }>(apiRoutes.providers, { method: "POST", body: JSON.stringify({ handle }) })).provider;
}

export async function createRemoteProvider(provider: Provider): Promise<Provider> {
	return (await request<{ provider: Provider }>(apiRoutes.providers, { method: "POST", body: JSON.stringify({ provider }) })).provider;
}

export async function updateRemoteProvider(id: string, patch: Partial<Pick<Provider, "connected">>): Promise<Provider> {
	return (await request<{ provider: Provider }>(`${apiRoutes.providers}/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(patch) })).provider;
}

export async function createRemoteAutomation(automation: Automation): Promise<Automation> {
	return (await request<{ automation: Automation }>(apiRoutes.automations, { method: "POST", body: JSON.stringify(automation) })).automation;
}

export async function updateRemoteAutomation(id: string, patch: Partial<Automation>): Promise<Automation> {
	return (await request<{ automation: Automation }>(`${apiRoutes.automations}/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(patch) })).automation;
}

export async function deleteRemoteAutomation(id: string): Promise<void> {
	await request<{ id: string }>(`${apiRoutes.automations}/${encodeURIComponent(id)}`, { method: "DELETE" });
}

export async function flushOutbox(): Promise<number> {
	if (!hasRemoteApi()) return 0;
	let flushed = 0;
	for (const mutation of await listMutations()) {
		try {
			await applyMutation(mutation);
			await removeMutation(mutation.id);
			flushed += 1;
		} catch {
			break;
		}
	}
	return flushed;
}

async function applyMutation(mutation: OutboxMutation): Promise<void> {
	if (mutation.kind === "entry.patch") {
		const payload = mutation.payload as { id: string; patch: Partial<Pick<Entry, "isRead" | "isPinned" | "tags">> };
		await patchRemoteEntry(payload.id, payload.patch);
		return;
	}
	if (mutation.kind === "collection.create") {
		await createRemoteCollection(mutation.payload as Collection);
		return;
	}
	if (mutation.kind === "provider.create") {
		await createRemoteProvider(mutation.payload as Provider);
		return;
	}
	if (mutation.kind === "provider.update") {
		const payload = mutation.payload as { id: string; patch: Partial<Pick<Provider, "connected">> };
		await updateRemoteProvider(payload.id, payload.patch);
		return;
	}
	if (mutation.kind === "automation.create") {
		await createRemoteAutomation(mutation.payload as Automation);
		return;
	}
	if (mutation.kind === "automation.update") {
		const payload = mutation.payload as { id: string; patch: Partial<Automation> };
		await updateRemoteAutomation(payload.id, payload.patch);
		return;
	}
	if (mutation.kind === "automation.delete") {
		await deleteRemoteAutomation((mutation.payload as { id: string }).id);
		return;
	}
	throw new Error(`Unsupported outbox mutation: ${mutation.kind}`);
}

export function providerAuthUrl(providerId: string): string {
	const path = providerId === "github" ? apiRoutes.auth.githubStart : apiRoutes.auth.tangledStart;
	return remoteUrl(`${path}?returnTo=${encodeURIComponent(window.location.pathname + window.location.search)}`);
}

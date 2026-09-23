import { apiRoutes, type ApiTokenSummary, type CreatedApiToken, type EntryMetadataResponse, type MeResponse, type SyncResponse, type WorkspaceResponse } from "./api-contract";
import type { Collection, Entry, Provider } from "./types";

export interface SyncProgress {
	entriesFetched: number;
	batch: number;
}

export function remoteUrl(path: string): string {
	return path;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
	const response = await fetch(remoteUrl(path), {
		...init,
		credentials: "include",
		headers: { "content-type": "application/json", ...init?.headers },
	});
	const payload = await response.json().catch(() => undefined) as { data?: unknown; error?: unknown } | undefined;
	if (!response.ok) {
		const resultData = payload?.data;
		const nestedMessage = resultData && typeof resultData === "object" && "error" in resultData && typeof resultData.error === "string" ? resultData.error : undefined;
		const message = nestedMessage ?? (typeof payload?.error === "string" ? payload.error : undefined);
		throw new Error(message ?? `Starboard returned HTTP ${response.status}`);
	}
	if (!payload || !("data" in payload)) throw new Error("Starboard returned an invalid response");
	return payload.data as T;
}

export async function fetchRemoteMe(): Promise<MeResponse> {
	return request<MeResponse>(apiRoutes.me);
}

export async function fetchRemoteWorkspace(): Promise<WorkspaceResponse> {
	return request<WorkspaceResponse>(apiRoutes.workspace);
}

export async function patchRemoteEntry(id: string, patch: Partial<Pick<Entry, "isRead" | "isPinned" | "tags">>): Promise<Entry> {
	return (await request<{ entry: Entry }>(`${apiRoutes.entries}/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(patch) })).entry;
}

export async function markRemoteGithubStarsRead(): Promise<{ markedRead: number }> {
	return request(apiRoutes.markGithubStarsRead, { method: "POST" });
}

export async function fetchRemoteApiTokens(): Promise<{ apiTokens: ApiTokenSummary[] }> {
	return request(apiRoutes.accountTokens);
}

export async function createRemoteApiToken(name: string): Promise<CreatedApiToken> {
	return request(apiRoutes.accountTokens, { method: "POST", body: JSON.stringify({ name }) });
}

export async function revokeRemoteApiToken(id: string): Promise<{ id: string; revokedAt: string }> {
	return request(`${apiRoutes.accountTokens}/${encodeURIComponent(id)}`, { method: "DELETE" });
}

export async function fetchRemoteEntryMetadata(id: string): Promise<EntryMetadataResponse> {
	return (await request<{ metadata: EntryMetadataResponse }>(`${apiRoutes.entries}/${encodeURIComponent(id)}/metadata`)).metadata;
}

export async function syncRemoteProvider(providerId: string, onProgress?: (progress: SyncProgress) => void): Promise<SyncResponse> {
	let added = 0;
	let updated = 0;
	let removed = 0;
	let indexed = 0;
	for (let batch = 1; batch <= 200; batch += 1) {
		const report = await request<SyncResponse>(`${apiRoutes.sync}/${encodeURIComponent(providerId)}`, { method: "POST", body: "{}" });
		added += report.added;
		updated += report.updated;
		removed += report.removed;
		indexed += report.indexed;
		onProgress?.({ entriesFetched: indexed, batch });
		if (report.status !== "queued") return { ...report, added, updated, removed, indexed };
	}
	throw new Error("This sync is larger than one browser session can finish. Select Sync again to continue from the saved cursor.");
}

export async function createRemoteCollection(collection: Collection): Promise<Collection> {
	return (await request<{ collection: Collection }>(apiRoutes.collections, { method: "POST", body: JSON.stringify(collection) })).collection;
}

export async function connectRemoteTangled(handle: string): Promise<Provider> {
	return (await request<{ provider: Provider }>(apiRoutes.providers, { method: "POST", body: JSON.stringify({ handle }) })).provider;
}

export async function logoutRemote(): Promise<void> {
	const response = await fetch(remoteUrl(apiRoutes.auth.logout), { method: "POST", credentials: "include" });
	if (!response.ok) throw new Error(`Could not sign out (HTTP ${response.status})`);
}

export function providerAuthUrl(providerId = "github"): string {
	const path = providerId === "github" ? apiRoutes.auth.githubStart : apiRoutes.auth.tangledStart;
	const returnTo = `${window.location.origin}${window.location.pathname}${window.location.search}`;
	return remoteUrl(`${path}?returnTo=${encodeURIComponent(returnTo)}`);
}

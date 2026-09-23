import type { Entry, Provider, RepositoryMetadata } from "../../../starboard/src/lib/types";
import type { WorkerEnv } from "../env";

export interface ProviderSyncContext {
	env: WorkerEnv;
	provider: Provider;
	accessToken?: string;
	cursor?: string;
}

export interface ProviderSyncPage {
	entries: Entry[];
	publicRepositories?: Array<{ externalId: string; metadata: RepositoryMetadata }>;
	privateRepositoryIds?: string[];
	nextCursor?: string;
	hasMore: boolean;
	remoteHandle?: string;
}

export interface RepositoryRefreshContext extends ProviderSyncContext {
	externalId: string;
	fullName: string;
	includeMetadata: boolean;
	includeLatestCommit: boolean;
}

export interface RepositoryRefreshResult {
	metadata?: RepositoryMetadata;
	isPublic?: boolean;
	latestCommit?: import("../../../starboard/src/lib/types").LatestCommit | null;
}

export interface ProviderSnapshot {
	starCount?: number;
	latestStarredAt?: string;
}

export interface RemoteProviderAdapter {
	kind: Provider["kind"];
	sync(context: ProviderSyncContext): Promise<ProviderSyncPage>;
	snapshot?(context: ProviderSyncContext): Promise<ProviderSnapshot | undefined>;
	refreshRepository?(context: RepositoryRefreshContext): Promise<RepositoryRefreshResult>;
}

export class ProviderSyncError extends Error {
	readonly status: number;

	constructor(message: string, status = 502) {
		super(message);
		this.name = "ProviderSyncError";
		this.status = status;
	}
}

export async function readProviderJson<T>(response: Response, providerName: string): Promise<T> {
	if (!response.ok) {
		const detail = (await response.text()).slice(0, 240);
		throw new ProviderSyncError(`${providerName} returned HTTP ${response.status}${detail ? `: ${detail}` : ""}`, response.status);
	}
	return response.json() as Promise<T>;
}

function parseLinkRelation(value: string | null, relation: string): string | undefined {
	if (!value) return undefined;
	for (const part of value.split(",")) {
		const match = part.match(/<([^>]+)>;\s*rel="([^"]+)"/);
		if (match?.[1] && match[2] === relation) return match[1];
	}
	return undefined;
}

export function parseNextLink(value: string | null): string | undefined {
	return parseLinkRelation(value, "next");
}

export function parseLastLink(value: string | null): string | undefined {
	return parseLinkRelation(value, "last");
}

export function stableProviderEntryId(providerId: string, externalId: string): string {
	return `${providerId}:${externalId}`.replace(/[^a-zA-Z0-9:_./-]+/g, "-");
}

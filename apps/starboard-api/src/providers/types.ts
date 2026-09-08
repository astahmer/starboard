import type { Entry, Provider } from "../../../starboard/src/lib/types";
import type { WorkerEnv } from "../env";

export interface ProviderSyncContext {
	env: WorkerEnv;
	provider: Provider;
	accessToken?: string;
	cursor?: string;
}

export interface ProviderSyncPage {
	entries: Entry[];
	nextCursor?: string;
	hasMore: boolean;
	remoteHandle?: string;
}

export interface RemoteProviderAdapter {
	kind: Provider["kind"];
	sync(context: ProviderSyncContext): Promise<ProviderSyncPage>;
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

export function parseNextLink(value: string | null): string | undefined {
	if (!value) return undefined;
	for (const part of value.split(",")) {
		const match = part.match(/<([^>]+)>;\s*rel="([^"]+)"/);
		if (match?.[1] && match[2] === "next") return match[1];
	}
	return undefined;
}

export function stableProviderEntryId(providerId: string, externalId: string): string {
	return `${providerId}:${externalId}`.replace(/[^a-zA-Z0-9:_./-]+/g, "-");
}

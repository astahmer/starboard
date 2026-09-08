import type { Entry, Provider } from "../../../starboard/src/lib/types";
import type { ProviderSyncContext, ProviderSyncPage, RemoteProviderAdapter } from "./types";
import { readProviderJson, stableProviderEntryId } from "./types";

interface StarItem {
	uri?: string;
	value?: {
		createdAt?: string;
		subject?: unknown;
		subjectDid?: string;
	};
}

interface StarPage {
	items?: StarItem[];
	cursor?: string | null;
}

interface RepoRecord {
	uri?: string;
	value?: {
		uri?: string;
		name?: string;
		description?: string;
		owner?: { did?: string; handle?: string; displayName?: string };
		did?: string;
		knot?: string;
		starsCount?: number;
		stars_count?: number;
		forksCount?: number;
		forks_count?: number;
		language?: string;
		topics?: string[];
		labels?: string[];
		createdAt?: string;
		updatedAt?: string;
	};
}

function subjectIdentifier(subject: unknown): string | undefined {
	if (typeof subject === "string") return subject;
	if (!subject || typeof subject !== "object") return undefined;
	const value = subject as Record<string, unknown>;
	if (typeof value.uri === "string") return value.uri;
	if (typeof value.did === "string") return value.did;
	if (typeof value.repo === "string") return value.repo;
	return undefined;
}

async function resolveHandle(handle: string, resolverBase: string, accessToken?: string): Promise<string> {
	if (handle.startsWith("did:")) return handle;
	const url = new URL("/xrpc/com.atproto.identity.resolveHandle", resolverBase);
	url.searchParams.set("handle", handle.replace(/^@/, ""));
	const response = await fetch(url, accessToken ? { headers: { Authorization: `Bearer ${accessToken}` } } : undefined);
	const body = await readProviderJson<{ did?: string }>(response, "AT Protocol identity resolver");
	if (!body.did) throw new Error(`Could not resolve Tangled handle ${handle}`);
	return body.did;
}

async function getRepo(bobbinBase: string, repo: string, accessToken?: string): Promise<RepoRecord["value"]> {
	const url = new URL("/xrpc/sh.tangled.repo.getRepo", bobbinBase);
	url.searchParams.set("repo", repo);
	const response = await fetch(url, accessToken ? { headers: { Authorization: `Bearer ${accessToken}` } } : undefined);
	if (!response.ok) return undefined;
	const body = (await response.json()) as RepoRecord;
	return body.value ? { ...body.value, uri: body.uri } : undefined;
}

function normalize(provider: Provider, item: StarItem, repoRef: string, repo: RepoRecord["value"]): Entry {
	const name = repo?.name ?? repoRef.split("/").at(-1) ?? "Tangled repository";
	const owner = repo?.owner?.handle ?? repo?.owner?.displayName ?? repo?.owner?.did ?? "Tangled";
	const externalId = repoRef || item.uri || name;
	const createdAt = item.value?.createdAt ?? new Date().toISOString();
	return {
		id: stableProviderEntryId(provider.id, externalId),
		providerId: provider.id,
		schemaId: provider.schema.id,
		externalId,
		kind: provider.schema.defaultKind,
		title: `${owner} / ${name}`,
		summary: repo?.description ?? "Tangled repository.",
		url: repo?.uri?.startsWith("http") ? repo.uri : `https://tangled.org/${repoRef.replace(/^at:\/\//, "")}`,
		author: owner,
		authorHandle: repo?.owner?.handle ?? repo?.owner?.did ?? owner,
		tags: [...(repo?.topics ?? []), ...(repo?.labels ?? [])].map((tag) => tag.toLocaleLowerCase()),
		starredAt: createdAt,
		updatedAt: repo?.updatedAt ?? repo?.createdAt ?? createdAt,
		syncedAt: new Date().toISOString(),
		isRead: false,
		isPinned: false,
		language: repo?.language,
		stars: repo?.starsCount ?? repo?.stars_count,
		forks: repo?.forksCount ?? repo?.forks_count,
		fields: { repositoryUri: repoRef, starRecordUri: item.uri ?? "" },
	};
}

export const tangledAdapter: RemoteProviderAdapter = {
	kind: "tangled",
	async sync({ env, provider, accessToken, cursor }: ProviderSyncContext): Promise<ProviderSyncPage> {
		const bobbinBase = (env.TANGLED_BOBBIN_URL || "https://api.tangled.org").replace(/\/$/, "");
		const resolverBase = (env.TANGLED_RESOLVER_URL || "https://public.api.bsky.app").replace(/\/$/, "");
		const subject = await resolveHandle(provider.handle, resolverBase, accessToken);
		const url = new URL("/xrpc/sh.tangled.feed.listStarsBy", bobbinBase);
		url.searchParams.set("subject", subject);
		url.searchParams.set("limit", "100");
		url.searchParams.set("order", "desc");
		if (cursor) url.searchParams.set("cursor", cursor);
		const response = await fetch(url, accessToken ? { headers: { Authorization: `Bearer ${accessToken}` } } : undefined);
		const body = await readProviderJson<StarPage>(response, "Tangled Bobbin");
		const items = body.items ?? [];
		const entries = await Promise.all(items.map(async (item) => {
			const repoRef = subjectIdentifier(item.value?.subject) ?? item.value?.subjectDid ?? item.uri ?? "";
			return normalize(provider, item, repoRef, repoRef ? await getRepo(bobbinBase, repoRef, accessToken) : undefined);
		}));
		return { entries, hasMore: Boolean(body.cursor), nextCursor: body.cursor ?? undefined, remoteHandle: subject };
	},
};

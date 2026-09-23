import { z } from "zod";
import type { Entry } from "../../starboard/src/lib/types";
import { getAgentEntry, listAgentEntries, listCollectionsReadOnly, listProviders } from "./repository";
import type { WorkerEnv } from "./env";

export const agentApiDocumentation = {
	name: "Starboard Agent API",
	version: "v1",
	authentication: {
		type: "Bearer token",
		header: "Authorization: Bearer sb_live_…",
		permissions: "Read-only access to your Starboard library",
		lifetime: "Tokens expire one year after creation and can be revoked from the Agent API dialog.",
	},
	endpoints: [
		{ method: "GET", path: "/api/v1/me", description: "Return the authenticated Starboard account." },
		{ method: "GET", path: "/api/v1/providers", description: "List connected sources and their IDs for filtering." },
		{ method: "GET", path: "/api/v1/entries", description: "Search, filter, sort, and page through saved entries." },
		{ method: "GET", path: "/api/v1/entries/{id}", description: "Return one saved entry." },
		{ method: "GET", path: "/api/v1/collections", description: "Return saved collections." },
	],
	entriesQuery: {
		q: "Substring search across repository names, descriptions, owners, tags, and source fields.",
		providerId: "Limit results to one connected source ID.",
		view: "all, unread, or pinned. Defaults to all.",
		language: "Exact language match.",
		minStars: "Minimum repository star count.",
		sort: "most-stars, recently-pushed, recently-starred, or name. Defaults to recently-starred.",
		page: "One-based page number. Defaults to 1.",
		limit: "Page size from 1 to 100. Defaults to 50.",
	},
	responseEnvelope: "Successful responses use { data, requestId }. Errors use { data: { error }, requestId }.",
	example: "curl -H \"Authorization: Bearer $STARBOARD_API_TOKEN\" \"$STARBOARD_API_URL/api/v1/entries?q=panda&sort=most-stars&minStars=100\"",
} as const;

const agentEntryQuerySchema = z.object({
	q: z.string().trim().max(200).optional(),
	providerId: z.string().trim().min(1).max(200).optional(),
	view: z.enum(["all", "unread", "pinned"]).default("all"),
	language: z.string().trim().min(1).max(100).optional(),
	minStars: z.string().regex(/^\d+$/).transform(Number).pipe(z.number().int().min(0).max(2_147_483_647)).optional(),
	sort: z.enum(["most-stars", "recently-pushed", "recently-starred", "name"]).default("recently-starred"),
	page: z.coerce.number().int().min(1).max(100_000).default(1),
	limit: z.coerce.number().int().min(1).max(100).default(50),
}).strict();

const allowedEntryParams = new Set(["q", "providerId", "view", "language", "minStars", "sort", "page", "limit"]);

const publicAgentEntry = (entry: Entry) => ({
	id: entry.id,
	providerId: entry.providerId,
	kind: entry.kind,
	title: entry.title,
	summary: entry.summary,
	url: entry.url,
	author: entry.author,
	authorHandle: entry.authorHandle,
	tags: entry.tags,
	starredAt: entry.starredAt,
	updatedAt: entry.updatedAt,
	isRead: entry.isRead,
	isPinned: entry.isPinned,
	language: entry.language,
	stars: entry.stars,
	forks: entry.forks,
	comments: entry.comments,
	fields: entry.fields,
});

export type AgentApiResult = { data: unknown; status?: number } | { error: string; status: number };

export async function handleAgentApi(request: Request, env: WorkerEnv, accountId: string): Promise<AgentApiResult> {
	if (request.method !== "GET") return { error: "The Agent API is read-only", status: 405 };
	const url = new URL(request.url);
	if (url.pathname === "/api/v1/me") {
		const account = await env.DB.prepare(
			"SELECT handle, display_name AS displayName, avatar_url AS avatarUrl FROM accounts WHERE id = ?1 LIMIT 1",
		).bind(accountId).first<{ handle: string; displayName: string; avatarUrl: string | null }>();
		if (!account) return { error: "Account not found", status: 404 };
		return { data: { account: { handle: account.handle, displayName: account.displayName, avatarUrl: account.avatarUrl ?? undefined } } };
	}
	if (url.pathname === "/api/v1/providers") {
		const providers = await listProviders(env.DB, accountId);
		return { data: { providers: providers.map((provider) => ({ id: provider.id, name: provider.name, kind: provider.kind, handle: provider.handle, connected: provider.connected, lastSyncedAt: provider.lastSyncedAt })) } };
	}
	if (url.pathname === "/api/v1/collections") return { data: { collections: await listCollectionsReadOnly(env.DB, accountId) } };
	if (url.pathname === "/api/v1/entries") {
		for (const key of url.searchParams.keys()) {
			if (!allowedEntryParams.has(key)) return { error: `Unsupported query parameter: ${key}`, status: 400 };
		}
		const parsedQuery = agentEntryQuerySchema.safeParse({
			q: url.searchParams.get("q") ?? undefined,
			providerId: url.searchParams.get("providerId") ?? undefined,
			view: url.searchParams.get("view") ?? undefined,
			language: url.searchParams.get("language") ?? undefined,
			minStars: url.searchParams.get("minStars") ?? undefined,
			sort: url.searchParams.get("sort") ?? undefined,
			page: url.searchParams.get("page") ?? undefined,
			limit: url.searchParams.get("limit") ?? undefined,
		});
		if (!parsedQuery.success) return { error: "Invalid entry filters", status: 400 };
		const page = parsedQuery.data.page;
		const limit = parsedQuery.data.limit;
		const result = await listAgentEntries(env.DB, accountId, {
			query: parsedQuery.data.q || undefined,
			providerId: parsedQuery.data.providerId,
			view: parsedQuery.data.view,
			language: parsedQuery.data.language,
			minStars: parsedQuery.data.minStars,
			sort: parsedQuery.data.sort,
			limit,
			offset: (page - 1) * limit,
		});
		return { data: { entries: result.entries.map(publicAgentEntry), pagination: { page, limit, total: result.total, hasMore: page * limit < result.total } } };
	}
	const entryMatch = url.pathname.match(/^\/api\/v1\/entries\/([^/]+)$/);
	if (entryMatch?.[1]) {
		const entry = await getAgentEntry(env.DB, accountId, decodeURIComponent(entryMatch[1]));
		return entry ? { data: { entry: publicAgentEntry(entry) } } : { error: "Entry not found", status: 404 };
	}
	return { error: "Not found", status: 404 };
}

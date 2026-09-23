import { McpServer } from "@modelcontextprotocol/server";
import { createMcpHandler } from "agents/mcp/server";
import { z } from "zod";
import { connectTangledHandle, credentialForAccount, credentialForProvider, finishGithubOAuth, finishTangledOAuth, logout, sessionAccountIdForRequest, startGithubOAuth, startTangledOAuth } from "./auth";
import { apiRoutes, type SearchRequest } from "../../starboard/src/lib/api-contract";
import type { Automation, Collection, CollectionRule, Entry, JsonValue, PluginManifest, Provider, RepositoryMetadataResponse, SearchMode } from "../../starboard/src/lib/types";
import { getEntry, getProvider, getSyncCheckpoint, insertCollection, listCollections, listEntries, listProviders, searchWorkspace, updateEntry, upsertProvider } from "./repository";
import { isSyncPending, syncProvider } from "./sync";
import { embedText } from "./embeddings";
import { deleteAutomation, listAutomations, listPlugins, upsertAutomation, upsertPlugin } from "./automation";
import type { WorkerEnv } from "./env";
import { getRemoteProviderAdapter } from "./providers/registry";
import { claimRepositoryMetadataRefresh, getRepositoryMetadataResponse, isRepositoryMetadataFresh, releaseRepositoryMetadataRefresh, saveRepositoryMetadataRefresh } from "./repository-metadata";

const jsonHeaders = (request: Request): Headers => {
	const headers = new Headers({
		"content-type": "application/json; charset=utf-8",
		"access-control-allow-headers": "content-type, authorization, mcp-protocol-version, mcp-session-id",
		"access-control-allow-methods": "GET, PATCH, POST, DELETE, OPTIONS",
		"access-control-expose-headers": "Mcp-Session-Id, Mcp-Protocol-Version",
	});
	const origin = request.headers.get("origin");
	if (origin) {
		headers.set("access-control-allow-origin", origin);
		headers.set("access-control-allow-credentials", "true");
		headers.set("vary", "Origin");
	}
	return headers;
};

function configuredOrigin(value: string | undefined): string | undefined {
	if (!value) return undefined;
	try {
		return new URL(value).origin;
	} catch {
		return undefined;
	}
}

function withCors(response: Response, request: Request, env: WorkerEnv): Response {
	const origin = request.headers.get("origin");
	if (!origin) return response;
	const allowedOrigins = new Set([new URL(request.url).origin, configuredOrigin(env.APP_URL), configuredOrigin(env.WEB_APP_URL)].filter((value): value is string => Boolean(value)));
	const headers = new Headers(response.headers);
	if (allowedOrigins.has(origin)) {
		headers.set("access-control-allow-origin", origin);
		headers.set("access-control-allow-credentials", "true");
	} else {
		headers.delete("access-control-allow-origin");
		headers.delete("access-control-allow-credentials");
	}
	headers.set("vary", "Origin");
	return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

const requestId = () => crypto.randomUUID();

function json<T>(request: Request, data: T, status = 200): Response {
	return new Response(JSON.stringify({ data, requestId: requestId() }), { status, headers: jsonHeaders(request) });
}

function failure(request: Request, message: string, status: number): Response {
	return json(request, { error: message }, status);
}

function modeFrom(value: string | null): SearchMode {
	return value === "fuzzy" || value === "semantic" ? value : "hybrid";
}

function limitFrom(value: string | null): number {
	const parsed = Number(value ?? 50);
	return Number.isFinite(parsed) ? Math.max(1, Math.min(Math.floor(parsed), 100)) : 50;
}

function isAutomationTrigger(value: unknown): value is Automation["trigger"] {
	return value === "entry.created" || value === "entry.updated" || value === "sync.completed" || value === "manual";
}

function isAutomationAction(value: unknown): value is Automation["action"] {
	return value === "tag" || value === "classify" || value === "webhook";
}

function slugify(value: string): string {
	return value.toLocaleLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "collection";
}

function textResult(value: unknown) {
	return { content: [{ type: "text" as const, text: JSON.stringify(value) }] };
}

function createMcpServer(env: WorkerEnv, accountId: string, request: Request): McpServer {
	const server = new McpServer({ name: "Starboard", version: "0.1.0" });

	server.registerTool(
		"search_entries",
		{
			description: "Search the user's provider-agnostic source library by text, meaning, provider, or collection.",
			inputSchema: {
				query: z.string().default(""),
				mode: z.enum(["hybrid", "fuzzy", "semantic"]).optional(),
				providerId: z.string().optional(),
				collectionId: z.string().optional(),
				limit: z.number().int().min(1).max(100).optional(),
			},
		},
		async ({ query, mode, providerId, collectionId, limit }) => {
			const entries = await searchWorkspace(env.DB, accountId, query, mode ?? "hybrid", providerId, collectionId, limit ?? 20, await embedText(env, query));
			return textResult({ entries, count: entries.length, mode: mode ?? "hybrid" });
		},
	);

	server.registerTool(
		"get_entry",
		{
			description: "Read one complete Starboard entry, including source provenance, tags, and starred date.",
			inputSchema: { id: z.string() },
		},
		async ({ id }) => {
			const entry = await getEntry(env.DB, accountId, id);
			return textResult(entry ?? { error: "Entry not found", id });
		},
	);

	server.registerTool(
		"list_collections",
		{
			description: "List saved smart collections and their rules.",
			inputSchema: {},
		},
		async () => textResult({ collections: await listCollections(env.DB, accountId) }),
	);

	server.registerTool(
		"sync_provider",
		{
			description: "Sync a provider now, resuming its cursor and returning an incremental backfill report.",
			inputSchema: { providerId: z.string(), cursor: z.string().optional() },
		},
		async ({ providerId, cursor }) => {
			if (!(await getProvider(env.DB, accountId, providerId))) return textResult({ error: "Provider not found", providerId });
			const report = await syncProvider(env, accountId, providerId, await credentialForProvider(env, request, providerId), 5, cursor);
			return textResult({ ...report, requestedCursor: cursor });
		},
	);

	server.registerTool(
		"tag_entry",
		{
			description: "Add or remove one normalized tag from an entry.",
			inputSchema: { id: z.string(), tag: z.string().min(1), action: z.enum(["add", "remove"]).optional() },
		},
		async ({ id, tag, action }) => {
			const entry = await getEntry(env.DB, accountId, id);
			if (!entry) return textResult({ error: "Entry not found", id });
			const normalizedTag = tag.trim().toLocaleLowerCase();
			if (!normalizedTag) return textResult({ error: "Tag is required", id });
			const tags = action === "remove" ? entry.tags.filter((item) => item !== normalizedTag) : Array.from(new Set([...entry.tags, normalizedTag]));
			const updated = await updateEntry(env.DB, accountId, id, { tags });
			return textResult(updated);
		},
	);

	server.registerTool(
		"create_collection",
		{
			description: "Create a saved smart collection over provider and tag metadata.",
			inputSchema: {
				name: z.string().min(1),
				description: z.string().optional(),
				providerId: z.string().optional(),
				tags: z.array(z.string()).optional(),
			},
		},
		async ({ name, description, providerId, tags }) => {
			const rule: CollectionRule = {};
			if (providerId) rule.providerIds = [providerId];
			if (tags?.length) rule.tags = tags.map((tag) => tag.trim().toLocaleLowerCase()).filter(Boolean);
			const collection: Collection = {
				id: `${accountId}:${slugify(name)}-${Date.now()}`,
				name,
				description: description ?? "A saved view created through MCP.",
				icon: "layers",
				color: "#8b7cff",
				rule,
				builtIn: false,
			};
			return textResult(await insertCollection(env.DB, accountId, collection));
		},
	);

	server.registerTool(
		"list_automations",
		{ description: "List enabled and disabled Starboard automation rules.", inputSchema: {} },
		async () => textResult({ automations: await listAutomations(env, accountId) }),
	);

	server.registerTool(
		"create_automation",
		{
			description: "Create a reviewable automation rule for new entries or completed syncs.",
			inputSchema: {
				name: z.string().min(1),
				trigger: z.enum(["entry.created", "entry.updated", "sync.completed", "manual"]),
				action: z.enum(["tag", "classify", "webhook"]),
				config: z.record(z.string(), z.unknown()).optional(),
			},
		},
		async ({ name, trigger, action, config }) => {
			const now = new Date().toISOString();
			const automation: Automation = { id: `${accountId}:${slugify(name)}-${Date.now()}`, name: name.trim(), description: "Created through MCP.", trigger, action, config: (config ?? {}) as Record<string, JsonValue>, enabled: true, createdAt: now, updatedAt: now };
			return textResult(await upsertAutomation(env, accountId, automation));
		},
	);

	server.registerTool(
		"register_plugin",
		{
			description: "Register a declarative plugin manifest. Plugin code runs only when explicitly enabled by a host integration.",
			inputSchema: {
				id: z.string().min(1),
				name: z.string().min(1),
				version: z.string().min(1),
				description: z.string().optional(),
				permissions: z.array(z.string()).optional(),
				triggers: z.array(z.string()).optional(),
				actions: z.array(z.string()).optional(),
				entrypoint: z.string().optional(),
			},
		},
		async ({ id, name, version, description, permissions, triggers, actions, entrypoint }) => {
			const plugin: PluginManifest = { id: `${accountId}:${id.trim()}`, name: name.trim(), version: version.trim(), description: description?.trim() ?? "Registered through MCP.", permissions: permissions ?? [], triggers: triggers as PluginManifest["triggers"] ?? [], actions: actions as PluginManifest["actions"] ?? [], entrypoint, enabled: true };
			return textResult(await upsertPlugin(env, accountId, plugin));
		},
	);

	return server;
}

async function refreshRepositoryMetadataForEntry(env: WorkerEnv, accountId: string, entryId: string): Promise<RepositoryMetadataResponse | undefined> {
	const entry = await getEntry(env.DB, accountId, entryId);
	if (!entry?.externalId) return undefined;
	const provider = await getProvider(env.DB, accountId, entry.providerId);
	if (!provider || provider.kind !== "github") return undefined;
	const adapter = getRemoteProviderAdapter(provider.kind);
	if (!adapter?.refreshRepository) return undefined;
	let cached = await getRepositoryMetadataResponse({ db: env.DB, externalId: entry.externalId });
	const includeMetadata = !isRepositoryMetadataFresh(cached.metadataFetchedAt);
	const includeLatestCommit = !isRepositoryMetadataFresh(cached.latestCommitFetchedAt);
	if ((!includeMetadata && !includeLatestCommit) || !provider.connected) return cached;
	let accessToken: string | undefined;
	try {
		accessToken = await credentialForAccount(env, accountId, provider.id);
	} catch {
		return cached;
	}
	if (!accessToken) return cached;
	const token = await claimRepositoryMetadataRefresh({ db: env.DB, externalId: entry.externalId, includeMetadata, includeLatestCommit });
	if (!token) return getRepositoryMetadataResponse({ db: env.DB, externalId: entry.externalId });
	try {
		const result = await adapter.refreshRepository({
			env,
			provider,
			accessToken,
			externalId: entry.externalId,
			fullName: cached.metadata?.title ?? entry.title,
			includeMetadata,
			includeLatestCommit,
		});
		if (result.isPublic === undefined && !cached.metadata) {
			await releaseRepositoryMetadataRefresh(env.DB, entry.externalId, token);
			return cached;
		}
		const fetchedAt = new Date().toISOString();
		await saveRepositoryMetadataRefresh({
			db: env.DB,
			externalId: entry.externalId,
			token,
			metadata: result.metadata,
			isPublic: result.isPublic ?? true,
			latestCommit: result.latestCommit,
			fetchedAt,
		});
		if (result.isPublic === false) return { metadata: result.metadata, metadataFetchedAt: fetchedAt, refreshing: false };
		cached = await getRepositoryMetadataResponse({ db: env.DB, externalId: entry.externalId });
		return cached;
	} catch {
		await releaseRepositoryMetadataRefresh(env.DB, entry.externalId, token);
		return getRepositoryMetadataResponse({ db: env.DB, externalId: entry.externalId });
	}
}

async function handleApi(request: Request, env: WorkerEnv, accountId?: string): Promise<Response> {
	const url = new URL(request.url);
	if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: jsonHeaders(request) });

	if (url.pathname === apiRoutes.health && request.method === "GET") {
		return json(request, { ok: true, service: "starboard-api", database: "d1", timestamp: new Date().toISOString() });
	}
	if (url.pathname === apiRoutes.me && request.method === "GET") {
		if (!accountId) return json(request, { account: null, authenticated: false, providers: [], canConnectGithub: Boolean(env.GITHUB_CLIENT_ID && env.GITHUB_CLIENT_SECRET && env.SESSION_SECRET) });
		const account = await env.DB.prepare("SELECT id, handle, display_name AS displayName, avatar_url AS avatarUrl FROM accounts WHERE id = ?1 LIMIT 1").bind(accountId).first<{ id: string; handle: string; displayName: string; avatarUrl: string | null }>();
		return json(request, { account: account ? { ...account, avatarUrl: account.avatarUrl ?? undefined } : null, authenticated: Boolean(account), providers: account ? await listProviders(env.DB, accountId) : [], canConnectGithub: Boolean(env.GITHUB_CLIENT_ID && env.GITHUB_CLIENT_SECRET && env.SESSION_SECRET) });
	}
	if (!accountId) return failure(request, "Authentication required", 401);
	if (url.pathname === apiRoutes.workspace && request.method === "GET") {
		const providers = await listProviders(env.DB, accountId);
		const providersWithSyncState = await Promise.all(providers.map(async (provider) => ({
			...provider,
			syncPending: isSyncPending((await getSyncCheckpoint(env.DB, accountId, provider.id))?.cursor),
		})));
		return json(request, { providers: providersWithSyncState, entries: await listEntries(env.DB, accountId), collections: await listCollections(env.DB, accountId), automations: await listAutomations(env, accountId), plugins: await listPlugins(env, accountId) });
	}
	if (url.pathname === apiRoutes.providers && request.method === "GET") return json(request, { providers: await listProviders(env.DB, accountId) });
	if (url.pathname === apiRoutes.providers && request.method === "POST") {
		const body = await request.json() as { handle?: string; provider?: Partial<Provider> };
		if (body.provider) {
			if (!body.provider.id?.trim() || !body.provider.name?.trim() || !body.provider.schema?.id) return failure(request, "Provider id, name, and schema are required", 400);
			const now = new Date().toISOString();
			const provider: Provider = {
				id: `${accountId}:${body.provider.id.trim()}`,
				name: body.provider.name.trim(),
				kind: body.provider.kind ?? "custom",
				handle: body.provider.handle?.trim() || "local-source",
				description: body.provider.description?.trim() || body.provider.schema.description,
				accent: body.provider.accent ?? "#8b7cff",
				schema: body.provider.schema,
				connected: body.provider.connected ?? true,
				connectedAt: body.provider.connectedAt ?? now,
				lastSyncedAt: body.provider.lastSyncedAt,
				settings: body.provider.settings,
			};
			return json(request, { provider: await upsertProvider(env.DB, accountId, provider) }, 201);
		}
		if (!body.handle?.trim()) return failure(request, "Provider handle is required", 400);
		try {
			return json(request, { provider: await connectTangledHandle(env, accountId, body.handle) }, 201);
		} catch (error) {
			return failure(request, error instanceof Error ? error.message : "Could not connect provider", 400);
		}
	}
	const providerMatch = url.pathname.match(/^\/api\/providers\/([^/]+)$/);
	if (providerMatch?.[1] && request.method === "PATCH") {
		const id = decodeURIComponent(providerMatch[1]);
		const current = await getProvider(env.DB, accountId, id);
		if (!current) return failure(request, "Provider not found", 404);
		const body = await request.json() as { connected?: boolean };
		if (typeof body.connected !== "boolean") return failure(request, "Provider connected state is required", 400);
		const connectedAt = body.connected ? current.connectedAt ?? new Date().toISOString() : current.connectedAt;
		await env.DB.prepare("UPDATE providers SET connected = ?1, connected_at = ?2 WHERE account_id = ?3 AND id = ?4").bind(body.connected ? 1 : 0, connectedAt ?? null, accountId, id).run();
		if (!body.connected) await env.DB.prepare("DELETE FROM provider_credentials WHERE account_id = ?1 AND provider_id = ?2").bind(accountId, id).run();
		return json(request, { provider: { ...current, connected: body.connected, connectedAt } });
	}
	if (providerMatch?.[1] && request.method === "DELETE") {
		const id = decodeURIComponent(providerMatch[1]);
		const current = await getProvider(env.DB, accountId, id);
		if (!current) return failure(request, "Provider not found", 404);
		await env.DB.batch([
			env.DB.prepare("DELETE FROM provider_credentials WHERE account_id = ?1 AND provider_id = ?2").bind(accountId, id),
			env.DB.prepare("DELETE FROM sync_checkpoints WHERE account_id = ?1 AND provider_id = ?2").bind(accountId, id),
			env.DB.prepare("DELETE FROM entries WHERE account_id = ?1 AND provider_id = ?2").bind(accountId, id),
			env.DB.prepare("DELETE FROM providers WHERE account_id = ?1 AND id = ?2").bind(accountId, id),
		]);
		return json(request, { id });
	}
	if (url.pathname === apiRoutes.collections && request.method === "GET") return json(request, { collections: await listCollections(env.DB, accountId) });
	if (url.pathname === apiRoutes.automations && request.method === "GET") return json(request, { automations: await listAutomations(env, accountId) });
	if (url.pathname === apiRoutes.automations && request.method === "POST") {
		const body = await request.json() as Partial<import("../../starboard/src/lib/types").Automation>;
		if (!body.name?.trim() || !isAutomationTrigger(body.trigger) || !isAutomationAction(body.action)) return failure(request, "Automation name, trigger, and action are required", 400);
		const now = new Date().toISOString();
		const automation: import("../../starboard/src/lib/types").Automation = {
			id: `${accountId}:${body.id?.trim() || `${slugify(body.name)}-${Date.now()}`}`,
			name: body.name.trim(),
			description: body.description?.trim() || "A Starboard automation.",
			trigger: body.trigger,
			action: body.action,
			config: body.config ?? {},
			enabled: body.enabled ?? true,
			createdAt: body.createdAt ?? now,
			updatedAt: now,
		};
		return json(request, { automation: await upsertAutomation(env, accountId, automation) }, 201);
	}
	const automationMatch = url.pathname.match(/^\/api\/automations\/([^/]+)$/);
	if (automationMatch?.[1] && request.method === "PATCH") {
		const id = decodeURIComponent(automationMatch[1]);
		const current = (await listAutomations(env, accountId)).find((automation) => automation.id === id);
		if (!current) return failure(request, "Automation not found", 404);
		const body = await request.json() as Partial<Automation>;
		if (body.trigger !== undefined && !isAutomationTrigger(body.trigger)) return failure(request, "Invalid automation trigger", 400);
		if (body.action !== undefined && !isAutomationAction(body.action)) return failure(request, "Invalid automation action", 400);
		const automation: Automation = {
			...current,
			name: typeof body.name === "string" && body.name.trim() ? body.name.trim() : current.name,
			description: typeof body.description === "string" ? body.description.trim() : current.description,
			trigger: body.trigger ?? current.trigger,
			action: body.action ?? current.action,
			config: body.config ?? current.config,
			enabled: typeof body.enabled === "boolean" ? body.enabled : current.enabled,
			updatedAt: new Date().toISOString(),
		};
		return json(request, { automation: await upsertAutomation(env, accountId, automation) });
	}
	if (automationMatch?.[1] && request.method === "DELETE") {
		const id = decodeURIComponent(automationMatch[1]);
		await deleteAutomation(env, accountId, id);
		return json(request, { id });
	}
	if (url.pathname === apiRoutes.plugins && request.method === "GET") return json(request, { plugins: await listPlugins(env, accountId) });
	if (url.pathname === apiRoutes.plugins && request.method === "POST") {
		const body = await request.json() as Partial<import("../../starboard/src/lib/types").PluginManifest>;
		if (!body.id?.trim() || !body.name?.trim() || !body.version?.trim()) return failure(request, "Plugin id, name, and version are required", 400);
		const plugin: import("../../starboard/src/lib/types").PluginManifest = {
			id: `${accountId}:${body.id.trim()}`,
			name: body.name.trim(),
			version: body.version.trim(),
			description: body.description?.trim() || "A Starboard plugin.",
			permissions: body.permissions ?? [],
			triggers: body.triggers ?? [],
			actions: body.actions ?? [],
			entrypoint: body.entrypoint,
			enabled: body.enabled ?? true,
		};
		return json(request, { plugin: await upsertPlugin(env, accountId, plugin) }, 201);
	}

	if (url.pathname === apiRoutes.entries && request.method === "GET") {
		return json(request, { entries: await listEntries(env.DB, accountId) });
	}
	const entryMetadataMatch = url.pathname.match(/^\/api\/entries\/([^/]+)\/metadata$/);
	if (entryMetadataMatch?.[1] && request.method === "GET") {
		const response = await refreshRepositoryMetadataForEntry(env, accountId, decodeURIComponent(entryMetadataMatch[1]));
		return response ? json(request, { metadata: response }) : failure(request, "GitHub repository not found", 404);
	}

	if (url.pathname === apiRoutes.search && request.method === "GET") {
		const params: SearchRequest = {
			query: url.searchParams.get("query") ?? "",
			mode: modeFrom(url.searchParams.get("mode")),
			providerId: url.searchParams.get("providerId") ?? undefined,
			collectionId: url.searchParams.get("collectionId") ?? undefined,
			limit: limitFrom(url.searchParams.get("limit")),
		};
		return json(request, {
			entries: await searchWorkspace(env.DB, accountId, params.query, params.mode ?? "hybrid", params.providerId, params.collectionId, params.limit, await embedText(env, params.query)),
			mode: params.mode ?? "hybrid",
			local: false,
		});
	}

	const entryMatch = url.pathname.match(/^\/api\/entries\/([^/]+)$/);
	if (entryMatch?.[1] && request.method === "GET") {
		const entry = await getEntry(env.DB, accountId, decodeURIComponent(entryMatch[1]));
		return entry ? json(request, { entry }) : failure(request, "Entry not found", 404);
	}
	if (entryMatch?.[1] && request.method === "PATCH") {
		const body = await request.json() as Partial<Pick<Entry, "isRead" | "isPinned" | "tags">>;
		const patch: Partial<Pick<Entry, "isRead" | "isPinned" | "tags">> = {};
		if (typeof body.isRead === "boolean") patch.isRead = body.isRead;
		if (typeof body.isPinned === "boolean") patch.isPinned = body.isPinned;
		if (Array.isArray(body.tags) && body.tags.every((tag) => typeof tag === "string")) patch.tags = body.tags.map((tag) => tag.trim().toLocaleLowerCase()).filter(Boolean);
		const entry = await updateEntry(env.DB, accountId, decodeURIComponent(entryMatch[1]), patch);
		return entry ? json(request, { entry }) : failure(request, "Entry not found", 404);
	}

	if (url.pathname === apiRoutes.collections && request.method === "POST") {
		const body = await request.json() as Partial<Collection>;
		if (!body.name?.trim()) return failure(request, "Collection name is required", 400);
		const collection: Collection = {
			id: `${accountId}:${body.id?.trim() || `${slugify(body.name)}-${Date.now()}`}`,
			name: body.name.trim(),
			description: body.description?.trim() || "A saved view over your source library.",
			icon: body.icon ?? "layers",
			color: body.color ?? "#8b7cff",
			rule: body.rule ?? {},
			builtIn: false,
		};
		return json(request, { collection: await insertCollection(env.DB, accountId, collection) }, 201);
	}

	const syncMatch = url.pathname.match(/^\/api\/sync\/([^/]+)$/);
	if (syncMatch?.[1] && request.method === "POST") {
		const providerId = decodeURIComponent(syncMatch[1]);
		if (!(await getProvider(env.DB, accountId, providerId))) return failure(request, "Provider not found", 404);
		try {
			const report = await syncProvider(env, accountId, providerId, await credentialForProvider(env, request, providerId), 5);
			return json(request, report, report.status === "queued" ? 202 : 200);
		} catch (error) {
			const status = typeof error === "object" && error !== null && "status" in error && typeof error.status === "number" ? error.status : 502;
			return failure(request, error instanceof Error ? error.message : "Provider sync failed", status);
		}
	}

	return failure(request, "Not found", 404);
}

export default {
	async fetch(request: Request, env: WorkerEnv, ctx: ExecutionContext): Promise<Response> {
		const url = new URL(request.url);
		if (url.pathname === apiRoutes.auth.githubStart && request.method === "GET") return withCors(await startGithubOAuth(env, request), request, env);
		if (url.pathname === apiRoutes.auth.githubCallback && request.method === "GET") return withCors(await finishGithubOAuth(env, request), request, env);
		if (url.pathname === apiRoutes.auth.tangledStart && request.method === "GET") return withCors(await startTangledOAuth(env, request), request, env);
		if (url.pathname === apiRoutes.auth.tangledCallback && request.method === "GET") return withCors(await finishTangledOAuth(env, request), request, env);
		if (url.pathname === apiRoutes.auth.logout && request.method === "POST") return withCors(await logout(env, request), request, env);
		const accountId = await sessionAccountIdForRequest(env, request);
		const publicApiPath = url.pathname === apiRoutes.health || url.pathname === apiRoutes.me;
		if (url.pathname.startsWith("/api/") && !publicApiPath && request.method !== "OPTIONS" && !accountId) {
			return withCors(failure(request, "Authentication required", 401), request, env);
		}
		if (url.pathname === "/mcp" || url.pathname.startsWith("/mcp/")) {
			if (!accountId) return withCors(failure(request, "Authentication required", 401), request, env);
			return withCors(await createMcpHandler(() => createMcpServer(env, accountId, request), { route: "/mcp" })(request, env, ctx), request, env);
		}
		if (!url.pathname.startsWith("/api/") && env.ASSETS) return env.ASSETS.fetch(request);
		try {
			return withCors(await handleApi(request, env, accountId), request, env);
		} catch (error) {
			const message = error instanceof Error ? error.message : "Unexpected server error";
			return withCors(failure(request, message, 500), request, env);
		}
	},
	scheduled(_event: ScheduledController, env: WorkerEnv, ctx: ExecutionContext): void {
		ctx.waitUntil((async () => {
			const providers = await env.DB.prepare("SELECT account_id, id FROM providers WHERE connected = 1").all<{ account_id: string; id: string }>();
			await Promise.allSettled(providers.results.map(async ({ account_id: accountId, id }) => {
				try {
					await syncProvider(env, accountId, id, await credentialForAccount(env, accountId, id), 5);
				} catch (error) {
					console.error(`Scheduled sync failed for ${accountId}:${id}`, error);
				}
			}));
		})());
	},
};

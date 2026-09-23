import type { Automation, Collection, Entry, PluginManifest, Provider, RepositoryMetadataResponse, SearchMode } from "./types";

export const apiRoutes = {
	health: "/api/health",
	providers: "/api/providers",
	entries: "/api/entries",
	collections: "/api/collections",
	sync: "/api/sync",
	search: "/api/search",
	workspace: "/api/workspace",
	me: "/api/me",
	accountTokens: "/api/account/tokens",
	markGithubStarsRead: "/api/entries/read-all",
	agentApi: "/api/v1",
	automations: "/api/automations",
	plugins: "/api/plugins",
	auth: {
		githubStart: "/api/auth/github/start",
		githubCallback: "/api/auth/github/callback",
		tangledStart: "/api/auth/tangled/start",
		tangledCallback: "/api/auth/tangled/callback",
		logout: "/api/auth/logout",
	},
} as const;

export interface ApiEnvelope<T> {
	data: T;
	requestId: string;
	}

export interface SearchRequest {
	query: string;
	mode?: SearchMode;
	providerId?: string;
	collectionId?: string;
	limit?: number;
}

export interface SearchResponse {
	entries: Entry[];
	mode: SearchMode;
	local: boolean;
}

export interface WorkspaceAccount {
	id: string;
	handle: string;
	displayName: string;
	avatarUrl?: string;
}

export interface MeResponse {
	account: WorkspaceAccount | null;
	authenticated: boolean;
	providers: Provider[];
	canConnectGithub: boolean;
}

export interface ApiTokenSummary {
	id: string;
	name: string;
	prefix: string;
	createdAt: string;
	expiresAt: string;
	lastUsedAt?: string;
	revokedAt?: string;
}

export interface CreatedApiToken {
	token: string;
	apiToken: ApiTokenSummary;
}

export interface WorkspaceResponse {
	entries: Entry[];
	providers: Provider[];
	collections: Collection[];
	automations?: Automation[];
	plugins?: PluginManifest[];
	}

export interface SyncResponse {
	providerId: string;
	added: number;
	updated: number;
	removed: number;
	indexed: number;
	completedAt: string;
	status: "completed" | "queued" | "failed";
	message?: string;
}

export type EntryMetadataResponse = RepositoryMetadataResponse;

/** Names exposed by the MCP server; each maps to the same application service as the HTTP API. */
export const mcpTools = [
	"search_entries",
	"list_collections",
	"get_entry",
	"sync_provider",
	"create_collection",
	"tag_entry",
	"list_automations",
	"create_automation",
	"register_plugin",
] as const;

export type McpToolName = (typeof mcpTools)[number];

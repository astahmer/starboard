import type { D1Database } from "@cloudflare/workers-types";

export interface WorkerEnv {
	DB: D1Database;
	ASSETS?: { fetch(request: Request): Promise<Response> };
	APP_URL?: string;
	WEB_APP_URL?: string;
	SESSION_SECRET?: string;
	GITHUB_CLIENT_ID?: string;
	GITHUB_CLIENT_SECRET?: string;
	GITHUB_API_URL?: string;
	TANGLED_BOBBIN_URL?: string;
	TANGLED_RESOLVER_URL?: string;
	TANGLED_CLIENT_ID?: string;
	TANGLED_AUTHORIZATION_URL?: string;
	TANGLED_TOKEN_URL?: string;
	TANGLED_SCOPE?: string;
	TANGLED_CLIENT_SECRET?: string;
	EMBEDDING_API_URL?: string;
	EMBEDDING_API_KEY?: string;
	EMBEDDING_MODEL?: string;
	LLM_API_URL?: string;
	LLM_API_KEY?: string;
	LLM_MODEL?: string;
	AUTOMATION_SIGNING_SECRET?: string;
}

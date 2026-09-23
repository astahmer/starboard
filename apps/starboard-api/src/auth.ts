import { apiRoutes } from "../../starboard/src/lib/api-contract";
import { schemaPresets } from "../../starboard/src/lib/workspace-defaults";
import type { Provider } from "../../starboard/src/lib/types";
import { decryptSecret, encryptSecret, hashToken, pkceChallenge, randomToken } from "./crypto";
import { upsertProvider } from "./repository";
import type { WorkerEnv } from "./env";

const SESSION_COOKIE = "starboard_session";
const OAUTH_STATE_COOKIE_PREFIX = "starboard_oauth_state_";
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30;
const STATE_TTL_SECONDS = 10 * 60;

interface AuthState {
	state: string;
	providerKind: "github" | "tangled";
	codeVerifier?: string;
	returnTo: string;
	accountId?: string;
}

interface GitHubTokenResponse {
	access_token?: string;
	refresh_token?: string;
	expires_in?: number;
	refresh_token_expires_in?: number;
	scope?: string;
	token_type?: string;
	error?: string;
}

interface GitHubUser {
	id: number;
	login: string;
	name?: string | null;
	avatar_url?: string;
}

interface TangledTokenResponse {
	access_token?: string;
	refresh_token?: string;
	expires_in?: number;
	scope?: string;
	token_type?: string;
	did?: string;
	sub?: string;
	handle?: string;
	error?: string;
}

function cookieValue(request: Request, name: string): string | undefined {
	const cookies = request.headers.get("cookie")?.split(";") ?? [];
	const prefix = `${name}=`;
	return cookies.map((cookie) => cookie.trim()).find((cookie) => cookie.startsWith(prefix))?.slice(prefix.length);
}

function originFor(request: Request, env: WorkerEnv): string {
	return (env.APP_URL || new URL(request.url).origin).replace(/\/$/, "");
}

function safeReturnTo(env: WorkerEnv, request: Request, value: string | null): string {
	const requestOrigin = new URL(request.url).origin;
	const webOrigin = (() => {
		try {
			return env.WEB_APP_URL ? new URL(env.WEB_APP_URL).origin : requestOrigin;
		} catch {
			return requestOrigin;
		}
	})();
	if (!value) return `${webOrigin}/`;
	if (value.startsWith("/") && !value.startsWith("//")) return new URL(value, webOrigin).toString();
	try {
		const absolute = new URL(value);
		if ([requestOrigin, webOrigin].includes(absolute.origin)) return absolute.toString();
	} catch {
		// Fall through to the safe origin.
	}
	return `${webOrigin}/`;
}

function redirectResponse(input: { destination: URL | string; cookies?: string[] }): Response {
	const headers = new Headers({ Location: input.destination.toString() });
	for (const cookie of input.cookies ?? []) headers.append("Set-Cookie", cookie);
	return new Response(null, { status: 302, headers });
}

function missingConfiguration(message: string): Response {
	return new Response(message, { status: 503, headers: { "content-type": "text/plain; charset=utf-8" } });
}

function redirectWithError(request: Request, returnTo: string, message: string): Response {
	const url = new URL(returnTo, new URL(request.url).origin);
	url.searchParams.set("auth_error", message);
	const state = new URL(request.url).searchParams.get("state");
	return state ? clearOAuthStateCookie(request, redirectResponse({ destination: url }), state) : redirectResponse({ destination: url });
}

async function storeAuthState(env: WorkerEnv, state: AuthState): Promise<void> {
	const now = new Date();
	const expiresAt = new Date(now.getTime() + STATE_TTL_SECONDS * 1000).toISOString();
	await env.DB.prepare(
		`INSERT INTO auth_states (state, provider_kind, code_verifier, return_to, account_id, created_at, expires_at)
		 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)`,
	).bind(state.state, state.providerKind, state.codeVerifier ?? null, state.returnTo, state.accountId ?? null, now.toISOString(), expiresAt).run();
}

async function consumeAuthState(env: WorkerEnv, state: string, providerKind: AuthState["providerKind"]): Promise<AuthState | undefined> {
	const row = await env.DB.prepare("SELECT state, provider_kind, code_verifier, return_to, account_id, expires_at FROM auth_states WHERE state = ?1 LIMIT 1").bind(state).first<{ state: string; provider_kind: AuthState["providerKind"]; code_verifier: string | null; return_to: string; account_id: string | null; expires_at: string }>();
	await env.DB.prepare("DELETE FROM auth_states WHERE state = ?1").bind(state).run();
	if (!row || row.provider_kind !== providerKind || Date.parse(row.expires_at) < Date.now()) return undefined;
	return { state: row.state, providerKind: row.provider_kind, codeVerifier: row.code_verifier ?? undefined, returnTo: row.return_to, accountId: row.account_id ?? undefined };
}

async function ensureAccount(env: WorkerEnv, accountId: string, handle: string, displayName: string, avatarUrl?: string): Promise<void> {
	const now = new Date().toISOString();
	await env.DB.prepare(
		`INSERT INTO accounts (id, handle, display_name, avatar_url, created_at, updated_at)
		 VALUES (?1, ?2, ?3, ?4, ?5, ?6)
		 ON CONFLICT(id) DO UPDATE SET handle = excluded.handle, display_name = excluded.display_name, avatar_url = excluded.avatar_url, updated_at = excluded.updated_at`,
	).bind(accountId, handle, displayName, avatarUrl ?? null, now, now).run();
}

async function createSession(env: WorkerEnv, accountId: string): Promise<string> {
	const raw = randomToken(32);
	const now = new Date();
	const expiresAt = new Date(now.getTime() + SESSION_TTL_SECONDS * 1000).toISOString();
	await env.DB.prepare("INSERT INTO sessions (id_hash, account_id, expires_at, created_at) VALUES (?1, ?2, ?3, ?4)").bind(await hashToken(raw), accountId, expiresAt, now.toISOString()).run();
	return raw;
}

function sessionCookie(value: string, request: Request): string {
	const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
	return `${SESSION_COOKIE}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_TTL_SECONDS}${secure}`;
}

function oauthStateCookieName(state: string): string {
	return `${OAUTH_STATE_COOKIE_PREFIX}${state}`;
}

function oauthStateCookie(state: string, request: Request): string {
	const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
	return `${oauthStateCookieName(state)}=${state}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${STATE_TTL_SECONDS}${secure}`;
}

function clearOAuthStateCookie(request: Request, response: Response, state: string): Response {
	const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
	const headers = new Headers(response.headers);
	headers.append("Set-Cookie", `${oauthStateCookieName(state)}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`);
	return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

export async function sessionAccountIdForRequest(env: WorkerEnv, request: Request): Promise<string | undefined> {
	const raw = cookieValue(request, SESSION_COOKIE);
	if (!raw) return undefined;
	const row = await env.DB.prepare("SELECT account_id, expires_at FROM sessions WHERE id_hash = ?1 LIMIT 1").bind(await hashToken(raw)).first<{ account_id: string; expires_at: string }>();
	if (!row || Date.parse(row.expires_at) < Date.now()) return undefined;
	return row.account_id;
}

export async function isAuthenticated(env: WorkerEnv, request: Request): Promise<boolean> {
	return Boolean(await sessionAccountIdForRequest(env, request));
}

export async function accountIdForRequest(env: WorkerEnv, request: Request): Promise<string | undefined> {
	return sessionAccountIdForRequest(env, request);
}

export async function credentialForProvider(env: WorkerEnv, request: Request, providerId: string): Promise<string | undefined> {
	if (!env.SESSION_SECRET) return undefined;
	const accountId = await accountIdForRequest(env, request);
	if (!accountId) return undefined;
	return credentialForAccount(env, accountId, providerId);
}

export async function credentialForAccount(env: WorkerEnv, accountId: string, providerId: string): Promise<string | undefined> {
	if (!env.SESSION_SECRET) return undefined;
	const row = await env.DB.prepare(
		`SELECT c.access_token_ciphertext, c.refresh_token_ciphertext, c.expires_at, p.kind
		 FROM provider_credentials c
		 INNER JOIN providers p ON p.id = c.provider_id AND p.account_id = c.account_id
		 WHERE c.provider_id = ?1 AND c.account_id = ?2 LIMIT 1`,
	).bind(providerId, accountId).first<{ access_token_ciphertext: string; refresh_token_ciphertext: string | null; expires_at: string | null; kind: string }>();
	if (!row) return undefined;
	if (!row.expires_at || Date.parse(row.expires_at) > Date.now() + 60_000) return decryptSecret(row.access_token_ciphertext, env.SESSION_SECRET);
	if (!row.refresh_token_ciphertext) return decryptSecret(row.access_token_ciphertext, env.SESSION_SECRET);
	const refreshToken = await decryptSecret(row.refresh_token_ciphertext, env.SESSION_SECRET);
	const isGithub = row.kind === "github" && env.GITHUB_CLIENT_ID && env.GITHUB_CLIENT_SECRET;
	const isTangled = row.kind === "tangled" && env.TANGLED_CLIENT_ID && env.TANGLED_TOKEN_URL;
	if (!isGithub && !isTangled) return undefined;
	const endpoint = isGithub ? "https://github.com/login/oauth/access_token" : env.TANGLED_TOKEN_URL!;
	const body = new URLSearchParams({ client_id: isGithub ? env.GITHUB_CLIENT_ID! : env.TANGLED_CLIENT_ID!, grant_type: "refresh_token", refresh_token: refreshToken, ...(isGithub && env.GITHUB_CLIENT_SECRET ? { client_secret: env.GITHUB_CLIENT_SECRET } : {}), ...(isTangled && env.TANGLED_CLIENT_SECRET ? { client_secret: env.TANGLED_CLIENT_SECRET } : {}) });
	const response = await fetch(endpoint, { method: "POST", headers: { Accept: "application/json", "content-type": "application/x-www-form-urlencoded" }, body });
	const token = await response.json() as GitHubTokenResponse;
	if (!response.ok || !token.access_token) return undefined;
	const encryptedAccess = await encryptSecret(token.access_token, env.SESSION_SECRET);
	const encryptedRefresh = token.refresh_token ? await encryptSecret(token.refresh_token, env.SESSION_SECRET) : row.refresh_token_ciphertext;
	const expiresAt = token.expires_in ? new Date(Date.now() + token.expires_in * 1000).toISOString() : null;
	await env.DB.prepare("UPDATE provider_credentials SET access_token_ciphertext = ?1, refresh_token_ciphertext = ?2, expires_at = ?3, updated_at = ?4 WHERE provider_id = ?5 AND account_id = ?6").bind(encryptedAccess, encryptedRefresh, expiresAt, new Date().toISOString(), providerId, accountId).run();
	return token.access_token;
}

async function saveCredential(env: WorkerEnv, accountId: string, providerId: string, token: { accessToken: string; refreshToken?: string; expiresIn?: number; scope?: string; tokenType?: string; metadata?: Record<string, string> }): Promise<void> {
	if (!env.SESSION_SECRET) throw new Error("SESSION_SECRET must be configured before connecting a provider");
	const expiresAt = token.expiresIn ? new Date(Date.now() + token.expiresIn * 1000).toISOString() : null;
	await env.DB.prepare(
		`INSERT INTO provider_credentials (provider_id, account_id, access_token_ciphertext, refresh_token_ciphertext, token_type, scope, expires_at, metadata_json, updated_at)
		 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
		 ON CONFLICT(provider_id) DO UPDATE SET account_id = excluded.account_id, access_token_ciphertext = excluded.access_token_ciphertext, refresh_token_ciphertext = excluded.refresh_token_ciphertext, token_type = excluded.token_type, scope = excluded.scope, expires_at = excluded.expires_at, metadata_json = excluded.metadata_json, updated_at = excluded.updated_at`,
	).bind(providerId, accountId, await encryptSecret(token.accessToken, env.SESSION_SECRET), token.refreshToken ? await encryptSecret(token.refreshToken, env.SESSION_SECRET) : null, token.tokenType ?? "Bearer", token.scope ?? null, expiresAt, JSON.stringify(token.metadata ?? {}), new Date().toISOString()).run();
}

function providerPreset(accountId: string, kind: "github" | "tangled", handle: string): Provider {
	const schema = schemaPresets.find((preset) => preset.id === `${kind}-repository`);
	if (!schema) throw new Error(`Missing ${kind} repository schema`);
	return {
		id: `${accountId}:${kind}`,
		name: kind === "github" ? "GitHub" : "Tangled",
		kind,
		handle,
		description: schema.description,
		accent: kind === "github" ? "#24292f" : "#4e7a69",
		schema,
		connected: true,
		connectedAt: new Date().toISOString(),
	};
}

export async function startGithubOAuth(env: WorkerEnv, request: Request): Promise<Response> {
	if (!env.GITHUB_CLIENT_ID || !env.GITHUB_CLIENT_SECRET || !env.SESSION_SECRET) return missingConfiguration("GitHub OAuth is not configured. Set GITHUB_CLIENT_ID, GITHUB_CLIENT_SECRET, and SESSION_SECRET.");
	const returnTo = safeReturnTo(env, request, new URL(request.url).searchParams.get("returnTo"));
	const state = randomToken(24);
	const codeVerifier = randomToken(48);
	await storeAuthState(env, { state, providerKind: "github", codeVerifier, returnTo });
	const url = new URL("https://github.com/login/oauth/authorize");
	url.searchParams.set("client_id", env.GITHUB_CLIENT_ID);
	url.searchParams.set("redirect_uri", `${originFor(request, env)}${apiRoutes.auth.githubCallback}`);
	url.searchParams.set("code_challenge", await pkceChallenge(codeVerifier));
	url.searchParams.set("code_challenge_method", "S256");
	url.searchParams.set("state", state);
	return redirectResponse({ destination: url, cookies: [oauthStateCookie(state, request)] });
}

export async function finishGithubOAuth(env: WorkerEnv, request: Request): Promise<Response> {
	const query = new URL(request.url).searchParams;
	const state = query.get("state");
	const code = query.get("code");
	const error = query.get("error");
	if (!state || cookieValue(request, oauthStateCookieName(state)) !== state) return new Response("Invalid or expired OAuth state", { status: 400 });
	const stored = await consumeAuthState(env, state, "github");
	if (!stored?.codeVerifier) return clearOAuthStateCookie(request, new Response("Invalid or expired OAuth state", { status: 400 }), state);
	if (error || !code) return redirectWithError(request, stored.returnTo, error ?? "GitHub authorization was cancelled");
	if (!env.GITHUB_CLIENT_ID || !env.GITHUB_CLIENT_SECRET || !env.SESSION_SECRET) return clearOAuthStateCookie(request, missingConfiguration("GitHub OAuth is not configured"), state);
	const tokenResponse = await fetch("https://github.com/login/oauth/access_token", {
		method: "POST",
		headers: { Accept: "application/json" },
		body: new URLSearchParams({ client_id: env.GITHUB_CLIENT_ID, client_secret: env.GITHUB_CLIENT_SECRET, code, redirect_uri: `${originFor(request, env)}${apiRoutes.auth.githubCallback}`, code_verifier: stored.codeVerifier }),
	});
	const token = await tokenResponse.json() as GitHubTokenResponse;
	if (!tokenResponse.ok || !token.access_token) return redirectWithError(request, stored.returnTo, token.error ?? "GitHub token exchange failed");
	const apiBase = (env.GITHUB_API_URL || "https://api.github.com").replace(/\/$/, "");
	const userResponse = await fetch(`${apiBase}/user`, {
		headers: {
			Accept: "application/vnd.github+json",
			Authorization: `Bearer ${token.access_token}`,
			"User-Agent": "Starboard",
			"X-GitHub-Api-Version": "2026-03-10",
		},
	});
	if (!userResponse.ok) return redirectWithError(request, stored.returnTo, `GitHub identity check failed (HTTP ${userResponse.status})`);
	const user = await userResponse.json() as GitHubUser;
	if (!Number.isSafeInteger(user.id) || !user.login?.trim()) return redirectWithError(request, stored.returnTo, "GitHub returned an invalid user identity");
	const accountId = `github-${user.id}`;
	await ensureAccount(env, accountId, user.login, user.name ?? user.login, user.avatar_url);
	const providerId = `${accountId}:github`;
	await upsertProvider(env.DB, accountId, providerPreset(accountId, "github", `@${user.login}`));
	await saveCredential(env, accountId, providerId, { accessToken: token.access_token, refreshToken: token.refresh_token, expiresIn: token.expires_in, scope: token.scope, tokenType: token.token_type, metadata: { login: user.login, id: String(user.id) } });
	const session = await createSession(env, accountId);
	const response = redirectResponse({ destination: stored.returnTo, cookies: [sessionCookie(session, request)] });
	return clearOAuthStateCookie(request, response, state);
}

export async function startTangledOAuth(env: WorkerEnv, request: Request): Promise<Response> {
	if (!env.TANGLED_CLIENT_ID || !env.TANGLED_AUTHORIZATION_URL || !env.TANGLED_TOKEN_URL || !env.SESSION_SECRET) return missingConfiguration("Tangled OAuth is not configured. Set TANGLED_CLIENT_ID, TANGLED_AUTHORIZATION_URL, TANGLED_TOKEN_URL, and SESSION_SECRET, or connect with a public handle.");
	const accountId = await sessionAccountIdForRequest(env, request);
	if (!accountId) return new Response("Authentication required", { status: 401 });
	const returnTo = safeReturnTo(env, request, new URL(request.url).searchParams.get("returnTo"));
	const verifier = randomToken(48);
	const state = randomToken(24);
	await storeAuthState(env, { state, providerKind: "tangled", codeVerifier: verifier, returnTo, accountId });
	const url = new URL(env.TANGLED_AUTHORIZATION_URL);
	url.searchParams.set("response_type", "code");
	url.searchParams.set("client_id", env.TANGLED_CLIENT_ID);
	url.searchParams.set("redirect_uri", `${originFor(request, env)}${apiRoutes.auth.tangledCallback}`);
	url.searchParams.set("scope", env.TANGLED_SCOPE ?? "atproto");
	url.searchParams.set("state", state);
	url.searchParams.set("code_challenge", await pkceChallenge(verifier));
	url.searchParams.set("code_challenge_method", "S256");
	return redirectResponse({ destination: url, cookies: [oauthStateCookie(state, request)] });
}

function jwtSubject(token: string): string | undefined {
	try {
		const payload = token.split(".")[1];
		if (!payload) return undefined;
		const normalized = payload.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(payload.length / 4) * 4, "=");
		const parsed = JSON.parse(atob(normalized)) as { sub?: string; handle?: string; did?: string };
		return parsed.handle ?? parsed.did ?? parsed.sub;
	} catch {
		return undefined;
	}
}

export async function finishTangledOAuth(env: WorkerEnv, request: Request): Promise<Response> {
	const query = new URL(request.url).searchParams;
	const state = query.get("state");
	const code = query.get("code");
	if (!state || cookieValue(request, oauthStateCookieName(state)) !== state) return new Response("Invalid or expired OAuth state", { status: 400 });
	const stored = await consumeAuthState(env, state, "tangled");
	if (!stored) return clearOAuthStateCookie(request, new Response("Invalid or expired OAuth state", { status: 400 }), state);
	if (!code) return redirectWithError(request, stored.returnTo, query.get("error") ?? "Tangled authorization was cancelled");
	if (!env.TANGLED_CLIENT_ID || !env.TANGLED_TOKEN_URL || !env.SESSION_SECRET || !stored.codeVerifier) return clearOAuthStateCookie(request, missingConfiguration("Tangled OAuth is not configured"), state);
	const tokenResponse = await fetch(env.TANGLED_TOKEN_URL, {
		method: "POST",
		headers: { Accept: "application/json", "content-type": "application/x-www-form-urlencoded" },
		body: new URLSearchParams({ grant_type: "authorization_code", code, client_id: env.TANGLED_CLIENT_ID, redirect_uri: `${originFor(request, env)}${apiRoutes.auth.tangledCallback}`, code_verifier: stored.codeVerifier, ...(env.TANGLED_CLIENT_SECRET ? { client_secret: env.TANGLED_CLIENT_SECRET } : {}) }),
	});
	const token = await tokenResponse.json() as TangledTokenResponse;
	if (!tokenResponse.ok || !token.access_token) return redirectWithError(request, stored.returnTo, token.error ?? "Tangled token exchange failed");
	const accountId = stored.accountId;
	if (!accountId) return new Response("Tangled authorization was not linked to an account", { status: 400 });
	const handle = token.handle ?? token.did ?? token.sub ?? jwtSubject(token.access_token) ?? "tangled-user";
	const providerId = `${accountId}:tangled`;
	await upsertProvider(env.DB, accountId, providerPreset(accountId, "tangled", handle));
	await saveCredential(env, accountId, providerId, { accessToken: token.access_token, refreshToken: token.refresh_token, expiresIn: token.expires_in, scope: token.scope, tokenType: token.token_type, metadata: { handle } });
	const session = await createSession(env, accountId);
	const response = redirectResponse({ destination: stored.returnTo, cookies: [sessionCookie(session, request)] });
	return clearOAuthStateCookie(request, response, state);
}

export async function logout(env: WorkerEnv, request: Request): Promise<Response> {
	const raw = cookieValue(request, SESSION_COOKIE);
	if (raw) await env.DB.prepare("DELETE FROM sessions WHERE id_hash = ?1").bind(await hashToken(raw)).run();
	const destination = safeReturnTo(env, request, env.WEB_APP_URL ? `${env.WEB_APP_URL}/` : "/");
	return redirectResponse({ destination, cookies: [`${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`] });
}

export async function connectTangledHandle(env: WorkerEnv, accountId: string, handle: string): Promise<Provider> {
	const normalized = handle.trim().replace(/^@/, "");
	if (!normalized) throw new Error("Tangled handle is required");
	const provider = providerPreset(accountId, "tangled", normalized);
	await upsertProvider(env.DB, accountId, provider);
	return provider;
}

export const authSessionCookieName = SESSION_COOKIE;

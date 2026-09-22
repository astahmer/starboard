import type { Entry, Provider } from "../../../starboard/src/lib/types";
import type { ProviderSyncContext, ProviderSyncPage, RemoteProviderAdapter } from "./types";
import { parseNextLink, ProviderSyncError, readProviderJson, stableProviderEntryId } from "./types";

interface GitHubRepo {
	id: number;
	full_name: string;
	name: string;
	description: string | null;
	html_url: string;
	owner?: { login?: string; avatar_url?: string };
	language: string | null;
	stargazers_count: number;
	forks_count: number;
	open_issues_count?: number;
	topics?: string[];
	updated_at: string;
	pushed_at?: string | null;
}

interface GitHubStarredRepo {
	starred_at?: string;
	repo?: GitHubRepo;
	id?: number;
	full_name?: string;
	description?: string | null;
	html_url?: string;
	owner?: { login?: string };
	language?: string | null;
	stargazers_count?: number;
	forks_count?: number;
	open_issues_count?: number;
	topics?: string[];
	updated_at?: string;
}

function repoFromPayload(payload: GitHubStarredRepo): GitHubRepo | undefined {
	if (payload.repo) return payload.repo;
	if (!payload.id || !payload.full_name || !payload.html_url) return undefined;
	return {
		id: payload.id,
		full_name: payload.full_name,
		name: payload.full_name.split("/").at(-1) ?? payload.full_name,
		description: payload.description ?? null,
		html_url: payload.html_url,
		owner: payload.owner,
		language: payload.language ?? null,
		stargazers_count: payload.stargazers_count ?? 0,
		forks_count: payload.forks_count ?? 0,
		open_issues_count: payload.open_issues_count,
		topics: payload.topics,
		updated_at: payload.updated_at ?? new Date().toISOString(),
	};
}

function normalize(payload: GitHubStarredRepo, provider: Provider): Entry | undefined {
	const repo = repoFromPayload(payload);
	if (!repo) return undefined;
	const [owner, name] = repo.full_name.split("/");
	const starredAt = payload.starred_at ?? new Date().toISOString();
	return {
		id: stableProviderEntryId(provider.id, String(repo.id)),
		providerId: provider.id,
		schemaId: provider.schema.id,
		externalId: String(repo.id),
		kind: provider.schema.defaultKind,
		title: repo.full_name,
		summary: repo.description ?? "No description provided.",
		url: repo.html_url,
		author: owner ?? repo.owner?.login ?? "GitHub",
		authorHandle: owner ?? repo.owner?.login ?? "github",
		tags: (repo.topics ?? []).map((topic) => topic.toLocaleLowerCase()),
		starredAt,
		updatedAt: repo.updated_at ?? starredAt,
		syncedAt: new Date().toISOString(),
		isRead: false,
		isPinned: false,
		language: repo.language ?? undefined,
		stars: repo.stargazers_count,
		forks: repo.forks_count,
		comments: repo.open_issues_count,
		fields: {
			repository: name ?? repo.name,
			owner: owner ?? repo.owner?.login ?? "",
			pushedAt: repo.pushed_at ?? null,
		},
	};
}

export const githubAdapter: RemoteProviderAdapter = {
	kind: "github",
	async sync({ env, provider, accessToken, cursor }: ProviderSyncContext): Promise<ProviderSyncPage> {
		if (!accessToken) throw new ProviderSyncError("GitHub is not connected. Authorize GitHub before syncing.", 401);
		const apiBase = (env.GITHUB_API_URL || "https://api.github.com").replace(/\/$/, "");
		const page = Math.max(1, Number(cursor || "1"));
		const response = await fetch(`${apiBase}/user/starred?sort=created&direction=desc&per_page=100&page=${page}`, {
			headers: {
			Accept: "application/vnd.github.star+json",
				Authorization: `Bearer ${accessToken}`,
				"X-GitHub-Api-Version": "2026-03-10",
			},
		});
		const payload = await readProviderJson<GitHubStarredRepo[]>(response, "GitHub");
		const entries = payload.map((item) => normalize(item, provider)).filter((item): item is Entry => Boolean(item));
		const next = parseNextLink(response.headers.get("link"));
		return {
			entries,
			hasMore: Boolean(next),
			nextCursor: next ? String(page + 1) : undefined,
		};
	},
};

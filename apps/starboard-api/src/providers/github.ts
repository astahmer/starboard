import type { Entry, LatestCommit, Provider, RepositoryMetadata } from "../../../starboard/src/lib/types";
import { z } from "zod";
import type { ProviderSyncContext, ProviderSyncPage, RemoteProviderAdapter, RepositoryRefreshContext } from "./types";
import { parseLastLink, parseNextLink, ProviderSyncError, readProviderJson, stableProviderEntryId } from "./types";

const githubSnapshotPayloadSchema = z.array(z.object({ starred_at: z.string().optional() }).passthrough());

const githubRepositorySchema = z.object({
	id: z.number(),
	private: z.boolean(),
	full_name: z.string(),
	name: z.string(),
	description: z.string().nullable(),
	html_url: z.string().url(),
	owner: z.object({ login: z.string() }).optional(),
	language: z.string().nullable(),
	stargazers_count: z.number(),
	forks_count: z.number(),
	open_issues_count: z.number().optional(),
	topics: z.array(z.string()).optional(),
	updated_at: z.string(),
	pushed_at: z.string().nullable().optional(),
});

const githubCommitListSchema = z.array(z.object({
	sha: z.string(),
	html_url: z.string().url(),
	commit: z.object({
		message: z.string(),
		author: z.object({ date: z.string().nullable().optional() }).nullable().optional(),
		committer: z.object({ date: z.string().nullable().optional() }).nullable().optional(),
	}),
}));

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
	private?: boolean;
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
	private?: boolean;
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
		private: payload.private,
	};
}

function metadataFromRepo(repo: GitHubRepo): RepositoryMetadata {
	const [owner, repository] = repo.full_name.split("/");
	return {
		title: repo.full_name,
		summary: repo.description ?? "No description provided.",
		url: repo.html_url,
		author: owner ?? repo.owner?.login ?? "GitHub",
		authorHandle: owner ?? repo.owner?.login ?? "github",
		updatedAt: repo.updated_at,
		language: repo.language ?? undefined,
		stars: repo.stargazers_count,
		forks: repo.forks_count,
		comments: repo.open_issues_count,
		topics: repo.topics ?? [],
		repository: repository ?? repo.name,
		owner: owner ?? repo.owner?.login ?? "",
		pushedAt: repo.pushed_at ?? null,
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
			isPrivate: repo.private ?? true,
		},
	};
}

async function refreshRepository({ env, accessToken, externalId, fullName, includeMetadata, includeLatestCommit }: RepositoryRefreshContext) {
	if (!accessToken) throw new ProviderSyncError("GitHub is not connected. Authorize GitHub before refreshing repository details.", 401);
	const apiBase = (env.GITHUB_API_URL || "https://api.github.com").replace(/\/$/, "");
	let repoName = fullName;
	let details: RepositoryMetadata | undefined;
	let isPublic: boolean | undefined;
	if (includeMetadata) {
		const repositoryParts = repoName.split("/");
		if (repositoryParts.length !== 2 || repositoryParts.some((part) => !part)) throw new ProviderSyncError("GitHub repository name is invalid");
		const repositoryPath = repositoryParts.map(encodeURIComponent).join("/");
		const response = await fetch(`${apiBase}/repos/${repositoryPath}`, { headers: githubHeaders(accessToken, "application/vnd.github+json") });
		const payload = githubRepositorySchema.safeParse(await readProviderJson<unknown>(response, "GitHub"));
		if (!payload.success) throw new ProviderSyncError("GitHub returned invalid repository metadata");
		const repo = payload.data;
		if (String(repo.id) !== externalId) throw new ProviderSyncError("GitHub repository identity did not match the saved entry");
		details = metadataFromRepo(repo);
		isPublic = !repo.private;
		repoName = repo.full_name;
		if (!isPublic) return { metadata: details, isPublic, latestCommit: undefined };
	}
	if (!includeLatestCommit) return { metadata: details, isPublic };
	const repositoryParts = repoName.split("/");
	if (repositoryParts.length !== 2 || repositoryParts.some((part) => !part)) throw new ProviderSyncError("GitHub repository name is invalid");
	const [owner, repository] = repositoryParts;
	const response = await fetch(`${apiBase}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repository)}/commits?per_page=1`, { headers: githubHeaders(accessToken, "application/vnd.github+json") });
	const payload = githubCommitListSchema.safeParse(await readProviderJson<unknown>(response, "GitHub"));
	if (!payload.success) throw new ProviderSyncError("GitHub returned invalid commit metadata");
	const commit = payload.data[0];
	const latestCommit: LatestCommit | null = commit ? {
		sha: commit.sha,
		message: commit.commit.message.slice(0, 2_000),
		url: commit.html_url,
		committedAt: commit.commit.author?.date ?? commit.commit.committer?.date ?? null,
	} : null;
	return { metadata: details, isPublic, latestCommit };
}

function githubHeaders(accessToken: string, accept = "application/vnd.github.star+json"): HeadersInit {
	return {
		Accept: accept,
		Authorization: `Bearer ${accessToken}`,
		"User-Agent": "Starboard",
		"X-GitHub-Api-Version": "2026-03-10",
	};
}

export const githubAdapter: RemoteProviderAdapter = {
	kind: "github",
	async snapshot({ env, accessToken }: ProviderSyncContext) {
		if (!accessToken) throw new ProviderSyncError("GitHub is not connected. Authorize GitHub before syncing.", 401);
		const apiBase = (env.GITHUB_API_URL || "https://api.github.com").replace(/\/$/, "");
		const response = await fetch(`${apiBase}/user/starred?sort=created&direction=desc&per_page=1&page=1`, {
			headers: githubHeaders(accessToken),
		});
		const result = githubSnapshotPayloadSchema.safeParse(await readProviderJson<unknown>(response, "GitHub"));
		if (!result.success) return undefined;
		const payload = result.data;
		const linkHeader = response.headers.get("link");
		const last = parseLastLink(linkHeader);
		const next = parseNextLink(linkHeader);
		let starCount: number;
		if (last) {
			let lastPage: number;
			try {
				lastPage = Number(new URL(last).searchParams.get("page"));
			} catch {
				return undefined;
			}
			if (!Number.isSafeInteger(lastPage) || lastPage < 1) return undefined;
			starCount = lastPage;
		} else {
			if (next) return undefined;
			starCount = payload.length;
		}
		if (starCount === 0) return { starCount: 0 };
		const newest = payload[0];
		if (payload.length !== 1 || !newest?.starred_at) return undefined;
		return { starCount, latestStarredAt: newest.starred_at };
	},
	async sync({ env, provider, accessToken, cursor }: ProviderSyncContext): Promise<ProviderSyncPage> {
		if (!accessToken) throw new ProviderSyncError("GitHub is not connected. Authorize GitHub before syncing.", 401);
		const apiBase = (env.GITHUB_API_URL || "https://api.github.com").replace(/\/$/, "");
		const page = Math.max(1, Number(cursor || "1"));
		const response = await fetch(`${apiBase}/user/starred?sort=created&direction=desc&per_page=100&page=${page}`, {
			headers: githubHeaders(accessToken),
		});
		const payload = await readProviderJson<GitHubStarredRepo[]>(response, "GitHub");
		const repos = payload.map(repoFromPayload).filter((repo): repo is GitHubRepo => Boolean(repo));
		const entries = payload.map((item) => normalize(item, provider)).filter((item): item is Entry => Boolean(item));
		const next = parseNextLink(response.headers.get("link"));
		return {
			entries,
			publicRepositories: repos.filter((repo) => repo.private === false).map((repo) => ({ externalId: String(repo.id), metadata: metadataFromRepo(repo) })),
			privateRepositoryIds: repos.filter((repo) => repo.private === true).map((repo) => String(repo.id)),
			hasMore: Boolean(next),
			nextCursor: next ? String(page + 1) : undefined,
		};
	},
	refreshRepository(context: RepositoryRefreshContext) {
		return refreshRepository(context);
	},
};

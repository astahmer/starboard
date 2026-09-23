import { afterEach, describe, expect, it, vi } from "vitest";
import type { Provider } from "./types";
import type { WorkerEnv } from "../../../starboard-api/src/env";
import { tangledAdapter } from "../../../starboard-api/src/providers/tangled";

const provider: Provider = {
	id: "account:tangled:astahmer.dev",
	name: "Tangled · astahmer.dev",
	kind: "tangled",
	handle: "astahmer.dev",
	description: "Public Tangled stars",
	accent: "#5d7390",
	schema: {
		id: "tangled-repository",
		name: "Tangled repository",
		description: "Public repositories starred on Tangled.",
		icon: "branch",
		defaultKind: "repository",
		fields: [],
	},
	connected: true,
};

describe("Tangled adapter", () => {
	afterEach(() => vi.unstubAllGlobals());

	it("resolves public repository stars by repo DID", async () => {
		const requestedUrls: URL[] = [];
		vi.stubGlobal("fetch", async (input: RequestInfo | URL) => {
			const url = new URL(input instanceof Request ? input.url : String(input));
			requestedUrls.push(url);
			if (url.pathname.endsWith("com.atproto.identity.resolveHandle")) return Response.json({ did: "did:plc:viewer" });
			if (url.pathname.endsWith("sh.tangled.feed.listStarsBy")) {
				return Response.json({
					items: [{ uri: "at://did:plc:viewer/sh.tangled.feed.star/star-1", value: { createdAt: "2026-09-22T10:00:00.000Z", subject: { did: "did:plc:repo" } } }],
					cursor: null,
				});
			}
			if (url.pathname.endsWith("sh.tangled.repo.getRepoByRepoDid")) {
				return Response.json({ uri: "at://did:plc:owner/sh.tangled.repo/project", value: { repoDid: "did:plc:repo", description: "A test repository", knot: "knot1.tangled.sh" } });
			}
			return new Response(null, { status: 404 });
		});
		const env = {
			DB: {} as WorkerEnv["DB"],
			TANGLED_BOBBIN_URL: "https://bobbin.example",
			TANGLED_RESOLVER_URL: "https://resolver.example",
		} satisfies WorkerEnv;

		const result = await tangledAdapter.sync({ env, provider });

		expect(result.entries).toHaveLength(1);
		expect(result.entries[0]).toMatchObject({
			title: "did:plc:owner / project",
			summary: "A test repository",
			url: "https://tangled.org/did:plc:owner/project",
			fields: { repositoryUri: "at://did:plc:owner/sh.tangled.repo/project" },
		});
		expect(requestedUrls.some((url) => url.pathname.endsWith("sh.tangled.repo.getRepo") && url.searchParams.has("repo"))).toBe(false);
		expect(requestedUrls.some((url) => url.pathname.endsWith("sh.tangled.repo.getRepoByRepoDid") && url.searchParams.get("repoDid") === "did:plc:repo")).toBe(true);
	});
});

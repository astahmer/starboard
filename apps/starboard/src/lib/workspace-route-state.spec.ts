import { describe, expect, it } from "vitest";
import { workspaceRouteFromPathname, workspaceSearchSchema } from "./workspace-route-state";

describe("workspace route state", () => {
	it("restores provider and collection filters from a deep link", () => {
		expect(workspaceRouteFromPathname("/sources/account%3Agithub")).toEqual({ kind: "provider", providerId: "account:github" });
		expect(workspaceRouteFromPathname("/collections/reading%3Aqueue")).toEqual({ kind: "collection", collectionId: "reading:queue" });
	});

	it("validates URL search state and drops malformed values", () => {
		expect(workspaceSearchSchema.parse({ view: "unread", q: "tanstack", entry: "repo-1" })).toEqual({
			view: "unread",
			q: "tanstack",
			entry: "repo-1",
			auth_error: undefined,
		});
		expect(workspaceSearchSchema.parse({ view: "unexpected", q: 7 })).toEqual({
			view: undefined,
			q: undefined,
			entry: undefined,
			auth_error: undefined,
		});
	});
});

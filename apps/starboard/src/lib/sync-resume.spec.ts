import { describe, expect, it } from "vitest";
import { isSyncPending } from "../../../starboard-api/src/sync";

describe("saved provider sync checkpoints", () => {
	it("resumes a partial checkpoint after the page reloads", () => {
		const cursor = JSON.stringify({ next: "provider-cursor", complete: false, seenExternalIds: ["repo-1"] });

		expect(isSyncPending(cursor)).toBe(true);
	});

	it("does not restart a completed import", () => {
		const cursor = JSON.stringify({ complete: true, seenExternalIds: [] });

		expect(isSyncPending(cursor)).toBe(false);
		expect(isSyncPending(undefined)).toBe(false);
	});
});

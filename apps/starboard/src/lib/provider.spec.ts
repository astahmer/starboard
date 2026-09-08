import { describe, expect, it } from "vitest";
import { createProviderRegistry } from "./provider";
import type { Entry, Provider } from "./types";

const manifest = (id: string, kind: Provider["kind"]): Provider => ({
	id,
	name: id,
	kind,
	handle: "@example",
	description: "Test provider",
	accent: "#8b7cff",
	schema: { id: `${id}-schema`, name: "Test", description: "", icon: "bookmark", defaultKind: "bookmark", fields: [] },
	connected: false,
});

const adapter = (id: string, kind: Provider["kind"]) => ({
	id,
	manifest: manifest(id, kind),
	authorize: async () => undefined,
	listSince: async () => ({ items: [], hasMore: false }),
	normalize: (): Entry => ({
		id: `${id}:entry`, providerId: id, schemaId: `${id}-schema`, kind: "bookmark", title: "Test", summary: "", url: "https://example.com", author: "Example", authorHandle: "@example", tags: [], starredAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z", syncedAt: "2026-01-01T00:00:00.000Z", isRead: false, isPinned: false,
	}),
});

describe("provider registry", () => {
	it("looks up adapters by provider kind and keeps the latest registration", () => {
		const first = adapter("first", "custom");
		const replacement = adapter("replacement", "custom");
		const github = adapter("github", "github");
		const registry = createProviderRegistry([first, github, replacement]);

		expect(registry.get("custom")?.id).toBe("replacement");
		expect(registry.get("github")?.id).toBe("github");
		expect(registry.get("missing")).toBeUndefined();
		expect(registry.list().map((item) => item.id)).toEqual(["replacement", "github"]);
	});
});

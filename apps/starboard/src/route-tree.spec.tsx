import { createMemoryHistory, createRouter } from "@tanstack/react-router";
import { describe, expect, it } from "vitest";
import { routeTree } from "./route-tree";

describe("workspace routes", () => {
	it("restores filtered views and supports navigation between deep links", async () => {
		const history = createMemoryHistory({ initialEntries: ["/sources/account%3Agithub?view=unread&q=tanstack"] });
		const router = createRouter({ routeTree, history });
		await router.load();

		const sourceMatch = router.state.matches.at(-1);
		expect(sourceMatch?.routeId).toContain("/sources/$providerId");
		expect(router.state.location.search).toMatchObject({ view: "unread", q: "tanstack" });

		const collectionLocation = router.buildLocation({ to: "/collections/$collectionId", params: { collectionId: "reading:queue" } });
		expect(collectionLocation.pathname).toBe("/collections/reading%3Aqueue");
	});
});

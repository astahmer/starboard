import { describe, expect, it } from "vitest";
import { defaultCollections, defaultEntries } from "./mock-data";
import { collectionMatches, fuzzyScore, searchEntries, semanticScore } from "./search";

describe("starboard search", () => {
	it("matches a repository by fuzzy characters", () => {
		expect(fuzzyScore("astro", "withastro / astro")).toBeGreaterThan(0.5);
		expect(searchEntries(defaultEntries, "astro", "fuzzy")[0]?.id).toBe("github-astro");
	});

	it("keeps contextual matches in semantic mode", () => {
		const aiEntry = defaultEntries.find((entry) => entry.id === "github-vercel-ai")!;
		expect(semanticScore("machine learning", aiEntry)).toBeGreaterThan(0.08);
		expect(searchEntries(defaultEntries, "machine learning", "semantic").map((entry) => entry.id)).toContain("github-vercel-ai");
	});

	it("combines exact and semantic signals in hybrid mode", () => {
		const results = searchEntries(defaultEntries, "local database", "hybrid");
		expect(results.map((entry) => entry.id)).toContain("github-turso");
	});

	it("evaluates saved collection rules without moving entries", () => {
		const github = defaultEntries.find((entry) => entry.providerId === "github")!;
		const tangled = defaultEntries.find((entry) => entry.providerId === "tangled")!;
		const githubStars = defaultCollections.find((collection) => collection.id === "github-stars")!;
		expect(collectionMatches(github, githubStars)).toBe(true);
		expect(collectionMatches(tangled, githubStars)).toBe(false);
	});

	it("searches provider-specific fields and classifier topics", () => {
		const entry = { ...defaultEntries[0]!, fields: { framework: "SolidStart" }, classification: { topics: ["offline-first"] } };
		expect(searchEntries([entry], "solidstart", "fuzzy")[0]?.id).toBe(entry.id);
		expect(searchEntries([entry], "offline first", "semantic")[0]?.id).toBe(entry.id);
	});

	it("matches collection tags without depending on casing", () => {
		const entry = { ...defaultEntries[0]!, tags: ["Local-First"] };
		const collection = { ...defaultCollections[5]!, rule: { tags: ["local-first"] } };
		expect(collectionMatches(entry, collection)).toBe(true);
	});
});

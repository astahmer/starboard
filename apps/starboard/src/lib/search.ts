import type { Collection, Entry, SearchMode } from "./types";

const semanticGroups: Record<string, string[]> = {
	ai: ["ai", "llm", "model", "agent", "inference", "machine learning"],
	ui: ["ui", "ux", "frontend", "interface", "design", "components", "react"],
	web: ["web", "frontend", "website", "browser", "astro", "performance"],
	data: ["data", "database", "storage", "sqlite", "edge", "local-first"],
	protocol: ["atproto", "decentralized", "social", "graph", "portable"],
	runtime: ["rust", "go", "typescript", "javascript", "runtime", "architecture"],
};

const tokenize = (value: string) =>
	value
		.toLocaleLowerCase()
		.replace(/[^a-z0-9@#-]+/g, " ")
		.split(/\s+/)
		.filter(Boolean);

const candidateText = (entry: Entry) =>
	[
		entry.title,
		entry.summary,
		entry.author,
		entry.authorHandle,
		entry.language ?? "",
		...entry.tags,
		...Object.values(entry.fields ?? {}).map((value) => typeof value === "string" ? value : JSON.stringify(value)),
		...(entry.classification?.topics ?? []),
	].join(" ");

export function fuzzyScore(query: string, candidate: string): number {
	const normalizedQuery = query.toLocaleLowerCase().trim();
	const normalizedCandidate = candidate.toLocaleLowerCase();
	if (!normalizedQuery) return 1;
	if (!normalizedCandidate) return 0;
	if (normalizedCandidate.includes(normalizedQuery)) {
		const start = normalizedCandidate.indexOf(normalizedQuery);
		return 0.78 + Math.max(0, 0.22 - start / 500);
	}

	const queryTokens = tokenize(normalizedQuery);
	const candidateTokens = tokenize(normalizedCandidate);
	if (queryTokens.length === 0 || candidateTokens.length === 0) return 0;

	const tokenScores = queryTokens.map((queryToken) => Math.max(0, ...candidateTokens.map((candidateToken) => {
		if (candidateToken === queryToken) return 1;
		if (candidateToken.startsWith(queryToken)) return 0.9;
		if (candidateToken.includes(queryToken)) return 0.82;
		if (queryToken.length < 3) return 0;

		const maximumDistance = queryToken.length <= 5 ? 1 : Math.floor(queryToken.length * 0.2);
		if (Math.abs(candidateToken.length - queryToken.length) > maximumDistance) {
			return subsequenceScore(queryToken, candidateToken);
		}

		const previousRow = Array.from({ length: candidateToken.length + 1 }, (_, index) => index);
		let currentRow = previousRow;
		for (let queryIndex = 1; queryIndex <= queryToken.length; queryIndex += 1) {
			currentRow = [queryIndex];
			for (let candidateIndex = 1; candidateIndex <= candidateToken.length; candidateIndex += 1) {
				const substitutionCost = queryToken[queryIndex - 1] === candidateToken[candidateIndex - 1] ? 0 : 1;
				const deletion = (previousRow[candidateIndex] ?? Number.POSITIVE_INFINITY) + 1;
				const insertion = (currentRow[candidateIndex - 1] ?? Number.POSITIVE_INFINITY) + 1;
				const substitution = (previousRow[candidateIndex - 1] ?? Number.POSITIVE_INFINITY) + substitutionCost;
				currentRow[candidateIndex] = Math.min(deletion, insertion, substitution);
			}
			previousRow.splice(0, previousRow.length, ...currentRow);
		}
		const distance = currentRow[candidateToken.length] ?? Number.POSITIVE_INFINITY;
		if (distance <= maximumDistance) return 0.72 * (1 - distance / Math.max(queryToken.length, candidateToken.length));
		return subsequenceScore(queryToken, candidateToken);
	})));
	if (tokenScores.some((score) => score === 0)) return 0;
	return Math.min(0.92, tokenScores.reduce((total, score) => total + score, 0) / tokenScores.length * 0.92);
}

const subsequenceScore = (queryToken: string, candidateToken: string): number => {
	if (queryToken.length < 3 || candidateToken.length > queryToken.length * 2) return 0;
	let queryIndex = 0;
	for (const character of candidateToken) {
		if (character === queryToken[queryIndex]) queryIndex += 1;
		if (queryIndex === queryToken.length) break;
	}
	if (queryIndex !== queryToken.length) return 0;
	return 0.62 * (queryToken.length / candidateToken.length);
};

export function semanticScore(query: string, entry: Entry): number {
	const queryTokens = tokenize(query);
	if (queryTokens.length === 0) return 1;
	const text = candidateText(entry).toLocaleLowerCase();
	const expanded = new Set(queryTokens);
	for (const token of queryTokens) {
		for (const [group, related] of Object.entries(semanticGroups)) {
			const matchesConcept = token === group || related.some((term) => term === token || term.split(" ").includes(token));
			if (matchesConcept) {
				related.forEach((term) => expanded.add(term));
				expanded.add(group);
			}
		}
	}

	let matched = 0;
	for (const token of expanded) {
		if (text.includes(token)) matched += 1;
	}
	const exactQueryBonus = text.includes(query.toLocaleLowerCase().trim()) ? 0.25 : 0;
	const tagBonus = entry.tags.some((tag) => queryTokens.some((token) => tag.includes(token))) ? 0.2 : 0;
	return Math.min(0.99, matched / Math.max(queryTokens.length * 2, 1) + exactQueryBonus + tagBonus);
}

export function cosineSimilarity(left: number[], right: number[]): number {
	if (left.length === 0 || left.length !== right.length) return 0;
	let dot = 0;
	let leftMagnitude = 0;
	let rightMagnitude = 0;
	for (let index = 0; index < left.length; index += 1) {
		const a = left[index] ?? 0;
		const b = right[index] ?? 0;
		dot += a * b;
		leftMagnitude += a * a;
		rightMagnitude += b * b;
	}
	if (leftMagnitude === 0 || rightMagnitude === 0) return 0;
	return dot / Math.sqrt(leftMagnitude * rightMagnitude);
}

export function collectionMatches(entry: Entry, collection: Collection): boolean {
	const rule = collection.rule;
	const entryTags = new Set(entry.tags.map((tag) => tag.toLocaleLowerCase()));
	if (rule.providerIds?.length && !rule.providerIds.includes(entry.providerId)) return false;
	if (rule.kinds?.length && !rule.kinds.includes(entry.kind)) return false;
	if (rule.tags?.length && !rule.tags.every((tag) => entryTags.has(tag.toLocaleLowerCase()))) return false;
	if (rule.anyTags?.length && !rule.anyTags.some((tag) => entryTags.has(tag.toLocaleLowerCase()))) return false;
	if (rule.unreadOnly && entry.isRead) return false;
	if (rule.pinnedOnly && !entry.isPinned) return false;
	return true;
}

export function searchEntries(entries: Entry[], query: string, mode: SearchMode, queryEmbedding?: number[]): Entry[] {
	const trimmed = query.trim();
	if (!trimmed) {
		return [...entries].sort((left, right) => Number(right.isPinned) - Number(left.isPinned) || right.starredAt.localeCompare(left.starredAt));
	}

	return entries
		.map((entry) => {
			const fuzzy = fuzzyScore(trimmed, candidateText(entry));
			const vector = queryEmbedding && entry.embedding ? (cosineSimilarity(queryEmbedding, entry.embedding) + 1) / 2 : undefined;
			const semantic = vector ?? semanticScore(trimmed, entry);
			const score = mode === "fuzzy" ? fuzzy : mode === "semantic" ? semantic : fuzzy * 0.55 + semantic * 0.45;
			return { entry, score };
		})
		.filter(({ score }) => score > (mode === "semantic" ? 0.08 : mode === "fuzzy" ? 0.45 : 0.25))
		.sort((left, right) => right.score - left.score || Number(right.entry.isPinned) - Number(left.entry.isPinned))
		.map(({ entry }) => entry);
}

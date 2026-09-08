import type { WorkerEnv } from "./env";

interface EmbeddingResponse {
	data?: Array<{ embedding?: number[] }>;
}

export async function embedText(env: WorkerEnv, input: string): Promise<number[] | undefined> {
	if (!input.trim() || !env.EMBEDDING_API_URL || !env.EMBEDDING_API_KEY) return undefined;
	try {
		const response = await fetch(env.EMBEDDING_API_URL, {
			method: "POST",
			headers: { "content-type": "application/json", authorization: `Bearer ${env.EMBEDDING_API_KEY}` },
			body: JSON.stringify({ model: env.EMBEDDING_MODEL ?? "text-embedding-3-small", input }),
		});
		if (!response.ok) return undefined;
		const payload = await response.json() as EmbeddingResponse;
		const embedding = payload.data?.[0]?.embedding;
		return Array.isArray(embedding) && embedding.every((value) => typeof value === "number") ? embedding : undefined;
	} catch {
		return undefined;
	}
}

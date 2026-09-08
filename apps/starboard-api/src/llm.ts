import type { Entry } from "../../starboard/src/lib/types";
import type { WorkerEnv } from "./env";

interface ChatResponse {
	choices?: Array<{ message?: { content?: string } }>;
}

export interface Classification {
	topics: string[];
	confidence?: number;
	model?: string;
}

function parseClassification(value: string, model: string): Classification | undefined {
	try {
		const cleaned = value.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
		const parsed = JSON.parse(cleaned) as { topics?: unknown; confidence?: unknown };
		const topics = Array.isArray(parsed.topics) ? parsed.topics.filter((topic): topic is string => typeof topic === "string").map((topic) => topic.trim().toLocaleLowerCase()).filter(Boolean).slice(0, 3) : [];
		if (topics.length === 0) return undefined;
		return { topics: Array.from(new Set(topics)), confidence: typeof parsed.confidence === "number" ? Math.max(0, Math.min(1, parsed.confidence)) : undefined, model };
	} catch {
		return undefined;
	}
}

export async function classifyEntry(env: WorkerEnv, entry: Entry): Promise<Classification | undefined> {
	if (!env.LLM_API_URL || !env.LLM_API_KEY) return undefined;
	const model = env.LLM_MODEL ?? "gpt-4o-mini";
	const response = await fetch(env.LLM_API_URL, {
		method: "POST",
		headers: { "content-type": "application/json", authorization: `Bearer ${env.LLM_API_KEY}` },
		body: JSON.stringify({
			model,
			temperature: 0,
			response_format: { type: "json_object" },
			messages: [
				{ role: "system", content: "Classify source-library entries. Return JSON {topics: string[], confidence: number}. Use at most three lowercase, reusable topics. Do not invent a topic unsupported by title or description." },
				{ role: "user", content: JSON.stringify({ title: entry.title, summary: entry.summary, author: entry.author, tags: entry.tags, language: entry.language }) },
			],
		}),
	});
	if (!response.ok) return undefined;
	const payload = await response.json() as ChatResponse;
	const content = payload.choices?.[0]?.message?.content;
	return content ? parseClassification(content, model) : undefined;
}

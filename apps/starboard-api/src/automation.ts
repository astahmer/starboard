import type { Automation, AutomationAction, AutomationTrigger, Entry, JsonValue, PluginManifest } from "../../starboard/src/lib/types";
import { updateEntry } from "./repository";
import { classifyEntry } from "./llm";
import type { WorkerEnv } from "./env";
import { signPayload } from "./crypto";

interface AutomationRow {
	id: string;
	name: string;
	description: string;
	trigger: AutomationTrigger;
	action: AutomationAction;
	config_json: string;
	enabled: number;
	created_at: string;
	updated_at: string;
}

interface PluginRow {
	id: string;
	name: string;
	version: string;
	description: string;
	manifest_json: string;
	enabled: number;
	created_at: string;
	updated_at: string;
}

const parseJson = <T,>(value: string, fallback: T): T => {
	try {
		return JSON.parse(value) as T;
	} catch {
		return fallback;
	}
};

function automationFromRow(row: AutomationRow): Automation {
	return { id: row.id, name: row.name, description: row.description, trigger: row.trigger, action: row.action, config: parseJson<Record<string, JsonValue>>(row.config_json, {}), enabled: row.enabled === 1, createdAt: row.created_at, updatedAt: row.updated_at };
}

function pluginFromRow(row: PluginRow): PluginManifest {
	return { ...parseJson<Omit<PluginManifest, "id" | "name" | "version" | "description" | "enabled">>(row.manifest_json, { permissions: [], triggers: [], actions: [] }), id: row.id, name: row.name, version: row.version, description: row.description, enabled: row.enabled === 1 };
}

export async function listAutomations(env: WorkerEnv): Promise<Automation[]> {
	const result = await env.DB.prepare("SELECT * FROM automations ORDER BY created_at ASC").all<AutomationRow>();
	return result.results.map(automationFromRow);
}

export async function upsertAutomation(env: WorkerEnv, automation: Automation): Promise<Automation> {
	await env.DB.prepare(
		`INSERT INTO automations (id, name, description, trigger, action, config_json, enabled, created_at, updated_at)
		 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
		 ON CONFLICT(id) DO UPDATE SET name = excluded.name, description = excluded.description, trigger = excluded.trigger, action = excluded.action, config_json = excluded.config_json, enabled = excluded.enabled, updated_at = excluded.updated_at`,
	).bind(automation.id, automation.name, automation.description, automation.trigger, automation.action, JSON.stringify(automation.config), automation.enabled ? 1 : 0, automation.createdAt, automation.updatedAt).run();
	return automation;
}

export async function deleteAutomation(env: WorkerEnv, id: string): Promise<void> {
	await env.DB.prepare("DELETE FROM automations WHERE id = ?1").bind(id).run();
}

export async function listPlugins(env: WorkerEnv): Promise<PluginManifest[]> {
	const result = await env.DB.prepare("SELECT * FROM plugins ORDER BY name ASC").all<PluginRow>();
	return result.results.map(pluginFromRow);
}

export async function upsertPlugin(env: WorkerEnv, plugin: PluginManifest): Promise<PluginManifest> {
	const { id, name, version, description, enabled, ...manifest } = plugin;
	const now = new Date().toISOString();
	await env.DB.prepare(
		`INSERT INTO plugins (id, name, version, description, manifest_json, enabled, created_at, updated_at)
		 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
		 ON CONFLICT(id) DO UPDATE SET name = excluded.name, version = excluded.version, description = excluded.description, manifest_json = excluded.manifest_json, enabled = excluded.enabled, updated_at = excluded.updated_at`,
	).bind(id, name, version, description, JSON.stringify(manifest), enabled ? 1 : 0, now, now).run();
	return plugin;
}

async function recordRun(env: WorkerEnv, automationId: string, trigger: AutomationTrigger, entryId: string | undefined, status: "completed" | "failed", message: string): Promise<void> {
	await env.DB.prepare("INSERT INTO automation_runs (id, automation_id, trigger, entry_id, status, message, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)").bind(`${automationId}:${Date.now()}:${crypto.randomUUID()}`, automationId, trigger, entryId ?? null, status, message, new Date().toISOString()).run();
}

function configString(automation: Automation, key: string): string | undefined {
	const value = automation.config[key];
	return typeof value === "string" ? value.trim() : undefined;
}

export async function runAutomations(env: WorkerEnv, trigger: AutomationTrigger, entry?: Entry): Promise<void> {
	const automations = (await listAutomations(env)).filter((automation) => automation.enabled && automation.trigger === trigger);
	let currentEntry = entry;
	for (const automation of automations) {
		try {
			if (automation.action === "tag" && currentEntry) {
				const tag = configString(automation, "tag");
				if (!tag) throw new Error("Tag action requires config.tag");
				const updated = await updateEntry(env.DB, currentEntry.id, { tags: Array.from(new Set([...currentEntry.tags, tag.toLocaleLowerCase()])) });
				if (updated) currentEntry = updated;
				await recordRun(env, automation.id, trigger, currentEntry.id, "completed", `Added tag ${tag}`);
				continue;
			}
			if (automation.action === "classify" && currentEntry) {
				const classification = await classifyEntry(env, currentEntry);
				if (!classification) throw new Error("LLM classifier is not configured or returned no topics");
				const updated = await updateEntry(env.DB, currentEntry.id, { classification });
				if (updated) currentEntry = updated;
				await recordRun(env, automation.id, trigger, currentEntry.id, "completed", `Suggested ${classification.topics.join(", ")}`);
				continue;
			}
			if (automation.action === "webhook") {
				const target = configString(automation, "url");
				if (!target || !target.startsWith("https://")) throw new Error("Webhook action requires an HTTPS config.url");
				const body = JSON.stringify({ trigger, entry: currentEntry ?? null, automationId: automation.id });
				const signature = env.AUTOMATION_SIGNING_SECRET ? await signPayload(body, env.AUTOMATION_SIGNING_SECRET) : undefined;
				const response = await fetch(target, { method: "POST", headers: { "content-type": "application/json", ...(signature ? { "x-starboard-signature": `sha256=${signature}` } : {}) }, body });
				if (!response.ok) throw new Error(`Webhook returned HTTP ${response.status}`);
				await recordRun(env, automation.id, trigger, currentEntry?.id, "completed", "Webhook delivered");
				continue;
			}
			await recordRun(env, automation.id, trigger, currentEntry?.id, "failed", "Unsupported automation action");
		} catch (error) {
			await recordRun(env, automation.id, trigger, currentEntry?.id, "failed", error instanceof Error ? error.message : "Automation failed");
		}
	}
}

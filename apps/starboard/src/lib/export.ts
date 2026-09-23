import type { Entry } from "./types";

export type EntryExportFormat = "csv" | "json" | "md";

const entryExportRecord = (entry: Entry) => ({
	repository: typeof entry.fields?.repository === "string" ? entry.fields.repository : entry.title,
	description: entry.summary,
	url: entry.url,
	owner: entry.author,
	ownerHandle: entry.authorHandle,
	providerId: entry.providerId,
	starredAt: entry.starredAt,
	updatedAt: entry.updatedAt,
	pushedAt: typeof entry.fields?.pushedAt === "string" ? entry.fields.pushedAt : undefined,
	repositoryStars: entry.stars,
	forks: entry.forks,
	language: entry.language,
	tags: entry.tags,
	isRead: entry.isRead,
	isPinned: entry.isPinned,
});

const escapeCsv = (value: unknown): string => `"${String(value ?? "").replaceAll('"', '""')}"`;
const escapeMarkdown = (value: unknown): string => String(value ?? "").replaceAll("|", "\\|").replaceAll(/\r?\n/g, " ");

export function serializeEntries(entries: Entry[], format: EntryExportFormat): string {
	const records = entries.map(entryExportRecord);
	if (format === "json") return JSON.stringify(records, null, 2);

	const columns = ["repository", "description", "url", "owner", "ownerHandle", "providerId", "starredAt", "updatedAt", "pushedAt", "repositoryStars", "forks", "language", "tags", "isRead", "isPinned"] as const;
	const headings = ["Repository", "Description", "URL", "Owner", "Owner handle", "Source ID", "Starred at", "Last updated", "Last pushed", "Repository stars", "Forks", "Language", "Tags", "Read", "Pinned"];
	const valueForColumn = (record: (typeof records)[number], column: (typeof columns)[number]): unknown => column === "tags" ? record.tags.join(", ") : record[column];
	if (format === "csv") return [headings, ...records.map((record) => columns.map((column) => valueForColumn(record, column)))].map((row) => row.map(escapeCsv).join(",")).join("\r\n");
	const rows = records.map((record) => `| ${columns.map((column) => escapeMarkdown(valueForColumn(record, column))).join(" | ")} |`);
	return [`| ${headings.join(" | ")} |`, `| ${headings.map(() => "---").join(" | ")} |`, ...rows].join("\n");
}

export function downloadEntries(entries: Entry[], format: EntryExportFormat): void {
	const content = serializeEntries(entries, format);
	const mimeType = format === "json" ? "application/json" : format === "csv" ? "text/csv" : "text/markdown";
	const url = URL.createObjectURL(new Blob([content], { type: `${mimeType};charset=utf-8` }));
	const anchor = document.createElement("a");
	anchor.href = url;
	anchor.download = `starboard-export-${new Date().toISOString().slice(0, 10)}.${format}`;
	document.body.append(anchor);
	anchor.click();
	anchor.remove();
	window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

import { z } from "zod";

export const entryViewSchema = z.enum(["all", "unread", "pinned"]);

export const workspaceSearchSchema = z.object({
	view: entryViewSchema.optional().catch(undefined),
	q: z.string().optional().catch(undefined),
	entry: z.string().optional().catch(undefined),
	auth_error: z.string().optional().catch(undefined),
});

export type EntryView = z.infer<typeof entryViewSchema>;
export type WorkspaceSearch = z.infer<typeof workspaceSearchSchema>;

export type WorkspaceRoute =
	| { kind: "all" }
	| { kind: "provider"; providerId: string }
	| { kind: "collection"; collectionId: string };

const pathSegment = (value: string): string => {
	try {
		return decodeURIComponent(value);
	} catch {
		return value;
	}
};

export const workspaceRouteFromPathname = (pathname: string): WorkspaceRoute => {
	const providerMatch = pathname.match(/^\/sources\/([^/]+)\/?$/);
	if (providerMatch?.[1]) return { kind: "provider", providerId: pathSegment(providerMatch[1]) };
	const collectionMatch = pathname.match(/^\/collections\/([^/]+)\/?$/);
	if (collectionMatch?.[1]) return { kind: "collection", collectionId: pathSegment(collectionMatch[1]) };
	return { kind: "all" };
};

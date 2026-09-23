import { useCallback, useDeferredValue, useEffect, useLayoutEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import { useLocation, useNavigate } from "@tanstack/react-router";
import { useWindowVirtualizer } from "@tanstack/react-virtual";
import {
	ArrowDownToLine,
	ArrowUpRight,
	Bookmark,
	BookmarkCheck,
	Check,
	ChevronRight,
	CircleHelp,
	Clock3,
	Code2,
	Copy,
	Download,
	FileJson,
	FileText,
	Github,
	GitBranch,
	Inbox,
	KeyRound,
	Layers3,
	LoaderCircle,
	LogOut,
	Plus,
	RefreshCw,
	Search,
	Sparkles,
	Star,
	Trash2,
	X,
} from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { z } from "zod";
import { connectRemoteTangled, createRemoteApiToken, createRemoteCollection, fetchRemoteApiTokens, fetchRemoteEntryMetadata, fetchRemoteMe, fetchRemoteWorkspace, logoutRemote, markRemoteGithubStarsRead, patchRemoteEntry, providerAuthUrl, revokeRemoteApiToken, syncRemoteProvider } from "@/lib/api-client";
import type { ApiTokenSummary, CreatedApiToken, EntryMetadataResponse, MeResponse, WorkspaceResponse } from "@/lib/api-contract";
import { downloadEntries } from "@/lib/export";
import { collectionMatches, searchEntries } from "@/lib/search";
import type { Collection, Entry, Provider } from "@/lib/types";
import { cn, formatDate, formatNumber, formatRelative, initials, slugify } from "@/lib/utils";
import { entryViewSchema, workspaceRouteFromPathname, type WorkspaceRoute, type WorkspaceSearch } from "@/lib/workspace-route-state";

const countEntriesForProvider = (entries: Entry[], providerId: string): number => entries.filter((entry) => entry.providerId === providerId).length;
const repositorySortSchema = z.enum(["relevance", "most-stars", "recently-pushed", "recently-starred", "name"]);
const minimumStarsSchema = z.enum(["all", "10", "100", "1000", "10000"]);

type RepositorySort = z.infer<typeof repositorySortSchema>;

const pushedAtTimestamp = (entry: Entry): number => {
	const pushedAt = entry.fields?.pushedAt;
	const timestamp = Date.parse(typeof pushedAt === "string" ? pushedAt : entry.updatedAt);
	return Number.isFinite(timestamp) ? timestamp : Number.NEGATIVE_INFINITY;
};

const sortRepositoryEntries = ({ entries, sort, hasQuery }: { entries: Entry[]; sort: RepositorySort; hasQuery: boolean }): Entry[] => {
	if (sort === "relevance" && hasQuery) return entries;
	return [...entries].sort((left, right) => {
		const pinnedOrder = Number(right.isPinned) - Number(left.isPinned);
		const recentlyStarredOrder = right.starredAt.localeCompare(left.starredAt);
		if (sort === "most-stars") return (right.stars ?? -1) - (left.stars ?? -1) || pinnedOrder || recentlyStarredOrder;
		if (sort === "recently-pushed") {
			const leftTimestamp = pushedAtTimestamp(left);
			const rightTimestamp = pushedAtTimestamp(right);
			if (leftTimestamp !== rightTimestamp) return rightTimestamp > leftTimestamp ? 1 : -1;
			return pinnedOrder || recentlyStarredOrder;
		}
		if (sort === "name") return left.title.localeCompare(right.title, undefined, { sensitivity: "base" }) || pinnedOrder || recentlyStarredOrder;
		return pinnedOrder || recentlyStarredOrder;
	});
};

function WorkspaceLoading() {
	return (
		<div className="mx-auto grid min-h-svh max-w-[1500px] grid-cols-1 lg:grid-cols-[248px_minmax(0,1fr)]">
			<aside className="hidden border-r bg-sidebar p-6 lg:block">
				<Skeleton className="h-8 w-32" />
				<Skeleton className="mt-10 h-10 w-full" />
				<Skeleton className="mt-8 h-4 w-20" />
				<Skeleton className="mt-4 h-9 w-full" />
				<Skeleton className="mt-2 h-9 w-full" />
				<Skeleton className="mt-2 h-9 w-full" />
			</aside>
			<main className="p-6 md:p-10">
				<Skeleton className="h-8 w-56" />
				<Skeleton className="mt-3 h-5 w-80 max-w-full" />
				<div className="mt-8 grid gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
					<div className="space-y-3">
						{Array.from({ length: 6 }, (_, index) => <Skeleton className="h-28 w-full" key={index} />)}
					</div>
					<Skeleton className="hidden h-96 xl:block" />
				</div>
			</main>
		</div>
	);
}

function SignInPage({ canConnectGithub, error }: { canConnectGithub: boolean; error: string | null }) {
	return (
		<div className="min-h-svh bg-background">
			<header className="mx-auto flex h-16 max-w-7xl items-center justify-between px-5 sm:px-8">
				<a className="flex items-center gap-2.5 font-semibold tracking-tight" href="/">
					<span className="flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground"><Star className="size-4" fill="currentColor" /></span>
					<span>starboard</span>
				</a>
				<Badge variant="outline" className="gap-1.5 rounded-full px-3 py-1 text-muted-foreground"><ShieldIcon /> Personal library</Badge>
			</header>
			<main className="mx-auto grid max-w-7xl items-center gap-16 px-5 pb-20 pt-14 sm:px-8 lg:min-h-[calc(100svh-64px)] lg:grid-cols-[minmax(0,1fr)_410px] lg:gap-20 lg:py-20">
				<section className="max-w-2xl">
					<Badge variant="secondary" className="mb-6 rounded-full px-3 py-1 font-medium">A home for the things you star</Badge>
					<h1 className="text-4xl font-semibold leading-[1.08] tracking-tight sm:text-5xl lg:text-6xl">Your GitHub stars,<br className="hidden sm:block" /> in one useful place.</h1>
					<p className="mt-6 max-w-xl text-lg leading-8 text-muted-foreground">Search, organize, and return to every repository you have saved. Your library is private to your account and built from your own GitHub data.</p>
					<div className="mt-9 flex flex-wrap items-center gap-x-6 gap-y-3 text-sm text-muted-foreground">
						<span className="inline-flex items-center gap-2"><Check className="size-4 text-primary" /> Your actual starred repositories</span>
						<span className="inline-flex items-center gap-2"><Check className="size-4 text-primary" /> Sign in with your own GitHub account</span>
					</div>
				</section>
				<Card className="mx-auto w-full max-w-[410px] border-border/80 shadow-sm">
					<CardHeader className="space-y-4 pb-5">
						<div className="flex size-11 items-center justify-center rounded-xl bg-secondary text-foreground"><Github className="size-5" /></div>
						<div className="space-y-1.5">
							<CardTitle className="text-xl">Get started</CardTitle>
							<CardDescription>Connect GitHub to import your star history and repository details.</CardDescription>
						</div>
					</CardHeader>
					<CardContent className="space-y-4">
						{error && <Alert variant="destructive"><AlertTitle>GitHub sign-in failed</AlertTitle><AlertDescription>{error}</AlertDescription></Alert>}
						{canConnectGithub ? (
							<Button className="w-full" size="lg" onClick={() => window.location.assign(providerAuthUrl())}>
								<Github className="size-4" /> Continue with GitHub
							</Button>
						) : (
							<Alert>
								<CircleHelp className="size-4" />
								<AlertTitle>GitHub sign-in is not configured yet</AlertTitle>
								<AlertDescription>The Starboard owner needs to finish GitHub App setup before accounts can connect.</AlertDescription>
							</Alert>
						)}
						<p className="text-center text-xs leading-5 text-muted-foreground">Starboard asks GitHub only for permission to read your stars and basic profile.</p>
					</CardContent>
				</Card>
			</main>
		</div>
	);
}

function ShieldIcon() {
	return <span className="inline-flex size-1.5 rounded-full bg-emerald-600" aria-hidden="true" />;
}

function CollectionIcon({ collection }: { collection: Collection }) {
	if (collection.icon === "github") return <Github className="size-4" />;
	if (collection.icon === "branch") return <GitBranch className="size-4" />;
	if (collection.icon === "sparkles") return <Sparkles className="size-4" />;
	if (collection.icon === "bookmark") return <Bookmark className="size-4" />;
	if (collection.icon === "inbox") return <Inbox className="size-4" />;
	return <Layers3 className="size-4" />;
}

function ProviderIcon({ provider }: { provider: Provider }) {
	return provider.kind === "github" ? <Github className="size-4" /> : <GitBranch className="size-4" />;
}

function App() {
	const location = useLocation();
	const navigate = useNavigate();
	const workspaceRoute = useMemo(() => workspaceRouteFromPathname(location.pathname), [location.pathname]);
	const query = location.search.q ?? "";
	const deferredQuery = useDeferredValue(query);
	const view = location.search.view ?? "all";
	const providerFilter = workspaceRoute.kind === "provider" ? workspaceRoute.providerId : "all";
	const collectionFilter = workspaceRoute.kind === "collection" ? workspaceRoute.collectionId : null;
	const selectedEntryId = location.search.entry ?? null;
	const authRedirectError = location.search.auth_error ?? null;
	const [me, setMe] = useState<MeResponse | null>(null);
	const [workspace, setWorkspace] = useState<WorkspaceResponse | null>(null);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const [syncingProviderId, setSyncingProviderId] = useState<string | null>(null);
	const [syncProgress, setSyncProgress] = useState(0);
	const [syncNotice, setSyncNotice] = useState<string | null>(null);
	const [savingEntryId, setSavingEntryId] = useState<string | null>(null);
	const [sortSelection, setSortSelection] = useState<RepositorySort | null>(null);
	const [languageFilter, setLanguageFilter] = useState("all");
	const [minimumStars, setMinimumStars] = useState<z.infer<typeof minimumStarsSchema>>("all");
	const [collectionDialogOpen, setCollectionDialogOpen] = useState(false);
	const [sourceDialogOpen, setSourceDialogOpen] = useState(false);
	const [apiTokenDialogOpen, setApiTokenDialogOpen] = useState(false);
	const [apiTokens, setApiTokens] = useState<ApiTokenSummary[]>([]);
	const [apiTokenName, setApiTokenName] = useState("");
	const [createdApiToken, setCreatedApiToken] = useState<CreatedApiToken | null>(null);
	const [apiTokenLoading, setApiTokenLoading] = useState(false);
	const [apiTokenBusy, setApiTokenBusy] = useState<string | null>(null);
	const [apiTokenError, setApiTokenError] = useState<string | null>(null);
	const [apiTokenCopied, setApiTokenCopied] = useState(false);
	const [markingGithubRead, setMarkingGithubRead] = useState(false);
	const [collectionName, setCollectionName] = useState("");
	const [collectionDescription, setCollectionDescription] = useState("");
	const [tangledHandle, setTangledHandle] = useState("");
	const [dialogError, setDialogError] = useState<string | null>(null);
	const [creatingCollection, setCreatingCollection] = useState(false);
	const [connectingTangled, setConnectingTangled] = useState(false);
	const initialSyncStarted = useRef(new Set<string>());
	const navigateWorkspace = useCallback((route: WorkspaceRoute, changes: Partial<WorkspaceSearch>, replace = false, resetScroll = true) => {
		const search = { ...location.search, ...changes };
		if (route.kind === "provider") {
			void navigate({ to: "/sources/$providerId", params: { providerId: route.providerId }, search, replace, resetScroll });
			return;
		}
		if (route.kind === "collection") {
			void navigate({ to: "/collections/$collectionId", params: { collectionId: route.collectionId }, search, replace, resetScroll });
			return;
		}
		void navigate({ to: "/", search, replace, resetScroll });
	}, [location.search, navigate]);

	const loadAccount = useCallback(async () => {
		setLoading(true);
		setError(null);
		try {
			const identity = await fetchRemoteMe();
			setMe(identity);
			if (!identity.authenticated) {
				setWorkspace(null);
				return;
			}
			setWorkspace(await fetchRemoteWorkspace());
		} catch (cause) {
			setWorkspace(null);
			setError(cause instanceof Error ? cause.message : "Starboard could not load your workspace");
		} finally {
			setLoading(false);
		}
	}, []);

	useEffect(() => {
		void loadAccount();
	}, [loadAccount]);

	const providers = workspace?.providers ?? [];
	const entries = workspace?.entries ?? [];
	const collections = workspace?.collections ?? [];
	const customCollections = collections.filter((collection) => !collection.builtIn);
	const selectedCollection = collectionFilter ? collections.find((collection) => collection.id === collectionFilter) : undefined;
	const selectedEntry = selectedEntryId ? entries.find((entry) => entry.id === selectedEntryId) : undefined;
	const hasSearchQuery = Boolean(deferredQuery.trim());
	const selectedSort = sortSelection ?? (hasSearchQuery ? "relevance" : "recently-starred");
	const effectiveSort = selectedSort === "relevance" && !hasSearchQuery ? "recently-starred" : selectedSort;
	const languageOptions = useMemo(() => Array.from(new Set(entries.map((entry) => entry.language).filter((language): language is string => Boolean(language)))).sort((left, right) => left.localeCompare(right)), [entries]);
	const hasRepositoryFilters = languageFilter !== "all" || minimumStars !== "all";

	const visibleEntries = useMemo(() => {
		if (!workspace) return [];
		let results = workspace.entries;
		if (providerFilter !== "all") results = results.filter((entry) => entry.providerId === providerFilter);
		if (view === "unread") results = results.filter((entry) => !entry.isRead);
		if (view === "pinned") results = results.filter((entry) => entry.isPinned);
		if (selectedCollection) results = results.filter((entry) => collectionMatches(entry, selectedCollection));
		if (languageFilter !== "all") results = results.filter((entry) => entry.language === languageFilter);
		if (minimumStars !== "all") results = results.filter((entry) => typeof entry.stars === "number" && entry.stars >= Number(minimumStars));
		const matches = hasSearchQuery ? searchEntries(results, deferredQuery, "hybrid") : results;
		return sortRepositoryEntries({ entries: matches, sort: effectiveSort, hasQuery: hasSearchQuery });
	}, [workspace, providerFilter, view, selectedCollection, deferredQuery, languageFilter, minimumStars, hasSearchQuery, effectiveSort]);

	useEffect(() => {
		if (visibleEntries.length === 0) {
			if (selectedEntryId !== null) navigateWorkspace(workspaceRoute, { entry: undefined }, true);
			return;
		}
		if (!visibleEntries.some((entry) => entry.id === selectedEntryId)) navigateWorkspace(workspaceRoute, { entry: visibleEntries[0]?.id }, true);
	}, [visibleEntries, selectedEntryId, navigateWorkspace, workspaceRoute]);

	const replaceEntry = (entry: Entry) => {
		setWorkspace((current) => current ? { ...current, entries: current.entries.map((candidate) => candidate.id === entry.id ? entry : candidate) } : current);
	};

	const synchronize = async (provider: Provider) => {
		if (syncingProviderId) return;
		setError(null);
		setSyncNotice(null);
		setSyncingProviderId(provider.id);
		setSyncProgress(0);
		try {
			const report = await syncRemoteProvider(provider.id, (progress) => setSyncProgress(progress.entriesFetched));
			const next = await fetchRemoteWorkspace();
			setWorkspace(next);
			setSyncNotice(report.message === "Already up to date." ? `${provider.name} is already up to date.` : `Synced ${report.indexed.toLocaleString()} repositories from ${provider.name}.`);
		} catch (cause) {
			setError(cause instanceof Error ? cause.message : "Source sync failed");
		} finally {
			setSyncingProviderId(null);
			setSyncProgress(0);
		}
	};

	useEffect(() => {
		const providerToSync = providers.find((provider) => (provider.kind === "github" || provider.kind === "tangled") && provider.connected && (provider.syncPending || !provider.lastSyncedAt) && !initialSyncStarted.current.has(provider.id));
		if (!providerToSync) return;
		initialSyncStarted.current.add(providerToSync.id);
		void synchronize(providerToSync);
	}, [workspace]);

	const updateEntry = async (entry: Entry, patch: Partial<Pick<Entry, "isRead" | "isPinned" | "tags">>) => {
		setSavingEntryId(entry.id);
		setError(null);
		try {
			replaceEntry(await patchRemoteEntry(entry.id, patch));
		} catch (cause) {
			setError(cause instanceof Error ? cause.message : "Could not update this repository");
		} finally {
			setSavingEntryId(null);
		}
	};

	const markAllGithubStarsAsRead = async () => {
		setMarkingGithubRead(true);
		setError(null);
		try {
			const result = await markRemoteGithubStarsRead();
			setWorkspace((current) => current ? {
				...current,
				entries: current.entries.map((entry) => current.providers.some((provider) => provider.id === entry.providerId && provider.kind === "github") ? { ...entry, isRead: true } : entry),
			} : current);
			setSyncNotice(`Marked ${result.markedRead.toLocaleString()} GitHub stars as read.`);
		} catch (cause) {
			setError(cause instanceof Error ? cause.message : "Could not mark GitHub stars as read");
		} finally {
			setMarkingGithubRead(false);
		}
	};

	const openApiTokenDialog = async () => {
		setApiTokenDialogOpen(true);
		setApiTokenError(null);
		setApiTokenLoading(true);
		try {
			setApiTokens((await fetchRemoteApiTokens()).apiTokens);
		} catch (cause) {
			setApiTokenError(cause instanceof Error ? cause.message : "Could not load API tokens");
		} finally {
			setApiTokenLoading(false);
		}
	};

	const createApiToken = async (event: FormEvent<HTMLFormElement>) => {
		event.preventDefault();
		const name = apiTokenName.trim();
		if (!name) {
			setApiTokenError("Enter a name for this token.");
			return;
		}
		setApiTokenBusy("create");
		setApiTokenError(null);
		try {
			const created = await createRemoteApiToken(name);
			setApiTokens((current) => [created.apiToken, ...current].slice(0, 50));
			setCreatedApiToken(created);
			setApiTokenCopied(false);
			setApiTokenName("");
		} catch (cause) {
			setApiTokenError(cause instanceof Error ? cause.message : "Could not create API token");
		} finally {
			setApiTokenBusy(null);
		}
	};

	const revokeApiToken = async (tokenId: string) => {
		setApiTokenBusy(tokenId);
		setApiTokenError(null);
		try {
			const revoked = await revokeRemoteApiToken(tokenId);
			setApiTokens((current) => current.map((token) => token.id === revoked.id ? { ...token, revokedAt: revoked.revokedAt } : token));
		} catch (cause) {
			setApiTokenError(cause instanceof Error ? cause.message : "Could not revoke API token");
		} finally {
			setApiTokenBusy(null);
		}
	};

	const copyCreatedApiToken = async () => {
		if (!createdApiToken) return;
		try {
			await navigator.clipboard.writeText(createdApiToken.token);
			setApiTokenCopied(true);
		} catch {
			setApiTokenError("Clipboard access failed. Select and copy the token above.");
		}
	};

	const createCollection = async (event: FormEvent<HTMLFormElement>) => {
		event.preventDefault();
		if (!collectionName.trim()) {
			setDialogError("Enter a name for this collection.");
			return;
		}
		setCreatingCollection(true);
		setDialogError(null);
		try {
			const collection = await createRemoteCollection({
				id: slugify(collectionName),
				name: collectionName.trim(),
				description: collectionDescription.trim() || "A collection of repositories you want to return to.",
				icon: "layers",
				color: "#5d7390",
				rule: providerFilter === "all" ? {} : { providerIds: [providerFilter] },
				builtIn: false,
			});
			setWorkspace((current) => current ? { ...current, collections: [...current.collections, collection] } : current);
			setCollectionName("");
			setCollectionDescription("");
			navigateWorkspace({ kind: "collection", collectionId: collection.id }, { view: undefined, entry: undefined });
			setCollectionDialogOpen(false);
		} catch (cause) {
			setDialogError(cause instanceof Error ? cause.message : "Could not create this collection");
		} finally {
			setCreatingCollection(false);
		}
	};

	const connectTangled = async (event: FormEvent<HTMLFormElement>) => {
		event.preventDefault();
		if (!tangledHandle.trim()) {
			setDialogError("Enter a Tangled handle.");
			return;
		}
		setConnectingTangled(true);
		setDialogError(null);
		try {
			await connectRemoteTangled(tangledHandle);
			setWorkspace(await fetchRemoteWorkspace());
			setTangledHandle("");
			setSourceDialogOpen(false);
		} catch (cause) {
			setDialogError(cause instanceof Error ? cause.message : "Could not connect this source");
		} finally {
			setConnectingTangled(false);
		}
	};

	const signOut = async () => {
		try {
			await logoutRemote();
			initialSyncStarted.current.clear();
			await loadAccount();
		} catch (cause) {
			setError(cause instanceof Error ? cause.message : "Could not sign out");
		}
	};

	if (loading) return <WorkspaceLoading />;
	if (!me?.authenticated) {
		if (error && !error.includes("sign-in")) {
			return (
				<div className="mx-auto flex min-h-svh max-w-lg flex-col items-center justify-center gap-5 px-6 text-center">
					<div className="flex size-12 items-center justify-center rounded-xl bg-secondary"><CircleHelp className="size-5" /></div>
					<h1 className="text-2xl font-semibold tracking-tight">Starboard is unavailable</h1>
					<p className="text-sm leading-6 text-muted-foreground">{error}</p>
					<Button onClick={() => void loadAccount()}><RefreshCw className="size-4" /> Try again</Button>
				</div>
			);
		}
		return <SignInPage canConnectGithub={me?.canConnectGithub ?? false} error={error ?? authRedirectError} />;
	}
	if (!workspace) return <WorkspaceLoading />;

	const unreadCount = entries.filter((entry) => !entry.isRead).length;
	const githubProviderIds = new Set(providers.filter((provider) => provider.kind === "github").map((provider) => provider.id));
	const unreadGithubCount = entries.filter((entry) => !entry.isRead && githubProviderIds.has(entry.providerId)).length;
	const pinnedCount = entries.filter((entry) => entry.isPinned).length;
	const activeProvider = providers.find((provider) => provider.id === providerFilter);
	const githubProvider = providers.find((provider) => provider.kind === "github");
	const activeSyncProvider = activeProvider && (activeProvider.kind === "github" || activeProvider.kind === "tangled") ? activeProvider : undefined;
	const syncTarget = activeProvider ? activeSyncProvider : providers.find((provider) => (provider.kind === "github" || provider.kind === "tangled") && provider.connected);
	const syncingProvider = providers.find((provider) => provider.id === syncingProviderId);
	const lastSyncedAt = providers.map((provider) => provider.lastSyncedAt).filter((value): value is string => Boolean(value)).sort().at(-1);

	const handleViewChange = (value: string) => {
		const parsedView = entryViewSchema.safeParse(value);
		if (!parsedView.success) return;
		const targetRoute = workspaceRoute.kind === "collection" ? { kind: "all" as const } : workspaceRoute;
		navigateWorkspace(targetRoute, { view: parsedView.data === "all" ? undefined : parsedView.data, entry: undefined });
	};

	const handleSelectProvider = (providerId: string) => {
		navigateWorkspace(providerId === "all" ? { kind: "all" } : { kind: "provider", providerId }, { view: undefined, entry: undefined });
	};

	const handleSelectCollection = (collectionId: string) => {
		navigateWorkspace({ kind: "collection", collectionId }, { view: undefined, entry: undefined });
	};

	const handleSelectLibraryView = (nextView: "all" | "unread" | "pinned") => {
		navigateWorkspace({ kind: "all" }, { view: nextView === "all" ? undefined : nextView, entry: undefined });
	};

	const handleQueryChange = (nextQuery: string) => {
		navigateWorkspace(workspaceRoute, { q: nextQuery || undefined }, true);
	};

	const handleSortChange = (value: string) => {
		const parsedSort = repositorySortSchema.safeParse(value);
		if (parsedSort.success) setSortSelection(parsedSort.data);
	};

	const handleMinimumStarsChange = (value: string) => {
		const parsedMinimumStars = minimumStarsSchema.safeParse(value);
		if (parsedMinimumStars.success) setMinimumStars(parsedMinimumStars.data);
	};

	const handleLanguageFilterChange = (value: string) => {
		if (value === "all" || languageOptions.includes(value)) setLanguageFilter(value);
	};

	const clearRepositoryFilters = () => {
		setLanguageFilter("all");
		setMinimumStars("all");
	};

	const handleSelectEntry = (entryId: string) => {
		navigateWorkspace(workspaceRoute, { entry: entryId }, false, false);
	};

	return (
		<div className="min-h-svh bg-background text-foreground">
			<div className="mx-auto grid min-h-svh max-w-[1600px] grid-cols-1 lg:grid-cols-[252px_minmax(0,1fr)]">
				<aside className="sticky top-0 hidden h-svh flex-col border-r bg-sidebar px-4 py-5 lg:flex">
					<a className="mb-7 flex items-center gap-2.5 px-2 font-semibold tracking-tight" href="/">
						<span className="flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground"><Star className="size-4" fill="currentColor" /></span>
						<span className="text-[15px]">starboard</span>
					</a>
					<Button className="w-full justify-start gap-2" variant="outline" onClick={() => { setDialogError(null); setSourceDialogOpen(true); }}>
						<Plus className="size-4" /> Add source
					</Button>
					<div className="mt-8 space-y-1">
						<p className="px-2 pb-2 text-xs font-medium text-muted-foreground">Library</p>
						<SidebarButton active={!collectionFilter && providerFilter === "all" && view === "all"} icon={<Inbox className="size-4" />} label="All saves" count={entries.length} onClick={() => handleSelectLibraryView("all")} />
						<SidebarButton active={!collectionFilter && providerFilter === "all" && view === "unread"} icon={<Sparkles className="size-4" />} label="Unread" count={unreadCount} onClick={() => handleSelectLibraryView("unread")} />
						<SidebarButton active={!collectionFilter && providerFilter === "all" && view === "pinned"} icon={<Bookmark className="size-4" />} label="Pinned" count={pinnedCount} onClick={() => handleSelectLibraryView("pinned")} />
					</div>
					<div className="mt-8 space-y-1">
						<div className="flex items-center justify-between px-2 pb-2">
							<p className="text-xs font-medium text-muted-foreground">Sources</p>
							<Button variant="ghost" size="icon" className="size-7" aria-label="Add source" onClick={() => { setDialogError(null); setSourceDialogOpen(true); }}><Plus className="size-3.5" /></Button>
						</div>
						{providers.map((provider) => (
							<SidebarButton key={provider.id} active={providerFilter === provider.id} icon={<ProviderIcon provider={provider} />} label={provider.name} count={countEntriesForProvider(entries, provider.id)} onClick={() => handleSelectProvider(provider.id)} detail={provider.handle} />
						))}
						{providers.length === 0 && <p className="px-2 py-2 text-xs text-muted-foreground">No connected sources</p>}
					</div>
					<div className="mt-8 flex min-h-0 flex-1 flex-col">
						<div className="flex items-center justify-between px-2 pb-2">
							<p className="text-xs font-medium text-muted-foreground">Collections</p>
							<Button variant="ghost" size="icon" className="size-7" aria-label="Create collection" onClick={() => { setDialogError(null); setCollectionDialogOpen(true); }}><Plus className="size-3.5" /></Button>
						</div>
						<div className="space-y-1 overflow-y-auto">
							{customCollections.map((collection) => (
								<SidebarButton key={collection.id} active={collectionFilter === collection.id} icon={<CollectionIcon collection={collection} />} label={collection.name} count={entries.filter((entry) => collectionMatches(entry, collection)).length} onClick={() => handleSelectCollection(collection.id)} />
							))}
							{customCollections.length === 0 && <p className="px-2 py-2 text-xs leading-5 text-muted-foreground">Save a useful view as a collection.</p>}
						</div>
					</div>
					<Separator className="my-4" />
					<div className="flex items-center gap-3 px-2">
						<Avatar className="size-8">
							{me.account?.avatarUrl && <AvatarImage src={me.account.avatarUrl} alt="" />}
							<AvatarFallback>{initials(me.account?.displayName ?? me.account?.handle ?? "Starboard")}</AvatarFallback>
						</Avatar>
						<div className="min-w-0 flex-1">
							<p className="truncate text-sm font-medium">{me.account?.displayName ?? me.account?.handle}</p>
							<p className="truncate text-xs text-muted-foreground">@{me.account?.handle.replace(/^@/, "")}</p>
						</div>
						<Button variant="ghost" size="icon" className="size-8 shrink-0" aria-label="Sign out" onClick={() => void signOut()}><LogOut className="size-4" /></Button>
					</div>
				</aside>

				<div className="min-w-0">
					<header className="sticky top-0 z-20 flex h-16 items-center justify-between border-b bg-background/95 px-5 backdrop-blur sm:px-8">
						<div className="flex min-w-0 items-center gap-2 text-sm text-muted-foreground">
							<span className="font-medium text-foreground lg:hidden">starboard</span>
							<span className="hidden lg:inline">Workspace</span><ChevronRight className="hidden size-3.5 lg:inline" />
							<span className="truncate text-foreground">{selectedCollection?.name ?? activeProvider?.name ?? (view === "unread" ? "Unread" : view === "pinned" ? "Pinned" : "All saves")}</span>
						</div>
						<div className="flex items-center gap-2">
							<Button variant="outline" size="sm" className="hidden sm:inline-flex" onClick={() => { setDialogError(null); setSourceDialogOpen(true); }}><Plus className="size-4" /> Add source</Button>
							<Button variant="ghost" size="icon" className="size-9 sm:hidden" aria-label="Agent API tokens" onClick={() => void openApiTokenDialog()}><KeyRound className="size-4" /></Button>
							<Button variant="ghost" size="sm" className="hidden sm:inline-flex" onClick={() => void openApiTokenDialog()}><KeyRound className="size-4" /> Agent API</Button>
							<Button variant="ghost" size="icon" className="size-9" aria-label="Sign out" onClick={() => void signOut()}><LogOut className="size-4" /></Button>
							<Avatar className="size-8">
								{me.account?.avatarUrl && <AvatarImage src={me.account.avatarUrl} alt="" />}
								<AvatarFallback>{initials(me.account?.displayName ?? me.account?.handle ?? "Starboard")}</AvatarFallback>
							</Avatar>
						</div>
					</header>
					<main className="mx-auto max-w-[1380px] px-5 py-6 sm:px-8 lg:px-10 lg:py-8">
						<div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
							<div>
								<p className="mb-1 text-xs font-medium text-muted-foreground">Your library</p>
								<h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Starred repositories</h1>
								<p className="mt-1 text-sm text-muted-foreground">{entries.length.toLocaleString()} {entries.length === 1 ? "repository" : "repositories"} from your connected sources</p>
							</div>
							<Button variant="outline" onClick={() => syncTarget && void synchronize(syncTarget)} disabled={!syncTarget || Boolean(syncingProviderId)}>
								{syncingProviderId === syncTarget?.id ? <LoaderCircle className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
								{syncingProviderId ? "Syncing" : "Sync now"}
							</Button>
						</div>

						{error && <Alert variant="destructive" className="mt-6"><AlertTitle>Something needs attention</AlertTitle><AlertDescription>{error}</AlertDescription></Alert>}
						{syncNotice && !error && <p role="status" className="mt-4 text-sm text-muted-foreground">{syncNotice}</p>}
						{syncingProviderId && (
							<div className="mt-5 flex items-center gap-2 rounded-lg border bg-card px-4 py-3 text-sm text-muted-foreground" role="status" aria-live="polite">
								<LoaderCircle className="size-4 animate-spin text-primary" />
								Importing {syncingProvider?.name ?? "source"}{syncProgress > 0 ? ` · ${syncProgress.toLocaleString()} loaded so far` : "…"}
							</div>
						)}

						<div className="mt-5 flex flex-col gap-3 border-b pb-4 xl:flex-row xl:items-center xl:justify-between">
							<div className="flex flex-wrap items-center gap-3">
								<Tabs value={view} onValueChange={handleViewChange}>
									<TabsList variant="line">
										<TabsTrigger value="all">All <span className="ml-1 text-xs text-muted-foreground">{entries.length}</span></TabsTrigger>
										<TabsTrigger value="unread">Unread <span className="ml-1 text-xs text-muted-foreground">{unreadCount}</span></TabsTrigger>
										<TabsTrigger value="pinned">Pinned <span className="ml-1 text-xs text-muted-foreground">{pinnedCount}</span></TabsTrigger>
									</TabsList>
								</Tabs>
								{unreadGithubCount > 0 && <Button size="sm" variant="outline" onClick={() => void markAllGithubStarsAsRead()} disabled={markingGithubRead}>
									{markingGithubRead ? <LoaderCircle className="size-4 animate-spin" /> : <Check className="size-4" />}
									Mark GitHub stars read
								</Button>}
							</div>
							<div className="grid w-full grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:justify-end xl:w-auto">
								<div className="relative col-span-2 min-w-0 sm:w-64 sm:flex-1 xl:w-72 xl:flex-none">
									<Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
									<Input value={query} onChange={(event) => handleQueryChange(event.target.value)} placeholder="Search repositories and topics" aria-label="Search repositories" className="h-10 bg-card pl-9 pr-9" />
									{query && <Button className="absolute right-1 top-1 size-8" variant="ghost" size="icon" aria-label="Clear search" onClick={() => handleQueryChange("")}><X className="size-4" /></Button>}
								</div>
								<DropdownMenu>
									<DropdownMenuTrigger asChild>
										<Button variant="outline" className="col-span-2 justify-start sm:col-span-1" disabled={visibleEntries.length === 0}><Download className="size-4" /> Export <span className="ml-auto text-xs text-muted-foreground">{visibleEntries.length.toLocaleString()}</span></Button>
									</DropdownMenuTrigger>
									<DropdownMenuContent align="end">
										<DropdownMenuItem onSelect={() => downloadEntries(visibleEntries, "csv")}>CSV spreadsheet</DropdownMenuItem>
										<DropdownMenuItem onSelect={() => downloadEntries(visibleEntries, "json")}><FileJson className="size-4" /> JSON</DropdownMenuItem>
										<DropdownMenuItem onSelect={() => downloadEntries(visibleEntries, "md")}><FileText className="size-4" /> Markdown</DropdownMenuItem>
									</DropdownMenuContent>
								</DropdownMenu>
								<select aria-label="Sort repositories" value={effectiveSort} onChange={(event) => handleSortChange(event.currentTarget.value)} className="h-10 min-w-0 rounded-md border border-input bg-card px-3 text-sm text-foreground shadow-xs outline-none focus-visible:ring-2 focus-visible:ring-ring sm:w-40">
									<option value="relevance">Best match</option>
									<option value="most-stars">Most repo stars</option>
									<option value="recently-pushed">Recently pushed</option>
									<option value="recently-starred">Recently starred</option>
									<option value="name">Name, A to Z</option>
								</select>
								<select aria-label="Filter by language" value={languageFilter} onChange={(event) => handleLanguageFilterChange(event.currentTarget.value)} className="h-10 min-w-0 rounded-md border border-input bg-card px-3 text-sm text-foreground shadow-xs outline-none focus-visible:ring-2 focus-visible:ring-ring sm:w-40">
									<option value="all">Any language</option>
									{languageOptions.map((language) => <option key={language} value={language}>{language}</option>)}
								</select>
								<select aria-label="Filter by minimum repository stars" value={minimumStars} onChange={(event) => handleMinimumStarsChange(event.currentTarget.value)} className="h-10 min-w-0 rounded-md border border-input bg-card px-3 text-sm text-foreground shadow-xs outline-none focus-visible:ring-2 focus-visible:ring-ring sm:w-40">
									<option value="all">Any repo stars</option>
									<option value="10">10+ repo stars</option>
									<option value="100">100+ repo stars</option>
									<option value="1000">1k+ repo stars</option>
									<option value="10000">10k+ repo stars</option>
								</select>
								{hasRepositoryFilters && <Button variant="ghost" size="sm" className="col-span-2 sm:col-span-1" onClick={clearRepositoryFilters}>Clear filters</Button>}
							</div>
						</div>

						<div className="mt-4 flex flex-wrap items-center gap-2 lg:hidden">
							<Button size="sm" variant={providerFilter === "all" ? "secondary" : "ghost"} onClick={() => handleSelectProvider("all")}>All sources</Button>
							{providers.map((provider) => <Button key={provider.id} size="sm" variant={providerFilter === provider.id ? "secondary" : "ghost"} onClick={() => handleSelectProvider(provider.id)}><ProviderIcon provider={provider} />{provider.name}</Button>)}
						</div>

						<div className="mt-5 grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_340px]">
							<section aria-label="Repository results" className="min-w-0">
								<div className="mb-1 flex items-center justify-between gap-4">
									<h2 className="text-sm font-medium">{selectedCollection?.name ?? activeProvider?.name ?? "Repositories"}</h2>
									<span className="text-xs text-muted-foreground">{visibleEntries.length.toLocaleString()} results</span>
								</div>
								<Separator />
								{visibleEntries.length === 0 ? (
									<div className="flex min-h-64 flex-col items-center justify-center px-5 text-center">
										<div className="mb-4 flex size-11 items-center justify-center rounded-xl bg-secondary text-muted-foreground"><Search className="size-5" /></div>
										<h3 className="font-medium">{entries.length === 0 ? "Your library is ready" : "No repositories found"}</h3>
										<p className="mt-2 max-w-sm text-sm leading-6 text-muted-foreground">{entries.length === 0 ? "Sync GitHub to import your actual stars. Starboard will keep the list up to date." : "Try another search or clear the filters to see more of your library."}</p>
										{entries.length === 0 && githubProvider && <Button className="mt-5" onClick={() => void synchronize(githubProvider)} disabled={Boolean(syncingProviderId)}><RefreshCw className="size-4" /> Sync your stars</Button>}
									</div>
								) : (
									<VirtualizedRepositoryList entries={visibleEntries} selectedEntryId={selectedEntryId} savingEntryId={savingEntryId} onSelectEntry={handleSelectEntry} onTogglePinned={(entry) => void updateEntry(entry, { isPinned: !entry.isPinned })} />
								)}
								{lastSyncedAt && <p className="mt-5 flex items-center gap-2 text-xs text-muted-foreground"><Clock3 className="size-3.5" /> Last synced {formatRelative(lastSyncedAt)}</p>}
							</section>

							<aside className="min-w-0 xl:sticky xl:top-24">
								{selectedEntry ? (
									<RepositoryDetails entry={selectedEntry} saving={savingEntryId === selectedEntry.id} onToggleRead={() => void updateEntry(selectedEntry, { isRead: !selectedEntry.isRead })} onTogglePinned={() => void updateEntry(selectedEntry, { isPinned: !selectedEntry.isPinned })} />
								) : (
									<Card className="hidden border-dashed bg-transparent shadow-none xl:block">
										<CardContent className="flex min-h-64 flex-col items-center justify-center px-6 text-center">
											<div className="mb-3 flex size-10 items-center justify-center rounded-full bg-secondary"><ArrowDownToLine className="size-4 text-muted-foreground" /></div>
											<p className="text-sm font-medium">Select a repository</p>
											<p className="mt-1 max-w-52 text-xs leading-5 text-muted-foreground">Open a result to see its details and library actions.</p>
										</CardContent>
									</Card>
								)}
							</aside>
						</div>
					</main>
				</div>
			</div>

			<Dialog open={collectionDialogOpen} onOpenChange={setCollectionDialogOpen}>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>New collection</DialogTitle>
						<DialogDescription>Create a saved view for repositories you want to find again.</DialogDescription>
					</DialogHeader>
					<form className="space-y-4" onSubmit={(event) => void createCollection(event)}>
						<label className="grid gap-2 text-sm font-medium">Name<Input autoFocus value={collectionName} onChange={(event) => setCollectionName(event.target.value)} placeholder="For later" maxLength={60} /></label>
						<label className="grid gap-2 text-sm font-medium">Description <Input value={collectionDescription} onChange={(event) => setCollectionDescription(event.target.value)} placeholder="A short note (optional)" maxLength={140} /></label>
						{dialogError && <p className="text-sm text-destructive">{dialogError}</p>}
						<DialogFooter><Button type="submit" disabled={creatingCollection}>{creatingCollection && <LoaderCircle className="size-4 animate-spin" />}Create collection</Button></DialogFooter>
					</form>
				</DialogContent>
			</Dialog>

			<Dialog open={sourceDialogOpen} onOpenChange={setSourceDialogOpen}>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>Connected sources</DialogTitle>
						<DialogDescription>Each source stays linked to your Starboard account.</DialogDescription>
					</DialogHeader>
					<div className="space-y-4">
						<div className="flex items-start justify-between gap-4 rounded-lg border p-4">
							<div className="flex min-w-0 gap-3"><span className="mt-0.5"><Github className="size-5" /></span><div><p className="font-medium">GitHub</p><p className="mt-1 text-sm text-muted-foreground">{githubProvider ? `Connected as ${githubProvider.handle}` : "Import starred repositories from your GitHub account."}</p></div></div>
							{githubProvider ? <Badge variant="secondary" className="shrink-0">Connected</Badge> : <Button size="sm" onClick={() => window.location.assign(providerAuthUrl())}>Connect</Button>}
						</div>
						<form className="space-y-3 rounded-lg border p-4" onSubmit={(event) => void connectTangled(event)}>
							<div className="flex gap-3"><GitBranch className="mt-0.5 size-5 shrink-0" /><div><p className="font-medium">Tangled</p><p className="mt-1 text-sm text-muted-foreground">Add a public handle to import its public stars.</p></div></div>
							<div className="flex gap-2"><Input value={tangledHandle} onChange={(event) => setTangledHandle(event.target.value)} placeholder="name.tangled.org" aria-label="Tangled handle" /><Button type="submit" disabled={connectingTangled}>{connectingTangled ? <LoaderCircle className="size-4 animate-spin" /> : "Add"}</Button></div>
							{dialogError && <p className="text-sm text-destructive">{dialogError}</p>}
						</form>
					</div>
				</DialogContent>
			</Dialog>

			<Dialog open={apiTokenDialogOpen} onOpenChange={(open) => {
				setApiTokenDialogOpen(open);
				if (!open) {
					setCreatedApiToken(null);
					setApiTokenCopied(false);
					setApiTokenError(null);
				}
			}}>
				<DialogContent className="max-h-[85svh] overflow-y-auto sm:max-w-xl">
					<DialogHeader>
						<DialogTitle>Agent API access</DialogTitle>
						<DialogDescription>Create read-only tokens so agents can search and read your Starboard library.</DialogDescription>
					</DialogHeader>
					<div className="space-y-4">
						<div className="rounded-lg border bg-muted/30 p-4 text-sm">
							<p className="font-medium">API v1 · read only</p>
							<p className="mt-1 text-muted-foreground">Tokens expire after one year. Store token in your agent’s secret settings. Each token is shown once and can be revoked here.</p>
							<pre className="mt-3 overflow-x-auto rounded-md bg-background px-3 py-2 text-xs"><code>{`curl -H 'Authorization: Bearer $STARBOARD_API_TOKEN' \\\n  '${window.location.origin}/api/v1/entries?q=panda&sort=most-stars&minStars=100'`}</code></pre>
						</div>
						{createdApiToken && <div className="space-y-3 rounded-lg border border-primary/50 bg-primary/5 p-4" role="status">
							<p className="text-sm font-medium">Copy this token now. Starboard won’t show it again.</p>
							<code className="block max-h-24 overflow-auto break-all rounded-md bg-background p-3 font-mono text-xs">{createdApiToken.token}</code>
							<Button size="sm" variant="outline" onClick={() => void copyCreatedApiToken()}>{apiTokenCopied ? <Check className="size-4" /> : <Copy className="size-4" />}{apiTokenCopied ? "Copied" : "Copy token"}</Button>
						</div>}
						<form className="flex flex-col gap-2 sm:flex-row" onSubmit={(event) => void createApiToken(event)}>
							<Input value={apiTokenName} onChange={(event) => setApiTokenName(event.target.value)} placeholder="Token name, e.g. Claude Desktop" aria-label="API token name" maxLength={60} />
							<Button type="submit" disabled={apiTokenBusy === "create"}>{apiTokenBusy === "create" && <LoaderCircle className="size-4 animate-spin" />}Create token</Button>
						</form>
						{apiTokenError && <p role="alert" className="text-sm text-destructive">{apiTokenError}</p>}
						<div className="space-y-2">
							<p className="text-sm font-medium">Your tokens</p>
							{apiTokenLoading ? <p className="text-sm text-muted-foreground">Loading tokens…</p> : apiTokens.length === 0 ? <p className="text-sm text-muted-foreground">No API tokens yet.</p> : apiTokens.map((token) => {
								const expired = Date.parse(token.expiresAt) <= Date.now();
								const inactive = Boolean(token.revokedAt) || expired;
								return <div key={token.id} className="flex items-center gap-3 rounded-lg border px-3 py-3">
									<div className="min-w-0 flex-1">
										<p className="truncate text-sm font-medium">{token.name}<span className="ml-2 text-xs font-normal text-muted-foreground">{inactive ? token.revokedAt ? "Revoked" : "Expired" : "Active"}</span></p>
										<p className="mt-1 truncate font-mono text-xs text-muted-foreground">{token.prefix}</p>
										<p className="mt-1 text-xs text-muted-foreground">Expires {formatDate(token.expiresAt)}{token.lastUsedAt ? ` · Used ${formatRelative(token.lastUsedAt)}` : " · Never used"}</p>
									</div>
									{!inactive && <Button variant="ghost" size="icon" aria-label={`Revoke ${token.name}`} disabled={apiTokenBusy === token.id} onClick={() => void revokeApiToken(token.id)}>
										{apiTokenBusy === token.id ? <LoaderCircle className="size-4 animate-spin" /> : <Trash2 className="size-4" />}
									</Button>}
								</div>;
							})}
						</div>
					</div>
				</DialogContent>
			</Dialog>
		</div>
	);
}

function SidebarButton({ active, icon, label, count, onClick, detail }: { active: boolean; icon: ReactNode; label: string; count: number; onClick: () => void; detail?: string }) {
	return (
		<button type="button" onClick={onClick} className={cn("flex min-h-9 w-full items-center gap-2.5 rounded-md px-2 text-left text-sm transition-colors hover:bg-accent hover:text-accent-foreground", active && "bg-accent font-medium text-accent-foreground")}>
			<span className="text-muted-foreground">{icon}</span>
			<span className="min-w-0 flex-1 truncate">{label}{detail && <span className="ml-1 text-xs font-normal text-muted-foreground">{detail}</span>}</span>
			<span className="text-xs tabular-nums text-muted-foreground">{count.toLocaleString()}</span>
		</button>
	);
}

function RepositoryRow({ entry, selected, saving, onSelect, onTogglePinned }: { entry: Entry; selected: boolean; saving: boolean; onSelect: () => void; onTogglePinned: () => void }) {
	return (
		<div className={cn("flex min-w-0 items-center gap-3 px-2 py-2.5 transition-colors sm:px-3", selected && "bg-card", "hover:bg-card/70")}>
			<button type="button" onClick={onSelect} className="min-w-0 flex-1 text-left">
				<div className="flex min-w-0 items-center gap-2">
					<Code2 className="size-4 shrink-0 text-muted-foreground" />
					<h3 className="truncate font-medium tracking-tight">{entry.title}</h3>
					{!entry.isRead && <Badge variant="secondary" className="shrink-0 px-1.5 py-0 text-[10px]">New</Badge>}
				</div>
				<div className="mt-1 flex min-w-0 items-center gap-2">
					<p className="min-w-0 flex-1 truncate text-sm leading-5 text-muted-foreground">{entry.summary}</p>
					<div className="hidden shrink-0 items-center gap-1.5 md:flex">
						{entry.tags.slice(0, 2).map((tag) => <Badge key={tag} variant="outline" className="rounded-md px-1.5 py-0 font-normal text-muted-foreground">{tag}</Badge>)}
						{entry.tags.length > 2 && <span className="text-xs text-muted-foreground">+{entry.tags.length - 2}</span>}
					</div>
				</div>
			</button>
			<div className="flex shrink-0 items-center gap-2 text-xs text-muted-foreground">
				<span className="inline-flex items-center gap-1.5 tabular-nums" aria-label={entry.stars === undefined ? "Repository popularity unavailable" : `${entry.stars.toLocaleString()} GitHub stars on ${entry.title}`}><Star className="size-3.5" />{formatNumber(entry.stars)}</span>
				{entry.language && <span className="hidden max-w-24 truncate sm:inline" title={entry.language}>{entry.language}</span>}
				<Button variant="ghost" size="icon" className="size-8" aria-label={entry.isPinned ? "Unpin repository" : "Pin repository"} aria-pressed={entry.isPinned} onClick={onTogglePinned} disabled={saving}>
					{entry.isPinned ? <BookmarkCheck className="size-4 text-primary" /> : <Bookmark className="size-4" />}
				</Button>
			</div>
		</div>
	);
}

type VirtualizedRepositoryListProps = {
	entries: Entry[];
	selectedEntryId: string | null;
	savingEntryId: string | null;
	onSelectEntry: (entryId: string) => void;
	onTogglePinned: (entry: Entry) => void;
};

function VirtualizedRepositoryList({ entries, selectedEntryId, savingEntryId, onSelectEntry, onTogglePinned }: VirtualizedRepositoryListProps) {
	const listRef = useRef<HTMLDivElement>(null);
	const [scrollMargin, setScrollMargin] = useState(0);
	const updateScrollMargin = useCallback(() => {
		const list = listRef.current;
		if (!list) return;
		const nextScrollMargin = list.getBoundingClientRect().top + window.scrollY;
		setScrollMargin((current) => current === nextScrollMargin ? current : nextScrollMargin);
	}, []);
	const virtualizer = useWindowVirtualizer({
		count: entries.length,
		estimateSize: () => 72,
		getItemKey: (index) => entries[index]?.id ?? index,
		overscan: 8,
		scrollMargin,
		directDomUpdates: true,
		useFlushSync: false,
	});

	useLayoutEffect(() => {
		updateScrollMargin();
	});

	useEffect(() => {
		window.addEventListener("resize", updateScrollMargin);
		return () => window.removeEventListener("resize", updateScrollMargin);
	}, [updateScrollMargin]);

	return (
		<div ref={listRef}>
			<div ref={virtualizer.containerRef} role="list" aria-label="Repository results" className="relative w-full">
				{virtualizer.getVirtualItems().map((virtualRow) => {
					const entry = entries[virtualRow.index];
					if (!entry) return null;
					return (
						<div
							key={virtualRow.key}
							ref={virtualizer.measureElement}
							data-index={virtualRow.index}
							role="listitem"
							aria-setsize={entries.length}
							aria-posinset={virtualRow.index + 1}
							className={virtualRow.index < entries.length - 1 ? "border-b" : ""}
							style={{ position: "absolute", top: 0, left: 0, width: "100%" }}
						>
							<RepositoryRow
								entry={entry}
								selected={entry.id === selectedEntryId}
								saving={savingEntryId === entry.id}
								onSelect={() => onSelectEntry(entry.id)}
								onTogglePinned={() => onTogglePinned(entry)}
							/>
						</div>
					);
				})}
			</div>
		</div>
	);
}

function RepositoryDetails({ entry, saving, onToggleRead, onTogglePinned }: { entry: Entry; saving: boolean; onToggleRead: () => void; onTogglePinned: () => void }) {
	const [repositoryMetadata, setRepositoryMetadata] = useState<EntryMetadataResponse | null>(null);
	const supportsGithubMetadata = entry.externalId !== undefined && entry.url.startsWith("https://github.com/");
	useEffect(() => {
		let active = true;
		let timeoutId: number | undefined;
		let attempts = 0;
		setRepositoryMetadata(null);
		if (!supportsGithubMetadata) return () => { active = false; };
		const loadMetadata = async () => {
			try {
				const response = await fetchRemoteEntryMetadata(entry.id);
				if (!active) return;
				setRepositoryMetadata(response);
				if (response.refreshing && attempts < 3) {
					attempts += 1;
					timeoutId = window.setTimeout(() => void loadMetadata(), attempts * 1_000);
				}
			} catch {
				if (active) setRepositoryMetadata({ refreshing: false });
			}
		};
		void loadMetadata();
		return () => {
			active = false;
			if (timeoutId !== undefined) window.clearTimeout(timeoutId);
		};
	}, [entry.id, supportsGithubMetadata]);
	const metadata = repositoryMetadata?.metadata;
	const lastActivity = metadata?.pushedAt ?? (typeof entry.fields?.pushedAt === "string" ? entry.fields.pushedAt : undefined);
	return (
		<Card className="overflow-hidden shadow-sm">
			<CardHeader className="gap-4 pb-4">
				<div className="flex items-start justify-between gap-4">
					<div className="flex size-10 items-center justify-center rounded-lg bg-secondary"><Github className="size-5" /></div>
					<Badge variant="outline" className="shrink-0 font-normal text-muted-foreground">GitHub</Badge>
				</div>
				<div className="min-w-0 space-y-1.5">
					<CardTitle className="break-words text-xl tracking-tight">{metadata?.title ?? entry.title}</CardTitle>
					<CardDescription>{metadata?.authorHandle ?? entry.authorHandle}</CardDescription>
				</div>
			</CardHeader>
			<CardContent className="space-y-5">
				<p className="text-sm leading-6 text-muted-foreground">{metadata?.summary ?? entry.summary}</p>
				<div className="grid grid-cols-2 gap-3 rounded-lg bg-muted/60 p-3 text-sm">
					<div><p className="text-xs text-muted-foreground">Repository stars</p><p className="mt-1 flex items-center gap-1.5 font-medium"><Star className="size-3.5" />{metadata?.stars.toLocaleString() ?? entry.stars?.toLocaleString() ?? "—"}</p></div>
					<div><p className="text-xs text-muted-foreground">Language</p><p className="mt-1 font-medium">{metadata?.language ?? entry.language ?? "Not specified"}</p></div>
					<div><p className="text-xs text-muted-foreground">Starred by you</p><p className="mt-1 font-medium">{formatDate(entry.starredAt)}</p></div>
					<div><p className="text-xs text-muted-foreground">Last updated</p><p className="mt-1 font-medium">{formatRelative(metadata?.updatedAt ?? entry.updatedAt)}</p></div>
					<div><p className="text-xs text-muted-foreground">Last activity</p><p className="mt-1 font-medium">{lastActivity ? formatRelative(lastActivity) : "Not available"}</p></div>
				</div>
				{supportsGithubMetadata && <div className="rounded-lg border p-3">
					<p className="text-xs font-medium text-muted-foreground">Latest commit</p>
					{repositoryMetadata?.latestCommit ? <a className="mt-1 block text-sm font-medium hover:underline" href={repositoryMetadata.latestCommit.url} target="_blank" rel="noreferrer">{repositoryMetadata.latestCommit.message.split("\n")[0]}<span className="ml-2 text-xs font-normal text-muted-foreground">{repositoryMetadata.latestCommit.committedAt ? formatRelative(repositoryMetadata.latestCommit.committedAt) : "date unavailable"}</span></a> : repositoryMetadata?.latestCommitFetchedAt ? <p className="mt-1 text-sm text-muted-foreground">No commits found.</p> : repositoryMetadata?.refreshing || !repositoryMetadata ? <p className="mt-1 flex items-center gap-2 text-sm text-muted-foreground"><LoaderCircle className="size-3.5 animate-spin" /> Fetching shared repository details…</p> : <p className="mt-1 text-sm text-muted-foreground">Latest commit is unavailable right now.</p>}
				</div>}
				{entry.tags.length > 0 && <div className="flex flex-wrap gap-1.5">{entry.tags.map((tag) => <Badge key={tag} variant="secondary" className="font-normal">{tag}</Badge>)}</div>}
				<div className="flex flex-wrap gap-2">
					<Button size="sm" variant="secondary" onClick={onToggleRead} disabled={saving}><Check className="size-4" />{entry.isRead ? "Mark unread" : "Mark read"}</Button>
					<Button size="sm" variant="outline" onClick={onTogglePinned} disabled={saving}>{entry.isPinned ? <BookmarkCheck className="size-4" /> : <Bookmark className="size-4" />}{entry.isPinned ? "Pinned" : "Pin"}</Button>
				</div>
				<Separator />
				<a className="inline-flex items-center gap-2 text-sm font-medium hover:underline" href={metadata?.url ?? entry.url} target="_blank" rel="noreferrer">
					Open on GitHub <ArrowUpRight className="size-4" />
				</a>
			</CardContent>
		</Card>
	);
}

export default App;

import {
	ArrowUpRight,
	Bookmark,
	BrainCircuit,
	CalendarDays,
	Check,
	ChevronDown,
	Circle,
	CircleCheck,
	Command,
	Database,
	ExternalLink,
	GitBranch,
	GitFork,
	Github,
	Inbox,
	Layers3,
	Link2,
	LoaderCircle,
	Plus,
	RefreshCw,
	Search,
	Settings2,
	Sparkles,
	Star,
	Tag,
	UserRound,
	Workflow,
	X,
	type LucideIcon,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState, type CSSProperties, type FormEvent, type ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { createBackfillEntries, defaultCollections, defaultProviders, schemaPresets } from "@/lib/mock-data";
import { collectionMatches, searchEntries } from "@/lib/search";
import { enqueueMutation } from "@/lib/local-cache";
import { connectRemoteTangled, createRemoteAutomation, createRemoteCollection, createRemoteProvider, deleteRemoteAutomation, fetchRemoteSearch, fetchRemoteWorkspace, flushOutbox, hasRemoteApi, patchRemoteEntry, providerAuthUrl, syncRemoteProvider, updateRemoteAutomation, updateRemoteProvider } from "@/lib/api-client";
import { hydrateWorkspace, loadWorkspace, saveWorkspace } from "@/lib/storage";
import type { WorkspaceResponse } from "@/lib/api-contract";
import type {
	Collection,
	CollectionRule,
	Entry,
	EntryKind,
	Automation,
	AutomationAction,
	AutomationTrigger,
	PluginManifest,
	Provider,
	SearchMode,
	WorkspaceSnapshot,
} from "@/lib/types";
import { cn, formatDate, formatNumber, formatRelative, initials, providerLabel, slugify } from "@/lib/utils";

const collectionIconMap: Record<Collection["icon"], LucideIcon> = {
	inbox: Inbox,
	sparkles: Sparkles,
	bookmark: Bookmark,
	github: Github,
	branch: GitBranch,
	layers: Layers3,
};

const modeLabels: Record<SearchMode, { label: string; detail: string }> = {
	hybrid: { label: "Hybrid", detail: "fuzzy + semantic" },
	fuzzy: { label: "Fuzzy", detail: "exactly what you typed" },
	semantic: { label: "Semantic", detail: "meaning and context" },
};

const accentPalette = ["#8b7cff", "#54c7a8", "#f28a6b", "#d18df2", "#f6c453"];

function iconForProvider(provider: Provider | undefined): LucideIcon {
	if (provider?.kind === "github") return Github;
	if (provider?.kind === "tangled") return GitBranch;
	if (provider?.schema.icon === "bookmark") return Bookmark;
	if (provider?.schema.icon === "rss") return Link2;
	return Circle;
}

function ProviderIcon({ provider, size = 15 }: { provider?: Provider; size?: number }) {
	const Icon = iconForProvider(provider);
	return <Icon size={size} strokeWidth={1.8} />;
}

function CollectionIcon({ collection, size = 15 }: { collection: Collection; size?: number }) {
	const Icon = collectionIconMap[collection.icon];
	return <Icon size={size} strokeWidth={1.8} />;
}

function SidebarItem({
	active,
	count,
	icon: Icon,
	label,
	onClick,
	accent,
}: {
	active: boolean;
	count: number;
	icon: LucideIcon;
	label: string;
	onClick: () => void;
	accent?: string;
}) {
	return (
		<button className={cn("sidebar-item", active && "is-active")} onClick={onClick}>
			<span className="sidebar-item-icon" style={accent ? { color: accent } : undefined}>
				<Icon size={15} strokeWidth={1.8} />
			</span>
			<span className="sidebar-item-label">{label}</span>
			<span className="sidebar-item-count">{count}</span>
		</button>
	);
}

function SourcePill({ provider }: { provider?: Provider }) {
	return (
		<span className="source-pill" style={{ "--source-accent": provider?.accent ?? "var(--muted)" } as CSSProperties}>
			<ProviderIcon provider={provider} size={13} />
			{providerLabel(provider)}
		</span>
	);
}

function EntryCard({
	entry,
	provider,
	selected,
	labels,
	onSelect,
	 onTogglePinned,
}: {
	entry: Entry;
	provider?: Provider;
	selected: boolean;
	labels: string[];
	onSelect: () => void;
	onTogglePinned: () => void;
}) {
	return (
		<article className={cn("entry-card", selected && "is-selected", !entry.isRead && "is-unread")} onClick={onSelect}>
			<div className="entry-card-topline">
				<div className="entry-source-line">
					<SourcePill provider={provider} />
					<span className="entry-separator">·</span>
					<span>starred {formatRelative(entry.starredAt)}</span>
					{!entry.isRead && <span className="unread-label">New</span>}
				</div>
				<button
					className={cn("icon-button pin-button", entry.isPinned && "is-pinned")}
					onClick={(event) => {
						event.stopPropagation();
						onTogglePinned();
					}}
					aria-label={entry.isPinned ? "Unpin entry" : "Pin entry"}
					title={entry.isPinned ? "Unpin" : "Pin"}
				>
					<Bookmark size={15} strokeWidth={1.8} fill={entry.isPinned ? "currentColor" : "none"} />
				</button>
			</div>
			<div className="entry-title-row">
				<div className="entry-title-wrap">
					<span className="entry-kind-mark">
						{entry.kind === "repository" ? <Database size={16} /> : <Link2 size={16} />}
					</span>
					<h3>{entry.title}</h3>
				</div>
				<a
					className="entry-open-link"
					href={entry.url}
					target="_blank"
					rel="noreferrer"
					onClick={(event) => event.stopPropagation()}
					aria-label={`Open ${entry.title}`}
				>
					<ArrowUpRight size={17} strokeWidth={1.8} />
				</a>
			</div>
			<p className="entry-summary">{entry.summary}</p>
			<div className="entry-tag-row">
				{entry.tags.slice(0, 4).map((tag) => (
					<span className="tag-chip" key={tag}>
						{tag}
					</span>
				))}
				{entry.tags.length > 4 && <span className="tag-more">+{entry.tags.length - 4}</span>}
			</div>
			<div className="entry-card-footer">
				<div className="entry-author">
					<span className="author-avatar">{initials(entry.author)}</span>
					<span>{entry.authorHandle}</span>
				</div>
				<div className="entry-metrics">
					{entry.language && (
						<span>
							<span className="language-dot" style={{ background: entry.languageColor }} />
							{entry.language}
						</span>
					)}
					{entry.stars !== undefined && (
						<span>
							<Star size={13} /> {formatNumber(entry.stars)}
						</span>
					)}
					{labels.length > 0 && <span className="collection-match-hint">{labels[0]}</span>}
				</div>
			</div>
		</article>
	);
}

function EntryDetail({
	entry,
	provider,
	collections,
	onClose,
	onToggleRead,
	onTogglePinned,
	onAddTag,
	onRemoveTag,
}: {
	entry?: Entry;
	provider?: Provider;
	collections: Collection[];
	onClose: () => void;
	onToggleRead: () => void;
	onTogglePinned: () => void;
	onAddTag: () => void;
	onRemoveTag: (tag: string) => void;
}) {
	if (!entry) {
		return (
			<aside className="detail-panel detail-empty">
				<div className="detail-empty-icon">
					<Layers3 size={22} />
				</div>
				<h2>Pick something to inspect</h2>
				<p>Search across every connected source, then use this space to see the full record and its organization.</p>
				<div className="detail-empty-tip">
					<Command size={14} />
					<span>Press ⌘ K to jump back to search</span>
				</div>
			</aside>
		);
	}

	const matchingCollections = collections.filter((collection) => collectionMatches(entry, collection));

	return (
		<aside className="detail-panel">
			<div className="detail-panel-topline">
				<SourcePill provider={provider} />
				<button className="icon-button detail-close" onClick={onClose} aria-label="Close details" title="Close details">
					<X size={16} />
				</button>
			</div>
			<div className="detail-heading-mark" style={{ color: provider?.accent }}>
				<ProviderIcon provider={provider} size={24} />
			</div>
			<h2 className="detail-title">{entry.title}</h2>
			<p className="detail-summary">{entry.summary}</p>
			<div className="detail-actions">
				<Button variant={entry.isRead ? "outline" : "secondary"} size="sm" onClick={onToggleRead}>
					{entry.isRead ? <CircleCheck size={14} /> : <Circle size={14} />}
					{entry.isRead ? "Read" : "Mark read"}
				</Button>
				<Button variant={entry.isPinned ? "default" : "outline"} size="sm" onClick={onTogglePinned}>
					<Bookmark size={14} fill={entry.isPinned ? "currentColor" : "none"} />
					{entry.isPinned ? "Pinned" : "Pin"}
				</Button>
				<a className="detail-external-action" href={entry.url} target="_blank" rel="noreferrer">
					<ExternalLink size={14} />
					Open
				</a>
			</div>
			{entry.classification?.topics.length ? (
				<div className="detail-section detail-classification">
					<div className="detail-section-heading"><span>Suggested topics</span><span className="classification-source">{entry.classification.model ?? "classifier"}{entry.classification.confidence !== undefined ? ` · ${Math.round(entry.classification.confidence * 100)}%` : ""}</span></div>
					<div className="detail-topic-list">{entry.classification.topics.map((topic) => <span className="detail-topic" key={topic}><Sparkles size={11} /> {topic}</span>)}</div>
				</div>
			) : null}

			<div className="detail-section">
				<div className="detail-section-heading">
					<span>Collections</span>
					<span className="detail-section-count">{matchingCollections.length}</span>
				</div>
				<div className="detail-collection-list">
					{matchingCollections.map((collection) => (
						<span className="detail-collection" key={collection.id} style={{ "--collection-color": collection.color } as CSSProperties}>
							<CollectionIcon collection={collection} size={13} />
							{collection.name}
						</span>
					))}
					{matchingCollections.length === 0 && <span className="detail-muted">No saved view matches yet.</span>}
				</div>
			</div>

			<div className="detail-section">
				<div className="detail-section-heading">
					<span>Tags</span>
					<button className="detail-add-button" onClick={onAddTag}>
						<Plus size={13} /> Add
					</button>
				</div>
				<div className="detail-tag-list">
					{entry.tags.map((tag) => (
						<button className="detail-tag" key={tag} onClick={() => onRemoveTag(tag)} title={`Remove ${tag}`}>
							<Tag size={12} /> {tag} <X size={11} />
						</button>
					))}
				</div>
			</div>

			<div className="detail-section detail-fields-section">
				<div className="detail-section-heading">Record fields</div>
				<div className="detail-fields">
					<DetailField icon={UserRound} label="Author" value={`${entry.author} · ${entry.authorHandle}`} />
					<DetailField icon={CalendarDays} label="Starred" value={formatDate(entry.starredAt)} />
					<DetailField icon={RefreshCw} label="Updated" value={formatRelative(entry.updatedAt)} />
					{entry.language && <DetailField icon={Database} label="Language" value={entry.language} />}
					{entry.forks !== undefined && <DetailField icon={GitFork} label="Forks" value={formatNumber(entry.forks)} />}
					{Object.entries(entry.fields ?? {}).map(([key, value]) => <DetailField icon={Layers3} label={key} value={formatRecordValue(value)} key={key} />)}
				</div>
			</div>
			<div className="detail-url-row">
				<Link2 size={13} />
				<a href={entry.url} target="_blank" rel="noreferrer">
					{entry.url.replace(/^https?:\/\//, "")}
				</a>
			</div>
		</aside>
	);
}

function DetailField({ icon: Icon, label, value }: { icon: LucideIcon; label: string; value: string }) {
	return (
		<div className="detail-field">
			<span className="detail-field-icon">
				<Icon size={14} />
			</span>
			<span className="detail-field-label">{label}</span>
			<span className="detail-field-value">{value}</span>
		</div>
	);
}

function formatRecordValue(value: unknown): string {
	if (value === null || value === undefined || value === "") return "—";
	if (typeof value === "string") return value;
	if (typeof value === "number" || typeof value === "boolean") return String(value);
	try {
		return JSON.stringify(value);
	} catch {
		return "—";
	}
}

function AutomationPanel({ enabled, automations, onToggle, onConfigure, onToggleAutomation, onDelete }: { enabled: boolean; automations: Automation[]; onToggle: () => void; onConfigure: () => void; onToggleAutomation: (id: string) => void; onDelete: (id: string) => void }) {
	return (
		<div className="automation-panel">
			<div className="automation-panel-header">
				<div className="automation-title-wrap">
					<span className="automation-icon">
						<BrainCircuit size={16} />
					</span>
					<div>
						<strong>Local classifier</strong>
						<span>optional enrichment hook</span>
					</div>
				</div>
				<button className={cn("switch", enabled && "is-on")} onClick={onToggle} aria-label="Toggle local classifier">
					<span />
				</button>
			</div>
			<p className="automation-copy">
				Suggest up to three tags when a new star arrives. Nothing is changed without a reviewable action.
			</p>
			<div className="automation-rule">
				<span className="automation-rule-dot" />
				<span>on <strong>entry.created</strong></span>
				<ArrowUpRight size={13} />
				<span>suggest tags</span>
			</div>
			{automations.length > 0 && (
				<div className="automation-list">
					{automations.map((automation) => (
						<div className="automation-list-item" key={automation.id}>
							<div><strong>{automation.name}</strong><span>{automation.trigger} · {automation.action}</span></div>
							<div className="automation-list-actions">
								<button className={cn("switch switch-small", automation.enabled && "is-on")} onClick={() => onToggleAutomation(automation.id)} aria-label={`${automation.enabled ? "Disable" : "Enable"} ${automation.name}`}><span /></button>
								<button className="automation-delete" onClick={() => onDelete(automation.id)} aria-label={`Delete ${automation.name}`}><X size={13} /></button>
							</div>
						</div>
					))}
				</div>
			)}
			<div className="automation-footer">
				<span><ZapIcon /> {automations.length > 0 ? `${automations.filter((automation) => automation.enabled).length} enabled` : "runs locally first"}</span>
				<button onClick={onConfigure}>{automations.length > 0 ? "Manage hooks" : "Configure hooks"}</button>
			</div>
		</div>
	);
}

function ZapIcon() {
	return <Sparkles size={12} />;
}

function AutomationDialog({ open, onClose, onCreate }: { open: boolean; onClose: () => void; onCreate: (automation: Automation) => void }) {
	const [name, setName] = useState("");
	const [trigger, setTrigger] = useState<AutomationTrigger>("entry.created");
	const [action, setAction] = useState<AutomationAction>("tag");
	const [value, setValue] = useState("");

	useEffect(() => {
		if (!open) return;
		setName("");
		setTrigger("entry.created");
		setAction("tag");
		setValue("");
	}, [open]);

	const submit = (event: FormEvent<HTMLFormElement>) => {
		event.preventDefault();
		if (!name.trim()) return;
		const now = new Date().toISOString();
		const config: Automation["config"] = action === "tag" ? { tag: value.trim() || "review" } : action === "webhook" ? { url: value.trim() } : {};
		onCreate({ id: `${slugify(name)}-${Date.now()}`, name: name.trim(), description: action === "classify" ? "Suggest topics with the configured classifier." : "A rule over your source library.", trigger, action, config, enabled: true, createdAt: now, updatedAt: now });
	};

	return (
		<ModalShell open={open} onClose={onClose} eyebrow="Automations" title="Configure a hook">
			<form className="automation-form" onSubmit={submit}>
				<p className="modal-intro">Rules stay explicit and reviewable. They can tag new entries, ask an optional classifier for suggestions, or call an HTTPS webhook.</p>
				<label><span>Name</span><Input value={name} onChange={(event) => setName(event.target.value)} placeholder="Mark AI tools for review" autoFocus /></label>
				<div className="form-two-column">
					<label><span>When</span><div className="select-wrap"><select value={trigger} onChange={(event) => setTrigger(event.target.value as AutomationTrigger)}><option value="entry.created">A new entry arrives</option><option value="sync.completed">A source finishes syncing</option><option value="manual">I run it manually</option></select><ChevronDown size={15} /></div></label>
					<label><span>Do</span><div className="select-wrap"><select value={action} onChange={(event) => setAction(event.target.value as AutomationAction)}><option value="tag">Add a tag</option><option value="classify">Suggest topics</option><option value="webhook">Call a webhook</option></select><ChevronDown size={15} /></div></label>
				</div>
				{action !== "classify" && <label><span>{action === "tag" ? "Tag" : "HTTPS webhook URL"}</span><Input value={value} onChange={(event) => setValue(event.target.value)} placeholder={action === "tag" ? "review" : "https://hooks.example.com/starboard"} /></label>}
				<div className="modal-actions"><Button type="button" variant="ghost" onClick={onClose}>Cancel</Button><Button type="submit" disabled={!name.trim() || action === "webhook" && !value.trim()}><Plus size={15} /> Save hook</Button></div>
			</form>
		</ModalShell>
	);
}

function ModalShell({
	open,
	title,
	eyebrow,
	onClose,
	children,
}: {
	open: boolean;
	title: string;
	eyebrow: string;
	onClose: () => void;
	children: ReactNode;
}) {
	if (!open) return null;
	return (
		<div className="modal-backdrop" onMouseDown={onClose}>
			<section className="modal-card" onMouseDown={(event) => event.stopPropagation()}>
				<div className="modal-header">
					<div>
						<span className="eyebrow">{eyebrow}</span>
						<h2>{title}</h2>
					</div>
					<button className="icon-button" onClick={onClose} aria-label="Close dialog">
						<X size={17} />
					</button>
				</div>
				{children}
			</section>
		</div>
	);
}

function ProviderDialog({
	open,
	providers,
	onClose,
	onConnect,
	onDisconnect,
	onCreate,
}: {
	open: boolean;
	providers: Provider[];
	onClose: () => void;
	onConnect: (providerId: string) => void;
	onDisconnect: (providerId: string) => void;
	onCreate: (name: string, handle: string, schemaId: string) => void;
}) {
	const [name, setName] = useState("");
	const [handle, setHandle] = useState("");
	const [schemaId, setSchemaId] = useState(schemaPresets[2]!.id);
	const selectedSchema = schemaPresets.find((schema) => schema.id === schemaId) ?? schemaPresets[2]!;

	useEffect(() => {
		if (!open) return;
		setName("");
		setHandle("");
		setSchemaId(schemaPresets[2]!.id);
	}, [open]);

	const submit = (event: FormEvent<HTMLFormElement>) => {
		event.preventDefault();
		if (!name.trim()) return;
		onCreate(name.trim(), handle.trim() || "@new-source", selectedSchema.id);
	};

	return (
		<ModalShell open={open} onClose={onClose} eyebrow="Sources" title="Connect a source">
			<div className="provider-options">
				<p className="modal-intro">Start with a built-in connector or bring your own provider schema. Entries stay in one local index either way.</p>
				<div className="provider-option-grid">
					{defaultProviders.map((preset) => {
						const existing = providers.find((provider) => provider.id === preset.id);
						return (
							<div className="provider-option" key={preset.id}>
								<div className="provider-option-icon" style={{ color: preset.accent }}>
									<ProviderIcon provider={preset} size={20} />
								</div>
								<div className="provider-option-copy">
									<strong>{preset.name}</strong>
									<span>{preset.schema.name}</span>
								</div>
								{existing?.connected ? (
									<div className="provider-option-connected"><Badge variant="secondary"><Check size={12} /> Connected</Badge><button className="provider-disconnect" onClick={() => onDisconnect(preset.id)}>Disconnect</button></div>
								) : (
									<Button variant="outline" size="sm" onClick={() => onConnect(preset.id)}>
										Connect <ArrowUpRight size={13} />
									</Button>
								)}
							</div>
						);
					})}
				</div>
			</div>
			<div className="modal-divider"><span>or add a provider</span></div>
			<form className="provider-form" onSubmit={submit}>
				<label>
					<span>Provider name</span>
					<Input value={name} onChange={(event) => setName(event.target.value)} placeholder="Bluesky bookmarks" autoFocus />
				</label>
				<label>
					<span>Account or handle <em>optional</em></span>
					<Input value={handle} onChange={(event) => setHandle(event.target.value)} placeholder="@you.example" />
				</label>
				<label>
					<span>Schema preset</span>
					<div className="select-wrap">
						<select value={schemaId} onChange={(event) => setSchemaId(event.target.value)}>
							{schemaPresets.map((schema) => <option value={schema.id} key={schema.id}>{schema.name}</option>)}
						</select>
						<ChevronDown size={15} />
					</div>
					<small>{selectedSchema.description}</small>
				</label>
				<div className="modal-actions">
					<Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
					<Button type="submit" disabled={!name.trim()}><Plus size={15} /> Add provider</Button>
				</div>
			</form>
		</ModalShell>
	);
}

function CollectionDialog({
	open,
	providers,
	currentProviderId,
	onClose,
	onCreate,
}: {
	open: boolean;
	providers: Provider[];
	currentProviderId: string;
	onClose: () => void;
	onCreate: (name: string, description: string, rule: CollectionRule) => void;
}) {
	const [name, setName] = useState("");
	const [description, setDescription] = useState("");
	const [providerId, setProviderId] = useState(currentProviderId);
	const [tags, setTags] = useState("");

	useEffect(() => {
		if (!open) return;
		setName("");
		setDescription("");
		setProviderId(currentProviderId);
		setTags("");
	}, [currentProviderId, open]);

	const submit = (event: FormEvent<HTMLFormElement>) => {
		event.preventDefault();
		const parsedTags = tags.split(",").map((tag) => tag.trim().toLocaleLowerCase()).filter(Boolean);
		const rule: CollectionRule = {};
		if (providerId !== "all") rule.providerIds = [providerId];
		if (parsedTags.length > 0) rule.tags = parsedTags;
		onCreate(name.trim(), description.trim() || "A saved view over your source library.", rule);
	};

	return (
		<ModalShell open={open} onClose={onClose} eyebrow="Organization" title="Create a collection">
			<form className="collection-form" onSubmit={submit}>
				<p className="modal-intro">Collections are saved views, not folders. One entry can match several of them as it gains context.</p>
				<label>
					<span>Collection name</span>
					<Input value={name} onChange={(event) => setName(event.target.value)} placeholder="Ideas to revisit" autoFocus />
				</label>
				<label>
					<span>Description <em>optional</em></span>
					<Input value={description} onChange={(event) => setDescription(event.target.value)} placeholder="A quiet shelf for promising things" />
				</label>
				<div className="form-two-column">
					<label>
						<span>Source</span>
						<div className="select-wrap">
							<select value={providerId} onChange={(event) => setProviderId(event.target.value)}>
								<option value="all">Every source</option>
								{providers.filter((provider) => provider.connected).map((provider) => <option value={provider.id} key={provider.id}>{provider.name}</option>)}
							</select>
							<ChevronDown size={15} />
						</div>
					</label>
					<label>
						<span>Tags <em>comma separated</em></span>
						<Input value={tags} onChange={(event) => setTags(event.target.value)} placeholder="read-later, design" />
					</label>
				</div>
				<div className="rule-preview">
					<span className="rule-preview-icon"><Sparkles size={15} /></span>
					<div>
						<strong>Live membership</strong>
						<span>{providerId === "all" ? "Any source" : providers.find((provider) => provider.id === providerId)?.name} {tags.trim() ? `· tagged ${tags}` : "· no tag filter yet"}</span>
					</div>
				</div>
				<div className="modal-actions">
					<Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
					<Button type="submit" disabled={!name.trim()}><Plus size={15} /> Create collection</Button>
				</div>
			</form>
		</ModalShell>
	);
}

type ReadFilter = "all" | "unread" | "read";

function FilterPopover({
	open,
	kind,
	read,
	pinned,
	tag,
	availableTags,
	onKindChange,
	onReadChange,
	onPinnedChange,
	onTagChange,
	onReset,
}: {
	open: boolean;
	kind: EntryKind | "all";
	read: ReadFilter;
	pinned: boolean;
	tag: string;
	availableTags: string[];
	onKindChange: (value: EntryKind | "all") => void;
	onReadChange: (value: ReadFilter) => void;
	onPinnedChange: (value: boolean) => void;
	onTagChange: (value: string) => void;
	onReset: () => void;
}) {
	if (!open) return null;
	return (
		<div className="filter-popover">
			<div className="filter-popover-heading"><div><span className="eyebrow">Narrow results</span><strong>Facets</strong></div><button className="icon-button" onClick={onReset} aria-label="Reset filters" title="Reset filters"><X size={14} /></button></div>
			<label><span>Kind</span><div className="select-wrap"><select value={kind} onChange={(event) => onKindChange(event.target.value as EntryKind | "all")}><option value="all">All kinds</option><option value="repository">Repositories</option><option value="bookmark">Bookmarks</option><option value="thread">Threads</option><option value="video">Videos</option><option value="note">Notes</option></select><ChevronDown size={14} /></div></label>
			<label><span>Read state</span><div className="select-wrap"><select value={read} onChange={(event) => onReadChange(event.target.value as ReadFilter)}><option value="all">Everything</option><option value="unread">Unread only</option><option value="read">Read only</option></select><ChevronDown size={14} /></div></label>
			<label className="filter-check"><input type="checkbox" checked={pinned} onChange={(event) => onPinnedChange(event.target.checked)} /><span>Only pinned</span></label>
			<label><span>Tag</span><Input list="starboard-tags" value={tag} onChange={(event) => onTagChange(event.target.value)} placeholder="Any tag" /><datalist id="starboard-tags">{availableTags.map((item) => <option value={item} key={item} />)}</datalist></label>
			<div className="filter-popover-footer"><span>Updates instantly</span><button onClick={onReset}>Clear all</button></div>
		</div>
	);
}

function mergeById<T extends { id: string }>(local: T[], remote: T[]): T[] {
	const merged = new Map(local.map((item) => [item.id, item]));
	for (const item of remote) merged.set(item.id, { ...merged.get(item.id), ...item });
	return [...merged.values()];
}

function mutationId(): string {
	return typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
}

export default function App() {
	const [initialWorkspace] = useState<WorkspaceSnapshot>(() => loadWorkspace());
	const [cacheHydrated, setCacheHydrated] = useState(false);
	const [entries, setEntries] = useState<Entry[]>(initialWorkspace.entries);
	const [providers, setProviders] = useState<Provider[]>(initialWorkspace.providers);
	const [collections, setCollections] = useState<Collection[]>(initialWorkspace.collections);
	const [automations, setAutomations] = useState<Automation[]>(initialWorkspace.automations ?? []);
	const [plugins, setPlugins] = useState<PluginManifest[]>(initialWorkspace.plugins ?? []);
	const [lastSyncedAt, setLastSyncedAt] = useState(initialWorkspace.lastSyncedAt);
	const [automationEnabled, setAutomationEnabled] = useState(initialWorkspace.preferences.automationEnabled);
	const [activeCollectionId, setActiveCollectionId] = useState("all");
	const [activeProviderId, setActiveProviderId] = useState("all");
	const [query, setQuery] = useState("");
	const [searchMode, setSearchMode] = useState<SearchMode>("hybrid");
	const [showFilters, setShowFilters] = useState(false);
	const [kindFilter, setKindFilter] = useState<EntryKind | "all">("all");
	const [readFilter, setReadFilter] = useState<ReadFilter>("all");
	const [pinnedFilter, setPinnedFilter] = useState(false);
	const [tagFilter, setTagFilter] = useState("");
	const [selectedEntryId, setSelectedEntryId] = useState<string | undefined>(initialWorkspace.entries[0]?.id);
	const [isSyncing, setIsSyncing] = useState(false);
	const [syncMessage, setSyncMessage] = useState("");
	const [showAutomation, setShowAutomation] = useState(false);
	const [showProviderDialog, setShowProviderDialog] = useState(false);
	const [showCollectionDialog, setShowCollectionDialog] = useState(false);
	const [showAutomationDialog, setShowAutomationDialog] = useState(false);
	const [remoteError, setRemoteError] = useState("");
	const [remoteSearchResult, setRemoteSearchResult] = useState<{ key: string; entries: Entry[] } | null>(null);
	const searchInputRef = useRef<HTMLInputElement>(null);

	useEffect(() => {
		if (!cacheHydrated) return;
		saveWorkspace({
			version: 1,
			entries,
			providers,
			collections,
			automations,
			plugins,
			lastSyncedAt,
			preferences: { automationEnabled },
		});
	}, [automationEnabled, automations, cacheHydrated, collections, entries, lastSyncedAt, plugins, providers]);

	useEffect(() => {
		let cancelled = false;
		void hydrateWorkspace().then((cached) => {
			if (cancelled) return;
			setEntries(cached.entries);
			setProviders(cached.providers);
			setCollections(cached.collections);
			setAutomations(cached.automations ?? []);
			setPlugins(cached.plugins ?? []);
			setLastSyncedAt(cached.lastSyncedAt);
			setAutomationEnabled(cached.preferences.automationEnabled);
			setCacheHydrated(true);
		});
		return () => { cancelled = true; };
	}, []);

	useEffect(() => {
		if (!cacheHydrated || !hasRemoteApi()) return;
		let cancelled = false;
		const authError = new URLSearchParams(window.location.search).get("auth_error");
		if (authError) setRemoteError(authError);
		void flushOutbox().then(() => fetchRemoteWorkspace()).then((remote) => {
			if (cancelled) return;
			setEntries(remote.entries);
			setProviders(remote.providers);
			setCollections(mergeById(defaultCollections.filter((collection) => collection.builtIn), remote.collections));
			setAutomations(remote.automations ?? []);
			setPlugins(remote.plugins ?? []);
			const latest = remote.providers.map((provider) => provider.lastSyncedAt).filter((value): value is string => Boolean(value)).sort().at(-1);
			if (latest) setLastSyncedAt(latest);
			setAutomationEnabled((remote.automations ?? []).some((automation) => automation.enabled));
			const staleProviders = remote.providers.filter((provider) => provider.connected && (!provider.lastSyncedAt || Date.now() - Date.parse(provider.lastSyncedAt) > 15 * 60 * 1000));
			if (staleProviders.length === 0) return;
			setIsSyncing(true);
			void Promise.allSettled(staleProviders.map((provider) => syncRemoteProvider(provider.id))).then(async (reports) => {
				if (cancelled) return;
				const refreshed = await fetchRemoteWorkspace();
				if (cancelled) return;
				setEntries(refreshed.entries);
				setProviders(refreshed.providers);
				setCollections(mergeById(defaultCollections.filter((collection) => collection.builtIn), refreshed.collections));
				setAutomations(refreshed.automations ?? []);
				setPlugins(refreshed.plugins ?? []);
				const refreshedLatest = refreshed.providers.map((provider) => provider.lastSyncedAt).filter((value): value is string => Boolean(value)).sort().at(-1);
				if (refreshedLatest) setLastSyncedAt(refreshedLatest);
				setIsSyncing(false);
				const failed = reports.filter((report) => report.status === "rejected").length;
				setSyncMessage(failed > 0 ? `${failed} source${failed === 1 ? "" : "s"} need attention` : "Connected sources synced automatically");
				window.setTimeout(() => setSyncMessage(""), 5000);
			}).catch((error: unknown) => {
				if (!cancelled) {
					setIsSyncing(false);
					setRemoteError(error instanceof Error ? error.message : "Automatic sync failed");
				}
			});
		}).catch((error: unknown) => {
			if (!cancelled) setRemoteError(error instanceof Error ? error.message : "Remote API unavailable");
		});
		return () => { cancelled = true; };
	}, [cacheHydrated]);

	const searchRequestKey = `${query.trim()}|${searchMode}|${activeProviderId}|${activeCollectionId}`;
	useEffect(() => {
		if (!cacheHydrated || !hasRemoteApi() || !query.trim()) {
			setRemoteSearchResult(null);
			return;
		}
		let cancelled = false;
		const timer = window.setTimeout(() => {
			void fetchRemoteSearch(query, searchMode, activeProviderId, activeCollectionId).then((result) => {
				if (!cancelled) setRemoteSearchResult({ key: searchRequestKey, entries: result.entries });
			}).catch(() => {
				// The local index remains the source of truth while a remote search is unavailable.
			});
		}, 180);
		return () => {
			cancelled = true;
			window.clearTimeout(timer);
		};
	}, [activeCollectionId, activeProviderId, cacheHydrated, query, searchMode, searchRequestKey]);

	useEffect(() => {
		const handler = (event: KeyboardEvent) => {
			if ((event.metaKey || event.ctrlKey) && event.key.toLocaleLowerCase() === "k") {
				event.preventDefault();
				searchInputRef.current?.focus();
			}
			if ((event.metaKey || event.ctrlKey) && event.key.toLocaleLowerCase() === "n") {
				event.preventDefault();
				setShowProviderDialog(true);
			}
			if (event.key === "/" && document.activeElement?.tagName !== "INPUT") {
				event.preventDefault();
				searchInputRef.current?.focus();
			}
			if (event.key === "Escape") {
				setShowAutomation(false);
				setShowAutomationDialog(false);
				setShowProviderDialog(false);
				setShowCollectionDialog(false);
				setShowFilters(false);
			}
		};
		window.addEventListener("keydown", handler);
		return () => window.removeEventListener("keydown", handler);
	}, []);

	const providerMap = useMemo(() => new Map(providers.map((provider) => [provider.id, provider])), [providers]);
	const activeCollection = collections.find((collection) => collection.id === activeCollectionId) ?? collections.find((collection) => collection.id === "all") ?? defaultCollections[0]!;
	const selectedEntry = entries.find((entry) => entry.id === selectedEntryId);
	const connectedProviders = providers.filter((provider) => provider.connected);
	const collectionEntries = useMemo(() => entries.filter((entry) => collectionMatches(entry, activeCollection)), [activeCollection, entries]);
	const scopedEntries = useMemo(() => {
		const tag = tagFilter.trim().toLocaleLowerCase();
		return collectionEntries.filter((entry) => {
			if (activeProviderId !== "all" && entry.providerId !== activeProviderId) return false;
			if (kindFilter !== "all" && entry.kind !== kindFilter) return false;
			if (readFilter === "unread" && entry.isRead) return false;
			if (readFilter === "read" && !entry.isRead) return false;
			if (pinnedFilter && !entry.isPinned) return false;
			if (tag && !entry.tags.some((item) => item.toLocaleLowerCase() === tag)) return false;
			return true;
		});
	}, [activeProviderId, collectionEntries, kindFilter, pinnedFilter, readFilter, tagFilter]);
	const visibleEntries = useMemo(() => {
		if (remoteSearchResult?.key === searchRequestKey) {
			const allowedIds = new Set(scopedEntries.map((entry) => entry.id));
			return remoteSearchResult.entries.filter((entry) => allowedIds.has(entry.id));
		}
		return searchEntries(scopedEntries, query, searchMode);
	}, [query, remoteSearchResult, scopedEntries, searchMode, searchRequestKey]);
	const unreadCount = entries.filter((entry) => !entry.isRead).length;
	const pinnedCount = entries.filter((entry) => entry.isPinned).length;
	const collectionCounts = useMemo(
		() => new Map(collections.map((collection) => [collection.id, entries.filter((entry) => collectionMatches(entry, collection)).length])),
		[collections, entries],
	);
	const providerCounts = useMemo(
		() => new Map(providers.map((provider) => [provider.id, entries.filter((entry) => entry.providerId === provider.id).length])),
		[entries, providers],
	);
	const customCollections = collections.filter((collection) => !collection.builtIn);
	const availableTags = useMemo(() => [...new Set(entries.flatMap((entry) => entry.tags))].sort(), [entries]);
	const activeFilterCount = (kindFilter !== "all" ? 1 : 0) + (readFilter !== "all" ? 1 : 0) + (pinnedFilter ? 1 : 0) + (tagFilter.trim() ? 1 : 0);

	useEffect(() => {
		if (visibleEntries.length === 0) {
			setSelectedEntryId(undefined);
			return;
		}
		if (!selectedEntryId || !visibleEntries.some((entry) => entry.id === selectedEntryId)) setSelectedEntryId(visibleEntries[0]!.id);
	}, [selectedEntryId, visibleEntries]);

	const selectCollection = (collectionId: string) => {
		setActiveCollectionId(collectionId);
		setActiveProviderId("all");
	};

	const selectProvider = (providerId: string) => {
		setActiveProviderId(providerId);
		setSelectedEntryId(undefined);
	};

	const resetFilters = () => {
		setKindFilter("all");
		setReadFilter("all");
		setPinnedFilter(false);
		setTagFilter("");
	};

	const queueMutation = (kind: "entry.patch" | "collection.create" | "provider.create" | "provider.update" | "automation.create" | "automation.update" | "automation.delete", payload: unknown) => {
		void enqueueMutation({ id: mutationId(), kind, payload, createdAt: new Date().toISOString() });
	};

	const patchEntry = (entryId: string, patch: Partial<Pick<Entry, "isRead" | "isPinned" | "tags">>) => {
		setEntries((current) => current.map((entry) => entry.id === entryId ? { ...entry, ...patch } : entry));
		if (!hasRemoteApi()) return;
		void patchRemoteEntry(entryId, patch).catch(() => queueMutation("entry.patch", { id: entryId, patch }));
	};

	const toggleRead = (entryId: string) => {
		const entry = entries.find((item) => item.id === entryId);
		if (entry) patchEntry(entryId, { isRead: !entry.isRead });
	};

	const togglePinned = (entryId: string) => {
		const entry = entries.find((item) => item.id === entryId);
		if (entry) patchEntry(entryId, { isPinned: !entry.isPinned });
	};

	const addTag = (entryId: string) => {
		const tag = window.prompt("Add a tag", "important")?.trim().toLocaleLowerCase();
		if (!tag) return;
		const entry = entries.find((item) => item.id === entryId);
		if (entry && !entry.tags.includes(tag)) patchEntry(entryId, { tags: [...entry.tags, tag] });
	};

	const removeTag = (entryId: string, tag: string) => {
		const entry = entries.find((item) => item.id === entryId);
		if (entry) patchEntry(entryId, { tags: entry.tags.filter((item) => item !== tag) });
	};

	const syncNow = async () => {
		if (isSyncing) return;
		setIsSyncing(true);
		setSyncMessage("");
		setRemoteError("");
		try {
			if (hasRemoteApi()) {
				const reports = await Promise.allSettled(connectedProviders.map((provider) => syncRemoteProvider(provider.id)));
				const successful = reports.filter((report): report is PromiseFulfilledResult<Awaited<ReturnType<typeof syncRemoteProvider>>> => report.status === "fulfilled");
				const failed = reports.filter((report) => report.status === "rejected");
				await flushOutbox();
				const remote = await fetchRemoteWorkspace();
				setEntries(remote.entries);
				setProviders(remote.providers);
				setCollections(mergeById(defaultCollections.filter((collection) => collection.builtIn), remote.collections));
				setAutomations(remote.automations ?? []);
				const latest = remote.providers.map((provider) => provider.lastSyncedAt).filter((value): value is string => Boolean(value)).sort().at(-1);
				setLastSyncedAt(latest ?? new Date().toISOString());
				const added = successful.reduce((total, report) => total + report.value.added, 0);
				const queued = successful.some((report) => report.value.status === "queued");
				setSyncMessage(failed.length > 0 ? `${successful.length} sources synced; ${failed.length} need attention` : queued ? `${added} entries added — backfill continues on next sync` : added > 0 ? `${added} new stars added to your cache` : "Everything is already up to date");
				if (failed.length > 0) setRemoteError("One or more sources could not sync. Check provider credentials.");
			} else {
				const now = new Date().toISOString();
				const incoming = createBackfillEntries(providers, new Set(entries.map((entry) => entry.id)));
				await new Promise((resolve) => window.setTimeout(resolve, 720));
				setEntries((current) => [...incoming, ...current.map((entry) => ({ ...entry, syncedAt: now }))]);
				setProviders((current) => current.map((provider) => provider.connected ? { ...provider, lastSyncedAt: now } : provider));
				setLastSyncedAt(now);
				setSyncMessage(incoming.length > 0 ? `${incoming.length} new stars added to your cache` : "Everything is already up to date");
			}
		} catch (error) {
			setRemoteError(error instanceof Error ? error.message : "Sync failed");
			setSyncMessage("Sync failed — local cache is still safe");
		} finally {
			setIsSyncing(false);
			window.setTimeout(() => setSyncMessage(""), 5000);
		}
	};

	const connectProvider = async (providerId: string) => {
		if (hasRemoteApi()) {
			if (providerId === "github") {
				window.location.assign(providerAuthUrl(providerId));
				return;
			}
			const handle = window.prompt("Tangled or Bluesky handle", "");
			if (!handle?.trim()) return;
			try {
				const provider = await connectRemoteTangled(handle);
				setProviders((current) => mergeById(current, [provider]));
				setShowProviderDialog(false);
				setSyncMessage("Tangled connected — syncing stars now");
				try {
					await syncRemoteProvider(provider.id);
					const refreshed = await fetchRemoteWorkspace();
					setEntries(refreshed.entries);
					setProviders(refreshed.providers);
					setCollections(mergeById(defaultCollections.filter((collection) => collection.builtIn), refreshed.collections));
					setAutomations(refreshed.automations ?? []);
					setPlugins(refreshed.plugins ?? []);
					setLastSyncedAt(new Date().toISOString());
					setSyncMessage("Tangled connected and indexed");
				} catch (error) {
					setRemoteError(error instanceof Error ? error.message : "Tangled sync failed");
				}
			} catch (error) {
				setRemoteError(error instanceof Error ? error.message : "Could not connect Tangled");
			}
			return;
		}
		const now = new Date().toISOString();
		setProviders((current) => current.map((provider) => provider.id === providerId ? { ...provider, connected: true, connectedAt: now, lastSyncedAt: now } : provider));
		setShowProviderDialog(false);
		setSyncMessage("Source connected — run sync to backfill its stars");
		window.setTimeout(() => setSyncMessage(""), 5000);
	};

	const disconnectProvider = (providerId: string) => {
		const provider = providers.find((item) => item.id === providerId);
		if (!provider || !window.confirm(`Disconnect ${provider.name}? Your indexed entries will stay here.`)) return;
		setProviders((current) => current.map((item) => item.id === providerId ? { ...item, connected: false } : item));
		setSyncMessage(`${provider.name} disconnected — indexed entries are still searchable`);
		if (hasRemoteApi()) void updateRemoteProvider(providerId, { connected: false }).catch(() => queueMutation("provider.update", { id: providerId, patch: { connected: false } }));
		window.setTimeout(() => setSyncMessage(""), 5000);
	};

	const createProvider = (name: string, handle: string, schemaId: string) => {
		const schema = schemaPresets.find((preset) => preset.id === schemaId) ?? schemaPresets[2]!;
		const now = new Date().toISOString();
		const provider: Provider = {
			id: `provider-${slugify(name)}-${Date.now()}`,
			name,
			kind: "custom",
			handle,
			description: schema.description,
			accent: accentPalette[providers.length % accentPalette.length]!,
			schema,
			connected: true,
			connectedAt: now,
			lastSyncedAt: now,
		};
		setProviders((current) => [...current, provider]);
		setShowProviderDialog(false);
		setSyncMessage(`${name} added with the ${schema.name.toLocaleLowerCase()} schema`);
		if (hasRemoteApi()) {
			void createRemoteProvider(provider).catch(() => queueMutation("provider.create", provider));
		}
		window.setTimeout(() => setSyncMessage(""), 5000);
	};

	const createCollection = async (name: string, description: string, rule: CollectionRule) => {
		const collection: Collection = {
			id: `${slugify(name)}-${Date.now()}`,
			name,
			description,
			icon: "layers",
			color: accentPalette[collections.length % accentPalette.length]!,
			rule,
			builtIn: false,
		};
		setCollections((current) => [...current, collection]);
		setActiveCollectionId(collection.id);
		setActiveProviderId("all");
		setShowCollectionDialog(false);
		if (hasRemoteApi()) {
			try {
				const remote = await createRemoteCollection(collection);
				setCollections((current) => mergeById(current, [remote]));
			} catch {
				queueMutation("collection.create", collection);
			}
		}
	};

	const createAutomation = (automation: Automation) => {
		setAutomations((current) => [...current, automation]);
		setAutomationEnabled(true);
		setShowAutomationDialog(false);
		setSyncMessage(`${automation.name} is ready for ${automation.trigger}`);
		if (hasRemoteApi()) {
			void createRemoteAutomation(automation).catch(() => queueMutation("automation.create", automation));
		}
		window.setTimeout(() => setSyncMessage(""), 5000);
	};

	const toggleAllAutomations = () => {
		const nextEnabled = !automationEnabled;
		setAutomationEnabled(nextEnabled);
		setAutomations((current) => current.map((automation) => ({ ...automation, enabled: nextEnabled, updatedAt: new Date().toISOString() })));
		if (hasRemoteApi()) {
			void Promise.all(automations.map((automation) => updateRemoteAutomation(automation.id, { enabled: nextEnabled }))).catch(() => {
				for (const automation of automations) queueMutation("automation.update", { id: automation.id, patch: { enabled: nextEnabled } });
			});
		}
	};

	const toggleAutomation = (id: string) => {
		const current = automations.find((automation) => automation.id === id);
		if (!current) return;
		const nextEnabled = !current.enabled;
		setAutomations((items) => items.map((automation) => automation.id === id ? { ...automation, enabled: nextEnabled, updatedAt: new Date().toISOString() } : automation));
		if (hasRemoteApi()) void updateRemoteAutomation(id, { enabled: nextEnabled }).catch(() => queueMutation("automation.update", { id, patch: { enabled: nextEnabled } }));
	};

	const deleteAutomation = (id: string) => {
		const automation = automations.find((item) => item.id === id);
		if (!automation || !window.confirm(`Delete ${automation.name}?`)) return;
		setAutomations((items) => items.filter((item) => item.id !== id));
		if (hasRemoteApi()) void deleteRemoteAutomation(id).catch(() => queueMutation("automation.delete", { id }));
	};

	return (
		<div className="app-shell">
			<aside className="sidebar">
				<div className="brand-lockup">
					<div className="brand-mark"><span /></div>
					<div className="brand-copy">
						<strong>starboard</strong>
						<span>your private source library</span>
					</div>
				</div>

				<Button className="add-source-button" variant="secondary" onClick={() => setShowProviderDialog(true)}>
					<span className="add-source-icon"><Plus size={15} /></span>
					<span>Add source</span>
					<kbd>⌘ N</kbd>
				</Button>

				<nav className="sidebar-nav" aria-label="Workspace navigation">
					<span className="sidebar-section-label">Workspace</span>
					<SidebarItem active={activeCollectionId === "all"} count={collectionCounts.get("all") ?? entries.length} icon={Inbox} label="All saves" onClick={() => selectCollection("all")} />
					<SidebarItem active={activeCollectionId === "unread"} count={unreadCount} icon={Sparkles} label="Unread" accent="#f6c453" onClick={() => selectCollection("unread")} />
					<SidebarItem active={activeCollectionId === "pinned"} count={pinnedCount} icon={Bookmark} label="Pinned" accent="#f28a6b" onClick={() => selectCollection("pinned")} />
				</nav>

				<div className="sidebar-nav source-nav">
					<div className="sidebar-section-heading">
						<span className="sidebar-section-label">Sources</span>
						<button className="sidebar-add-button" onClick={() => setShowProviderDialog(true)} aria-label="Add source"><Plus size={14} /></button>
					</div>
					{connectedProviders.map((provider) => (
						<SidebarItem
							key={provider.id}
							active={activeProviderId === provider.id}
							count={providerCounts.get(provider.id) ?? 0}
							icon={iconForProvider(provider)}
							label={provider.name}
							accent={provider.accent}
							onClick={() => selectProvider(provider.id)}
						/>
					))}
				</div>

				<div className="sidebar-nav collections-nav">
					<div className="sidebar-section-heading">
						<span className="sidebar-section-label">Collections</span>
						<button className="sidebar-add-button" onClick={() => setShowCollectionDialog(true)} aria-label="Add collection"><Plus size={14} /></button>
					</div>
					{collections.filter((collection) => ["github-stars", "tangled-stars"].includes(collection.id)).map((collection) => (
						<SidebarItem
							key={collection.id}
							active={activeCollectionId === collection.id}
							count={collectionCounts.get(collection.id) ?? 0}
							icon={collectionIconMap[collection.icon]}
							label={collection.name}
							accent={collection.color}
							onClick={() => selectCollection(collection.id)}
						/>
					))}
					{customCollections.map((collection) => (
						<SidebarItem
							key={collection.id}
							active={activeCollectionId === collection.id}
							count={collectionCounts.get(collection.id) ?? 0}
							icon={collectionIconMap[collection.icon]}
							label={collection.name}
							accent={collection.color}
							onClick={() => selectCollection(collection.id)}
						/>
					))}
					{customCollections.length === 0 && <span className="sidebar-empty-copy">Make a saved view from any search.</span>}
				</div>

				<div className="sidebar-bottom">
					<div className="cache-status">
						<span className="cache-status-dot" />
						<div><strong>Local cache ready</strong><span>{entries.length} entries indexed</span></div>
					</div>
					<div className="sidebar-user">
						<span className="user-avatar">AS</span>
						<div><strong>Alex's workspace</strong><span>Personal</span></div>
						<button className="icon-button" aria-label="Workspace settings"><Settings2 size={15} /></button>
					</div>
				</div>
			</aside>

			<main className="main-content">
				<header className="topbar">
					<div className="breadcrumb"><span>Workspace</span><span>/</span><strong>{activeCollection.name}</strong></div>
					<div className="topbar-actions">
						<div className="automation-anchor">
							<Button variant={showAutomation ? "secondary" : "ghost"} size="icon" onClick={() => setShowAutomation((current) => !current)} aria-label="Open automations" title="Automations">
								<Workflow size={17} />
							</Button>
							{showAutomation && <AutomationPanel enabled={automationEnabled} automations={automations} onToggle={toggleAllAutomations} onToggleAutomation={toggleAutomation} onDelete={deleteAutomation} onConfigure={() => { setShowAutomation(false); setShowAutomationDialog(true); }} />}
						</div>
						<Button variant="outline" size="sm" onClick={() => setShowProviderDialog(true)}><Plus size={14} /> Connect source</Button>
						<span className="topbar-avatar">AS</span>
					</div>
				</header>

				<div className="content-wrap">
					<div className="page-heading">
						<div>
							<span className="eyebrow">{activeProviderId === "all" ? "Library view" : providerLabel(providerMap.get(activeProviderId))}</span>
							<div className="page-title-row">
								<h1>{activeCollection.name}</h1>
								<span className="title-count">{visibleEntries.length}</span>
							</div>
							<p>{activeCollection.description} <span className="heading-dot">·</span> <strong>{entries.length} cached locally</strong></p>
						</div>
						<Button variant="outline" onClick={syncNow} disabled={isSyncing}>
							{isSyncing ? <LoaderCircle className="spin" size={15} /> : <RefreshCw size={15} />}
							{isSyncing ? "Syncing…" : "Sync now"}
						</Button>
					</div>

					<div className="sync-strip">
						<div className="sync-strip-main">
							<span className={cn("sync-live-dot", isSyncing && "is-syncing")} />
							<div><strong>{isSyncing ? "Checking connected sources" : "All sources up to date"}</strong><span>Last checked {formatRelative(lastSyncedAt)}</span></div>
						</div>
						<div className="sync-strip-sources">
							{connectedProviders.map((provider) => <span key={provider.id} title={`${provider.name} · ${formatRelative(provider.lastSyncedAt ?? lastSyncedAt)}`}><ProviderIcon provider={provider} size={14} /></span>)}
						</div>
						{syncMessage && <span className="sync-message"><Check size={13} /> {syncMessage}</span>}
					</div>
					{remoteError && <div className="remote-error"><X size={14} /><span>{remoteError}</span><button onClick={() => setRemoteError("")}>Dismiss</button></div>}

					<div className="search-toolbar">
						<div className="search-input-wrap">
							<Search className="search-icon" size={17} />
							<Input ref={searchInputRef} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search repos, bookmarks, threads…" aria-label="Search entries" />
							{query && <button className="search-clear" onClick={() => setQuery("")} aria-label="Clear search"><X size={15} /></button>}
							<kbd className="search-shortcut"><Command size={12} /> K</kbd>
						</div>
						<div className="mode-toggle" aria-label="Search mode">
							{(Object.keys(modeLabels) as SearchMode[]).map((mode) => (
								<button key={mode} className={cn(searchMode === mode && "is-active")} onClick={() => setSearchMode(mode)} title={modeLabels[mode].detail}>
									{mode === "semantic" && <Sparkles size={13} />}
									{modeLabels[mode].label}
								</button>
							))}
						</div>
						<div className="filter-anchor">
							<button className={cn("filter-button", (showFilters || activeFilterCount > 0) && "is-active")} onClick={() => setShowFilters((current) => !current)} aria-label="Filter options" aria-expanded={showFilters}><Settings2 size={15} /><span>Filter</span>{activeFilterCount > 0 && <b>{activeFilterCount}</b>}</button>
							<FilterPopover open={showFilters} kind={kindFilter} read={readFilter} pinned={pinnedFilter} tag={tagFilter} availableTags={availableTags} onKindChange={setKindFilter} onReadChange={setReadFilter} onPinnedChange={setPinnedFilter} onTagChange={setTagFilter} onReset={resetFilters} />
						</div>
					</div>

					<div className="source-filter-row">
						<span className="filter-label">Source</span>
		<button className={cn("source-filter", activeProviderId === "all" && "is-active")} onClick={() => selectProvider("all")}>
							<span>All sources</span><small>{collectionEntries.length}</small>
						</button>
						{connectedProviders.map((provider) => (
							<button className={cn("source-filter", activeProviderId === provider.id && "is-active")} onClick={() => selectProvider(provider.id)} key={provider.id}>
								<span className="source-filter-name"><ProviderIcon provider={provider} size={13} />{provider.name}</span><small>{collectionEntries.filter((entry) => entry.providerId === provider.id).length}</small>
							</button>
						))}
						<span className="filter-spacer" />
						<span className="result-note">{query.trim() ? `${visibleEntries.length} matches · ${modeLabels[searchMode].detail}` : "Sorted by newest star"}</span>
					</div>

					<div className="results-layout">
						<section className="results-column">
							<div className="results-heading">
								<div><span className="eyebrow">Indexed entries</span><strong>{visibleEntries.length === 1 ? "1 result" : `${visibleEntries.length} results`}</strong></div>
								<span className="results-shortcut">↑↓ navigate <span>·</span> click to inspect</span>
							</div>
							<div className="entry-list">
								{visibleEntries.map((entry) => {
									const matchingLabels = collections.filter((collection) => collection.id !== "all" && collectionMatches(entry, collection)).map((collection) => collection.name);
									return (
										<EntryCard
											key={entry.id}
											entry={entry}
											provider={providerMap.get(entry.providerId)}
											selected={entry.id === selectedEntryId}
											labels={matchingLabels}
											onSelect={() => {
												setSelectedEntryId(entry.id);
												if (!entry.isRead) toggleRead(entry.id);
											}}
											onTogglePinned={() => togglePinned(entry.id)}
										/>
									);
								})}
								{visibleEntries.length === 0 && (
									<div className="empty-results">
										<div className="empty-results-icon"><Search size={20} /></div>
										<h3>{query.trim() ? "Nothing surfaced yet" : "This shelf is empty"}</h3>
										<p>{query.trim() ? "Try fewer words, a different search mode, or a provider filter." : "Sync a connected source or create a new collection to give this view a purpose."}</p>
										{query.trim() && <Button variant="outline" size="sm" onClick={() => setQuery("")}><X size={14} /> Clear search</Button>}
									</div>
								)}
							</div>
							<div className="results-footer"><Database size={13} /><span>Search is instant because your index lives on this device.</span><button onClick={() => setShowProviderDialog(true)}>Connect another source <ArrowUpRight size={12} /></button></div>
						</section>
						<EntryDetail
							entry={selectedEntry}
							provider={selectedEntry ? providerMap.get(selectedEntry.providerId) : undefined}
							collections={collections}
							onClose={() => setSelectedEntryId(undefined)}
							onToggleRead={() => selectedEntry && toggleRead(selectedEntry.id)}
							onTogglePinned={() => selectedEntry && togglePinned(selectedEntry.id)}
							onAddTag={() => selectedEntry && addTag(selectedEntry.id)}
							onRemoveTag={(tag) => selectedEntry && removeTag(selectedEntry.id, tag)}
						/>
					</div>
				</div>
			</main>

			<ProviderDialog open={showProviderDialog} providers={providers} onClose={() => setShowProviderDialog(false)} onConnect={connectProvider} onDisconnect={disconnectProvider} onCreate={createProvider} />
			<CollectionDialog open={showCollectionDialog} providers={providers} currentProviderId={activeProviderId} onClose={() => setShowCollectionDialog(false)} onCreate={createCollection} />
			<AutomationDialog open={showAutomationDialog} onClose={() => setShowAutomationDialog(false)} onCreate={createAutomation} />
		</div>
	);
}

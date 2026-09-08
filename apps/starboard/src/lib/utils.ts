import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import type { Provider } from "./types";

export function cn(...inputs: ClassValue[]) {
	return twMerge(clsx(inputs));
}

export function formatRelative(value: string): string {
	const date = new Date(value);
	if (Number.isNaN(date.getTime())) return "unknown";
	const diff = Date.now() - date.getTime();
	const minutes = Math.max(1, Math.round(diff / 60000));
	if (minutes < 60) return `${minutes}m ago`;
	const hours = Math.round(minutes / 60);
	if (hours < 24) return `${hours}h ago`;
	const days = Math.round(hours / 24);
	if (days < 30) return `${days}d ago`;
	const months = Math.round(days / 30);
	return `${months}mo ago`;
}

export function formatDate(value: string): string {
	const date = new Date(value);
	if (Number.isNaN(date.getTime())) return "Unknown date";
	return new Intl.DateTimeFormat("en", { month: "short", day: "numeric", year: "numeric" }).format(date);
}

export function formatNumber(value: number | undefined): string {
	if (value === undefined) return "—";
	if (value >= 1000) return `${(value / 1000).toFixed(value >= 10000 ? 0 : 1)}k`;
	return `${value}`;
}

export function initials(value: string): string {
	return value
		.split(/\s+/)
		.map((part) => part[0] ?? "")
		.join("")
		.slice(0, 2)
		.toUpperCase();
}

export function slugify(value: string): string {
	return value
		.toLocaleLowerCase()
		.trim()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-|-$/g, "") || "collection";
}

export function providerLabel(provider: Provider | undefined): string {
	return provider?.name ?? "Unknown source";
}

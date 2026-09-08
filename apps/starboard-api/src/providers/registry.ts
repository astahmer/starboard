import type { Provider } from "../../../starboard/src/lib/types";
import { githubAdapter } from "./github";
import { tangledAdapter } from "./tangled";
import type { RemoteProviderAdapter } from "./types";

const adapters = new Map<Provider["kind"], RemoteProviderAdapter>([
	["github", githubAdapter],
	["tangled", tangledAdapter],
]);

export function getRemoteProviderAdapter(kind: Provider["kind"]): RemoteProviderAdapter | undefined {
	return adapters.get(kind);
}

export function listRemoteProviderKinds(): Provider["kind"][] {
	return [...adapters.keys()];
}

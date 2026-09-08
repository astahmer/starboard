# Starboard

Starboard is the provider-agnostic source library for things worth keeping:
GitHub stars, Tangled stars, bookmarks, threads, and whatever gets added next.
This first slice is a Vite + React workspace with shadcn-style primitives,
local-first persistence, a shared entry model, and a sync-ready provider seam.

## Run it

From the repository root:

```bash
pnpm starboard:dev
```

This starts both the Vite UI and local Alchemy Worker. To run only the UI,
use `pnpm starboard:ui`.

Or build it with:

```bash
pnpm starboard:build
```

Without an API configured, the demo starts with seeded GitHub and Tangled
entries. Search, read state, pins, tags, collections, automations, connected
sources, and the last sync checkpoint are persisted locally. IndexedDB holds
the workspace snapshot and offline mutation outbox; localStorage remains a
small compatibility fallback, so reopening the app is instant and
offline-friendly.

## Product seams

- `src/lib/types.ts` is the common data contract for entries, providers,
  schemas, and smart collections.
- `src/lib/provider.ts` describes the adapter contract: authorize, page by a
  provider cursor, and normalize into the common entry shape.
- `src/lib/search.ts` provides the local fuzzy matcher and a deliberately
  dependency-free semantic signal preview. A real embedding index can replace
  the semantic scorer without changing the UI contract.
- `src/lib/api-contract.ts` is the shared HTTP/MCP surface. The Cloudflare
  Worker calls the same application service for REST and MCP, rather than
  maintaining two implementations of search or sync.

The Worker implementation lives in `../starboard-api`. It exposes read/search
routes, entry mutations, collection and automation management, provider OAuth,
cursor-based GitHub/Tangled sync, and a stateless Streamable HTTP MCP endpoint
at `/mcp`. When `VITE_STARBOARD_API_URL` is set, the UI hydrates from the
remote workspace after showing the local cache and flushes offline mutations
in order.

## Deployment boundary

D1 stores normalized records and optional embeddings. OAuth tokens remain
encrypted and server-only. Add a provider by implementing the shared adapter
contract and registering its server adapter; custom schemas already work in
the UI and API, while their remote fetcher remains an explicit integration.

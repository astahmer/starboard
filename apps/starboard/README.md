# Starboard

Starboard is the provider-agnostic source library for things worth keeping:
GitHub stars, Tangled stars, bookmarks, threads, and whatever gets added next.
The Vite + React workspace uses shadcn/ui components and a shared entry model.
Each person signs in with their own GitHub account and gets a private library
synced from their actual starred repositories.

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

The app starts without sample entries. Configure a GitHub App and the API
environment as described in `../starboard-api/README.md`; after sign-in,
Starboard imports your GitHub stars and stores read state, pins, tags, and
collections in your account-owned workspace.

## Product seams

- `src/lib/types.ts` is the common data contract for entries, providers,
  schemas, and smart collections.
- `src/lib/provider.ts` describes the adapter contract: authorize, page by a
  provider cursor, and normalize into the common entry shape.
- `src/lib/search.ts` provides local fuzzy matching over the authenticated
  account's imported entries.
- `src/lib/api-contract.ts` is the shared HTTP/MCP surface. The Cloudflare
  Worker calls the same application service for REST and MCP, rather than
  maintaining two implementations of search or sync.

The Worker implementation lives in `../starboard-api`. It exposes
account-scoped read/search routes, entry mutations, collection and automation
management, GitHub App authorization, cursor-based GitHub/Tangled sync, and a
Streamable HTTP MCP endpoint at `/mcp`. Vite proxies `/api` and `/mcp` during
local development; production serves the UI and API from one origin.

## Deployment boundary

D1 stores account-owned records and optional embeddings. OAuth tokens remain
encrypted and server-only. Add a provider by implementing the shared adapter
contract and registering its server adapter; custom schemas already work in
the UI and API, while their remote fetcher remains an explicit integration.

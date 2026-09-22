# Starboard

Starboard is a provider-agnostic source library for things worth keeping:
GitHub stars, Tangled stars, bookmarks, threads, and whatever gets added next.
It combines an instant local cache with a durable Cloudflare Worker/D1 backend,
hybrid search, source sync, smart collections, automations, and MCP.

## Run locally

Requirements: Node 24 and pnpm 12.

```bash
pnpm install
pnpm dev
```

The Vite UI runs at `http://localhost:5174`; the local Alchemy Worker runs at
`http://localhost:1337`. `pnpm ui` and `pnpm api:dev` start either side alone.

Copy `apps/starboard-api/.env.example` to `apps/starboard-api/.env` when you
want OAuth, embeddings, optional LLM classification, or signed webhooks. The
demo UI works without credentials and persists its local workspace in
IndexedDB with an offline mutation outbox.

## What is here

- `apps/starboard`: Vite + React UI with the shared entry/provider/schema
  contract, local fuzzy/semantic search, filters, collections, source setup,
  automations, and optimistic offline edits.
- `apps/starboard-api`: Cloudflare Worker + D1 persistence, GitHub/Tangled
  adapters, OAuth/session boundary, cursor-based sync/backfill, optional
  embeddings/classification, automation hooks, REST, and MCP at `/mcp`.
- `scripts/starboard-dev.mjs`: one-command local launcher with child-process
  cleanup, including Alchemy's local Worker runtime.

To add a provider, define a schema in the common contract and register a
server-side adapter that pages remote records into normalized entries. Custom
schemas already work in the UI; remote fetching remains an explicit trusted
integration.

## Deploy

Deploy the browser-local UI demo separately:

```bash
pnpm site:plan
pnpm site:deploy
```

This publishes the Vite UI as a static Cloudflare site. Its sample workspace
and edits stay in each visitor's browser; the API and shared database are not
included in this demo deployment.

Deploy the API and D1 database separately:

```bash
pnpm api:plan
pnpm api:deploy
```

Alchemy provisions the Cloudflare Worker and D1 database. Use an explicit
stage for preview/production separation, for example:

```bash
pnpm --filter starboard-api plan --stage production
```

Configure OAuth and other secrets through Alchemy/Cloudflare. Set
`AUTH_REQUIRED=true` and put the API behind Cloudflare Access before exposing
the single-workspace deployment publicly.

## Verification

```bash
pnpm test
pnpm build
pnpm api:typecheck
```

See `apps/starboard/README.md`, `apps/starboard-api/README.md`, and
`plans/collections-and-organization.md` for the detailed contracts and
product plan.

# Starboard API

Cloudflare Worker backend for Starboard. It stores normalized providers,
entries, collections, credentials, automations, and sync checkpoints in D1,
and serves the same search service through REST and MCP.

## Local development

From repository root:

```bash
pnpm starboard-api:dev
```

Copy `apps/starboard-api/.env.example` to `apps/starboard-api/.env` when you
want OAuth, embeddings, or the optional classifier. Alchemy starts a local
Worker at `http://localhost:1337` and provisions a local D1 binding. Useful
checks:

```bash
curl http://localhost:1337/api/health
curl 'http://localhost:1337/api/search?query=react&mode=hybrid'
```

MCP clients should connect to `http://localhost:1337/mcp` using Streamable
HTTP. The server exposes search, entry mutation, collection, sync,
automation, and declarative plugin-manifest tools.

## Deploy

```bash
pnpm starboard-api:plan
pnpm starboard-api:deploy
```

Alchemy owns the Worker and D1 resources. Use an explicit Alchemy stage when
you need separate preview and production state, for example
`pnpm --filter starboard-api plan --stage production`. Set secrets through
Cloudflare/Alchemy configuration; never put OAuth tokens in the browser cache.

## Implemented boundary

- GitHub OAuth stores encrypted credentials server-side and syncs the starred
  repositories endpoint, including `starred_at` and cursor-based backfill.
- Tangled sync resolves a handle through AT Protocol and reads stars/repository
  metadata through Bobbin. A public handle is enough for public stars; the
  configurable PKCE OAuth path is available for deployments with a Tangled
  OAuth client.
- Every sync is incremental, resumes from a D1 checkpoint, indexes optional
  embeddings, runs enabled automations, and prunes unstarred entries after a
  complete backfill.
- Webhooks are HTTPS-only and can receive an `x-starboard-signature` HMAC
  header when `AUTOMATION_SIGNING_SECRET` is configured. Plugin registration is
  intentionally declarative; executable plugin code must be hosted by an
  explicitly trusted integration.

## Security boundary

This starter is a single-workspace deployment: normalized rows are shared by
the Worker, while OAuth credentials are encrypted and associated with the
default account. Keep the API private behind Cloudflare Access or set
`AUTH_REQUIRED=true` before exposing it to the internet. The UI sends browser
credentials only to the configured API origin, and local-first edits wait in
the IndexedDB outbox when the API is unavailable.

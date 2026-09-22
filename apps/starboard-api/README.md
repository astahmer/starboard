# Starboard API

Cloudflare Worker backend for Starboard. It stores account-owned providers,
entries, collections, credentials, automations, and sync checkpoints in D1,
and serves the same search service through REST and MCP.

## Local development

From repository root:

```bash
pnpm starboard-api:dev
```

Copy `apps/starboard-api/.env.example` to `apps/starboard-api/.env` and fill in
GitHub App credentials to enable sign-in. Alchemy starts a local Worker at
`http://localhost:1337`, applies local D1 migrations, and provisions the
binding. Only `/api/health` and `/api/me` are public; workspace routes require
the signed-in account's session.

```bash
curl http://localhost:1337/api/health
curl http://localhost:1337/api/me
```

MCP clients should connect to `http://localhost:1337/mcp` using Streamable
HTTP. The server exposes search, entry mutation, collection, sync,
automation, and declarative plugin-manifest tools.

## Deploy

```bash
pnpm starboard-api:plan
pnpm starboard-api:deploy
```

The hosted UI and API use one origin, with a production D1 database and
scheduled sync. Before deploying, configure `GITHUB_CLIENT_ID`,
`GITHUB_CLIENT_SECRET`, `SESSION_SECRET`, `APP_URL`, and `WEB_APP_URL` in the
Alchemy environment. Register
`<APP_URL>/api/auth/github/callback` as a GitHub App callback and grant only
the user `Starring: read` permission. Set both origins to the deployed site's
URL. Use `pnpm site:plan` to preview and `pnpm site:deploy` to deploy the
combined app.

## Implemented boundary

- GitHub App user authorization stores encrypted credentials server-side and
  syncs the authenticated user's starred repositories, including `starred_at`
  and resumable cursor-based backfill. The API syncs up to five 100-repository
  pages per request; the browser continues queued pages until the import ends.
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

Every workspace, provider, entry, collection, automation, credential, and
sync checkpoint is scoped to the stable GitHub account ID. Sessions use
HttpOnly, SameSite cookies; OAuth uses state validation and PKCE. The UI
does not seed or cache sample data. GitHub credentials remain server-side and
encrypted at rest.

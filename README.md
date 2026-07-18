# filo

> A distraction-free, typewriter-style capture tool for writing line by line.

Type a line, press **Enter**, and it drops into the document. filo is a
**capture tool, not an editor** — it keeps you moving, silently fixes only
high-confidence spelling/grammar in the background, and formats your raw lines
into clean markdown when you explicitly *seal* a document. Bilingual (English +
Traditional Chinese), single-user, syncs across devices.

The full product spec is in [`PRODUCT_SPEC.md`](./PRODUCT_SPEC.md) (the design
review history is in `PRODUCT_SPEC_REVIEW.md`).

## Architecture

| Layer | Stack |
|---|---|
| Frontend (`web/`) | Vite + React + TypeScript SPA |
| Backend (`server/`) | Cloudflare Worker + Hono, D1 (SQLite) |
| Hosting | A **single** Cloudflare Worker serves both the API and the SPA (static assets) on one origin — no CORS. Live at `filo.unsubject.com` |
| AI | Claude **Haiku** (`claude-haiku-4-5`) for both silent correction and seal-time formatting |
| Auth | Single-user bearer token (Cloudflare secret) |

```
filo/
├── PRODUCT_SPEC.md          # authoritative product spec (Revision 3)
├── package.json             # root orchestrator scripts (delegate to each package)
├── server/                  # Cloudflare Worker + D1 backend
│   ├── migrations/0001_init.sql
│   ├── wrangler.toml
│   └── src/                 # app.ts (Hono factory, DI), routes/, db/, ai/, auth.ts
└── web/                     # Vite + React SPA
    └── src/                 # components/, state/useFilo.ts, api/
```

The Worker uses dependency injection (DB executor + AI client + clock), so the
backend is tested fully offline against Node's built-in `node:sqlite` using the
real migration SQL, and the AI client is faked in tests. The frontend is tested
with Vitest + Testing Library (jsdom), including wire-contract tests that run the
real API client against mocked server responses.

## Local development

Prerequisites: Node 22+.

```bash
# Install both packages
npm run install:all

# Backend (Worker + local D1) — http://localhost:8787
#   Set local secrets first: cp server/.dev.vars.example server/.dev.vars  (then edit)
#   Apply migrations to the local D1:  cd server && npx wrangler d1 migrations apply filo --local
cd server && npm run dev

# Frontend (Vite dev server) — in another terminal
#   cp web/.env.example web/.env.local  (set VITE_API_BASE / VITE_FILO_TOKEN if needed)
cd web && npm run dev
```

### Checks (run from the repo root)

```bash
npm run typecheck   # server + web
npm test            # server (32) + web (22)
npm run build       # server (wrangler dry-run) + web (vite build)
```

## Deployment checklist (requires your Cloudflare account)

The build and tests run offline, but deploying needs a Cloudflare account and a
few secrets only you can set:

1. **Log in:** `cd server && npx wrangler login`
2. **Create the D1 database:** `npx wrangler d1 create filo` — copy the returned
   `database_id` into `server/wrangler.toml` (replace `REPLACE_WITH_D1_DATABASE_ID`).
3. **Apply migrations:** `npx wrangler d1 migrations apply filo` (add `--local` for dev).
4. **Set secrets:**
   ```bash
   npx wrangler secret put FILO_BEARER_TOKEN      # your single-user token
   npx wrangler secret put ANTHROPIC_API_KEY      # for correction + seal
   # optional — enables sealed-doc push to your 2nd-brain:
   npx wrangler secret put SECOND_BRAIN_URL
   npx wrangler secret put SECOND_BRAIN_TOKEN
   ```
5. **Build the SPA, then deploy the Worker** — a **single** Worker serves both
   the API and the static SPA (same origin, no CORS). The Worker's `[assets]`
   binding (`server/wrangler.toml`) bundles `web/dist`, so build the web app
   first:
   ```bash
   npm --prefix web ci && npm --prefix web run build   # produces web/dist
   cd server && npx wrangler deploy                     # bundles worker + assets
   ```
   With Cloudflare **Workers Builds** (git-connected), use root `server`, build
   command `npm --prefix ../web ci && npm --prefix ../web run build`, and deploy
   command `npx wrangler deploy`. Point your custom domain (e.g.
   `filo.unsubject.com`) at this one Worker.
6. **Token at runtime:** the app's token gate stores the bearer token in
   `localStorage["filo_token"]` on first load. Do **not** set `VITE_FILO_TOKEN`
   for a production build (it would inline the secret into the bundle, spec §6);
   it's a local-dev convenience only. `VITE_API_BASE` is left **empty** in
   `web/.env.production` so the SPA calls the API same-origin.
7. **Verify model IDs** are current on your account before production traffic:
   correction and seal both use `claude-haiku-4-5-20251001`.

## Operating the live deployment

filo runs as one git-connected Cloudflare Worker at **`filo.unsubject.com`**.

- **Deploy:** push to `main` → Cloudflare Workers Builds rebuilds and deploys
  automatically (root `server`, build `npm --prefix ../web ci && npm --prefix ../web run build`, deploy `npx wrangler deploy`).
- **Secrets** (Worker → Settings → Variables and Secrets): `FILO_BEARER_TOKEN`
  (your login, also entered in the app's token gate) and `ANTHROPIC_API_KEY`
  (correction + seal). Optional `SECOND_BRAIN_URL` / `SECOND_BRAIN_TOKEN`.
- **Logs:** observability is on (`wrangler.toml`) — Worker → Logs → live stream.
  Seal/correction failures log a safe reason (`anthropic_http_401`, etc.) with no
  writing content.
- **Data:** documents/lines/seals live in the `filo` D1 database
  (`231c6ee9-…`); schema is `server/migrations/0001_init.sql`.

## Status — live ✅

MVP shipped and deployed across all three spec phases (capture core, silent
correction, seal & format). Optional follow-ups: wire the seal→2nd-brain push
(an ingest endpoint on the 2nd-brain Worker), and final visual-design polish of
the quiet status / fade treatment (§7/§10 open questions).

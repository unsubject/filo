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
| Frontend (`web/`) | Vite + React + TypeScript SPA (Cloudflare Pages) |
| Backend (`server/`) | Cloudflare Worker + Hono, D1 (SQLite) |
| AI | Claude API — **Haiku** for silent correction, **Sonnet** for seal-time formatting |
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
npm test            # server (28) + web (19)
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
5. **Deploy the Worker:** `npx wrangler deploy`
6. **Deploy the SPA** (Cloudflare Pages): build `web/` (`npm run build` → `web/dist`)
   and deploy it; set `VITE_API_BASE` to the deployed Worker URL and provide the
   bearer token (via `VITE_FILO_TOKEN` at build time or `localStorage.filo_token`
   at runtime). Pin `CORS_ORIGIN` in `wrangler.toml` to the Pages origin if you
   don't want `*`.
7. **Verify model IDs** are current on your account before production traffic:
   correction `claude-haiku-4-5-20251001`, seal `claude-sonnet-5`.

## Status

MVP implemented across all three spec phases (capture core, silent correction,
seal & format), with the acceptance-test matrix covered offline. Not yet done:
live deployment (needs the account/secrets above) and final visual-design polish
of the quiet status/fade treatment (§7/§10 open questions).

# filo — web (SPA)

The Vite + React + TypeScript writing canvas for `filo`. See the root
`PRODUCT_SPEC.md` for the full product spec; this package implements the
frontend slice (§4, §7 and the frontend items of §8).

## Scripts

```bash
npm install        # install deps
npm run dev        # Vite dev server
npm run typecheck  # tsc --noEmit
npm test           # vitest run (jsdom, no backend needed)
npm run build      # tsc -b && vite build
```

## Configuration

| Variable         | Purpose                          | Default                 |
| ---------------- | -------------------------------- | ----------------------- |
| `VITE_API_BASE`  | Base URL of the filo Worker API  | `http://localhost:8787` |
| `VITE_FILO_TOKEN`| **Local-dev only** bearer token  | _(unset)_               |

Copy `.env.example` to `.env.local` for local dev.

### The bearer token is runtime-only

The single-user bearer token is resolved at request time from
`localStorage["filo_token"]` — never from the bundle. This matters:
`VITE_FILO_TOKEN` is a Vite build-time variable, so putting the real token there
**inlines it into the static JS** shipped to Cloudflare Pages, where anyone who
can load the app could recover it and call every API route (spec §6). So:

- **Production:** set the token at runtime. On first load the app shows a small
  token gate (outside the writing canvas); the value is stored in
  `localStorage["filo_token"]` on your device only. You can also set it manually:

  ```js
  localStorage.setItem("filo_token", "<your-token>");
  ```

- **Local dev:** `VITE_FILO_TOKEN` is a convenience that only **seeds**
  localStorage during `npm run dev` (via `seedDevToken`, guarded by
  `import.meta.env.DEV`, so the literal is dead-code-eliminated from production
  builds). Never rely on it for a real deployment; leave it blank for prod.

Never commit a real token; `.env` / `.env.*` are gitignored.

## Architecture

- `src/api/` — typed API client (`FiloApi`) matching the backend surface in
  spec §5.3, plus the shared data-model types (§5.2). Errors surface as
  `ApiError` carrying the stable `{ error: { code, message } }` envelope.
- `src/state/useFilo.ts` — the single store hook: document list, the active
  document + optimistic line stack, the full keyboard/IME commit logic, undo /
  restore-raw, silent-correction debounce + reconcile-on-open, seal / export,
  and the derived quiet status.
- `src/components/` — `WritingCanvas`, `Composer` (keyboard contract wiring),
  `LineStack` (contrast hierarchy, no per-line affordances), `StatusSurface`
  (one quiet status + around-canvas notices), `DocumentSwitcher`.
- `src/App.tsx` — wires the store to the UI. Accepts an injectable `api` prop so
  tests run fully offline against `src/test/fakeApi.ts`.

## Tests

`npm test` runs the frontend slice of the §8 acceptance matrix in jsdom with a
deterministic in-memory API — no backend required.

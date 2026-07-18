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

The API client reads two environment variables at build/dev time via Vite:

| Variable         | Purpose                              | Default                 |
| ---------------- | ------------------------------------ | ----------------------- |
| `VITE_API_BASE`  | Base URL of the filo Worker API      | `http://localhost:8787` |
| `VITE_FILO_TOKEN`| Single-user bearer token (all routes)| _(unset)_               |

Copy `.env.example` to `.env.local` and fill these in for local dev. The token
is optional in the file — if `VITE_FILO_TOKEN` is unset, the client falls back
to `localStorage.getItem("filo_token")`, so you can also set it at runtime:

```js
localStorage.setItem("filo_token", "<your-token>");
```

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

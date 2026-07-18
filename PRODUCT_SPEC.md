# filo — Product Spec

> A distraction-free, typewriter-style capture tool for writing line by line.

## 1. Vision

Simon writes best when he can focus on one line at a time without distraction —
a habit shaped by years of chat apps, where thought arrives sentence by
sentence and each `Enter` sends it on its way. `filo` recreates that feeling for
personal writing.

You type a line. You press **Enter**. The line drops into the document above,
the composer clears, and you write the next one. It should feel like a
mechanical typewriter — *similar, but not the same*: once a line is committed it
belongs to the document, and momentum carries forward.

`filo` is a **capture tool, not an editor.** It exists to get words down without
friction. Real editing, restructuring, and polishing happen in another tool
downstream. `filo`'s only jobs are to (a) capture cleanly, (b) silently fix
high-confidence spelling and grammar in the background so you never stop to
fix a typo, and (c) format the raw lines into clean structure when you
explicitly *seal* a document.

Bilingual by default: English and Traditional Chinese (Hong Kong register),
mixed freely within the same document.

## 2. Principles

1. **The screen shows nothing but the writing.** No toolbars, no menus in the
   way, no spellcheck squiggles, no grammar nags, no counters demanding
   attention.
2. **Never interrupt the writer.** AI is invisible while you write. Corrections
   arrive silently, after the fact. Nothing ever steals the cursor or asks you
   to accept a suggestion mid-flow.
3. **Capture, don't edit.** Committed lines are not editable inside `filo`.
   Forward momentum over fiddling.
4. **Trust the writer's momentum.** The only correction `filo` makes on its own
   is high-confidence spelling/grammar — it never rephrases, restructures, or
   changes meaning, tone, or voice.
5. **Bilingual is first-class,** not an afterthought. Chinese input (IME) must
   feel exactly as smooth as English.

## 3. Locked design decisions

| Area | Decision |
|---|---|
| Platform | Web app (SPA), single-user, cloud sync across devices |
| Writing model | Chat-composer: type → **Enter** → line commits into the doc above; composer clears |
| Editing | Committed lines are **not editable** in `filo`; only action is *delete most recent line(s)* — a repeatable undo-last |
| Auto-correct | Silent, background, **high-confidence spelling/grammar only** — never rephrase or restructure |
| Correction timing | Line commits instantly as typed; the correction lands a moment later, in place |
| Bilingual | Mix English + 繁中 freely within one document; language auto-detected per line |
| Documents | Discrete named documents (a document list; create / open) |
| Seal / format | On-demand **seal** action turns raw lines into clean formatted markdown |
| Seal output | Stored in `filo` + downloadable `.md` **and** pushable to 2nd-brain |
| Auth | Single-user bearer token |
| Stack | Cloudflare Worker API + **D1** (SQLite) + Claude API; SPA on Cloudflare Pages |
| Models | **Haiku** for the silent correction pass (fast, cheap); **Sonnet** for seal-time formatting |

## 4. User experience

### 4.1 The writing canvas

A full-screen, distraction-free surface:

- Committed lines stack upward, rendered in a muted/dimmed style — present, but
  not competing for attention.
- A single composer input is pinned at the bottom, like a chat message box.
- Pressing **Enter** commits the current line: it moves up into the document,
  the composer clears, focus stays in the composer.
- The browser's own spellcheck and autocorrect are disabled
  (`spellcheck=false`, `autocorrect`/`autocapitalize` off) so nothing underlines
  or rewrites while you type.
- No visible word count, no formatting toolbar, no AI suggestions in view.

### 4.2 IME safety (make-or-break for Traditional Chinese)

Chinese input relies on an IME composition session: you type romanization/phonetics
and press keys — including **Enter** — to *select candidate characters*. `filo`
**must not** commit a line when Enter is pressed during an active composition.

- Track composition state via `compositionstart` / `compositionend` events.
- The Enter handler commits a line **only** when no composition is in progress.
- This applies equally to any input method that uses composition (Cantonese,
  Pinyin, Cangjie, etc.).

This is the single most important interaction detail in the product. If it is
wrong, the tool is unusable for half its purpose.

### 4.3 Mistake recovery

There is no in-place editing of committed lines. The only recovery action is
**delete the most recent line(s)** — an undo-last that can be repeated to pull
back several recent lines. Everything older is considered sealed for the
downstream editor. (Suggested bindings: a visible undo affordance plus a
keyboard shortcut such as `Cmd/Ctrl+Backspace`; exact binding TBD in build.)

### 4.4 Documents

Writing is organized into **discrete, named documents**. A minimal document list
lets you create a new document or open an existing one. The writing canvas stays
uncluttered; document management lives behind a light, out-of-the-way menu.

### 4.5 Silent correction

- A line commits **instantly** and is persisted exactly as typed (`raw_text`).
- A moment later, a background pass corrects **only medium-to-high-confidence
  spelling and grammar errors** and updates the line **in place**, silently.
- No diff, no "accept/reject", no marker that interrupts. (An optional, purely
  passive indicator of correction state is allowed but must never demand
  attention.)
- Mixed English / 繁中 is handled per line with language detected inline.

### 4.6 Seal & format

When a document is ready, the user **seals** it. This is the one moment `filo`
does heavier AI work:

- The raw (corrected) lines are formatted into clean, structured markdown —
  headings, paragraphs, sensible structure — without changing the words'
  meaning or voice.
- The sealed result is **stored in `filo`**, **downloadable as an `.md` file**,
  and can be **pushed to Simon's 2nd-brain** journal.

## 5. Architecture

### 5.1 Overview

- **Frontend:** minimal SPA on **Cloudflare Pages**. Recommended: **Vite +
  React + TypeScript** (low-stakes, swappable). The whole UI is the canvas +
  composer + a light document switcher.
- **Backend:** **Cloudflare Worker** API with **D1** (SQLite) storage.
- **Auth:** single-user **bearer token** on every route (matching the pattern
  Simon already ships for his 2nd-brain server).
- **AI:** Claude API — **Haiku** for the frequent, cheap, silent correction
  pass; **Sonnet** for the occasional, higher-quality seal-time formatting.
- **Sync:** the server is the source of truth; every device reads/writes through
  the Worker API, so documents follow Simon across devices.

### 5.2 Data model (D1)

```sql
documents(
  id, title, created_at, updated_at, sealed_at, status        -- status: draft | sealed
)

lines(
  id, document_id, seq,
  raw_text,            -- exactly as typed, kept for provenance
  corrected_text,      -- what is displayed after the silent pass (null until corrected)
  corrected_at,
  created_at
)

seals(
  id, document_id, formatted_markdown, model, created_at       -- history of sealed outputs
)
```

`raw_text` is never overwritten; `corrected_text` holds the silent fix and is
what renders. Keeping both preserves provenance and makes correction reversible.

### 5.3 API surface

| Method & path | Purpose |
|---|---|
| `GET /documents` | List documents |
| `POST /documents` | Create a document |
| `GET /documents/:id` | Fetch a document with its lines |
| `PATCH /documents/:id` | Rename / update metadata |
| `DELETE /documents/:id` | Delete a document |
| `POST /documents/:id/lines` | Commit a line `{raw_text}` → returns the (uncorrected) line |
| `DELETE /documents/:id/lines/last` | Undo the most recent commit |
| `POST /documents/:id/correct` | Batch-correct pending lines (Haiku), silent in-place update |
| `POST /documents/:id/seal` | Format via Sonnet, store the seal, return markdown; optional 2nd-brain push |
| `GET /documents/:id/export.md` | Download the sealed markdown |

All routes require the bearer token.

### 5.4 Correction flow

1. Client commits a line → `POST /lines` persists `raw_text` and it appears
   immediately.
2. After a short debounce of inactivity, the client calls `POST /correct`,
   which batches any lines still lacking `corrected_text`.
3. The Worker sends the batch to **Haiku** with a strict instruction:

   > Fix only medium-to-high-confidence spelling and grammar errors. Do **not**
   > rephrase, restructure, or change meaning, tone, or style. Preserve mixed
   > English and Traditional Chinese exactly. If there is no confident fix,
   > return the line unchanged.

4. Corrected text is written to `corrected_text` and quietly replaces the
   displayed line.

Batching + debounce keeps API calls and latency low; language is handled inline,
so no separate language detector is needed.

### 5.5 Seal flow

1. `POST /seal` gathers the document's lines (corrected where available).
2. **Sonnet** formats them into clean structured markdown, preserving wording
   and voice.
3. The result is stored in `seals`, returned to the client, made available at
   `GET /export.md`, and — if requested — pushed to 2nd-brain via its API/MCP.

## 6. Build phasing

1. **Phase 1 — Capture core.** Worker + D1 + bearer auth; documents CRUD; line
   commit + undo-last; IME-safe SPA canvas; cloud persistence and cross-device
   sync. No AI yet — pure, reliable capture that syncs.
2. **Phase 2 — Silent correction.** Background Haiku pass, silent in-place
   update, `raw`/`corrected` provenance.
3. **Phase 3 — Seal & format.** Sonnet format-at-seal, stored + downloadable
   `.md`, push to 2nd-brain.
4. **Later.** Desktop / mobile wrappers, offline queue with sync-on-reconnect,
   optional translation help, Notion export, richer keyboard-driven document
   navigation.

## 7. Open questions / to settle during build

- Exact keyboard bindings (commit, undo-last, new document, switch document).
- Debounce window and batch size for the correction pass.
- Whether to show any passive "corrected / syncing" indicator, or truly nothing.
- Offline behavior for v1 (server-of-truth only vs. a local queue) — currently
  deferred to *Later*.
- 2nd-brain push: which channel/format a sealed piece should land as.

## 8. Non-goals (for now)

- Not a rich-text editor; no in-place editing of committed lines.
- No collaborative / multi-user features — single-user only.
- No interruptive AI: no inline suggestions, autocomplete, or accept/reject
  prompts during writing.
- No translation between languages during capture (may come *Later*).

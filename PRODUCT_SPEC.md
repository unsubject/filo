# filo — Product Spec

> A distraction-free, typewriter-style capture tool for writing line by line.

*Revision 3 — refined after the round-2 review (`PRODUCT_SPEC_REVIEW.md`, PR #2;
round-1 review preserved in PR #1). The core vision is unchanged; this revision
adds the full keyboard/IME contract, blank-line policy, document titling &
switcher behavior, export HTTP semantics, an API error envelope, expanded quiet
states, testable capture rules, and a design/visual section.*

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

**"Capture, not editor" as concrete, testable rules.** The principle above is
enforced by these prohibitions, which hold as features accumulate:

- No cursor placement inside committed lines.
- No per-line edit buttons, diffs, or correction badges in the line stack.
- No inline AI suggestions or autocomplete.
- No rich-text formatting toolbar.
- Undo-last and latest-line restore-raw are the **only** destructive actions on
  the writing canvas.
- Rename, delete-document, seal, and export live **outside** the writing rhythm
  (in the document menu/switcher, never adjacent to the text cursor).

## 3. Locked design decisions

| Area | Decision |
|---|---|
| Platform | Web app (SPA), single-user, cloud sync across devices |
| Writing model | Chat-composer: type → **Enter** → line commits into the doc above; composer clears |
| Editing | Committed lines are **not editable** in `filo`; recovery is *delete most recent line(s)* (repeatable undo-last) plus *restore-raw* for the latest line |
| Auto-correct | Silent, background, **high-confidence spelling/grammar only** — never rephrase or restructure |
| Correction timing | Line commits instantly as typed; the correction lands a moment later, in place |
| Correction trigger | Client debounce **+ reconcile-on-open**; best-effort while the app is open (no queue infra in v1) |
| Bilingual | Mix English + 繁中 freely within one document; language auto-detected per line |
| Documents | Discrete named documents (a document list; create / open) |
| Seal / format | On-demand **seal** action turns raw lines into clean formatted markdown; re-seal allowed (versioned) |
| Seal output | Stored in `filo` + downloadable `.md` **and** pushable to 2nd-brain |
| Delete strategy | **Soft delete** (`deleted_at` tombstone); seal/export ignore deleted lines |
| Auth | Single-user bearer token (stored as a Cloudflare secret) |
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

**Quiet status surface.** Cloud sync and background AI introduce invisible
failure modes, so there is exactly **one** unobtrusive status affordance (a
small bottom-corner glyph or a row in the document menu). The rule: status is
there **if you look for it**, but it never competes with the composer and never
interrupts. All of the following are quiet and text-only — never a modal, toast,
or badge in the line stack:

`Saved · Syncing · Offline · Correction pending · Correction failed ·
Seal failed`.

**States around the canvas** must also be specified so the build never
improvises noisy UI — each is quiet, text-only copy:

- No documents yet (empty document list).
- Empty document (before the first line — see the first-run line in §4.4).
- Loading a document.
- Failed to load a document (with a quiet retry).
- Line commit failed (composer text retained — see §5.6).
- Correction failed (retryable).
- Seal failed (draft untouched, retryable).
- Export unavailable because the document has never been sealed.

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

**Complete keyboard contract.** Enter is the primary action and is overloaded
across desktop, mobile, and IMEs, so every case is defined explicitly (the goal
is to *prevent surprising commits*, not to add features):

| Input | Behavior |
|---|---|
| `Enter` while **not** composing | Commit the current **non-empty** line. |
| `Enter` while composing | Let the IME select candidates; **do not commit**. |
| Empty composer + `Enter` | **No-op** — never create an accidental blank line. |
| `Shift+Enter` | Commit an **intentional blank line** (pacing). |
| `Cmd/Ctrl+Enter` | Alternate explicit commit — useful for mobile / accessibility. |
| Mobile keyboard send/return | Same as `Enter` (commit); still gated by composition state. |

**Mobile / soft-keyboard contract.** The web app will be opened on phones, and
the whole interaction hinges on Enter — which mobile keyboards handle
inconsistently. Even before native wrappers, v1 must:

- Keep the composer usable with the virtual keyboard up; respect iOS safe-area
  insets so the composer isn't hidden.
- Provide a **visible commit/send affordance** (a send button) as a reliable
  fallback for keyboards without a dependable Enter key.
- Apply the same composition rule to mobile Chinese IMEs (Enter during
  composition never commits).

Deep mobile polish is deferred, but the Enter-dependency fallback ships in v1.

### 4.3 Mistake recovery

There is no in-place editing of committed lines. Two non-interruptive recovery
actions exist:

- **Undo-last** — delete the most recent line, repeatable to pull back several
  recent lines. See §4.7 for the precise contract.
- **Restore-raw (latest line only)** — if a silent correction changed the most
  recent line for the worse, one action reverts that line to exactly what you
  typed (`raw_text`). Scoped to the latest line only, to preserve the
  capture-not-edit model. Anything older is fixed downstream after export.

Suggested bindings: a visible undo affordance plus a shortcut such as
`Cmd/Ctrl+Backspace`; exact binding settled in build.

### 4.4 Documents

Writing is organized into **discrete, named documents**. A minimal document list
lets you create a new document or open an existing one. The writing canvas stays
uncluttered; document management lives behind a light, out-of-the-way menu.

**Titling never blocks capture.** A new document is **auto-titled by timestamp**
and opens the canvas immediately — you never name a document before writing.
Rename happens quietly later, from the document list.

**Document switcher primitives.** The switcher (out of the writing path) offers:
create · rename · delete · open draft · view latest sealed export · see sync
state. Sort order is defined to avoid ambiguity: **drafts first by `updated_at`
descending, then sealed-only documents**.

**First-run empty state.** Because the interaction model is unfamiliar, a new
document shows one dismissible line before the first commit — *"Write one line,
press Enter, keep going."* — then disappears.

### 4.5 Silent correction

- A line commits **instantly** and is persisted exactly as typed (`raw_text`).
- A moment later, a background pass corrects **only medium-to-high-confidence
  spelling and grammar errors** and updates the line **in place**, silently.
- No diff, no "accept/reject", no marker that interrupts. The only visible hint
  is the passive `Correction pending` status in §4.1.
- Mixed English / 繁中 is handled per line with language detected inline.
- Correction is **best-effort while the app is open**: triggered on a debounce
  and reconciled when a document is next opened (see §5.4). If a correction is
  wrong on the latest line, use restore-raw (§4.3).
- **Blank lines** (committed via `Shift+Enter`) are stored as a line with empty
  `raw_text` and `correction_status = 'skipped'`; the correction pass never
  touches them, undo-last treats them like any line, and seal reads them as
  paragraph breaks (§4.6).

### 4.6 Seal & format

When a document is ready, the user **seals** it. This is the one moment `filo`
does heavier AI work.

- The raw (corrected) lines are formatted into clean, structured markdown
  without changing the words' meaning or voice.
- **Formatting boundaries** (also drive the prompt and tests):
  - *Allowed:* headings, paragraphs, bullet lists, and blockquotes where clearly
    implied by the raw lines.
  - *Not allowed:* adding new claims, reordering (unless explicitly asked),
    summarizing, translating, changing register/voice, or inventing headings the
    content doesn't support.
  - Ambiguous fragments stay fragments — do not over-polish.
  - Intentional blank lines are honored as paragraph breaks. Return markdown
    only — no commentary.
- **Lifecycle:** sealing creates a **version** (a row in `seals`); the draft may
  keep going afterward. **Re-sealing is allowed** and appends to seal history.
  Export uses the **latest** seal by default. If a seal fails, the draft is
  untouched and the `Seal failed` status offers a retry.
- The sealed result is **stored in `filo`**, **downloadable as an `.md` file**,
  and can be **pushed to Simon's 2nd-brain** journal.

### 4.7 Undo-last contract

Undo-last is the primary recovery mechanism, so its behavior is defined
precisely:

- Removes the most recent **non-deleted** line, even if it has **already been
  corrected**.
- **Cannot cross a sealed boundary** — undo only affects lines added since the
  last seal.
- Optimistic locally (the line disappears immediately), then confirmed on sync.
- If a background correction completes for a line that was just undone, the
  correction write is a **no-op** (see the conditional guard in §5.4). Delete is
  a soft tombstone, so a late correction can never resurrect a removed line.

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
  id            TEXT PRIMARY KEY,
  title         TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'draft'
                  CHECK (status IN ('draft', 'sealed')),
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL,
  sealed_at     INTEGER            -- last successful seal, null if never sealed
);

lines(
  id                       TEXT PRIMARY KEY,
  document_id              TEXT NOT NULL
                             REFERENCES documents(id) ON DELETE CASCADE,
  client_line_id           TEXT NOT NULL,  -- client-generated, for idempotency
  seq                      INTEGER NOT NULL,-- server-assigned, monotonic per doc
  raw_text                 TEXT NOT NULL,  -- exactly as typed; never overwritten
                                           -- (empty string for a blank line)
  corrected_text           TEXT,           -- silent fix; null until corrected
  correction_status        TEXT NOT NULL DEFAULT 'pending'
                             CHECK (correction_status IN
                               ('pending','corrected','unchanged','failed','skipped')),
  correction_model         TEXT,
  correction_prompt_version TEXT,
  correction_error         TEXT,
  corrected_at             INTEGER,
  deleted_at               INTEGER,        -- soft-delete tombstone
  created_at               INTEGER NOT NULL,
  UNIQUE (document_id, seq),
  UNIQUE (document_id, client_line_id)
);

seals(
  id                TEXT PRIMARY KEY,
  document_id       TEXT NOT NULL
                      REFERENCES documents(id) ON DELETE CASCADE,
  formatted_markdown TEXT NOT NULL,
  model             TEXT NOT NULL,
  prompt_version    TEXT,
  created_at        INTEGER NOT NULL        -- newest row = current export
);

-- Indexes
CREATE INDEX idx_lines_doc_seq       ON lines(document_id, seq);
CREATE INDEX idx_lines_doc_pending   ON lines(document_id, correction_status, deleted_at);
CREATE INDEX idx_seals_doc_created   ON seals(document_id, created_at);
```

`raw_text` is never overwritten. `corrected_text` holds the silent fix and is
what renders when present; otherwise `raw_text` renders. Keeping both preserves
provenance and makes restore-raw and downstream cleanup trivial. `seq` is
assigned by the server inside a transaction so ordering is authoritative even
under concurrent/retried writes.

### 5.3 API surface

All routes require the bearer token.

| Method & path | Purpose |
|---|---|
| `GET /documents` | List documents |
| `POST /documents` | Create a document |
| `GET /documents/:id` | Fetch a document with its (non-deleted) lines |
| `PATCH /documents/:id` | Rename / update metadata |
| `DELETE /documents/:id` | Delete a document (and its seals) |
| `POST /documents/:id/lines` | Commit a line `{raw_text, client_line_id}` → returns the line with server `seq`; idempotent on `client_line_id` |
| `DELETE /documents/:id/lines/last` | Undo the most recent line (soft delete) |
| `POST /documents/:id/lines/:lineId/restore-raw` | Restore the latest line to `raw_text` (clears the correction) |
| `POST /documents/:id/correct` | Correct all still-pending, non-deleted lines (Haiku), silent in-place update |
| `POST /documents/:id/seal` | Format via Sonnet, append a `seals` row, return markdown; optional 2nd-brain push |
| `GET /documents/:id/export.md` | Download the latest sealed markdown (never seals implicitly) |

**Idempotency & ordering.** `POST /lines` carries a client-generated
`client_line_id`; the server assigns `seq` in a D1 transaction and enforces
`UNIQUE (document_id, seq)` and `UNIQUE (document_id, client_line_id)`. A retried
submit returns the existing line rather than creating a duplicate.

**Export semantics.** `GET /export.md` returns the **latest** seal and never
seals implicitly. If the document has never been sealed it returns **`409`**
with error code `no_seal`. On success: `Content-Type: text/markdown;
charset=utf-8`, and a safe download filename derived from the document title +
seal timestamp.

**Error envelope.** Every error response uses a stable shape so the frontend can
keep failure states calm and consistent:

```json
{ "error": { "code": "line_commit_failed",
             "message": "Could not save line. Your text is still in the composer." } }
```

Messages are reassuring and action-oriented, never raw stack detail.

### 5.4 Correction flow

1. Client commits a line → `POST /lines` persists `raw_text`
   (`correction_status = 'pending'`) and it appears immediately.
2. After a short debounce of inactivity, the client calls `POST /correct`, which
   batches all still-`pending`, non-deleted lines.
3. On **opening a document**, the client also calls `POST /correct` once to
   **reconcile** any lines left pending from a previous session (e.g. the tab
   was closed before the debounce fired). Correction is therefore best-effort
   while open and self-healing on next open — no queue infrastructure in v1.
4. The Worker sends the batch to **Haiku** with a strict instruction:

   > Fix only medium-to-high-confidence spelling and grammar errors. Do **not**
   > rephrase, restructure, or change meaning, tone, or style. Preserve mixed
   > English and Traditional Chinese exactly. If there is no confident fix,
   > return the line unchanged.

5. Corrected text is written with a **conditional guard** so it can never touch
   a line that was undone or already resolved:

   ```sql
   UPDATE lines
      SET corrected_text = ?, correction_status = 'corrected', corrected_at = ?
    WHERE id = ? AND correction_status = 'pending' AND deleted_at IS NULL;
   ```

   Corrections target stable line **IDs**, never `seq` alone. When the model
   returns text identical to `raw_text`, the line is marked
   `correction_status = 'unchanged'` (not `corrected`). A failure records
   `correction_status = 'failed'` + `correction_error` and can be retried.

Batching + debounce keeps API calls and latency low; language is handled inline,
so no separate language detector is needed.

### 5.5 Seal flow

1. `POST /seal` gathers the document's **non-deleted** lines in `seq` order
   (corrected text where present, else raw).
2. **Sonnet** formats them into clean structured markdown within the boundaries
   in §4.6, preserving wording and voice.
3. A new row is appended to `seals`; the result is returned to the client, made
   available at `GET /export.md` (latest seal), and — if requested — pushed to
   2nd-brain via its API/MCP. On failure the draft is untouched and the client
   surfaces `Seal failed` with a retry.

### 5.6 Online-first & retry contract

v1 is online-first (server is source of truth), but a minimal contract prevents
data loss without a full offline queue:

- Lines display optimistically the instant Enter is pressed.
- The composer's text is retained until the server acknowledges the commit; on
  failure the line is marked unsynced and retried, and nothing is lost.
- Failed seals and failed corrections are retryable from the quiet status
  surface.
- A full offline queue with sync-on-reconnect remains a *Later* item.

## 6. Security & privacy

Because `filo` sends personal writing to an AI API and holds journal-grade
content, security and privacy are specified, not assumed:

- **Auth:** the bearer token is stored as a **Cloudflare secret**, never in
  source or the client bundle. Compare tokens in a **timing-safe** way. Every
  route returns a uniform `401` that does not leak whether a route/resource
  exists.
- **Logging:** never log bearer tokens, and never log AI request/response
  payloads (they contain private writing).
- **Data sent to AI:** correction sends individual pending lines; seal sends the
  document's non-deleted lines. Nothing else is transmitted.
- **Retention & deletion:** `raw_text`, `corrected_text`, and `seals` persist
  until the user deletes the document; `DELETE /documents/:id` removes the
  document, its lines, and its seals. AI request/response logs are not stored.
- Anthropic's API does not use API inputs/outputs to train models by default;
  this is the basis for sending personal text.

## 7. Design & visual language

The look must serve the "nothing but writing" principle, not decorate it.

- **Spatial contrast hierarchy.** The composer has the highest contrast and a
  fixed bottom position. Recent committed lines are medium-low contrast; older
  lines fade further into scrollback. Status and document controls live at the
  edges and are **never** placed adjacent to the text cursor.
- **No correction affordances in the line stack.** No badges, diffs, or hover
  controls on committed lines — those turn capture into editing. Any correction
  signal is document-level only (the quiet status surface).
- **Undo is a safety affordance, not a toolbar.** A small, discoverable "Undo
  last" control in the lower chrome or command menu, revealing its shortcut once
  discovered — not styled like an editing toolbar.
- **Motion, sparingly.** If a committed line "drops" upward (the typewriter/chat
  metaphor), keep it subtle and fast. Correction replacements do **not** animate
  strongly — motion near text implies the system is editing alongside you.
- **IME visual stability.** During composition the composer must not flicker,
  resize, or lose focus, and custom key handling must not interfere with
  candidate windows. Test with Cantonese, Pinyin, Cangjie, and mobile
  Traditional Chinese keyboards.

## 8. Acceptance test matrix

These become the acceptance backbone across the build phases:

- Enter **commits** a line when not composing.
- Enter **does not commit** during IME composition (desktop and mobile).
- Empty composer + Enter **creates no line**; `Shift+Enter` creates exactly one
  intentional blank line.
- Rapid Enter presses **preserve line order** (server `seq` is monotonic).
- A retried/double-submitted line does **not** duplicate (idempotency).
- Undo-last works **while a correction is pending**, and a late correction on an
  undone line is a **no-op**.
- Undo-last **cannot cross a sealed boundary**.
- Correction **never changes** a line that had no confident error, and **skips**
  blank lines.
- Restore-raw returns the latest line to exactly what was typed.
- Seal **preserves language mix and ordering**; re-seal appends history; the
  seal prompt never summarizes, translates, or invents content.
- `GET /export.md` returns the **latest** seal, and **`409 no_seal`** when the
  document has never been sealed.
- **Every route** rejects unauthorized requests with a uniform `401`.

## 9. Build phasing

1. **Phase 1 — Capture core.** Worker + D1 (schema in §5.2) + bearer auth;
   documents CRUD with timestamp auto-title; line commit with idempotency +
   server `seq`; the full keyboard contract (incl. Shift+Enter blank lines);
   undo-last (soft delete); IME-safe SPA canvas with the mobile send fallback;
   quiet status + around-canvas states; online-first retry contract; cloud
   persistence and cross-device sync. No AI yet.
2. **Phase 2 — Silent correction.** Background Haiku pass with the conditional
   guard, client debounce + reconcile-on-open, correction metadata, restore-raw.
3. **Phase 3 — Seal & format.** Sonnet format-at-seal within the §4.6
   boundaries, versioned seals, export HTTP semantics, push to 2nd-brain.
4. **Later.** Native desktop / mobile wrappers, full offline queue with
   sync-on-reconnect, optional translation help, Notion export, richer
   keyboard-driven document navigation.

Each phase ships the relevant slice of the §8 test matrix as its acceptance
criteria.

## 10. Open questions / to settle during build

- Debounce window and batch size for the correction pass.
- Visual treatment of the quiet status glyph and the contrast-fade curve.
- 2nd-brain push: which channel/format a sealed piece should land as.

## 11. Non-goals (for now)

- Not a rich-text editor; no in-place editing of committed lines (beyond
  undo-last and latest-line restore-raw).
- No collaborative / multi-user features — single-user only.
- No interruptive AI: no inline suggestions, autocomplete, or accept/reject
  prompts during writing.
- No translation between languages during capture (may come *Later*).
- No full offline queue in v1 (online-first contract only).

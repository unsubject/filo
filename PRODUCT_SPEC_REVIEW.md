# filo — Round 2 Product Spec Review

This review evaluates the current `filo` product spec from three angles: usability, product design, and engineering readiness. The core concept remains compelling: a line-at-a-time capture surface that preserves writing momentum and defers editing until after capture. The main risks are now in the edge cases around Enter, IME composition, silent AI mutation, sync failure, and the exact lifecycle of a sealed document.

## Executive takeaways

1. **The product should treat Enter as a dangerous power tool.** Enter is the primary action, but it is also overloaded by desktop keyboards, mobile keyboards, and Chinese IMEs. The spec should define behavior for `Enter`, `Shift+Enter`, `Cmd/Ctrl+Enter`, composition events, and mobile send buttons before implementation.
2. **Silent correction needs a recovery contract.** The spec preserves `raw_text`, but the user-facing behavior when AI makes a bad correction is still ambiguous. Either make raw restore possible for the latest line or explicitly defer all correction disputes to downstream editing.
3. **Sync state must be quiet, not absent.** A distraction-free interface can still show tiny, non-interruptive status. Without this, users cannot tell the difference between saved writing, unsynced writing, failed correction, and failed seal.
4. **Seal needs a lifecycle.** The data model supports seal history, but the product does not yet decide whether sealing freezes capture, creates a version, or allows continued drafting.
5. **The API needs idempotency and race protection.** Rapid line commits, retries, undo-last, background correction, and multi-device use will otherwise produce duplicate lines, incorrect ordering, or correction updates for deleted lines.

## Usability review

### 1. Specify the complete keyboard contract

The spec currently says pressing **Enter** commits the current line, and IME composition must not commit. That is the right foundation, but it is not yet complete enough for implementation.

Recommended contract:

| Input | Expected behavior |
|---|---|
| `Enter` while not composing | Commit current non-empty line. |
| `Enter` while composing | Let the IME handle candidate selection; do not commit. |
| `Shift+Enter` | Either insert a soft line break in the composer or do nothing; choose one explicitly. |
| `Cmd/Ctrl+Enter` | Optional explicit commit shortcut, useful if `Enter` behavior changes on mobile or accessibility devices. |
| Empty composer + `Enter` | Do nothing; do not create blank lines unless blank lines are intentionally part of capture. |
| Mobile keyboard send/return | Define separately from desktop Enter because mobile keyboards vary by browser and locale. |

The usability goal is not to add features; it is to prevent surprising commits.

### 2. Add a visible commit fallback for mobile and accessibility

A pure keyboard interaction is elegant on desktop but fragile on phones, tablets, screen readers, and alternative input devices. Add a subtle send/commit affordance next to the composer. It can stay visually quiet, but it should exist so the product does not depend entirely on a hardware-style Enter key.

### 3. Clarify what the writer sees when correction changes text

Silent correction is intentionally invisible, but the user may still notice a committed line changing. The spec should decide whether corrected lines receive any passive treatment, such as:

- A brief, very subtle fade when corrected text replaces raw text.
- No visual animation at all.
- A passive status entry in the document menu showing correction activity.

The recommendation is to avoid per-line badges, because they invite editing. Use document-level status instead.

### 4. Define recovery from incorrect correction

The current model keeps `raw_text`, which is good, but it does not specify how the user benefits from that provenance. Choose one of these product positions:

- **Strict capture mode:** no restore action; the raw text exists for export/debugging only, and any correction dispute is fixed downstream.
- **Latest-line safety valve:** allow “restore raw for latest line” while the line is still within the undo window.
- **Export-time raw option:** export can use corrected text by default but optionally use raw text.

For the product philosophy, the best compromise is latest-line safety valve plus downstream editing for older lines.

### 5. Add empty, loading, and failure states

The spec describes the ideal writing surface but not the states around it. Define minimal copy and behavior for:

- No documents yet.
- Empty document.
- Loading document.
- Failed document load.
- Line commit failed.
- Correction failed.
- Seal failed.
- Export not available because the document has never been sealed.

These states can be quiet and text-only, but they should be specified so the implementation does not improvise noisy UI.

### 6. Decide whether blank lines are allowed

Writers may use blank lines as pacing. The current line model can technically store them, but the UX does not say whether empty Enter commits a blank line. Decide explicitly:

- If blank lines are allowed, require an intentional gesture such as `Shift+Enter` or a composer command.
- If blank lines are not allowed, seal-time formatting must infer paragraph breaks from content.

For a capture-first tool, disallow accidental empty lines but consider an intentional paragraph-break command later.

## Product-design review

### 1. Make document lifecycle explicit

The spec has `status: draft | sealed`, `sealed_at`, and a `seals` history table. That implies multiple possible product models. Pick one:

| Model | Pros | Cons |
|---|---|---|
| Seal freezes document | Simple mental model; preserves capture purity. | User must duplicate/reopen to continue writing. |
| Seal creates a version, draft continues | Flexible; aligns with seal history. | Requires more UI clarity around latest seal vs current draft. |
| Seal creates separate markdown artifact | Clean split between capture and output. | Requires an artifact list or export history. |

Recommendation: **seal creates a version and the draft may continue**, but the UI should say “Last sealed at…” and export should default to the latest seal.

### 2. Separate “document title” from “first line” behavior

The spec says documents are named, but it does not define how titles are created in a frictionless capture flow. Options:

- Ask for title before opening the canvas.
- Auto-title from timestamp and allow rename in the document list.
- Infer a title from the first committed line during seal.

Recommendation: auto-title new documents by timestamp and allow quiet rename later. Do not block capture on naming.

### 3. Define the minimal document switcher

Document management should stay out of the canvas, but cross-device document sync requires some UI. Specify the document switcher primitives:

- Create document.
- Rename document.
- Delete document.
- Open draft.
- View latest sealed export.
- See saved/sync state.

Avoid sorting ambiguity by defining sort order: drafts first by `updated_at` descending, sealed-only documents after that.

### 4. Make the “capture, not editor” promise testable

The principle is strong but should be converted into product rules:

- No cursor placement inside committed lines.
- No per-line edit buttons.
- No inline AI suggestions.
- No rich text toolbar.
- Undo-last is the only destructive writing-canvas action.
- Rename, delete document, seal, and export live outside the core writing rhythm.

These rules will protect the design as features accumulate.

### 5. Define formatting boundaries for seal

Seal should produce markdown structure without rewriting. Add concrete rules:

- Preserve line order unless headings or list grouping are directly implied.
- Preserve English and Traditional Chinese register.
- Do not translate.
- Do not summarize.
- Do not invent headings if the content does not support them.
- Prefer conservative paragraphs over clever restructuring.
- Return markdown only; no commentary.

This should become both prompt guidance and an acceptance criterion.

### 6. Add privacy posture to the product narrative

Because the tool is for personal writing, privacy is part of usability. Add a short user-facing privacy stance:

- Writing is stored in the user's private D1 database.
- Correction and seal send text to the configured AI provider.
- Deleting a document deletes its lines and seals from `filo` storage.
- The app avoids logging writing content in application logs.

Even for a single-user product, this shapes trust.

## Engineering review

### 1. Introduce client line IDs and idempotency

`POST /documents/:id/lines` should accept a client-generated ID or idempotency key. Without it, retries can duplicate lines. Recommended request:

```json
{
  "client_line_id": "uuid-or-ulid",
  "raw_text": "..."
}
```

Server behavior:

- If `client_line_id` is new, create the line.
- If it already exists for the document, return the existing line.
- Assign `seq` server-side in a transaction.
- Enforce uniqueness on `(document_id, client_line_id)` and `(document_id, seq)`.

### 2. Make ordering transactional

The `seq` field is central to the writing model. Generate it in the Worker with a D1 transaction or another concurrency-safe pattern. Do not let the client choose `seq`, because two devices can commit at the same time.

### 3. Model line lifecycle explicitly

Add a `status` or lifecycle fields for lines. Recommended fields:

- `correction_status`: `pending | corrected | unchanged | failed | skipped`
- `correction_error`: nullable text
- `correction_model`: nullable text
- `correction_prompt_version`: nullable text
- `deleted_at`: nullable timestamp if soft delete is selected

This improves retry behavior and makes silent AI operations observable to the system without making them noisy in the UI.

### 4. Protect undo-last from correction races

A likely race:

1. User commits line A.
2. Client queues correction for line A.
3. User invokes undo-last and deletes line A.
4. Correction returns and attempts to update line A.

Implementation rules:

- Correction updates by stable `line.id`, not by document position.
- Correction update includes `WHERE corrected_text IS NULL` and, if soft delete exists, `deleted_at IS NULL`.
- If the update affects zero rows, treat it as a benign no-op.

### 5. Reconsider client-triggered correction as the only mechanism

Client debounce is fine for Phase 2, but it means correction may never happen if the user closes the tab quickly. Options:

- Phase 2 simple path: client calls `POST /correct`; pending corrections are best-effort while app is open.
- More robust path: enqueue correction jobs when lines are created.
- Hybrid: keep `POST /correct` and also run opportunistic correction when fetching a document with pending lines.

The spec should choose one and document its reliability tradeoff.

### 6. Add D1 schema constraints and indexes

The schema should be implementation-grade. Recommended constraints:

```sql
CREATE TABLE documents (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('draft', 'sealed')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  sealed_at TEXT
);

CREATE TABLE lines (
  id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  client_line_id TEXT NOT NULL,
  seq INTEGER NOT NULL,
  raw_text TEXT NOT NULL,
  corrected_text TEXT,
  correction_status TEXT NOT NULL DEFAULT 'pending',
  corrected_at TEXT,
  created_at TEXT NOT NULL,
  deleted_at TEXT,
  UNIQUE(document_id, client_line_id),
  UNIQUE(document_id, seq)
);

CREATE INDEX lines_document_seq_idx ON lines(document_id, seq);
CREATE INDEX lines_pending_correction_idx ON lines(document_id, correction_status, deleted_at);
```

### 7. Define export semantics

`GET /documents/:id/export.md` should specify:

- Return `404` or `409` if no seal exists.
- Export latest seal by default.
- Use `Content-Type: text/markdown; charset=utf-8`.
- Use safe filename generation from title and seal timestamp.
- Do not run seal implicitly from export.

### 8. Specify API error shapes

Define a stable JSON error envelope:

```json
{
  "error": {
    "code": "line_commit_failed",
    "message": "Could not save line. Your text is still in the composer."
  }
}
```

This helps the frontend keep failure states calm and consistent.

### 9. Harden auth and logging

Add implementation requirements:

- Store bearer token as a Cloudflare secret.
- Never log the `Authorization` header.
- Avoid logging raw writing content, AI prompts, or AI responses by default.
- Return consistent `401` for missing and invalid tokens.
- Apply auth before route-specific work.

### 10. Add acceptance tests by phase

Recommended Phase 1 tests:

- Non-composition Enter commits exactly one line.
- Composition Enter commits zero lines.
- Rapid Enter commits preserve order.
- Empty Enter does not create a line unless blank-line behavior is explicitly enabled.
- Undo-last removes only the latest non-deleted line.
- Unauthorized requests fail for every API route.

Recommended Phase 2 tests:

- Correction preserves line count and order.
- Correction never updates deleted lines.
- Correction can retry failed pending lines.
- Mixed English and Traditional Chinese text is preserved unless there is a high-confidence typo fix.

Recommended Phase 3 tests:

- Seal stores a seal record.
- Re-seal behavior matches the chosen lifecycle.
- Export returns the latest seal.
- Seal prompt does not summarize, translate, or invent content.

## Design review

### 1. Preserve the “nothing but writing” surface with spatial hierarchy

The canvas should make committed lines visible but de-emphasized. Recommended hierarchy:

- Composer: highest contrast, fixed bottom position.
- Recent committed lines: medium-low contrast.
- Older committed lines: lower contrast or fade into scrollback.
- Status and document controls: available at edges, never adjacent to the text cursor.

This keeps focus on the next line while preserving enough context to continue.

### 2. Avoid correction affordances inside the line stack

Do not add correction badges, diffs, or hover controls to committed lines. Those patterns turn the capture surface into an editor. If correction status must exist, place it in a document-level status area.

### 3. Treat undo as a safety affordance, not a toolbar

Undo-last should be visible enough to discover but not styled like an editing toolbar. A small “Undo last” control in the lower chrome or command menu is enough. It should show the shortcut after discovery.

### 4. Design for IME composition visually as well as technically

During composition, the composer should not flicker, resize, or lose focus. Avoid custom key handling that interferes with candidate windows. Test with Cantonese, Pinyin, Cangjie, and mobile Traditional Chinese keyboards.

### 5. Keep document management off the writing path

Document list, rename, delete, seal history, and export should live behind a light menu or separate view. The writing view should have only:

- Document title or minimal document switcher.
- Line stack.
- Composer.
- Quiet status.
- Optional undo-last.
- Optional seal action when intentionally invoked.

### 6. Use motion sparingly

If the committed line “drops” upward like a typewriter/chat metaphor, keep it subtle and fast. Correction replacements should not animate strongly; motion near text can distract and imply the system is editing alongside the user.

## Highest-priority spec edits

1. Add a **keyboard and IME contract** covering desktop, mobile, composition, empty lines, and shortcut variants.
2. Add a **line lifecycle** covering raw, corrected, unchanged, failed, deleted, and correction metadata.
3. Add **idempotent line commit** with client line IDs and server-side sequence assignment.
4. Add **undo/correction race rules** so deleted lines cannot be resurrected or updated after undo.
5. Add a **document/seal lifecycle** describing whether sealing freezes, versions, or forks the draft.
6. Add **quiet status and failure states** for saved, syncing, offline, correction failed, seal failed, and export unavailable.
7. Add **privacy and logging requirements** for writing content and AI calls.
8. Add **phase-specific acceptance tests** before implementation begins.

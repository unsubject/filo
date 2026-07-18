# filo — Product Spec Review

This review suggests product-design and engineering improvements to tighten the existing `filo` spec before implementation. The core vision is strong: a single-purpose, line-by-line capture surface with silent correction and an explicit seal step. The recommendations below focus on reducing ambiguity, protecting the writing flow, and de-risking the Cloudflare/AI implementation.

## Product-design improvements

### 1. Define a small set of explicit user states

The current spec describes draft documents, sealed documents, pending corrections, and exports, but it does not yet define how those states appear to the user. Add a lightweight state model for:

- **Draft:** writable, line commits enabled, undo-last enabled.
- **Correcting:** draft remains writable while prior lines may update silently.
- **Sealed:** capture disabled or clearly separated from the sealed output.
- **Seal failed:** draft remains intact, with a retry affordance.
- **Export pushed:** markdown was successfully downloaded or sent to 2nd-brain.

This will make the product easier to reason about without adding interface clutter.

### 2. Clarify what “not editable” means after correction

The product principle is capture, not editing, but silent correction can still alter visible text after a line is committed. The spec should define how the writer can recover if the correction is wrong while still preserving the no-editing model.

Recommended approach:

- Keep `raw_text` as the canonical recovery fallback.
- Allow undo-last to remove corrected lines exactly as it removes raw lines.
- Add a non-interruptive “restore raw for latest line” action only for the most recent line, or define that incorrect corrections are fixed downstream after export.

Either choice is acceptable, but the spec should choose one before build.

### 3. Make undo-last behavior precise

Undo-last is the only recovery mechanism, so it should be specified tightly:

- Does undo remove the most recent line even if it has already been corrected?
- Can undo cross a sealed boundary?
- Is undo local-only until sync completes, or does it require a server round trip?
- What happens if correction completes for a line that has just been undone?

A precise undo contract will prevent race-condition bugs and confusing cross-device behavior.

### 4. Add a quiet sync/correction status language

The screen should remain distraction-free, but cloud sync and AI correction introduce invisible failure modes. The spec should define one quiet status surface, such as a small bottom-corner glyph or document-menu row, with states like:

- Saved
- Syncing
- Offline
- Correction pending
- Seal failed

The key product rule should be: status is available if the user looks for it, but it never competes with the composer.

### 5. Specify sealed-document behavior

The seal action is central, but the lifecycle after sealing is under-specified. Decide whether:

- Sealing freezes the draft permanently.
- Sealing creates a version while the draft can continue.
- Re-sealing is allowed and creates seal history.
- Export always uses the latest seal or lets the user choose prior seals.

The existing `seals` table supports history, so the product should expose or intentionally hide that versioning.

### 6. Define mobile ergonomics early

Even if wrappers are later, the web app will likely be used on phones. The spec should address:

- Virtual-keyboard behavior with the composer pinned at the bottom.
- Safe-area handling on iOS.
- Whether Enter commits on mobile keyboards or inserts nothing.
- A visible commit/send affordance for keyboards without a reliable Enter key.
- IME behavior on mobile Chinese keyboards.

This is especially important because the product’s main interaction depends on the Enter key.

### 7. Add a first-run and empty-state experience

The product has a strong conceptual model that may be unfamiliar. Add a minimal first-run empty state that explains the rule in one sentence, for example: “Write one line, press Enter, keep going.” Keep it dismissible or shown only before the first committed line.

### 8. Define markdown formatting boundaries

Seal-time formatting must preserve meaning and voice, but “clean structured markdown” can still be interpreted broadly. Add concrete formatting rules:

- Allowed: headings, paragraphs, bullet lists, blockquotes where clearly implied.
- Not allowed: adding new claims, changing order unless explicitly requested, summarizing, translating, changing register.
- Ambiguous fragments should remain as fragments rather than being over-polished.

This will make prompt design and tests much easier.

## Engineering improvements

### 1. Add API idempotency and ordering guarantees

Line capture is the core data path, so the API should prevent duplicates and preserve ordering under retry. Add:

- A client-generated `idempotency_key` or client line ID on `POST /documents/:id/lines`.
- A server-assigned monotonic `seq` inside a D1 transaction.
- A uniqueness constraint on `(document_id, seq)` and on `(document_id, client_line_id)` if client IDs are used.

This protects against double-submit, flaky networks, and multi-device races.

### 2. Move correction triggering server-side where possible

The spec currently has the client call `POST /correct` after a debounce. That is simple, but it couples background work to the browser staying open. Consider:

- Keep `POST /correct` for explicit/manual triggering.
- Add a Worker Queue, scheduled job, or opportunistic server-side correction after line writes.
- Ensure pending lines are corrected eventually even if the tab closes.

If Cloudflare Queues are too much for v1, document that correction is best-effort while the app is open.

### 3. Design correction as a versioned operation

Add fields that make AI behavior auditable and debuggable:

- `correction_model`
- `correction_prompt_version`
- `correction_status`
- `correction_error`
- `corrected_at`

This will help diagnose bad corrections, retry failures, and future prompt changes.

### 4. Add concurrency controls for correction and undo

Correction can race with undo-last. Engineering should ensure the correction update targets only existing pending lines and is safe if a line has been deleted. Recommended implementation details:

- Correct by stable line ID, not by sequence alone.
- Use conditional updates such as `WHERE id = ? AND corrected_text IS NULL`.
- Treat deleted lines as no-ops during correction writes.

### 5. Clarify delete strategy

Hard-deleting lines is simple, but provenance may matter. Decide between:

- **Hard delete:** simpler and aligned with undo-last.
- **Soft delete:** better auditability and safer cross-device sync.

If soft delete is chosen, add `deleted_at` and ensure seal/export ignore deleted lines.

### 6. Add offline and retry semantics, even if v1 is online-first

The spec defers offline behavior, but minimal retry semantics should exist in v1:

- What happens when line commit fails?
- Is the composer line retained until confirmed?
- Can the UI optimistically show a line before server acknowledgement?
- How are failed seals retried?

A small online-first contract will prevent data loss without building a full offline queue.

### 7. Add database indexes and constraints to the data model

The schema should specify practical D1 constraints:

- Primary keys for all tables.
- Foreign keys from `lines` and `seals` to `documents`.
- Index on `lines(document_id, seq)`.
- Index on `lines(document_id, corrected_at)` or a status field for pending correction lookup.
- Check constraint for `documents.status IN ('draft', 'sealed')`.

These are small additions that prevent common production issues.

### 8. Define authentication and secret handling more concretely

Single-user bearer auth is appropriate, but the spec should state:

- Token is stored as a Cloudflare secret, not in source.
- Compare tokens in a timing-safe way where feasible.
- Return consistent `401` responses without leaking route existence.
- Avoid logging bearer tokens or AI request payloads that may contain private writing.

### 9. Add privacy and retention rules for AI calls

Because the app sends personal writing to an AI API, the spec should include a privacy section:

- What text is sent for correction and sealing.
- Whether raw and corrected text are retained indefinitely.
- Whether AI request/response logs are stored.
- How to delete documents and associated seals.

This is important even for a single-user product because the content is likely personal journal material.

### 10. Create a test matrix around the core interaction

Before implementation, define tests for the make-or-break flows:

- Enter commits a line when not composing.
- Enter does not commit during IME composition.
- Rapid Enter presses preserve line order.
- Undo-last works while correction is pending.
- Correction never changes unchanged lines.
- Seal preserves language mix and ordering.
- Export returns the latest sealed markdown.
- Unauthorized requests are rejected on every route.

This should become the acceptance test backbone for Phase 1 through Phase 3.

## Suggested spec additions

The following sections would make `PRODUCT_SPEC.md` more implementation-ready:

1. **Document lifecycle:** draft, correcting, sealed, failed seal, re-seal behavior.
2. **Line lifecycle:** pending, corrected, correction failed, deleted.
3. **Sync contract:** optimistic vs confirmed commits, retry behavior, cross-device ordering.
4. **AI contract:** prompt versioning, correction constraints, seal formatting constraints, privacy.
5. **Mobile/IME contract:** desktop and mobile input behavior, composition tests, visible commit fallback.
6. **Acceptance criteria:** concise testable requirements for each build phase.

## Highest-priority changes before build

1. Specify undo/correction race behavior.
2. Add line idempotency and server-side ordering guarantees.
3. Define sealed-document lifecycle and re-seal behavior.
4. Add minimal sync/error status that does not disrupt the writing canvas.
5. Add IME-focused acceptance tests for desktop and mobile.

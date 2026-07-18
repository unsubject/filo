/**
 * Data-access layer (spec §5.2 schema, §5.3 API behavior). All SQL lives here
 * so route handlers stay thin and storage-agnostic.
 */
import type { SqlExecutor } from './executor.js';
import { newId } from '../ids.js';

export interface DocumentRow {
  id: string;
  title: string;
  status: 'draft' | 'sealed';
  created_at: number;
  updated_at: number;
  sealed_at: number | null;
}

export type CorrectionStatus =
  | 'pending'
  | 'corrected'
  | 'unchanged'
  | 'failed'
  | 'skipped';

export interface LineRow {
  id: string;
  document_id: string;
  client_line_id: string;
  seq: number;
  raw_text: string;
  corrected_text: string | null;
  correction_status: CorrectionStatus;
  correction_model: string | null;
  correction_prompt_version: string | null;
  correction_error: string | null;
  corrected_at: number | null;
  deleted_at: number | null;
  created_at: number;
}

export interface SealRow {
  id: string;
  document_id: string;
  formatted_markdown: string;
  model: string;
  prompt_version: string | null;
  created_at: number;
}

// ---------------------------------------------------------------------------
// Documents
// ---------------------------------------------------------------------------

export async function createDocument(
  db: SqlExecutor,
  opts: { id: string; title: string; now: number },
): Promise<DocumentRow> {
  await db.run(
    `INSERT INTO documents (id, title, status, created_at, updated_at, sealed_at)
     VALUES (?, ?, 'draft', ?, ?, NULL)`,
    [opts.id, opts.title, opts.now, opts.now],
  );
  const row = await getDocument(db, opts.id);
  if (!row) throw new Error('document insert failed');
  return row;
}

export async function getDocument(
  db: SqlExecutor,
  id: string,
): Promise<DocumentRow | undefined> {
  return db.get<DocumentRow>(`SELECT * FROM documents WHERE id = ?`, [id]);
}

/**
 * List documents. Sort order (spec §4.4): drafts first by updated_at
 * descending, then sealed-only documents.
 */
export async function listDocuments(db: SqlExecutor): Promise<DocumentRow[]> {
  return db.all<DocumentRow>(
    `SELECT * FROM documents
      ORDER BY (CASE WHEN status = 'draft' THEN 0 ELSE 1 END) ASC,
               updated_at DESC`,
  );
}

export async function updateDocumentMeta(
  db: SqlExecutor,
  id: string,
  patch: { title?: string; status?: 'draft' | 'sealed' },
  now: number,
): Promise<DocumentRow | undefined> {
  const sets: string[] = [];
  const params: unknown[] = [];
  if (patch.title !== undefined) {
    sets.push('title = ?');
    params.push(patch.title);
  }
  if (patch.status !== undefined) {
    sets.push('status = ?');
    params.push(patch.status);
  }
  sets.push('updated_at = ?');
  params.push(now);
  params.push(id);
  await db.run(`UPDATE documents SET ${sets.join(', ')} WHERE id = ?`, params);
  return getDocument(db, id);
}

export async function touchDocument(
  db: SqlExecutor,
  id: string,
  now: number,
): Promise<void> {
  await db.run(`UPDATE documents SET updated_at = ? WHERE id = ?`, [now, id]);
}

export async function deleteDocument(
  db: SqlExecutor,
  id: string,
): Promise<void> {
  // FKs use ON DELETE CASCADE, so lines and seals go with it.
  await db.run(`DELETE FROM documents WHERE id = ?`, [id]);
}

// ---------------------------------------------------------------------------
// Lines
// ---------------------------------------------------------------------------

/** Non-deleted lines in seq order (for fetching a document / sealing). */
export async function getLines(
  db: SqlExecutor,
  documentId: string,
): Promise<LineRow[]> {
  return db.all<LineRow>(
    `SELECT * FROM lines
      WHERE document_id = ? AND deleted_at IS NULL
      ORDER BY seq ASC`,
    [documentId],
  );
}

/**
 * Commit a line idempotently. `seq` is assigned server-side, monotonic per
 * document, computed atomically inside the INSERT. A retried submit with the
 * same client_line_id returns the existing row (ON CONFLICT DO NOTHING), never
 * a duplicate (spec §5.3 idempotency & ordering).
 */
export async function commitLine(
  db: SqlExecutor,
  opts: {
    documentId: string;
    clientLineId: string;
    rawText: string;
    now: number;
  },
): Promise<{ line: LineRow; created: boolean }> {
  const existingBefore = await db.get<LineRow>(
    `SELECT * FROM lines WHERE document_id = ? AND client_line_id = ?`,
    [opts.documentId, opts.clientLineId],
  );
  if (existingBefore) {
    return { line: existingBefore, created: false };
  }

  const id = newId('line');
  // Blank lines (Shift+Enter) are stored with correction_status='skipped'
  // and are never touched by the correction pass (spec §4.5).
  const status: CorrectionStatus = opts.rawText === '' ? 'skipped' : 'pending';

  await db.run(
    `INSERT INTO lines
       (id, document_id, client_line_id, seq, raw_text,
        correction_status, created_at)
     VALUES
       (?, ?, ?,
        (SELECT COALESCE(MAX(seq), -1) + 1 FROM lines WHERE document_id = ?),
        ?, ?, ?)
     ON CONFLICT(document_id, client_line_id) DO NOTHING`,
    [
      id,
      opts.documentId,
      opts.clientLineId,
      opts.documentId,
      opts.rawText,
      status,
      opts.now,
    ],
  );

  const row = await db.get<LineRow>(
    `SELECT * FROM lines WHERE document_id = ? AND client_line_id = ?`,
    [opts.documentId, opts.clientLineId],
  );
  if (!row) throw new Error('line commit failed');
  const created = row.id === id;
  return { line: row, created };
}

/** The most recent non-deleted line, or undefined. */
export async function getLatestLine(
  db: SqlExecutor,
  documentId: string,
): Promise<LineRow | undefined> {
  return db.get<LineRow>(
    `SELECT * FROM lines
      WHERE document_id = ? AND deleted_at IS NULL
      ORDER BY seq DESC LIMIT 1`,
    [documentId],
  );
}

/**
 * Soft-delete the most recent non-deleted line that was added since the last
 * seal (undo cannot cross a sealed boundary, spec §4.7). Returns the deleted
 * line, or undefined if there is nothing to undo.
 */
export async function softDeleteLastLine(
  db: SqlExecutor,
  documentId: string,
  now: number,
): Promise<LineRow | undefined> {
  const doc = await getDocument(db, documentId);
  const sealBoundary = doc?.sealed_at ?? null;

  // Latest line strictly after the last seal (by created_at) — undo only
  // affects lines added since the last seal.
  const latest = await db.get<LineRow>(
    sealBoundary === null
      ? `SELECT * FROM lines
           WHERE document_id = ? AND deleted_at IS NULL
           ORDER BY seq DESC LIMIT 1`
      : `SELECT * FROM lines
           WHERE document_id = ? AND deleted_at IS NULL AND created_at > ?
           ORDER BY seq DESC LIMIT 1`,
    sealBoundary === null ? [documentId] : [documentId, sealBoundary],
  );
  if (!latest) return undefined;

  await db.run(`UPDATE lines SET deleted_at = ? WHERE id = ?`, [now, latest.id]);
  return db.get<LineRow>(`SELECT * FROM lines WHERE id = ?`, [latest.id]);
}

/**
 * Restore the latest non-deleted line to its raw text: clears corrected_text
 * and resets correction_status so raw renders (spec §4.3, §5.3). Valid only for
 * the latest line and only for the given lineId.
 */
export async function restoreRawLatest(
  db: SqlExecutor,
  documentId: string,
  lineId: string,
  now: number,
): Promise<{ ok: boolean; line?: LineRow }> {
  const latest = await getLatestLine(db, documentId);
  if (!latest || latest.id !== lineId) {
    return { ok: false };
  }
  // Blank lines stay 'skipped'; everything else returns to 'pending'
  // (its raw text renders, and it is eligible for a future correction pass).
  const resetStatus: CorrectionStatus =
    latest.raw_text === '' ? 'skipped' : 'pending';
  await db.run(
    `UPDATE lines
        SET corrected_text = NULL,
            correction_status = ?,
            correction_model = NULL,
            correction_prompt_version = NULL,
            correction_error = NULL,
            corrected_at = ?
      WHERE id = ? AND deleted_at IS NULL`,
    [resetStatus, now, lineId],
  );
  const line = await db.get<LineRow>(`SELECT * FROM lines WHERE id = ?`, [
    lineId,
  ]);
  return { ok: true, line };
}

/** Pending, non-deleted, non-blank lines eligible for correction (§5.4). */
export async function getPendingLines(
  db: SqlExecutor,
  documentId: string,
): Promise<LineRow[]> {
  return db.all<LineRow>(
    `SELECT * FROM lines
      WHERE document_id = ?
        AND deleted_at IS NULL
        AND correction_status IN ('pending', 'failed')
        AND raw_text <> ''
      ORDER BY seq ASC`,
    [documentId],
  );
}

/**
 * Apply a correction result with the conditional guard from spec §5.4: the
 * write only lands if the line is not deleted and not already resolved. A late
 * correction on an undone (soft-deleted) line, or one already
 * corrected/unchanged/skipped, is a no-op. Returns true if the row was updated.
 *
 * The spec's illustrative guard is `correction_status = 'pending'`; we widen
 * the eligible set to include 'failed' so a failed correction is retryable
 * (spec §5.6) without weakening the core invariant (never touch a deleted line
 * or one that already reached a successful terminal state).
 */
export async function applyCorrection(
  db: SqlExecutor,
  opts: {
    lineId: string;
    status: 'corrected' | 'unchanged' | 'failed';
    correctedText: string | null;
    model: string;
    promptVersion: string;
    error: string | null;
    now: number;
  },
): Promise<boolean> {
  const res = await db.run(
    `UPDATE lines
        SET corrected_text = ?,
            correction_status = ?,
            correction_model = ?,
            correction_prompt_version = ?,
            correction_error = ?,
            corrected_at = ?
      WHERE id = ?
        AND correction_status IN ('pending', 'failed')
        AND deleted_at IS NULL`,
    [
      opts.correctedText,
      opts.status,
      opts.model,
      opts.promptVersion,
      opts.error,
      opts.now,
      opts.lineId,
    ],
  );
  return res.changes > 0;
}

// ---------------------------------------------------------------------------
// Seals
// ---------------------------------------------------------------------------

export async function insertSeal(
  db: SqlExecutor,
  opts: {
    documentId: string;
    markdown: string;
    model: string;
    promptVersion: string;
    now: number;
  },
): Promise<SealRow> {
  const id = newId('seal');
  await db.run(
    `INSERT INTO seals
       (id, document_id, formatted_markdown, model, prompt_version, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [id, opts.documentId, opts.markdown, opts.model, opts.promptVersion, opts.now],
  );
  // Record the successful seal on the document.
  await db.run(`UPDATE documents SET sealed_at = ?, updated_at = ? WHERE id = ?`, [
    opts.now,
    opts.now,
    opts.documentId,
  ]);
  const row = await db.get<SealRow>(`SELECT * FROM seals WHERE id = ?`, [id]);
  if (!row) throw new Error('seal insert failed');
  return row;
}

/** Latest seal for a document (newest created_at), or undefined. */
export async function getLatestSeal(
  db: SqlExecutor,
  documentId: string,
): Promise<SealRow | undefined> {
  return db.get<SealRow>(
    `SELECT * FROM seals
      WHERE document_id = ?
      ORDER BY created_at DESC, rowid DESC
      LIMIT 1`,
    [documentId],
  );
}

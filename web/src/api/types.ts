// Types mirror the D1 data model and API surface in PRODUCT_SPEC.md §5.2 / §5.3.

export type DocumentStatus = "draft" | "sealed";

export type CorrectionStatus =
  | "pending"
  | "corrected"
  | "unchanged"
  | "failed"
  | "skipped";

/** Row from `documents` — metadata only (no lines). */
export interface DocumentMeta {
  id: string;
  title: string;
  status: DocumentStatus;
  created_at: number;
  updated_at: number;
  /** Last successful seal; null if never sealed. */
  sealed_at: number | null;
}

/** Row from `lines`. `corrected_text` renders when present, else `raw_text`. */
export interface Line {
  id: string;
  document_id: string;
  client_line_id: string;
  /** Server-assigned, monotonic per document. */
  seq: number;
  /** Exactly as typed; empty string for an intentional blank line. */
  raw_text: string;
  /** Silent fix; null until corrected (or after restore-raw). */
  corrected_text: string | null;
  correction_status: CorrectionStatus;
  correction_model?: string | null;
  correction_prompt_version?: string | null;
  correction_error?: string | null;
  corrected_at?: number | null;
  deleted_at?: number | null;
  created_at: number;
}

/** GET /documents/:id — a document plus its non-deleted lines in seq order. */
export interface DocumentWithLines {
  document: DocumentMeta;
  lines: Line[];
}

/** Row from `seals`. */
export interface Seal {
  id: string;
  document_id: string;
  formatted_markdown: string;
  model: string;
  prompt_version?: string | null;
  created_at: number;
}

/** Result of POST /documents/:id/correct. */
export interface CorrectResult {
  lines: Line[];
}

/** Result of DELETE /documents/:id/lines/last. */
export interface UndoResult {
  /** The line that was soft-deleted, or null if there was nothing to undo. */
  deleted_line_id: string | null;
}

/** Stable error envelope from the API (§5.3). */
export interface ApiErrorEnvelope {
  error: {
    code: string;
    message: string;
  };
}

export interface SealOptions {
  /** Also push the sealed markdown to Simon's 2nd-brain journal. */
  pushToSecondBrain?: boolean;
}

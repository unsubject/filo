/**
 * Stable error envelope (spec §5.3). Every error response is
 * `{ "error": { "code", "message" } }` with a calm, action-oriented message.
 */
import type { Context } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';

export type ErrorCode =
  | 'unauthorized'
  | 'not_found'
  | 'validation_failed'
  | 'line_commit_failed'
  | 'nothing_to_undo'
  | 'restore_not_allowed'
  | 'correction_failed'
  | 'seal_failed'
  | 'no_seal'
  | 'internal_error';

export interface ErrorBody {
  error: { code: ErrorCode; message: string };
}

/** An error carrying an HTTP status, envelope code, and a user-facing message. */
export class ApiError extends Error {
  readonly status: ContentfulStatusCode;
  readonly code: ErrorCode;

  constructor(status: ContentfulStatusCode, code: ErrorCode, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

export function envelope(code: ErrorCode, message: string): ErrorBody {
  return { error: { code, message } };
}

/** Render an ApiError (or any thrown value) as the standard envelope. */
export function renderError(c: Context, err: unknown): Response {
  if (err instanceof ApiError) {
    return c.json(envelope(err.code, err.message), err.status);
  }
  // Never leak stack detail or private payloads (spec §6).
  return c.json(
    envelope('internal_error', 'Something went wrong. Please try again.'),
    500,
  );
}

// Common constructors with reassuring copy.
export const Errors = {
  unauthorized: () =>
    new ApiError(401, 'unauthorized', 'Not authorized.'),
  notFound: () =>
    new ApiError(404, 'not_found', 'That document could not be found.'),
  validation: (message: string) =>
    new ApiError(400, 'validation_failed', message),
  lineCommitFailed: () =>
    new ApiError(
      500,
      'line_commit_failed',
      'Could not save line. Your text is still in the composer.',
    ),
  nothingToUndo: () =>
    new ApiError(409, 'nothing_to_undo', 'There is nothing to undo.'),
  restoreNotAllowed: () =>
    new ApiError(
      409,
      'restore_not_allowed',
      'Only the latest line can be restored to what you typed.',
    ),
  correctionFailed: () =>
    new ApiError(
      502,
      'correction_failed',
      'Correction did not finish. You can try again.',
    ),
  sealFailed: () =>
    new ApiError(
      502,
      'seal_failed',
      'Sealing did not finish. Your draft is untouched — you can try again.',
    ),
  noSeal: () =>
    new ApiError(
      409,
      'no_seal',
      'This document has not been sealed yet, so there is nothing to export.',
    ),
} as const;

/**
 * Line routes (spec §5.3, §4.3, §4.5, §4.7): commit, undo-last, restore-raw.
 */
import type { Hono } from 'hono';
import type { AppEnv } from '../app.js';
import { Errors, renderError } from '../errors.js';
import {
  commitLine,
  getDocument,
  restoreRawLatest,
  softDeleteLastLine,
  touchDocument,
} from '../db/repo.js';

export function registerLineRoutes(app: Hono<AppEnv>): void {
  // Commit a line — idempotent on (document_id, client_line_id).
  app.post('/documents/:id/lines', async (c) => {
    const db = c.get('db');
    const now = c.get('now');
    const documentId = c.req.param('id');

    const doc = await getDocument(db, documentId);
    if (!doc) return renderError(c, Errors.notFound());

    const body = (await c.req.json().catch(() => null)) as {
      raw_text?: unknown;
      client_line_id?: unknown;
    } | null;
    if (!body) return renderError(c, Errors.validation('Expected a JSON body.'));

    // raw_text === '' is a valid intentional blank line (Shift+Enter).
    if (typeof body.raw_text !== 'string') {
      return renderError(c, Errors.validation('raw_text must be a string.'));
    }
    if (
      typeof body.client_line_id !== 'string' ||
      body.client_line_id.trim() === ''
    ) {
      return renderError(
        c,
        Errors.validation('client_line_id is required.'),
      );
    }

    try {
      const { line, created } = await commitLine(db, {
        documentId,
        clientLineId: body.client_line_id,
        rawText: body.raw_text,
        now,
      });
      if (created) await touchDocument(db, documentId, now);
      return c.json({ line }, created ? 201 : 200);
    } catch {
      return renderError(c, Errors.lineCommitFailed());
    }
  });

  // Undo-last: soft-delete the most recent non-deleted line (since last seal).
  app.delete('/documents/:id/lines/last', async (c) => {
    const db = c.get('db');
    const now = c.get('now');
    const documentId = c.req.param('id');

    const doc = await getDocument(db, documentId);
    if (!doc) return renderError(c, Errors.notFound());

    const deleted = await softDeleteLastLine(db, documentId, now);
    if (!deleted) return renderError(c, Errors.nothingToUndo());
    await touchDocument(db, documentId, now);
    return c.json({ deleted_line: deleted });
  });

  // Restore-raw: latest line only; clears the correction so raw renders.
  app.post('/documents/:id/lines/:lineId/restore-raw', async (c) => {
    const db = c.get('db');
    const now = c.get('now');
    const documentId = c.req.param('id');
    const lineId = c.req.param('lineId');

    const doc = await getDocument(db, documentId);
    if (!doc) return renderError(c, Errors.notFound());

    const result = await restoreRawLatest(db, documentId, lineId, now);
    if (!result.ok) return renderError(c, Errors.restoreNotAllowed());
    await touchDocument(db, documentId, now);
    return c.json({ line: result.line });
  });
}

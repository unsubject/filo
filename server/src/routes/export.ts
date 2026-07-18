/**
 * Export route (spec §5.3 export semantics): download the latest sealed
 * markdown. Never seals implicitly. 409 `no_seal` when never sealed.
 */
import type { Hono } from 'hono';
import type { AppEnv } from '../app.js';
import { Errors, renderError } from '../errors.js';
import { getDocument, getLatestSeal } from '../db/repo.js';
import { safeExportFilename } from '../ids.js';

export function registerExportRoute(app: Hono<AppEnv>): void {
  app.get('/documents/:id/export.md', async (c) => {
    const db = c.get('db');
    const documentId = c.req.param('id');

    const doc = await getDocument(db, documentId);
    if (!doc) return renderError(c, Errors.notFound());

    const seal = await getLatestSeal(db, documentId);
    if (!seal) return renderError(c, Errors.noSeal());

    const filename = safeExportFilename(doc.title, seal.created_at);
    return new Response(seal.formatted_markdown, {
      status: 200,
      headers: {
        'content-type': 'text/markdown; charset=utf-8',
        'content-disposition': `attachment; filename="${filename}"`,
      },
    });
  });
}

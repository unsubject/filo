/**
 * Document routes (spec §5.3): list, create, fetch (with lines), rename,
 * delete.
 */
import type { Hono } from 'hono';
import type { AppEnv } from '../app.js';
import { Errors, renderError } from '../errors.js';
import { newId, timestampTitle } from '../ids.js';
import {
  createDocument,
  deleteDocument,
  getDocument,
  getLines,
  listDocuments,
  updateDocumentMeta,
} from '../db/repo.js';

export function registerDocumentRoutes(app: Hono<AppEnv>): void {
  // List documents.
  app.get('/documents', async (c) => {
    const db = c.get('db');
    const docs = await listDocuments(db);
    return c.json({ documents: docs });
  });

  // Create a document (auto-titled by timestamp; never blocks capture).
  app.post('/documents', async (c) => {
    const db = c.get('db');
    const now = c.get('now');
    let title: string | undefined;
    try {
      const body = (await c.req.json().catch(() => ({}))) as {
        title?: unknown;
      };
      if (typeof body.title === 'string' && body.title.trim() !== '') {
        title = body.title.trim();
      }
    } catch {
      // Body is optional; ignore parse errors.
    }
    const doc = await createDocument(db, {
      id: newId('doc'),
      title: title ?? timestampTitle(now),
      now,
    });
    return c.json({ document: doc }, 201);
  });

  // Fetch a document with its non-deleted lines.
  app.get('/documents/:id', async (c) => {
    const db = c.get('db');
    const id = c.req.param('id');
    const doc = await getDocument(db, id);
    if (!doc) return renderError(c, Errors.notFound());
    const lines = await getLines(db, id);
    return c.json({ document: doc, lines });
  });

  // Rename / update metadata.
  app.patch('/documents/:id', async (c) => {
    const db = c.get('db');
    const now = c.get('now');
    const id = c.req.param('id');
    const doc = await getDocument(db, id);
    if (!doc) return renderError(c, Errors.notFound());

    const body = (await c.req.json().catch(() => null)) as {
      title?: unknown;
      status?: unknown;
    } | null;
    if (!body) return renderError(c, Errors.validation('Expected a JSON body.'));

    const patch: { title?: string; status?: 'draft' | 'sealed' } = {};
    if (body.title !== undefined) {
      if (typeof body.title !== 'string' || body.title.trim() === '') {
        return renderError(c, Errors.validation('Title cannot be empty.'));
      }
      patch.title = body.title.trim();
    }
    if (body.status !== undefined) {
      if (body.status !== 'draft' && body.status !== 'sealed') {
        return renderError(
          c,
          Errors.validation("Status must be 'draft' or 'sealed'."),
        );
      }
      patch.status = body.status;
    }
    if (patch.title === undefined && patch.status === undefined) {
      return renderError(c, Errors.validation('Nothing to update.'));
    }
    const updated = await updateDocumentMeta(db, id, patch, now);
    return c.json({ document: updated });
  });

  // Delete a document (and its lines + seals via ON DELETE CASCADE).
  app.delete('/documents/:id', async (c) => {
    const db = c.get('db');
    const id = c.req.param('id');
    const doc = await getDocument(db, id);
    if (!doc) return renderError(c, Errors.notFound());
    await deleteDocument(db, id);
    return c.json({ deleted: true, id });
  });
}

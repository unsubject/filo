/**
 * Seal route (spec §5.5, §4.6): format non-deleted lines via the AI client,
 * append a versioned seals row, optionally push to 2nd-brain.
 */
import type { Hono } from 'hono';
import type { AppEnv } from '../app.js';
import { Errors, renderError } from '../errors.js';
import { SEAL_MODEL, SEAL_PROMPT_VERSION } from '../ai/client.js';
import { getDocument, getLines, insertSeal } from '../db/repo.js';

export function registerSealRoute(app: Hono<AppEnv>): void {
  app.post('/documents/:id/seal', async (c) => {
    const db = c.get('db');
    const ai = c.get('ai');
    const sb = c.get('sb');
    const now = c.get('now');
    const documentId = c.req.param('id');

    const doc = await getDocument(db, documentId);
    if (!doc) return renderError(c, Errors.notFound());

    const body = (await c.req.json().catch(() => ({}))) as {
      push_to_second_brain?: unknown;
    };
    const wantPush = body.push_to_second_brain === true;

    // Gather non-deleted lines in seq order: corrected where present else raw;
    // blank lines are paragraph breaks.
    const rows = await getLines(db, documentId);
    const sealLines = rows.map((l) => ({
      seq: l.seq,
      text: l.corrected_text ?? l.raw_text,
      is_blank: l.raw_text === '',
    }));

    let markdown: string;
    try {
      markdown = await ai.formatSeal(sealLines, { title: doc.title });
    } catch {
      // Draft is untouched on failure (no seal row written).
      return renderError(c, Errors.sealFailed());
    }

    const seal = await insertSeal(db, {
      documentId,
      markdown,
      model: SEAL_MODEL,
      promptVersion: SEAL_PROMPT_VERSION,
      now,
    });

    let push: { pushed: boolean; reason?: string } | undefined;
    if (wantPush) {
      // Push is best-effort and never fails the seal.
      push = await sb.push({
        documentId,
        title: doc.title,
        markdown,
      });
    }

    return c.json({
      seal: {
        id: seal.id,
        document_id: seal.document_id,
        model: seal.model,
        prompt_version: seal.prompt_version,
        created_at: seal.created_at,
      },
      markdown,
      pushed: push?.pushed ?? false,
      push_reason: push?.reason,
    });
  });
}

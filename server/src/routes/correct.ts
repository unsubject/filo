/**
 * Correction route (spec §5.4): batch all still-pending, non-deleted, non-blank
 * lines through the AI client and write results with the conditional guard.
 */
import type { Hono } from 'hono';
import type { AppEnv } from '../app.js';
import { Errors, renderError } from '../errors.js';
import {
  CORRECTION_MODEL,
  CORRECTION_PROMPT_VERSION,
} from '../ai/client.js';
import {
  applyCorrection,
  getDocument,
  getLines,
  getPendingLines,
} from '../db/repo.js';

export function registerCorrectRoute(app: Hono<AppEnv>): void {
  app.post('/documents/:id/correct', async (c) => {
    const db = c.get('db');
    const ai = c.get('ai');
    const now = c.get('now');
    const documentId = c.req.param('id');

    const doc = await getDocument(db, documentId);
    if (!doc) return renderError(c, Errors.notFound());

    const pending = await getPendingLines(db, documentId);
    if (pending.length === 0) {
      const lines = await getLines(db, documentId);
      return c.json({
        corrected: 0,
        unchanged: 0,
        failed: 0,
        applied: 0,
        lines,
      });
    }

    let results;
    try {
      results = await ai.correctLines(
        pending.map((l) => ({ id: l.id, raw_text: l.raw_text })),
      );
    } catch (err) {
      // Whole-batch failure: record a per-line failure so it is retryable
      // (spec §5.6). Lines stay eligible for a later correction pass.
      const message = err instanceof Error ? err.message : 'correction_failed';
      results = pending.map((l) => ({
        id: l.id,
        corrected_text: l.raw_text,
        error: message,
      }));
    }
    const rawById = new Map(pending.map((l) => [l.id, l.raw_text]));
    const resultById = new Map(results.map((r) => [r.id, r]));

    let corrected = 0;
    let unchanged = 0;
    let failed = 0;
    let applied = 0;

    for (const line of pending) {
      const raw = rawById.get(line.id)!;
      const r = resultById.get(line.id);

      let status: 'corrected' | 'unchanged' | 'failed';
      let correctedText: string | null;
      let error: string | null;

      if (!r || r.error) {
        status = 'failed';
        correctedText = null;
        error = r?.error ?? 'missing_in_model_output';
        failed++;
      } else if (r.corrected_text === raw) {
        // Model returned identical text → 'unchanged', no stored fix.
        status = 'unchanged';
        correctedText = null;
        error = null;
        unchanged++;
      } else {
        status = 'corrected';
        correctedText = r.corrected_text;
        error = null;
        corrected++;
      }

      // Guarded write: a no-op if the line was undone or already resolved.
      const didApply = await applyCorrection(db, {
        lineId: line.id,
        status,
        correctedText,
        model: CORRECTION_MODEL,
        promptVersion: CORRECTION_PROMPT_VERSION,
        error,
        now,
      });
      if (didApply) applied++;
    }

    const lines = await getLines(db, documentId);
    return c.json({ corrected, unchanged, failed, applied, lines });
  });
}

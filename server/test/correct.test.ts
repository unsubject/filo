import { describe, it, expect } from 'vitest';
import { makeHarness, type Harness } from './harness.js';
import { commitLine, softDeleteLastLine, applyCorrection } from '../src/db/repo.js';
import { SqliteExecutor } from './sqlite-executor.js';
import { createDocument } from '../src/db/repo.js';

async function newDoc(h: Harness): Promise<string> {
  const res = await h.request('POST', '/documents');
  const { document } = (await res.json()) as { document: { id: string } };
  return document.id;
}

interface LineDto {
  id: string;
  raw_text: string;
  corrected_text: string | null;
  correction_status: string;
  correction_model: string | null;
  correction_prompt_version: string | null;
}

describe('correction pass (spec §5.4, §8)', () => {
  it('corrects typos, leaves clean lines unchanged, and skips blank lines', async () => {
    const h = makeHarness();
    const id = await newDoc(h);

    // A typo line, a clean line, and a blank line.
    await h.request('POST', `/documents/${id}/lines`, {
      body: { raw_text: 'teh cat', client_line_id: 'c-1' },
    });
    await h.request('POST', `/documents/${id}/lines`, {
      body: { raw_text: 'hello world', client_line_id: 'c-2' },
    });
    await h.request('POST', `/documents/${id}/lines`, {
      body: { raw_text: '', client_line_id: 'blank' },
    });

    const res = await h.request('POST', `/documents/${id}/correct`);
    expect(res.status).toBe(200);
    const summary = (await res.json()) as {
      corrected: number;
      unchanged: number;
      failed: number;
      applied: number;
      lines: LineDto[];
    };

    expect(summary.corrected).toBe(1);
    expect(summary.unchanged).toBe(1);
    expect(summary.failed).toBe(0);
    expect(summary.applied).toBe(2);

    const byRaw = new Map(summary.lines.map((l) => [l.raw_text, l]));
    const typo = byRaw.get('teh cat')!;
    expect(typo.correction_status).toBe('corrected');
    expect(typo.corrected_text).toBe('the cat');
    expect(typo.correction_model).toBe('claude-haiku-4-5-20251001');
    expect(typo.correction_prompt_version).toBe('correct-v1');

    const clean = byRaw.get('hello world')!;
    expect(clean.correction_status).toBe('unchanged');
    expect(clean.corrected_text).toBeNull();

    const blank = byRaw.get('')!;
    expect(blank.correction_status).toBe('skipped'); // never touched
  });

  it('is a no-op the second time (no pending lines left)', async () => {
    const h = makeHarness();
    const id = await newDoc(h);
    await h.request('POST', `/documents/${id}/lines`, {
      body: { raw_text: 'teh cat', client_line_id: 'c-1' },
    });
    await h.request('POST', `/documents/${id}/correct`);
    const second = await h.request('POST', `/documents/${id}/correct`);
    const summary = (await second.json()) as { applied: number };
    expect(summary.applied).toBe(0);
  });

  it('records failed + correction_error when the whole batch fails', async () => {
    const h = makeHarness({ fakeOptions: { failCorrection: true } });
    const id = await newDoc(h);
    await h.request('POST', `/documents/${id}/lines`, {
      body: { raw_text: 'teh cat', client_line_id: 'c-1' },
    });
    const res = await h.request('POST', `/documents/${id}/correct`);
    const summary = (await res.json()) as { failed: number; lines: LineDto[] };
    expect(summary.failed).toBe(1);
    const line = summary.lines[0]!;
    expect(line.correction_status).toBe('failed');
  });

  it('conditional guard: a late correction on an undone line is a no-op', async () => {
    // Direct repo-level test of the §5.4 guard: the line is soft-deleted
    // before the correction write lands.
    const db = new SqliteExecutor();
    const now = 1000;
    const doc = await createDocument(db, { id: 'doc_x', title: 't', now });
    const { line } = await commitLine(db, {
      documentId: doc.id,
      clientLineId: 'c-1',
      rawText: 'teh cat',
      now,
    });
    // Undo before the correction arrives.
    await softDeleteLastLine(db, doc.id, now + 1);

    const applied = await applyCorrection(db, {
      lineId: line.id,
      status: 'corrected',
      correctedText: 'the cat',
      model: 'm',
      promptVersion: 'v',
      error: null,
      now: now + 2,
    });
    expect(applied).toBe(false);

    const after = await db.get<LineDto>('SELECT * FROM lines WHERE id = ?', [
      line.id,
    ]);
    expect(after?.corrected_text).toBeNull();
    expect(after?.correction_status).toBe('pending');
    db.close();
  });
});

describe('restore-raw (spec §4.3, §8)', () => {
  it('restores the latest line to exactly what was typed', async () => {
    const h = makeHarness();
    const id = await newDoc(h);
    const commit = await h.request('POST', `/documents/${id}/lines`, {
      body: { raw_text: 'teh cat', client_line_id: 'c-1' },
    });
    const lineId = ((await commit.json()) as { line: LineDto }).line.id;

    await h.request('POST', `/documents/${id}/correct`);

    const restore = await h.request(
      'POST',
      `/documents/${id}/lines/${lineId}/restore-raw`,
    );
    expect(restore.status).toBe(200);
    const restored = ((await restore.json()) as { line: LineDto }).line;
    expect(restored.corrected_text).toBeNull();
    expect(restored.raw_text).toBe('teh cat');
    expect(restored.correction_status).toBe('pending');
  });

  it('rejects restore-raw on a non-latest line with 409', async () => {
    const h = makeHarness();
    const id = await newDoc(h);
    const first = await h.request('POST', `/documents/${id}/lines`, {
      body: { raw_text: 'first', client_line_id: 'c-1' },
    });
    const firstId = ((await first.json()) as { line: LineDto }).line.id;
    await h.request('POST', `/documents/${id}/lines`, {
      body: { raw_text: 'second', client_line_id: 'c-2' },
    });

    const restore = await h.request(
      'POST',
      `/documents/${id}/lines/${firstId}/restore-raw`,
    );
    expect(restore.status).toBe(409);
    const body = (await restore.json()) as { error: { code: string } };
    expect(body.error.code).toBe('restore_not_allowed');
  });
});

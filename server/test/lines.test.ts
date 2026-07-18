import { describe, it, expect } from 'vitest';
import { makeHarness, type Harness } from './harness.js';

async function newDoc(h: Harness): Promise<string> {
  const res = await h.request('POST', '/documents');
  const { document } = (await res.json()) as { document: { id: string } };
  return document.id;
}

interface LineDto {
  id: string;
  seq: number;
  raw_text: string;
  corrected_text: string | null;
  correction_status: string;
  deleted_at: number | null;
}

describe('line commit (spec §5.3, §8)', () => {
  it('is idempotent on client_line_id — a retried submit returns the existing line, no duplicate', async () => {
    const h = makeHarness();
    const id = await newDoc(h);

    const first = await h.request('POST', `/documents/${id}/lines`, {
      body: { raw_text: 'hello', client_line_id: 'c-1' },
    });
    expect(first.status).toBe(201);
    const firstLine = ((await first.json()) as { line: LineDto }).line;

    const retry = await h.request('POST', `/documents/${id}/lines`, {
      body: { raw_text: 'hello', client_line_id: 'c-1' },
    });
    expect(retry.status).toBe(200); // existing, not created
    const retryLine = ((await retry.json()) as { line: LineDto }).line;

    expect(retryLine.id).toBe(firstLine.id);
    expect(retryLine.seq).toBe(firstLine.seq);

    const doc = await h.request('GET', `/documents/${id}`);
    const { lines } = (await doc.json()) as { lines: LineDto[] };
    expect(lines).toHaveLength(1);
  });

  it('rapid commits preserve monotonic seq order', async () => {
    const h = makeHarness();
    const id = await newDoc(h);

    const n = 12;
    // Sequential awaits mimic rapid Enter presses through one worker.
    for (let i = 0; i < n; i++) {
      await h.request('POST', `/documents/${id}/lines`, {
        body: { raw_text: `line ${i}`, client_line_id: `c-${i}` },
      });
    }
    const doc = await h.request('GET', `/documents/${id}`);
    const { lines } = (await doc.json()) as { lines: LineDto[] };
    expect(lines).toHaveLength(n);
    lines.forEach((l, i) => {
      expect(l.seq).toBe(i);
      expect(l.raw_text).toBe(`line ${i}`);
    });
  });

  it('accepts a blank line (Shift+Enter) stored as correction_status=skipped', async () => {
    const h = makeHarness();
    const id = await newDoc(h);
    const res = await h.request('POST', `/documents/${id}/lines`, {
      body: { raw_text: '', client_line_id: 'blank-1' },
    });
    expect(res.status).toBe(201);
    const line = ((await res.json()) as { line: LineDto }).line;
    expect(line.raw_text).toBe('');
    expect(line.correction_status).toBe('skipped');
  });

  it('rejects a missing client_line_id and a non-string raw_text', async () => {
    const h = makeHarness();
    const id = await newDoc(h);
    const noClient = await h.request('POST', `/documents/${id}/lines`, {
      body: { raw_text: 'x' },
    });
    expect(noClient.status).toBe(400);
    const badRaw = await h.request('POST', `/documents/${id}/lines`, {
      body: { raw_text: 5, client_line_id: 'c' },
    });
    expect(badRaw.status).toBe(400);
  });
});

describe('undo-last (spec §4.3, §4.7, §8)', () => {
  it('soft-deletes the most recent non-deleted line and returns its id', async () => {
    const h = makeHarness();
    const id = await newDoc(h);
    await h.request('POST', `/documents/${id}/lines`, {
      body: { raw_text: 'first', client_line_id: 'c-1' },
    });
    const secondRes = await h.request('POST', `/documents/${id}/lines`, {
      body: { raw_text: 'second', client_line_id: 'c-2' },
    });
    const secondId = ((await secondRes.json()) as { line: LineDto }).line.id;

    const undo = await h.request('DELETE', `/documents/${id}/lines/last`);
    expect(undo.status).toBe(200);
    const { deleted_line_id } = (await undo.json()) as {
      deleted_line_id: string | null;
    };
    expect(deleted_line_id).toBe(secondId);

    const doc = await h.request('GET', `/documents/${id}`);
    const { lines } = (await doc.json()) as { lines: LineDto[] };
    expect(lines.map((l) => l.raw_text)).toEqual(['first']);
  });

  it('returns 200 with deleted_line_id null when there is nothing to remove', async () => {
    const h = makeHarness();
    const id = await newDoc(h);
    const undo = await h.request('DELETE', `/documents/${id}/lines/last`);
    expect(undo.status).toBe(200);
    const { deleted_line_id } = (await undo.json()) as {
      deleted_line_id: string | null;
    };
    expect(deleted_line_id).toBeNull();
  });

  it('cannot cross a sealed boundary', async () => {
    const h = makeHarness();
    const id = await newDoc(h);
    await h.request('POST', `/documents/${id}/lines`, {
      body: { raw_text: 'before seal', client_line_id: 'c-1' },
    });
    await h.request('POST', `/documents/${id}/seal`);

    // Nothing added since the seal → undo is a no-op (200, null id).
    const undo1 = await h.request('DELETE', `/documents/${id}/lines/last`);
    expect(undo1.status).toBe(200);
    const undo1Body = (await undo1.json()) as {
      deleted_line_id: string | null;
    };
    expect(undo1Body.deleted_line_id).toBeNull();

    // Add a line after the seal → undo removes only that line.
    const afterRes = await h.request('POST', `/documents/${id}/lines`, {
      body: { raw_text: 'after seal', client_line_id: 'c-2' },
    });
    const afterId = ((await afterRes.json()) as { line: LineDto }).line.id;
    const undo2 = await h.request('DELETE', `/documents/${id}/lines/last`);
    expect(undo2.status).toBe(200);
    const { deleted_line_id } = (await undo2.json()) as {
      deleted_line_id: string | null;
    };
    expect(deleted_line_id).toBe(afterId);

    // The pre-seal line survives.
    const doc = await h.request('GET', `/documents/${id}`);
    const { lines } = (await doc.json()) as { lines: LineDto[] };
    expect(lines.map((l) => l.raw_text)).toEqual(['before seal']);
  });
});

import { describe, it, expect } from 'vitest';
import { makeHarness } from './harness.js';

interface DocDto {
  id: string;
  title: string;
  status: string;
  sealed_at: number | null;
}

describe('documents CRUD (spec §4.4, §5.3)', () => {
  it('auto-titles a new document by timestamp and opens as a draft', async () => {
    const h = makeHarness();
    const res = await h.request('POST', '/documents');
    expect(res.status).toBe(201);
    const { document } = (await res.json()) as { document: DocDto };
    expect(document.status).toBe('draft');
    expect(document.title).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
    expect(document.sealed_at).toBeNull();
  });

  it('renames via PATCH and rejects an empty title', async () => {
    const h = makeHarness();
    const created = await h.request('POST', '/documents');
    const id = ((await created.json()) as { document: DocDto }).document.id;

    const ok = await h.request('PATCH', `/documents/${id}`, {
      body: { title: 'My Journal' },
    });
    expect(ok.status).toBe(200);
    expect(((await ok.json()) as { document: DocDto }).document.title).toBe(
      'My Journal',
    );

    const bad = await h.request('PATCH', `/documents/${id}`, {
      body: { title: '   ' },
    });
    expect(bad.status).toBe(400);
  });

  it('lists drafts first by updated_at desc', async () => {
    const h = makeHarness();
    const a = await h.request('POST', '/documents');
    const aId = ((await a.json()) as { document: DocDto }).document.id;
    const b = await h.request('POST', '/documents');
    const bId = ((await b.json()) as { document: DocDto }).document.id;

    // Touch A so it becomes most-recently-updated.
    await h.request('PATCH', `/documents/${aId}`, { body: { title: 'A2' } });

    const list = await h.request('GET', '/documents');
    const { documents } = (await list.json()) as { documents: DocDto[] };
    expect(documents[0]!.id).toBe(aId);
    expect(documents[1]!.id).toBe(bId);
  });

  it('DELETE removes the document and cascades to its lines and seals', async () => {
    const h = makeHarness();
    const created = await h.request('POST', '/documents');
    const id = ((await created.json()) as { document: DocDto }).document.id;
    await h.request('POST', `/documents/${id}/lines`, {
      body: { raw_text: 'x', client_line_id: 'c-1' },
    });
    await h.request('POST', `/documents/${id}/seal`);

    const del = await h.request('DELETE', `/documents/${id}`);
    expect(del.status).toBe(200);

    const get = await h.request('GET', `/documents/${id}`);
    expect(get.status).toBe(404);

    const lineCount = await h.db.get<{ n: number }>(
      'SELECT COUNT(*) AS n FROM lines WHERE document_id = ?',
      [id],
    );
    const sealCount = await h.db.get<{ n: number }>(
      'SELECT COUNT(*) AS n FROM seals WHERE document_id = ?',
      [id],
    );
    expect(lineCount?.n).toBe(0);
    expect(sealCount?.n).toBe(0);
  });

  it('returns 404 for an unknown document', async () => {
    const h = makeHarness();
    const res = await h.request('GET', '/documents/nope');
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('not_found');
  });
});

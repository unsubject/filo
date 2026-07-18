import { describe, it, expect } from 'vitest';
import { makeHarness, TEST_TOKEN, type Harness } from './harness.js';

async function newDoc(h: Harness): Promise<string> {
  const res = await h.request('POST', '/documents');
  const { document } = (await res.json()) as { document: { id: string } };
  return document.id;
}

describe('seal (spec §4.6, §5.5, §8)', () => {
  it('creates a versioned seal row and re-seal appends to history', async () => {
    const h = makeHarness();
    const id = await newDoc(h);
    await h.request('POST', `/documents/${id}/lines`, {
      body: { raw_text: 'first line', client_line_id: 'c-1' },
    });

    const seal1 = await h.request('POST', `/documents/${id}/seal`);
    expect(seal1.status).toBe(200);
    const s1 = (await seal1.json()) as {
      seal: { id: string; model: string; prompt_version: string };
      markdown: string;
    };
    expect(s1.seal.model).toBe('claude-sonnet-5');
    expect(s1.seal.prompt_version).toBe('seal-v1');
    expect(s1.markdown).toContain('first line');

    // Keep writing, then re-seal.
    await h.request('POST', `/documents/${id}/lines`, {
      body: { raw_text: 'second line', client_line_id: 'c-2' },
    });
    const seal2 = await h.request('POST', `/documents/${id}/seal`);
    const s2 = (await seal2.json()) as { seal: { id: string } };
    expect(s2.seal.id).not.toBe(s1.seal.id);

    const count = await h.db.get<{ n: number }>(
      'SELECT COUNT(*) AS n FROM seals WHERE document_id = ?',
      [id],
    );
    expect(count?.n).toBe(2);
  });

  it('preserves language mix and line ordering (blank line = paragraph break)', async () => {
    const h = makeHarness();
    const id = await newDoc(h);
    const lines = ['Hello 世界', '', '第二段 second paragraph'];
    for (let i = 0; i < lines.length; i++) {
      await h.request('POST', `/documents/${id}/lines`, {
        body: { raw_text: lines[i], client_line_id: `c-${i}` },
      });
    }
    const seal = await h.request('POST', `/documents/${id}/seal`);
    const { markdown } = (await seal.json()) as { markdown: string };
    expect(markdown).toContain('Hello 世界');
    expect(markdown).toContain('第二段 second paragraph');
    // Ordering preserved.
    expect(markdown.indexOf('Hello 世界')).toBeLessThan(
      markdown.indexOf('第二段'),
    );
  });

  it('pushes to 2nd-brain only when requested', async () => {
    const h = makeHarness();
    const id = await newDoc(h);
    await h.request('POST', `/documents/${id}/lines`, {
      body: { raw_text: 'content', client_line_id: 'c-1' },
    });

    await h.request('POST', `/documents/${id}/seal`, { body: {} });
    expect(h.sb.calls).toHaveLength(0);

    const withPush = await h.request('POST', `/documents/${id}/seal`, {
      body: { push_to_second_brain: true },
    });
    const body = (await withPush.json()) as { pushed: boolean };
    expect(body.pushed).toBe(true);
    expect(h.sb.calls).toHaveLength(1);
  });

  it('leaves the draft untouched and returns seal_failed on formatter failure', async () => {
    const h = makeHarness({ fakeOptions: { failSeal: true } });
    const id = await newDoc(h);
    await h.request('POST', `/documents/${id}/lines`, {
      body: { raw_text: 'content', client_line_id: 'c-1' },
    });
    const seal = await h.request('POST', `/documents/${id}/seal`);
    expect(seal.status).toBe(502);
    const body = (await seal.json()) as { error: { code: string } };
    expect(body.error.code).toBe('seal_failed');

    // No seal row written.
    const count = await h.db.get<{ n: number }>(
      'SELECT COUNT(*) AS n FROM seals WHERE document_id = ?',
      [id],
    );
    expect(count?.n).toBe(0);
  });
});

describe('export (spec §5.3, §8)', () => {
  it('returns 409 no_seal when the document has never been sealed', async () => {
    const h = makeHarness();
    const id = await newDoc(h);
    const res = await h.request('GET', `/documents/${id}/export.md`);
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('no_seal');
  });

  it('returns the latest seal with markdown content-type and a safe filename', async () => {
    const h = makeHarness();
    const id = await newDoc(h);
    await h.request('POST', `/documents/${id}/lines`, {
      body: { raw_text: 'version one', client_line_id: 'c-1' },
    });
    await h.request('POST', `/documents/${id}/seal`);

    // Re-seal after adding content; export must return the LATEST.
    await h.request('POST', `/documents/${id}/lines`, {
      body: { raw_text: 'version two', client_line_id: 'c-2' },
    });
    await h.request('POST', `/documents/${id}/seal`);

    const res = await h.request('GET', `/documents/${id}/export.md`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe(
      'text/markdown; charset=utf-8',
    );
    const disposition = res.headers.get('content-disposition') ?? '';
    expect(disposition).toContain('attachment');
    expect(disposition).toMatch(/filename=".*\.md"/);

    const text = await res.text();
    expect(text).toContain('version two');
  });

  it('exposes Content-Disposition cross-origin so the SPA can read the filename', async () => {
    const h = makeHarness();
    const id = await newDoc(h);
    await h.request('POST', `/documents/${id}/lines`, {
      body: { raw_text: 'exportable', client_line_id: 'c-1' },
    });
    await h.request('POST', `/documents/${id}/seal`);

    // A cross-origin GET (Origin header present) must carry
    // Access-Control-Expose-Headers listing Content-Disposition, otherwise the
    // browser hides it and the download falls back to filo-<id>.md.
    const req = new Request(`https://filo.test/documents/${id}/export.md`, {
      method: 'GET',
      headers: {
        authorization: `Bearer ${TEST_TOKEN}`,
        origin: 'https://filo.pages.dev',
      },
    });
    const res = await h.app.fetch(req, h.env);
    expect(res.status).toBe(200);
    const exposed = res.headers.get('access-control-expose-headers') ?? '';
    expect(exposed.toLowerCase()).toContain('content-disposition');
  });
});

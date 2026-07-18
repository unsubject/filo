import { describe, it, expect } from 'vitest';
import { makeHarness } from './harness.js';
import { timingSafeEqual } from '../src/auth.js';

describe('bearer auth (spec §6, §8)', () => {
  it('every route rejects unauthorized requests with a uniform 401 envelope', async () => {
    const h = makeHarness();
    // Seed a doc + line + seal with a valid token so protected resources exist.
    const created = await h.request('POST', '/documents');
    const { document } = (await created.json()) as { document: { id: string } };
    const id = document.id;

    const routes: Array<[string, string, unknown?]> = [
      ['GET', '/documents'],
      ['POST', '/documents'],
      ['GET', `/documents/${id}`],
      ['PATCH', `/documents/${id}`, { title: 'x' }],
      ['DELETE', `/documents/${id}`],
      ['POST', `/documents/${id}/lines`, { raw_text: 'a', client_line_id: 'c1' }],
      ['DELETE', `/documents/${id}/lines/last`],
      ['POST', `/documents/${id}/lines/line_x/restore-raw`],
      ['POST', `/documents/${id}/correct`],
      ['POST', `/documents/${id}/seal`],
      ['GET', `/documents/${id}/export.md`],
    ];

    for (const [method, path, body] of routes) {
      // No token at all.
      const noTok = await h.request(method, path, { body, token: null });
      expect(noTok.status, `${method} ${path} (no token)`).toBe(401);
      const noTokBody = (await noTok.json()) as {
        error: { code: string; message: string };
      };
      expect(noTokBody.error.code).toBe('unauthorized');

      // Wrong token.
      const badTok = await h.request(method, path, { body, token: 'wrong' });
      expect(badTok.status, `${method} ${path} (bad token)`).toBe(401);
      const badBody = (await badTok.json()) as { error: { code: string } };
      expect(badBody.error.code).toBe('unauthorized');
    }
  });

  it('401 does not reveal whether the resource exists', async () => {
    const h = makeHarness();
    const missing = await h.request('GET', '/documents/does-not-exist', {
      token: null,
    });
    expect(missing.status).toBe(401);
    const body = (await missing.json()) as { error: { code: string } };
    expect(body.error.code).toBe('unauthorized');
  });

  it('timingSafeEqual compares correctly', () => {
    expect(timingSafeEqual('abc', 'abc')).toBe(true);
    expect(timingSafeEqual('abc', 'abd')).toBe(false);
    expect(timingSafeEqual('abc', 'abcd')).toBe(false);
    expect(timingSafeEqual('', '')).toBe(true);
  });
});

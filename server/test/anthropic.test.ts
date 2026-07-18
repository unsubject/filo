import { describe, it, expect, vi, afterEach } from 'vitest';
import { AnthropicClient } from '../src/ai/anthropic.js';

/**
 * Offline unit tests for the REAL AnthropicClient with a mocked global `fetch`.
 * These lock the shared request path used by BOTH correctLines and formatSeal:
 * a 200 response that carries a non-terminal `stop_reason` (notably
 * "max_tokens") is TRUNCATED and must be treated as a failure, never stored as
 * a successful correction/seal (spec §5.5/§5.6).
 */

function mockFetch(body: unknown, status = 200): typeof fetch {
  return vi.fn().mockResolvedValue(
    new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    }),
  ) as unknown as typeof fetch;
}

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe('AnthropicClient truncation guard (stop_reason)', () => {
  it('formatSeal throws when a 200 is truncated (stop_reason=max_tokens)', async () => {
    globalThis.fetch = mockFetch({
      content: [{ type: 'text', text: '# Title\n\npartial body that got cut' }],
      stop_reason: 'max_tokens',
    });
    const client = new AnthropicClient('test-key');
    await expect(
      client.formatSeal(
        [{ seq: 1, text: 'a long line', is_blank: false }],
        { title: 'Doc' },
      ),
    ).rejects.toThrow(/anthropic_truncated_max_tokens/);
  });

  it('correctLines surfaces truncation as a per-line failure (retryable)', async () => {
    // correctLines swallows the throw from the shared path and marks every line
    // failed so the route can retry — the truncated text is never stored.
    globalThis.fetch = mockFetch({
      content: [{ type: 'text', text: '[{"id":"l1","corrected_text":"the cat"}' }],
      stop_reason: 'max_tokens',
    });
    const client = new AnthropicClient('test-key');
    const results = await client.correctLines([{ id: 'l1', raw_text: 'teh cat' }]);
    expect(results).toHaveLength(1);
    expect(results[0].id).toBe('l1');
    expect(results[0].error).toBe('anthropic_truncated_max_tokens');
    // Falls back to raw text; never the truncated model output.
    expect(results[0].corrected_text).toBe('teh cat');
  });

  it('accepts a normal completion (stop_reason=end_turn)', async () => {
    globalThis.fetch = mockFetch({
      content: [{ type: 'text', text: '# Title\n\nfull body' }],
      stop_reason: 'end_turn',
    });
    const client = new AnthropicClient('test-key');
    const md = await client.formatSeal(
      [{ seq: 1, text: 'a line', is_blank: false }],
      { title: 'Doc' },
    );
    expect(md).toContain('full body');
  });

  it('accepts stop_reason=stop_sequence as terminal', async () => {
    globalThis.fetch = mockFetch({
      content: [{ type: 'text', text: '[{"id":"l1","corrected_text":"the cat"}]' }],
      stop_reason: 'stop_sequence',
    });
    const client = new AnthropicClient('test-key');
    const results = await client.correctLines([{ id: 'l1', raw_text: 'teh cat' }]);
    expect(results[0].corrected_text).toBe('the cat');
    expect(results[0].error).toBeUndefined();
  });
});

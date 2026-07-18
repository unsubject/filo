/**
 * Shared test harness: build the real Hono app with an in-memory sqlite
 * executor + injected fake AI + a spyable 2nd-brain, and a small typed request
 * helper.
 */
import { createApp } from '../src/app.js';
import type { Env } from '../src/env.js';
import type { AiClient } from '../src/ai/client.js';
import type { SecondBrainPush } from '../src/secondbrain.js';
import { FakeAiClient, type FakeAiOptions } from '../src/ai/fake.js';
import { SqliteExecutor } from './sqlite-executor.js';

export const TEST_TOKEN = 'test-bearer-token-123';

export class SpySecondBrain implements SecondBrainPush {
  readonly configured = true;
  calls: Array<{ documentId: string; title: string; markdown: string }> = [];
  async push(opts: {
    documentId: string;
    title: string;
    markdown: string;
  }): Promise<{ pushed: boolean; reason?: string }> {
    this.calls.push(opts);
    return { pushed: true };
  }
}

export interface Harness {
  app: ReturnType<typeof createApp>;
  db: SqliteExecutor;
  ai: AiClient;
  sb: SpySecondBrain;
  env: Env;
  /** Monotonic virtual clock so timestamps and undo-boundaries are ordered. */
  tick(): number;
  request(
    method: string,
    path: string,
    opts?: { body?: unknown; token?: string | null },
  ): Promise<Response>;
}

export function makeHarness(options?: {
  ai?: AiClient;
  fakeOptions?: FakeAiOptions;
}): Harness {
  const db = new SqliteExecutor();
  const ai = options?.ai ?? new FakeAiClient(options?.fakeOptions);
  const sb = new SpySecondBrain();

  let clock = 1_700_000_000_000; // fixed epoch-ms start
  const tick = () => {
    clock += 1000;
    return clock;
  };

  const env: Env = {
    DB: undefined as unknown as D1Database, // never used; executor is injected
    FILO_BEARER_TOKEN: TEST_TOKEN,
    ANTHROPIC_API_KEY: 'unused-in-tests',
  };

  const app = createApp({
    getExecutor: () => db,
    getAiClient: () => ai,
    getSecondBrain: () => sb,
    now: () => tick(),
  });

  const request = async (
    method: string,
    path: string,
    opts?: { body?: unknown; token?: string | null },
  ): Promise<Response> => {
    const headers: Record<string, string> = {};
    // `token: null` => omit the header entirely (unauthorized path).
    const token = opts && 'token' in opts ? opts.token : TEST_TOKEN;
    if (token) headers['authorization'] = `Bearer ${token}`;
    let bodyInit: string | undefined;
    if (opts?.body !== undefined) {
      headers['content-type'] = 'application/json';
      bodyInit = JSON.stringify(opts.body);
    }
    const req = new Request(`https://filo.test${path}`, {
      method,
      headers,
      body: bodyInit,
    });
    return app.fetch(req, env);
  };

  return { app, db, ai, sb, env, tick, request };
}

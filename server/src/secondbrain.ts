/**
 * 2nd-brain push (spec §4.6, §5.5). Sealed markdown can optionally be pushed to
 * Simon's 2nd-brain journal. Behind an interface so it is stubbed/no-op when
 * unconfigured, and never blocks or fails a seal.
 */
import type { Env } from './env.js';

export interface SecondBrainPush {
  /** True when a push target is configured. */
  readonly configured: boolean;
  /** Push sealed markdown. Returns whether the push was attempted+accepted. */
  push(opts: {
    documentId: string;
    title: string;
    markdown: string;
  }): Promise<{ pushed: boolean; reason?: string }>;
}

/** No-op push used when no 2nd-brain target is configured. */
export class NoopSecondBrain implements SecondBrainPush {
  readonly configured = false;
  async push(): Promise<{ pushed: boolean; reason?: string }> {
    return { pushed: false, reason: 'not_configured' };
  }
}

/** HTTP push to a configured 2nd-brain endpoint. */
export class HttpSecondBrain implements SecondBrainPush {
  readonly configured = true;
  constructor(
    private readonly url: string,
    private readonly token: string | undefined,
  ) {}

  async push(opts: {
    documentId: string;
    title: string;
    markdown: string;
  }): Promise<{ pushed: boolean; reason?: string }> {
    try {
      const res = await fetch(this.url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(this.token ? { authorization: `Bearer ${this.token}` } : {}),
        },
        body: JSON.stringify({
          source: 'filo',
          document_id: opts.documentId,
          title: opts.title,
          markdown: opts.markdown,
        }),
      });
      if (!res.ok) {
        return { pushed: false, reason: `http_${res.status}` };
      }
      return { pushed: true };
    } catch (err) {
      const reason = err instanceof Error ? err.message : 'push_failed';
      return { pushed: false, reason };
    }
  }
}

/** Build the push implementation from env (no-op when unconfigured). */
export function secondBrainFromEnv(env: Env): SecondBrainPush {
  if (env.SECOND_BRAIN_URL) {
    return new HttpSecondBrain(env.SECOND_BRAIN_URL, env.SECOND_BRAIN_TOKEN);
  }
  return new NoopSecondBrain();
}

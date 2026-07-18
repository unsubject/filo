/**
 * Bearer-token auth (spec §6). Applied before any route work. Uses a
 * timing-safe comparison and returns a uniform 401 that never reveals whether
 * a route or resource exists.
 */
import type { MiddlewareHandler } from 'hono';
import type { Env } from './env.js';
import { Errors, renderError } from './errors.js';

/**
 * Constant-time string equality. Compares over a fixed number of iterations
 * derived from both inputs so length differences do not short-circuit.
 */
export function timingSafeEqual(a: string, b: string): boolean {
  const aBytes = new TextEncoder().encode(a);
  const bBytes = new TextEncoder().encode(b);
  // Fold the length difference into the result without early return.
  let diff = aBytes.length ^ bBytes.length;
  const len = Math.max(aBytes.length, bBytes.length, 1);
  for (let i = 0; i < len; i++) {
    const x = i < aBytes.length ? aBytes[i]! : 0;
    const y = i < bBytes.length ? bBytes[i]! : 0;
    diff |= x ^ y;
  }
  return diff === 0;
}

function extractBearer(header: string | undefined): string | null {
  if (!header) return null;
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match ? match[1]!.trim() : null;
}

export const bearerAuth: MiddlewareHandler<{ Bindings: Env }> = async (
  c,
  next,
) => {
  const expected = c.env.FILO_BEARER_TOKEN;
  const provided = extractBearer(c.req.header('authorization'));

  // Uniform 401: no distinction between "missing", "malformed", and "wrong".
  if (!expected || provided === null || !timingSafeEqual(provided, expected)) {
    return renderError(c, Errors.unauthorized());
  }
  await next();
  return;
};

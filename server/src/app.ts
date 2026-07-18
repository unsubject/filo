/**
 * Hono application factory with dependency injection so tests can supply an
 * offline SQL executor + a fake AI client (spec §5.1 backend, §5.3 API surface).
 */
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import type { Env } from './env.js';
import type { SqlExecutor } from './db/executor.js';
import type { AiClient } from './ai/client.js';
import type { SecondBrainPush } from './secondbrain.js';
import { bearerAuth } from './auth.js';
import { renderError, Errors } from './errors.js';
import { registerDocumentRoutes } from './routes/documents.js';
import { registerLineRoutes } from './routes/lines.js';
import { registerCorrectRoute } from './routes/correct.js';
import { registerSealRoute } from './routes/seal.js';
import { registerExportRoute } from './routes/export.js';

/** Per-request dependencies exposed to handlers. */
export interface AppVars {
  db: SqlExecutor;
  ai: AiClient;
  sb: SecondBrainPush;
  now: number;
}

export type AppEnv = { Bindings: Env; Variables: AppVars };

/** Factory dependencies, injected differently in prod vs. tests. */
export interface AppDeps {
  getExecutor(env: Env): SqlExecutor;
  getAiClient(env: Env): AiClient;
  getSecondBrain(env: Env): SecondBrainPush;
  /** Clock, overridable in tests. */
  now?(): number;
}

export function createApp(deps: AppDeps): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  // Uniform envelope for any uncaught error.
  app.onError((err, c) => renderError(c, err));

  // CORS runs before auth so the SPA (served from a different origin) can make
  // API calls. The preflight `OPTIONS` is answered here (204) and short-circuits
  // before `bearerAuth`, so preflight never requires the bearer token. The
  // allowed origin is configurable via `CORS_ORIGIN` (default `*`, acceptable
  // because auth is a bearer token, not cookies).
  app.use(
    '*',
    cors({
      origin: (origin, c) => {
        const allowed = c.env.CORS_ORIGIN ?? '*';
        if (allowed === '*') return '*';
        return allowed === origin ? origin : null;
      },
      allowHeaders: ['Authorization', 'Content-Type'],
      allowMethods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    }),
  );

  // Auth runs before all route work on every route (spec §6). It never runs on
  // preflight `OPTIONS`, which the CORS middleware above has already answered.
  app.use('*', bearerAuth);

  // Attach per-request dependencies.
  app.use('*', async (c, next) => {
    c.set('db', deps.getExecutor(c.env));
    c.set('ai', deps.getAiClient(c.env));
    c.set('sb', deps.getSecondBrain(c.env));
    c.set('now', deps.now ? deps.now() : Date.now());
    await next();
  });

  registerDocumentRoutes(app);
  registerLineRoutes(app);
  registerCorrectRoute(app);
  registerSealRoute(app);
  registerExportRoute(app);

  // Uniform not-found envelope (still behind auth).
  app.notFound((c) => renderError(c, Errors.notFound()));

  return app;
}

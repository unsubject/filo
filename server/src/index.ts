/**
 * Production Worker entrypoint. Wires real dependencies: D1 executor, Anthropic
 * AI client, and env-configured 2nd-brain push.
 */
import { createApp, type AppDeps } from './app.js';
import type { Env } from './env.js';
import { D1Executor } from './db/executor.js';
import { AnthropicClient } from './ai/anthropic.js';
import { secondBrainFromEnv } from './secondbrain.js';

const deps: AppDeps = {
  getExecutor: (env: Env) => new D1Executor(env.DB),
  getAiClient: (env: Env) => new AnthropicClient(env.ANTHROPIC_API_KEY),
  getSecondBrain: (env: Env) => secondBrainFromEnv(env),
};

const app = createApp(deps);

export default {
  fetch: app.fetch,
};

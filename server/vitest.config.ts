import { defineConfig } from 'vitest/config';

// Plain Node environment: the suite runs the real migration against Node's
// built-in `node:sqlite` (offline, no workerd / Cloudflare account needed).
// `node:sqlite` is loaded at runtime via process.getBuiltinModule (see
// test/sqlite-executor.ts) so the bundler never needs to resolve it.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
    globals: false,
  },
});

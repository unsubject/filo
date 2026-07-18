/**
 * Test-only SqlExecutor backed by Node 22's built-in `node:sqlite`. Runs the
 * real migration SQL so the suite executes offline with no Cloudflare account
 * or workerd runtime (per build brief fallback strategy).
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import type { DatabaseSync as DatabaseSyncType } from 'node:sqlite';
import type { SqlExecutor } from '../src/db/executor.js';

// Load `node:sqlite` via the runtime builtin loader so the bundler (Vite/
// Vitest) never tries to statically resolve this newer builtin.
const { DatabaseSync } = (
  process as unknown as {
    getBuiltinModule(id: string): typeof import('node:sqlite');
  }
).getBuiltinModule('node:sqlite');

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATION_PATH = join(__dirname, '..', 'migrations', '0001_init.sql');

export class SqliteExecutor implements SqlExecutor {
  readonly db: DatabaseSyncType;

  constructor() {
    this.db = new DatabaseSync(':memory:');
    // Enforce FKs so ON DELETE CASCADE works in tests (matches spec intent).
    this.db.exec('PRAGMA foreign_keys = ON;');
    const migration = readFileSync(MIGRATION_PATH, 'utf8');
    this.db.exec(migration);
  }

  async run(
    sql: string,
    params: unknown[] = [],
  ): Promise<{ changes: number }> {
    const stmt = this.db.prepare(sql);
    const res = stmt.run(...(params as never[]));
    return { changes: Number(res.changes) };
  }

  async get<T>(sql: string, params: unknown[] = []): Promise<T | undefined> {
    const stmt = this.db.prepare(sql);
    const row = stmt.get(...(params as never[]));
    return (row as T | undefined) ?? undefined;
  }

  async all<T>(sql: string, params: unknown[] = []): Promise<T[]> {
    const stmt = this.db.prepare(sql);
    return stmt.all(...(params as never[])) as T[];
  }

  close(): void {
    this.db.close();
  }
}

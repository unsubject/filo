/**
 * Minimal SQL executor interface so route logic is storage-agnostic.
 *
 * Production uses the D1 adapter (workerd). Tests use a `node:sqlite` adapter
 * (see test/sqlite-executor.ts) so the whole suite runs offline with no
 * Cloudflare account or workerd runtime.
 */
export interface SqlExecutor {
  /** Run a statement; returns the number of rows changed. */
  run(sql: string, params?: unknown[]): Promise<{ changes: number }>;
  /** Fetch the first matching row, or undefined. */
  get<T>(sql: string, params?: unknown[]): Promise<T | undefined>;
  /** Fetch all matching rows. */
  all<T>(sql: string, params?: unknown[]): Promise<T[]>;
}

/** Adapter over a Cloudflare D1Database. */
export class D1Executor implements SqlExecutor {
  constructor(private readonly db: D1Database) {}

  async run(sql: string, params: unknown[] = []): Promise<{ changes: number }> {
    const res = await this.db
      .prepare(sql)
      .bind(...params)
      .run();
    return { changes: res.meta.changes ?? 0 };
  }

  async get<T>(sql: string, params: unknown[] = []): Promise<T | undefined> {
    const row = await this.db
      .prepare(sql)
      .bind(...params)
      .first<T>();
    return row ?? undefined;
  }

  async all<T>(sql: string, params: unknown[] = []): Promise<T[]> {
    const res = await this.db
      .prepare(sql)
      .bind(...params)
      .all<T>();
    return res.results ?? [];
  }
}

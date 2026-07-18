/**
 * Worker bindings (spec §5.1, §6). Secrets are injected by Cloudflare at
 * runtime; nothing here is committed to source.
 */
export interface Env {
  /** D1 database binding (wrangler.toml [[d1_databases]] binding = "DB"). */
  DB: D1Database;
  /** Single-user bearer token — stored as a Cloudflare secret. */
  FILO_BEARER_TOKEN: string;
  /** Anthropic API key — stored as a Cloudflare secret. */
  ANTHROPIC_API_KEY: string;
  /** Optional 2nd-brain push endpoint. Push is disabled when unset. */
  SECOND_BRAIN_URL?: string;
  /** Optional 2nd-brain bearer token. */
  SECOND_BRAIN_TOKEN?: string;
  /** Free-form environment label (non-secret). */
  FILO_ENV?: string;
}

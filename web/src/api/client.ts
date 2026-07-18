// Typed API client for the filo Worker backend (PRODUCT_SPEC.md §5.3).
//
// Configuration:
//   - Base URL comes from `import.meta.env.VITE_API_BASE`
//     (default `http://localhost:8787`).
//   - The single-user bearer token is **runtime-only**: it lives in
//     `localStorage["filo_token"]` and is read per request via `getAuthToken`.
//     It is NEVER inlined into the production bundle — a build-time secret in
//     the static Pages app would be recoverable by anyone who can load the app
//     (spec §6). Use the token gate in the UI, or `setAuthToken`, to store it.
//   - `VITE_FILO_TOKEN` is a **local-dev convenience only**: in `npm run dev`
//     it seeds localStorage once (see `seedDevToken`). The read is guarded by
//     `import.meta.env.DEV`, so the literal is dead-code-eliminated from
//     production builds and prod behavior never depends on it.
//
// Every route requires the bearer token. Errors surface as `ApiError` carrying
// the stable `{ error: { code, message } }` envelope so the UI can keep failure
// states calm and consistent.

import type {
  CorrectResult,
  DocumentMeta,
  DocumentWithLines,
  Line,
  SealResult,
  SealOptions,
  UndoResult,
  ApiErrorEnvelope,
} from "./types";

export const DEFAULT_API_BASE = "http://localhost:8787";
export const TOKEN_STORAGE_KEY = "filo_token";

/** A structured error carrying the API's stable error envelope. */
export class ApiError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.status = status;
  }
}

/** The full set of backend operations the SPA needs. */
export interface FiloApi {
  listDocuments(): Promise<DocumentMeta[]>;
  createDocument(): Promise<DocumentMeta>;
  getDocument(id: string): Promise<DocumentWithLines>;
  renameDocument(id: string, title: string): Promise<DocumentMeta>;
  deleteDocument(id: string): Promise<void>;
  commitLine(
    id: string,
    input: { raw_text: string; client_line_id: string },
  ): Promise<Line>;
  undoLastLine(id: string): Promise<UndoResult>;
  restoreRaw(id: string, lineId: string): Promise<Line>;
  correct(id: string): Promise<CorrectResult>;
  seal(id: string, options?: SealOptions): Promise<SealResult>;
  /** Fetch the latest sealed markdown as text; throws ApiError `no_seal` (409). */
  exportMarkdown(id: string): Promise<{ filename: string; markdown: string }>;
  /** Absolute URL of the export endpoint (for anchor downloads). */
  exportUrl(id: string): string;
}

export interface ApiClientConfig {
  baseUrl?: string;
  /** Resolve the bearer token at call time (allows late login). */
  getToken?: () => string | null;
  /** Injectable for tests / SSR. Defaults to global `fetch`. */
  fetchImpl?: typeof fetch;
}

function readStoredToken(): string | null {
  try {
    return globalThis.localStorage?.getItem(TOKEN_STORAGE_KEY) ?? null;
  } catch {
    return null;
  }
}

/**
 * The current bearer token, read from localStorage at call time (runtime-only).
 * Resolved per request so a late login takes effect without a reload.
 */
export function getAuthToken(): string | null {
  return readStoredToken();
}

/** Whether a bearer token has been provided this session. */
export function hasAuthToken(): boolean {
  return !!readStoredToken();
}

/** Store the bearer token at runtime (used by the token gate UI). */
export function setAuthToken(token: string): void {
  const value = token.trim();
  try {
    if (value) globalThis.localStorage?.setItem(TOKEN_STORAGE_KEY, value);
    else globalThis.localStorage?.removeItem(TOKEN_STORAGE_KEY);
  } catch {
    /* ignore — non-persistent contexts simply won't remember the token */
  }
}

/** Clear the stored bearer token (e.g. a "sign out" affordance). */
export function clearAuthToken(): void {
  try {
    globalThis.localStorage?.removeItem(TOKEN_STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

/**
 * DEV-ONLY: seed localStorage from `VITE_FILO_TOKEN` so `npm run dev` works
 * without pasting a token every session. Guarded by `import.meta.env.DEV`, so
 * the secret literal is dead-code-eliminated from production bundles — prod
 * NEVER depends on a build-time token. No-op if a token is already stored.
 */
export function seedDevToken(): void {
  if (!import.meta.env?.DEV) return;
  const fromEnv = import.meta.env?.VITE_FILO_TOKEN;
  if (!fromEnv) return;
  if (readStoredToken()) return;
  try {
    globalThis.localStorage?.setItem(TOKEN_STORAGE_KEY, fromEnv);
  } catch {
    /* ignore */
  }
}

function contentDispositionFilename(header: string | null): string | null {
  if (!header) return null;
  const star = /filename\*=(?:UTF-8'')?([^;]+)/i.exec(header);
  if (star?.[1]) {
    try {
      return decodeURIComponent(star[1].replace(/"/g, "").trim());
    } catch {
      /* fall through */
    }
  }
  const plain = /filename="?([^";]+)"?/i.exec(header);
  return plain?.[1]?.trim() ?? null;
}

export function createApiClient(config: ApiClientConfig = {}): FiloApi {
  const baseUrl = (
    config.baseUrl ??
    import.meta.env?.VITE_API_BASE ??
    DEFAULT_API_BASE
  ).replace(/\/+$/, "");
  const getToken = config.getToken ?? getAuthToken;
  const doFetch = config.fetchImpl ?? globalThis.fetch.bind(globalThis);

  function authHeaders(extra?: Record<string, string>): HeadersInit {
    const token = getToken();
    return {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...extra,
    };
  }

  async function toApiError(res: Response): Promise<ApiError> {
    let code = "unknown";
    let message = `Request failed (${res.status}).`;
    try {
      const body = (await res.json()) as ApiErrorEnvelope;
      if (body?.error?.code) code = body.error.code;
      if (body?.error?.message) message = body.error.message;
    } catch {
      /* non-JSON error body — keep generic message */
    }
    return new ApiError(code, message, res.status);
  }

  async function request<T>(path: string, init?: RequestInit): Promise<T> {
    const res = await doFetch(`${baseUrl}${path}`, init);
    if (!res.ok) throw await toApiError(res);
    if (res.status === 204) return undefined as T;
    return (await res.json()) as T;
  }

  return {
    async listDocuments() {
      const { documents } = await request<{ documents: DocumentMeta[] }>(
        "/documents",
        { headers: authHeaders() },
      );
      return documents;
    },

    async createDocument() {
      const { document } = await request<{ document: DocumentMeta }>(
        "/documents",
        {
          method: "POST",
          headers: authHeaders({ "Content-Type": "application/json" }),
          body: "{}",
        },
      );
      return document;
    },

    getDocument(id) {
      return request<DocumentWithLines>(`/documents/${encodeURIComponent(id)}`, {
        headers: authHeaders(),
      });
    },

    async renameDocument(id, title) {
      const { document } = await request<{ document: DocumentMeta }>(
        `/documents/${encodeURIComponent(id)}`,
        {
          method: "PATCH",
          headers: authHeaders({ "Content-Type": "application/json" }),
          body: JSON.stringify({ title }),
        },
      );
      return document;
    },

    async deleteDocument(id) {
      await request<void>(`/documents/${encodeURIComponent(id)}`, {
        method: "DELETE",
        headers: authHeaders(),
      });
    },

    async commitLine(id, input) {
      const { line } = await request<{ line: Line }>(
        `/documents/${encodeURIComponent(id)}/lines`,
        {
          method: "POST",
          headers: authHeaders({ "Content-Type": "application/json" }),
          body: JSON.stringify(input),
        },
      );
      return line;
    },

    undoLastLine(id) {
      return request<UndoResult>(
        `/documents/${encodeURIComponent(id)}/lines/last`,
        { method: "DELETE", headers: authHeaders() },
      );
    },

    async restoreRaw(id, lineId) {
      const { line } = await request<{ line: Line }>(
        `/documents/${encodeURIComponent(id)}/lines/${encodeURIComponent(
          lineId,
        )}/restore-raw`,
        { method: "POST", headers: authHeaders() },
      );
      return line;
    },

    correct(id) {
      return request<CorrectResult>(
        `/documents/${encodeURIComponent(id)}/correct`,
        { method: "POST", headers: authHeaders() },
      );
    },

    seal(id, options) {
      return request<SealResult>(`/documents/${encodeURIComponent(id)}/seal`, {
        method: "POST",
        headers: authHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({
          push_to_second_brain: options?.pushToSecondBrain ?? false,
        }),
      });
    },

    exportUrl(id) {
      return `${baseUrl}/documents/${encodeURIComponent(id)}/export.md`;
    },

    async exportMarkdown(id) {
      const res = await doFetch(this.exportUrl(id), { headers: authHeaders() });
      if (!res.ok) throw await toApiError(res);
      const markdown = await res.text();
      const filename =
        contentDispositionFilename(res.headers.get("Content-Disposition")) ??
        `filo-${id}.md`;
      return { filename, markdown };
    },
  };
}

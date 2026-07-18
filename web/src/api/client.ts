// Typed API client for the filo Worker backend (PRODUCT_SPEC.md §5.3).
//
// Configuration:
//   - Base URL comes from `import.meta.env.VITE_API_BASE`
//     (default `http://localhost:8787`).
//   - The single-user bearer token comes from `import.meta.env.VITE_FILO_TOKEN`
//     or, if unset, `localStorage.getItem("filo_token")`.
//     See web/README.md for how to set either one.
//
// Every route requires the bearer token. Errors surface as `ApiError` carrying
// the stable `{ error: { code, message } }` envelope so the UI can keep failure
// states calm and consistent.

import type {
  CorrectResult,
  DocumentMeta,
  DocumentWithLines,
  Line,
  Seal,
  SealOptions,
  UndoResult,
  ApiErrorEnvelope,
} from "./types";

export const DEFAULT_API_BASE = "http://localhost:8787";
const TOKEN_STORAGE_KEY = "filo_token";

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
  seal(id: string, options?: SealOptions): Promise<Seal>;
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

export function resolveEnvToken(): string | null {
  const fromEnv = import.meta.env?.VITE_FILO_TOKEN;
  if (fromEnv) return fromEnv;
  try {
    return globalThis.localStorage?.getItem(TOKEN_STORAGE_KEY) ?? null;
  } catch {
    return null;
  }
}

export function storeToken(token: string): void {
  try {
    globalThis.localStorage?.setItem(TOKEN_STORAGE_KEY, token);
  } catch {
    /* ignore — non-persistent contexts still work via env */
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
  const getToken = config.getToken ?? resolveEnvToken;
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
    listDocuments() {
      return request<DocumentMeta[]>("/documents", {
        headers: authHeaders(),
      });
    },

    createDocument() {
      return request<DocumentMeta>("/documents", {
        method: "POST",
        headers: authHeaders({ "Content-Type": "application/json" }),
        body: "{}",
      });
    },

    getDocument(id) {
      return request<DocumentWithLines>(`/documents/${encodeURIComponent(id)}`, {
        headers: authHeaders(),
      });
    },

    renameDocument(id, title) {
      return request<DocumentMeta>(`/documents/${encodeURIComponent(id)}`, {
        method: "PATCH",
        headers: authHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({ title }),
      });
    },

    async deleteDocument(id) {
      await request<void>(`/documents/${encodeURIComponent(id)}`, {
        method: "DELETE",
        headers: authHeaders(),
      });
    },

    commitLine(id, input) {
      return request<Line>(`/documents/${encodeURIComponent(id)}/lines`, {
        method: "POST",
        headers: authHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify(input),
      });
    },

    undoLastLine(id) {
      return request<UndoResult>(
        `/documents/${encodeURIComponent(id)}/lines/last`,
        { method: "DELETE", headers: authHeaders() },
      );
    },

    restoreRaw(id, lineId) {
      return request<Line>(
        `/documents/${encodeURIComponent(id)}/lines/${encodeURIComponent(
          lineId,
        )}/restore-raw`,
        { method: "POST", headers: authHeaders() },
      );
    },

    correct(id) {
      return request<CorrectResult>(
        `/documents/${encodeURIComponent(id)}/correct`,
        { method: "POST", headers: authHeaders() },
      );
    },

    seal(id, options) {
      return request<Seal>(`/documents/${encodeURIComponent(id)}/seal`, {
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

import type { FiloApi } from "../api/client";
import { ApiError } from "../api/client";
import type {
  DocumentMeta,
  DocumentWithLines,
  Line,
  Seal,
} from "../api/types";

interface FakeState {
  documents: Map<string, DocumentMeta>;
  lines: Map<string, Line[]>; // documentId -> lines (in seq order)
  seals: Map<string, Seal[]>;
  seq: number;
  idCounter: number;
}

export interface FakeApi extends FiloApi {
  /** Introspection for assertions. */
  _state: FakeState;
  /** Force the next commitLine call to reject once. */
  failNextCommit(): void;
}

/**
 * A fully in-memory, deterministic implementation of FiloApi for tests — no
 * network, no backend. Correction turns the token "teh" into "the" so tests can
 * observe a silent fix and then restore-raw back to the typed text.
 */
export function createFakeApi(): FakeApi {
  const state: FakeState = {
    documents: new Map(),
    lines: new Map(),
    seals: new Map(),
    seq: 0,
    idCounter: 0,
  };
  let failCommit = false;

  const nextId = (prefix: string) => `${prefix}-${++state.idCounter}`;
  const now = () => Date.now();

  function touch(id: string) {
    const doc = state.documents.get(id);
    if (doc) state.documents.set(id, { ...doc, updated_at: now() });
  }

  const api: FakeApi = {
    _state: state,
    failNextCommit() {
      failCommit = true;
    },

    async listDocuments() {
      return [...state.documents.values()];
    },

    async createDocument() {
      const id = nextId("doc");
      const t = now();
      const doc: DocumentMeta = {
        id,
        title: new Date(t).toISOString(),
        status: "draft",
        created_at: t,
        updated_at: t,
        sealed_at: null,
      };
      state.documents.set(id, doc);
      state.lines.set(id, []);
      state.seals.set(id, []);
      return doc;
    },

    async getDocument(id): Promise<DocumentWithLines> {
      const document = state.documents.get(id);
      if (!document) throw new ApiError("not_found", "No such document", 404);
      const lines = (state.lines.get(id) ?? []).filter(
        (l) => l.deleted_at == null,
      );
      return { document, lines };
    },

    async renameDocument(id, title) {
      const doc = state.documents.get(id);
      if (!doc) throw new ApiError("not_found", "No such document", 404);
      const updated = { ...doc, title, updated_at: now() };
      state.documents.set(id, updated);
      return updated;
    },

    async deleteDocument(id) {
      state.documents.delete(id);
      state.lines.delete(id);
      state.seals.delete(id);
    },

    async commitLine(id, input) {
      if (failCommit) {
        failCommit = false;
        throw new ApiError(
          "line_commit_failed",
          "Could not save line. Your text is still in the composer.",
          503,
        );
      }
      const list = state.lines.get(id) ?? [];
      // Idempotency on client_line_id.
      const existing = list.find(
        (l) => l.client_line_id === input.client_line_id,
      );
      if (existing) return existing;
      const line: Line = {
        id: nextId("line"),
        document_id: id,
        client_line_id: input.client_line_id,
        seq: ++state.seq,
        raw_text: input.raw_text,
        corrected_text: null,
        correction_status: input.raw_text === "" ? "skipped" : "pending",
        created_at: now(),
        deleted_at: null,
      };
      list.push(line);
      state.lines.set(id, list);
      touch(id);
      return line;
    },

    async undoLastLine(id) {
      const list = state.lines.get(id) ?? [];
      for (let i = list.length - 1; i >= 0; i--) {
        if (list[i].deleted_at == null) {
          list[i] = { ...list[i], deleted_at: now() };
          state.lines.set(id, list);
          touch(id);
          return { deleted_line_id: list[i].id };
        }
      }
      return { deleted_line_id: null };
    },

    async restoreRaw(id, lineId) {
      const list = state.lines.get(id) ?? [];
      const idx = list.findIndex((l) => l.id === lineId);
      if (idx < 0) throw new ApiError("not_found", "No such line", 404);
      const updated: Line = {
        ...list[idx],
        corrected_text: null,
        correction_status: "unchanged",
        correction_error: null,
      };
      list[idx] = updated;
      state.lines.set(id, list);
      return updated;
    },

    async correct(id) {
      const list = state.lines.get(id) ?? [];
      const corrected: Line[] = [];
      for (let i = 0; i < list.length; i++) {
        const line = list[i];
        if (line.deleted_at != null) continue;
        if (line.correction_status !== "pending") continue;
        const fixed = line.raw_text.replace(/\bteh\b/g, "the");
        const updated: Line = {
          ...line,
          corrected_text: fixed === line.raw_text ? null : fixed,
          correction_status: fixed === line.raw_text ? "unchanged" : "corrected",
          corrected_at: now(),
          correction_model: "haiku-test",
        };
        list[i] = updated;
        corrected.push(updated);
      }
      state.lines.set(id, list);
      return { lines: corrected };
    },

    async seal(id) {
      const doc = state.documents.get(id);
      if (!doc) throw new ApiError("not_found", "No such document", 404);
      const lines = (state.lines.get(id) ?? []).filter(
        (l) => l.deleted_at == null,
      );
      const md = lines
        .map((l) => l.corrected_text ?? l.raw_text)
        .join("\n\n");
      const sealRow: Seal = {
        id: nextId("seal"),
        document_id: id,
        formatted_markdown: md,
        model: "sonnet-test",
        created_at: now(),
      };
      const seals = state.seals.get(id) ?? [];
      seals.push(sealRow);
      state.seals.set(id, seals);
      // Mirror the server (§4.6): sealing records `sealed_at` but keeps the
      // document a draft so writing may continue. `status='sealed'` is only
      // reachable via explicit PATCH (a future freeze feature).
      state.documents.set(id, {
        ...doc,
        sealed_at: sealRow.created_at,
        updated_at: now(),
      });
      return {
        seal: {
          id: sealRow.id,
          document_id: sealRow.document_id,
          model: sealRow.model,
          created_at: sealRow.created_at,
        },
        markdown: md,
        pushed: false,
      };
    },

    exportUrl(id) {
      return `http://test.local/documents/${id}/export.md`;
    },

    async exportMarkdown(id) {
      const seals = state.seals.get(id) ?? [];
      if (seals.length === 0)
        throw new ApiError("no_seal", "This document has never been sealed", 409);
      const latest = seals[seals.length - 1];
      return { filename: `filo-${id}.md`, markdown: latest.formatted_markdown };
    },
  };

  return api;
}

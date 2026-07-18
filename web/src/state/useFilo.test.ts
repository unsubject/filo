import { describe, it, expect } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useFilo } from "./useFilo";
import { ApiError, type FiloApi } from "../api/client";
import type {
  DocumentMeta,
  DocumentWithLines,
  Line,
  SealResult,
} from "../api/types";

function meta(id: string): DocumentMeta {
  return {
    id,
    title: id,
    status: "draft",
    created_at: 1,
    updated_at: 1,
    sealed_at: null,
  };
}

/**
 * A FiloApi whose FIRST commit hangs until `rejectFirst()` is called (so we can
 * fail it AFTER switching documents), and whose later commits succeed. Enough of
 * the surface is stubbed to drive `useFilo` for the §5.6 preservation contract.
 */
function makeDeferredApi() {
  let commitCalls = 0;
  let rejectFirst: () => void = () => {};
  const docs: Record<string, DocumentWithLines> = {
    d1: { document: meta("d1"), lines: [] },
    d2: { document: meta("d2"), lines: [] },
  };

  const api: FiloApi = {
    async listDocuments() {
      return [meta("d1"), meta("d2")];
    },
    async createDocument() {
      return meta("d1");
    },
    async getDocument(id) {
      return docs[id];
    },
    async renameDocument(id) {
      return meta(id);
    },
    async deleteDocument() {},
    commitLine(_id, input) {
      commitCalls += 1;
      if (commitCalls === 1) {
        return new Promise<Line>((_resolve, reject) => {
          rejectFirst = () =>
            reject(new ApiError("line_commit_failed", "flaky", 503));
        });
      }
      return Promise.resolve<Line>({
        id: `line-${input.client_line_id}`,
        document_id: "d1",
        client_line_id: input.client_line_id,
        seq: 1,
        raw_text: input.raw_text,
        corrected_text: null,
        correction_status: "pending",
        created_at: 2,
      });
    },
    async undoLastLine() {
      return { deleted_line_id: null };
    },
    async restoreRaw() {
      return {} as Line;
    },
    async correct() {
      return { lines: [] };
    },
    async seal() {
      return {} as SealResult;
    },
    exportUrl() {
      return "";
    },
    async exportMarkdown() {
      return { filename: "", markdown: "" };
    },
  };

  return { api, rejectFirst: () => rejectFirst() };
}

describe("useFilo preserves failed commits across document switches (§5.6)", () => {
  it("keeps the raw text of an in-flight commit that fails after switching docs", async () => {
    const { api, rejectFirst } = makeDeferredApi();
    const { result } = renderHook(() =>
      useFilo(api, { correctionDebounceMs: 0 }),
    );

    // Open d1 and start a commit that will not resolve yet.
    await act(async () => {
      await result.current.openDocument("d1");
    });
    act(() => {
      result.current.setComposer("in-flight raw text");
    });
    act(() => {
      result.current.commitNormal();
    });

    // Switch to another document BEFORE the commit fails.
    await act(async () => {
      await result.current.openDocument("d2");
    });

    // Now the original commit rejects — its doc is no longer the active view.
    await act(async () => {
      rejectFirst();
      await Promise.resolve();
    });

    // Reopen the original document: the failed line must be back, with its exact
    // raw text, and retryable.
    await act(async () => {
      await result.current.openDocument("d1");
    });

    const failed = result.current.lines.find((l) => l._failed);
    expect(failed).toBeDefined();
    expect(failed?.raw_text).toBe("in-flight raw text");

    // And retryFailedCommits can re-send it successfully.
    await act(async () => {
      await result.current.retryFailedCommits();
    });
    expect(result.current.lines.some((l) => l._failed)).toBe(false);
    expect(
      result.current.lines.some((l) => l.raw_text === "in-flight raw text"),
    ).toBe(true);
  });
});

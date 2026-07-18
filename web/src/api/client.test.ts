import { describe, it, expect, vi } from "vitest";
import { createApiClient, ApiError, type FiloApi } from "./client";
import type { DocumentMeta, Line } from "./types";

/**
 * Wire-contract tests: exercise the REAL createApiClient against a mocked
 * `fetch` returning the REAL server response envelopes. The app suite runs on
 * the injected fakeApi, so these tests are the only thing that locks the client
 * to the server's on-the-wire shapes (§5.3) — the layer where the BLOCKER
 * unwrapping bugs lived.
 */

const BASE = "http://api.test";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/** Build a client whose fetch returns exactly `response`, capturing the call. */
function clientReturning(response: Response): {
  api: FiloApi;
  fetchMock: ReturnType<typeof vi.fn>;
} {
  const fetchMock = vi.fn().mockResolvedValue(response);
  const api = createApiClient({
    baseUrl: BASE,
    getToken: () => "test-token",
    fetchImpl: fetchMock as unknown as typeof fetch,
  });
  return { api, fetchMock };
}

const docMeta = (id: string): DocumentMeta => ({
  id,
  title: "A doc",
  status: "draft",
  created_at: 1,
  updated_at: 2,
  sealed_at: null,
});

const lineRow = (id: string): Line => ({
  id,
  document_id: "doc-1",
  client_line_id: "c-1",
  seq: 0,
  raw_text: "teh cat",
  corrected_text: null,
  correction_status: "pending",
  created_at: 1,
});

describe("createApiClient wire contract (§5.3 envelopes)", () => {
  it("listDocuments unwraps { documents } to the array", async () => {
    const docs = [docMeta("d1"), docMeta("d2")];
    const { api, fetchMock } = clientReturning(jsonResponse({ documents: docs }));

    const result = await api.listDocuments();

    expect(result).toEqual(docs); // bare array, not the wrapper
    expect(Array.isArray(result)).toBe(true);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`${BASE}/documents`);
    expect((init.headers as Record<string, string>).Authorization).toBe(
      "Bearer test-token",
    );
  });

  it("createDocument unwraps { document } (201)", async () => {
    const doc = docMeta("d1");
    const { api, fetchMock } = clientReturning(
      jsonResponse({ document: doc }, 201),
    );

    const result = await api.createDocument();

    expect(result).toEqual(doc);
    expect(fetchMock.mock.calls[0][1].method).toBe("POST");
  });

  it("getDocument returns { document, lines } as-is", async () => {
    const payload = { document: docMeta("d1"), lines: [lineRow("l1")] };
    const { api } = clientReturning(jsonResponse(payload));

    const result = await api.getDocument("d1");

    expect(result).toEqual(payload);
  });

  it("renameDocument unwraps { document }", async () => {
    const doc = { ...docMeta("d1"), title: "Renamed" };
    const { api } = clientReturning(jsonResponse({ document: doc }));

    const result = await api.renameDocument("d1", "Renamed");

    expect(result).toEqual(doc);
    expect(result.title).toBe("Renamed");
  });

  it("commitLine unwraps { line }", async () => {
    const line = lineRow("l1");
    const { api } = clientReturning(jsonResponse({ line }, 201));

    const result = await api.commitLine("d1", {
      raw_text: "teh cat",
      client_line_id: "c-1",
    });

    expect(result).toEqual(line);
    expect(result.id).toBe("l1");
  });

  it("undoLastLine returns { deleted_line_id } (id and null forms)", async () => {
    const { api: apiA } = clientReturning(
      jsonResponse({ deleted_line_id: "l9" }),
    );
    expect(await apiA.undoLastLine("d1")).toEqual({ deleted_line_id: "l9" });

    const { api: apiB } = clientReturning(
      jsonResponse({ deleted_line_id: null }),
    );
    expect(await apiB.undoLastLine("d1")).toEqual({ deleted_line_id: null });
  });

  it("restoreRaw unwraps { line }", async () => {
    const line = { ...lineRow("l1"), correction_status: "unchanged" as const };
    const { api } = clientReturning(jsonResponse({ line }));

    const result = await api.restoreRaw("d1", "l1");

    expect(result).toEqual(line);
  });

  it("correct exposes the lines array from the summary envelope", async () => {
    const lines = [lineRow("l1")];
    const { api } = clientReturning(
      jsonResponse({
        corrected: 1,
        unchanged: 0,
        failed: 0,
        applied: 1,
        lines,
      }),
    );

    const result = await api.correct("d1");

    expect(result.lines).toEqual(lines);
  });

  it("seal returns the { seal, markdown, pushed, push_reason } shape", async () => {
    const payload = {
      seal: {
        id: "s1",
        document_id: "d1",
        model: "claude-sonnet-5",
        prompt_version: "seal-v1",
        created_at: 5,
      },
      markdown: "# Title\n\nbody",
      pushed: true,
      push_reason: "ok",
    };
    const { api } = clientReturning(jsonResponse(payload));

    const result = await api.seal("d1", { pushToSecondBrain: true });

    expect(result).toEqual(payload);
    expect(result.markdown).toContain("body");
    expect(result.pushed).toBe(true);
  });

  it("exportMarkdown returns text + filename from Content-Disposition", async () => {
    const res = new Response("# sealed markdown", {
      status: 200,
      headers: {
        "content-type": "text/markdown; charset=utf-8",
        "content-disposition": 'attachment; filename="filo-my-doc.md"',
      },
    });
    const { api } = clientReturning(res);

    const result = await api.exportMarkdown("d1");

    expect(result.markdown).toBe("# sealed markdown");
    expect(result.filename).toBe("filo-my-doc.md");
  });

  it("exportMarkdown throws ApiError no_seal on a 409", async () => {
    // Mint a fresh Response per call — a Response body can only be read once.
    const fetchMock = vi.fn().mockImplementation(async () =>
      jsonResponse(
        { error: { code: "no_seal", message: "never sealed" } },
        409,
      ),
    );
    const api = createApiClient({
      baseUrl: BASE,
      getToken: () => "test-token",
      fetchImpl: fetchMock as unknown as typeof fetch,
    });

    await expect(api.exportMarkdown("d1")).rejects.toMatchObject({
      code: "no_seal",
      status: 409,
    });
    await expect(api.exportMarkdown("d1")).rejects.toBeInstanceOf(ApiError);
  });

  it("surfaces the error envelope { error: { code, message } } as ApiError", async () => {
    const { api } = clientReturning(
      jsonResponse(
        { error: { code: "not_found", message: "gone" } },
        404,
      ),
    );

    await expect(api.getDocument("nope")).rejects.toMatchObject({
      code: "not_found",
      status: 404,
      message: "gone",
    });
  });
});

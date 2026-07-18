import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ApiError, type FiloApi } from "../api/client";
import type { DocumentMeta, DocumentWithLines, Line } from "../api/types";

/** How long the composer is idle before the silent correction pass fires. */
export const CORRECTION_DEBOUNCE_MS = 1500;

/** A committed line plus client-only sync bookkeeping (never shown in-stack). */
export interface CanvasLine extends Line {
  /** Optimistically shown, not yet acknowledged by the server. */
  _pending?: boolean;
  /** Commit failed; retained locally for retry (no in-stack badge). */
  _failed?: boolean;
}

export type LoadStatus = "idle" | "loading" | "ready" | "error";

/** The single quiet status-surface state (§4.1). */
export type StatusKind =
  | "saved"
  | "syncing"
  | "offline"
  | "correction_pending"
  | "correction_failed"
  | "seal_failed";

export const STATUS_LABELS: Record<StatusKind, string> = {
  saved: "Saved",
  syncing: "Syncing",
  offline: "Offline",
  correction_pending: "Correction pending",
  correction_failed: "Correction failed",
  seal_failed: "Seal failed",
};

/** Quiet, text-only around-canvas notices (§4.1). */
export type CanvasNotice =
  | { kind: "line_commit_failed" }
  | { kind: "correction_failed" }
  | { kind: "seal_failed" }
  | { kind: "export_unavailable" }
  | { kind: "load_failed" };

export type CommitKind = "normal" | "blank";

export function newClientId(): string {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === "function") return c.randomUUID();
  return `cid-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

/** The text that renders for a line: corrected when present, else raw. */
export function displayText(line: Line): string {
  return line.corrected_text ?? line.raw_text;
}

interface UseFiloOptions {
  /** Override the debounce (tests use 0 for determinism). */
  correctionDebounceMs?: number;
}

export function useFilo(api: FiloApi, options: UseFiloOptions = {}) {
  const debounceMs = options.correctionDebounceMs ?? CORRECTION_DEBOUNCE_MS;

  const [documents, setDocuments] = useState<DocumentMeta[]>([]);
  const [documentsStatus, setDocumentsStatus] = useState<LoadStatus>("idle");

  const [activeId, setActiveId] = useState<string | null>(null);
  const [docMeta, setDocMeta] = useState<DocumentMeta | null>(null);
  const [docStatus, setDocStatus] = useState<LoadStatus>("idle");
  const [lines, setLines] = useState<CanvasLine[]>([]);

  const [composer, setComposer] = useState("");
  const [firstRunDismissed, setFirstRunDismissed] = useState(false);

  const [pendingCommits, setPendingCommits] = useState(0);
  const [correctionState, setCorrectionState] = useState<
    "idle" | "pending" | "failed"
  >("idle");
  const [sealState, setSealState] = useState<"idle" | "sealing" | "failed">(
    "idle",
  );
  const [notice, setNotice] = useState<CanvasNotice | null>(null);
  const [online, setOnline] = useState<boolean>(
    typeof navigator !== "undefined" ? navigator.onLine : true,
  );

  // IME composition state — tracked as a ref so the keydown handler reads the
  // freshest value synchronously, and mirrored to state for visual stability.
  const composingRef = useRef(false);
  const [composing, setComposing] = useState(false);

  const correctTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const activeIdRef = useRef<string | null>(null);
  activeIdRef.current = activeId;

  useEffect(() => {
    if (typeof window === "undefined") return;
    const up = () => setOnline(true);
    const down = () => setOnline(false);
    window.addEventListener("online", up);
    window.addEventListener("offline", down);
    return () => {
      window.removeEventListener("online", up);
      window.removeEventListener("offline", down);
    };
  }, []);

  // ---- Document list ------------------------------------------------------

  const refreshDocuments = useCallback(async () => {
    setDocumentsStatus("loading");
    try {
      const docs = await api.listDocuments();
      setDocuments(sortDocuments(docs));
      setDocumentsStatus("ready");
    } catch {
      setDocumentsStatus("error");
    }
  }, [api]);

  const runCorrection = useCallback(async () => {
    const id = activeIdRef.current;
    if (!id) return;
    setCorrectionState("pending");
    try {
      const result = await api.correct(id);
      if (activeIdRef.current !== id) return;
      const byId = new Map(result.lines.map((l) => [l.id, l]));
      setLines((prev) =>
        prev.map((line) => {
          const updated = byId.get(line.id);
          // Conditional guard mirror: only merge lines still present locally.
          return updated ? { ...line, ...updated } : line;
        }),
      );
      setCorrectionState("idle");
    } catch {
      if (activeIdRef.current !== id) return;
      setCorrectionState("failed");
      setNotice({ kind: "correction_failed" });
    }
  }, [api]);

  const scheduleCorrection = useCallback(() => {
    if (correctTimer.current) clearTimeout(correctTimer.current);
    correctTimer.current = setTimeout(() => {
      void runCorrection();
    }, debounceMs);
  }, [runCorrection, debounceMs]);

  const openDocument = useCallback(
    async (id: string) => {
      setActiveId(id);
      activeIdRef.current = id;
      setDocStatus("loading");
      setLines([]);
      setDocMeta(null);
      setComposer("");
      setFirstRunDismissed(false);
      setNotice(null);
      setCorrectionState("idle");
      setSealState("idle");
      try {
        const data: DocumentWithLines = await api.getDocument(id);
        if (activeIdRef.current !== id) return;
        setDocMeta(data.document);
        setLines(data.lines);
        setDocStatus("ready");
        // Reconcile-on-open: heal any lines left pending from a prior session.
        void runCorrection();
      } catch {
        if (activeIdRef.current !== id) return;
        setDocStatus("error");
        setNotice({ kind: "load_failed" });
      }
    },
    [api, runCorrection],
  );

  const createDocument = useCallback(async () => {
    const doc = await api.createDocument();
    setDocuments((prev) => sortDocuments([doc, ...prev]));
    await openDocument(doc.id);
    return doc;
  }, [api, openDocument]);

  const renameDocument = useCallback(
    async (id: string, title: string) => {
      const updated = await api.renameDocument(id, title);
      setDocuments((prev) =>
        sortDocuments(prev.map((d) => (d.id === id ? updated : d))),
      );
      if (activeIdRef.current === id) setDocMeta(updated);
    },
    [api],
  );

  const deleteDocument = useCallback(
    async (id: string) => {
      await api.deleteDocument(id);
      setDocuments((prev) => prev.filter((d) => d.id !== id));
      if (activeIdRef.current === id) {
        setActiveId(null);
        activeIdRef.current = null;
        setDocMeta(null);
        setLines([]);
        setDocStatus("idle");
      }
    },
    [api],
  );

  // ---- Composition (IME) --------------------------------------------------

  const handleCompositionStart = useCallback(() => {
    composingRef.current = true;
    setComposing(true);
  }, []);

  const handleCompositionEnd = useCallback(() => {
    composingRef.current = false;
    setComposing(false);
  }, []);

  // ---- Commit -------------------------------------------------------------

  const nextSeq = useCallback(() => {
    let max = 0;
    for (const l of lines) if (l.seq > max) max = l.seq;
    return max + 1;
  }, [lines]);

  const submit = useCallback(
    async (rawText: string, kind: CommitKind) => {
      const id = activeIdRef.current;
      if (!id) return;
      const clientLineId = newClientId();
      const optimistic: CanvasLine = {
        id: `optimistic-${clientLineId}`,
        document_id: id,
        client_line_id: clientLineId,
        seq: nextSeq(),
        raw_text: rawText,
        corrected_text: null,
        correction_status: kind === "blank" ? "skipped" : "pending",
        created_at: Date.now(),
        _pending: true,
      };
      const submittedComposer = kind === "normal" ? rawText : null;

      setFirstRunDismissed(true);
      setLines((prev) => [...prev, optimistic]);
      setPendingCommits((n) => n + 1);

      try {
        const saved = await api.commitLine(id, {
          raw_text: rawText,
          client_line_id: clientLineId,
        });
        if (activeIdRef.current !== id) return;
        setLines((prev) =>
          prev.map((l) =>
            l.client_line_id === clientLineId ? { ...saved } : l,
          ),
        );
        // Composer text is retained until ack (§5.6); clear only now, and only
        // if the user hasn't typed something new in the meantime.
        if (submittedComposer !== null) {
          setComposer((cur) => (cur === submittedComposer ? "" : cur));
        }
        setNotice((n) => (n?.kind === "line_commit_failed" ? null : n));
        if (kind === "normal") scheduleCorrection();
      } catch {
        if (activeIdRef.current !== id) return;
        setLines((prev) =>
          prev.map((l) =>
            l.client_line_id === clientLineId
              ? { ...l, _pending: false, _failed: true }
              : l,
          ),
        );
        setNotice({ kind: "line_commit_failed" });
      } finally {
        setPendingCommits((n) => Math.max(0, n - 1));
      }
    },
    [api, nextSeq, scheduleCorrection],
  );

  /** Commit driven by Enter / Cmd+Enter / send button. Never while composing. */
  const commitNormal = useCallback(() => {
    if (composingRef.current) return;
    if (composer.length === 0) return; // empty composer + Enter -> no-op
    void submit(composer, "normal");
  }, [composer, submit]);

  /** Shift+Enter — commit exactly one intentional blank line (pacing). */
  const commitBlank = useCallback(() => {
    if (composingRef.current) return;
    void submit("", "blank");
  }, [submit]);

  /** Re-send any commits that previously failed. */
  const retryFailedCommits = useCallback(async () => {
    const failed = lines.filter((l) => l._failed);
    if (failed.length === 0) return;
    setNotice((n) => (n?.kind === "line_commit_failed" ? null : n));
    for (const line of failed) {
      const id = activeIdRef.current;
      if (!id) return;
      setLines((prev) =>
        prev.map((l) =>
          l.client_line_id === line.client_line_id
            ? { ...l, _failed: false, _pending: true }
            : l,
        ),
      );
      setPendingCommits((n) => n + 1);
      try {
        const saved = await api.commitLine(id, {
          raw_text: line.raw_text,
          client_line_id: line.client_line_id,
        });
        setLines((prev) =>
          prev.map((l) =>
            l.client_line_id === line.client_line_id ? { ...saved } : l,
          ),
        );
      } catch {
        setLines((prev) =>
          prev.map((l) =>
            l.client_line_id === line.client_line_id
              ? { ...l, _pending: false, _failed: true }
              : l,
          ),
        );
        setNotice({ kind: "line_commit_failed" });
      } finally {
        setPendingCommits((n) => Math.max(0, n - 1));
      }
    }
  }, [api, lines]);

  // ---- Recovery: undo-last & restore-raw ----------------------------------

  const latestLine = lines.length > 0 ? lines[lines.length - 1] : null;

  const canUndo = useMemo(() => {
    if (!latestLine) return false;
    // Cannot cross a sealed boundary (§4.7): only undo lines added since seal.
    const sealedAt = docMeta?.sealed_at ?? null;
    if (sealedAt != null && latestLine.created_at <= sealedAt) return false;
    return true;
  }, [latestLine, docMeta]);

  const undoLast = useCallback(async () => {
    if (!canUndo || !latestLine) return;
    const id = activeIdRef.current;
    if (!id) return;
    const removed = latestLine;
    setLines((prev) => prev.slice(0, -1)); // optimistic
    try {
      await api.undoLastLine(id);
    } catch {
      if (activeIdRef.current !== id) return;
      setLines((prev) => [...prev, removed]); // restore on failure
      setNotice({ kind: "line_commit_failed" });
    }
  }, [api, canUndo, latestLine]);

  const restoreRawLatest = useCallback(async () => {
    const line = latestLine;
    if (!line || line.id.startsWith("optimistic-")) return;
    const id = activeIdRef.current;
    if (!id) return;
    // Optimistic: show exactly what was typed by clearing the correction.
    setLines((prev) =>
      prev.map((l) =>
        l.id === line.id
          ? { ...l, corrected_text: null, correction_status: "unchanged" }
          : l,
      ),
    );
    try {
      const updated = await api.restoreRaw(id, line.id);
      if (activeIdRef.current !== id) return;
      setLines((prev) => prev.map((l) => (l.id === line.id ? updated : l)));
    } catch {
      /* keep the optimistic raw text; nothing destructive happened */
    }
  }, [api, latestLine]);

  // ---- Seal & export ------------------------------------------------------

  const seal = useCallback(
    async (opts?: { pushToSecondBrain?: boolean }) => {
      const id = activeIdRef.current;
      if (!id) return;
      setSealState("sealing");
      setNotice((n) => (n?.kind === "seal_failed" ? null : n));
      try {
        await api.seal(id, opts);
        if (activeIdRef.current !== id) return;
        setSealState("idle");
        const fresh = await api.getDocument(id);
        if (activeIdRef.current !== id) return;
        setDocMeta(fresh.document);
        setDocuments((prev) =>
          sortDocuments(
            prev.map((d) => (d.id === id ? fresh.document : d)),
          ),
        );
      } catch {
        if (activeIdRef.current !== id) return;
        setSealState("failed");
        setNotice({ kind: "seal_failed" });
      }
    },
    [api],
  );

  const exportLatest = useCallback(async () => {
    const id = activeIdRef.current;
    if (!id) return;
    try {
      const { filename, markdown } = await api.exportMarkdown(id);
      triggerDownload(filename, markdown);
      setNotice((n) => (n?.kind === "export_unavailable" ? null : n));
    } catch (err) {
      if (err instanceof ApiError && err.code === "no_seal") {
        setNotice({ kind: "export_unavailable" });
      } else {
        setNotice({ kind: "seal_failed" });
      }
    }
  }, [api]);

  // ---- Derived: the single status kind ------------------------------------

  const status: StatusKind = useMemo(() => {
    if (!online) return "offline";
    if (sealState === "failed") return "seal_failed";
    if (correctionState === "failed") return "correction_failed";
    if (pendingCommits > 0 || sealState === "sealing") return "syncing";
    if (correctionState === "pending") return "correction_pending";
    return "saved";
  }, [online, sealState, correctionState, pendingCommits]);

  const showFirstRun =
    docStatus === "ready" && lines.length === 0 && !firstRunDismissed;

  useEffect(() => {
    return () => {
      if (correctTimer.current) clearTimeout(correctTimer.current);
    };
  }, []);

  return {
    // document list
    documents,
    documentsStatus,
    refreshDocuments,
    createDocument,
    renameDocument,
    deleteDocument,
    // active document
    activeId,
    docMeta,
    docStatus,
    lines,
    openDocument,
    // composer
    composer,
    setComposer,
    composing,
    handleCompositionStart,
    handleCompositionEnd,
    commitNormal,
    commitBlank,
    retryFailedCommits,
    // recovery
    canUndo,
    undoLast,
    restoreRawLatest,
    latestLine,
    // seal / export
    seal,
    exportLatest,
    sealState,
    // status
    status,
    statusLabel: STATUS_LABELS[status],
    notice,
    dismissNotice: () => setNotice(null),
    // first run
    showFirstRun,
    dismissFirstRun: () => setFirstRunDismissed(true),
  };
}

export type FiloStore = ReturnType<typeof useFilo>;

/** Drafts first by updated_at desc, then sealed-only documents (§4.4). */
export function sortDocuments(docs: DocumentMeta[]): DocumentMeta[] {
  return [...docs].sort((a, b) => {
    const aDraft = a.status === "draft";
    const bDraft = b.status === "draft";
    if (aDraft !== bDraft) return aDraft ? -1 : 1;
    return b.updated_at - a.updated_at;
  });
}

function triggerDownload(filename: string, markdown: string): void {
  if (typeof document === "undefined") return;
  const blob = new Blob([markdown], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

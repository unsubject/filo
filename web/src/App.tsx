import { useEffect, useMemo } from "react";
import { createApiClient, type FiloApi } from "./api/client";
import { useFilo } from "./state/useFilo";
import { DocumentSwitcher } from "./components/DocumentSwitcher";
import { StatusSurface } from "./components/StatusSurface";
import { WritingCanvas } from "./components/WritingCanvas";
import type { CanvasNotice } from "./state/useFilo";

export interface AppProps {
  /** Injectable API (tests pass a fake; production uses the real client). */
  api?: FiloApi;
  /** Override the correction debounce (tests use 0). */
  correctionDebounceMs?: number;
}

export default function App({ api, correctionDebounceMs }: AppProps) {
  const client = useMemo(() => api ?? createApiClient(), [api]);
  const store = useFilo(client, { correctionDebounceMs });

  const { refreshDocuments } = store;
  useEffect(() => {
    void refreshDocuments();
  }, [refreshDocuments]);

  function handleRetry(notice: CanvasNotice) {
    switch (notice.kind) {
      case "line_commit_failed":
        void store.retryFailedCommits();
        break;
      case "seal_failed":
        void store.seal();
        break;
      case "load_failed":
        if (store.activeId) void store.openDocument(store.activeId);
        break;
      case "correction_failed":
        // Actually retry the correction pass; clear the notice first so a fresh
        // failure can re-raise it.
        store.dismissNotice();
        void store.runCorrection();
        break;
      case "export_unavailable":
        break;
    }
  }

  const hasActiveDoc = !!store.activeId && !!store.docMeta;

  return (
    <div className="app">
      <header className="app-header">
        <DocumentSwitcher
          documents={store.documents}
          status={store.documentsStatus}
          activeId={store.activeId}
          onCreate={() => void store.createDocument()}
          onOpen={(id) => void store.openDocument(id)}
          onRename={(id, title) => void store.renameDocument(id, title)}
          onDelete={(id) => void store.deleteDocument(id)}
        />

        {hasActiveDoc ? (
          <div className="doc-actions" data-testid="doc-actions">
            <span className="doc-actions-title">{store.docMeta?.title}</span>
            <button
              type="button"
              data-testid="seal-document"
              disabled={store.sealState === "sealing"}
              onClick={() => void store.seal()}
            >
              {store.sealState === "sealing" ? "Sealing…" : "Seal"}
            </button>
            <button
              type="button"
              data-testid="export-document"
              onClick={() => void store.exportLatest()}
            >
              Export .md
            </button>
          </div>
        ) : null}

        <StatusSurface
          status={store.status}
          statusLabel={store.statusLabel}
          notice={store.notice}
          onRetry={handleRetry}
        />
      </header>

      <main className="app-main">
        {hasActiveDoc ? (
          <WritingCanvas store={store} />
        ) : store.docStatus === "loading" ? (
          <p className="around-canvas" data-testid="doc-loading">
            Opening document…
          </p>
        ) : store.documents.length === 0 &&
          store.documentsStatus === "ready" ? (
          <div className="around-canvas" data-testid="no-documents">
            <p>No documents yet.</p>
            <button
              type="button"
              data-testid="first-create"
              onClick={() => void store.createDocument()}
            >
              Start writing
            </button>
          </div>
        ) : (
          <div className="around-canvas" data-testid="choose-document">
            <p>Open a document, or create a new one.</p>
            <button
              type="button"
              data-testid="choose-create"
              onClick={() => void store.createDocument()}
            >
              New document
            </button>
          </div>
        )}
      </main>
    </div>
  );
}

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  createApiClient,
  clearAuthToken,
  hasAuthToken,
  type ApiClientConfig,
  type FiloApi,
} from "./api/client";
import { useFilo } from "./state/useFilo";
import { DocumentSwitcher } from "./components/DocumentSwitcher";
import { StatusSurface } from "./components/StatusSurface";
import { WritingCanvas } from "./components/WritingCanvas";
import { TokenGate } from "./components/TokenGate";
import type { CanvasNotice } from "./state/useFilo";

export interface AppProps {
  /** Injectable API (tests pass a fake; production uses the real client). */
  api?: FiloApi;
  /**
   * Extra config for the internally-created real client (only used when `api`
   * is not injected). Tests use this to supply a mocked `fetchImpl`; App always
   * wires its own `onUnauthorized` on top so a 401 returns to the token gate.
   */
  apiConfig?: ApiClientConfig;
  /** Override the correction debounce (tests use 0). */
  correctionDebounceMs?: number;
  /**
   * Force-bypass the runtime token gate (tests inject a fake API and don't need
   * a token). Defaults to whether a token is present in localStorage.
   */
  requireToken?: boolean;
}

export default function App({
  api,
  apiConfig,
  correctionDebounceMs,
  requireToken = api === undefined,
}: AppProps) {
  // Runtime-only auth: gate the app until a token is stored in localStorage.
  const [authed, setAuthed] = useState(() => !requireToken || hasAuthToken());
  // Set when we bounced the user back to the gate because a request 401'd, so
  // the gate can explain why (vs. a first-time or deliberate sign-out).
  const [rejectedToken, setRejectedToken] = useState(false);

  // Any 401 clears the stored token and returns to the gate — never a soft-lock
  // where a wrong token bricks the app until localStorage is cleared by hand.
  const handleUnauthorized = useCallback(() => {
    clearAuthToken();
    setRejectedToken(true);
    setAuthed(false);
  }, []);

  const client = useMemo(
    () => api ?? createApiClient({ ...apiConfig, onUnauthorized: handleUnauthorized }),
    [api, apiConfig, handleUnauthorized],
  );
  const store = useFilo(client, { correctionDebounceMs });

  const { refreshDocuments } = store;
  useEffect(() => {
    if (!authed) return;
    void refreshDocuments();
  }, [refreshDocuments, authed]);

  function signOut() {
    clearAuthToken();
    setRejectedToken(false);
    setAuthed(false);
  }

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

  if (!authed) {
    return (
      <div className="app">
        <main className="app-main">
          <TokenGate
            notice={
              rejectedToken
                ? "That token didn't work — please re-enter."
                : undefined
            }
            onSaved={() => {
              setRejectedToken(false);
              setAuthed(true);
            }}
          />
        </main>
      </div>
    );
  }

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

        <button
          type="button"
          className="sign-out"
          data-testid="sign-out"
          title="Change or clear your access token"
          onClick={signOut}
        >
          Sign out
        </button>
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

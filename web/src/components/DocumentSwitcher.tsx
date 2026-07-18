import { useState } from "react";
import type { DocumentMeta } from "../api/types";
import type { LoadStatus } from "../state/useFilo";

export interface DocumentSwitcherProps {
  documents: DocumentMeta[];
  status: LoadStatus;
  activeId: string | null;
  onCreate: () => void;
  onOpen: (id: string) => void;
  onRename: (id: string, title: string) => void;
  onDelete: (id: string) => void;
}

/**
 * The document switcher (§4.4) — lives OUTSIDE the writing path. Create, rename,
 * delete, open a draft, and see sync state. Kept behind a light, out-of-the-way
 * toggle so the canvas stays uncluttered.
 */
export function DocumentSwitcher({
  documents,
  status,
  activeId,
  onCreate,
  onOpen,
  onRename,
  onDelete,
}: DocumentSwitcherProps) {
  const [open, setOpen] = useState(false);

  return (
    <div className="doc-switcher">
      <button
        type="button"
        className="doc-switcher-toggle"
        data-testid="switcher-toggle"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        Documents
      </button>

      {open ? (
        <div className="doc-switcher-panel" data-testid="switcher-panel">
          <button
            type="button"
            className="doc-create"
            data-testid="create-document"
            onClick={() => {
              onCreate();
              setOpen(false);
            }}
          >
            New document
          </button>

          {status === "loading" ? (
            <p className="doc-empty" data-testid="documents-loading">
              Loading documents…
            </p>
          ) : status === "error" ? (
            <p className="doc-empty" data-testid="documents-error">
              Could not load documents.
            </p>
          ) : documents.length === 0 ? (
            <p className="doc-empty" data-testid="documents-empty">
              No documents yet.
            </p>
          ) : (
            <ul className="doc-list" data-testid="documents-list">
              {documents.map((doc) => (
                <li
                  key={doc.id}
                  className="doc-row"
                  data-active={doc.id === activeId ? "true" : undefined}
                >
                  <button
                    type="button"
                    className="doc-open"
                    data-testid="open-document"
                    onClick={() => {
                      onOpen(doc.id);
                      setOpen(false);
                    }}
                  >
                    <span className="doc-title">{doc.title}</span>
                    <span className="doc-meta">
                      {doc.status === "sealed" ? "sealed" : "draft"}
                    </span>
                  </button>
                  <button
                    type="button"
                    className="doc-rename"
                    data-testid="rename-document"
                    aria-label={`Rename ${doc.title}`}
                    onClick={() => {
                      const next = window.prompt("Rename document", doc.title);
                      if (next && next.trim()) onRename(doc.id, next.trim());
                    }}
                  >
                    Rename
                  </button>
                  <button
                    type="button"
                    className="doc-delete"
                    data-testid="delete-document"
                    aria-label={`Delete ${doc.title}`}
                    onClick={() => {
                      if (window.confirm(`Delete "${doc.title}"?`))
                        onDelete(doc.id);
                    }}
                  >
                    Delete
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </div>
  );
}

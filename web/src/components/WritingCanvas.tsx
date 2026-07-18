import { useEffect, useRef, type KeyboardEvent } from "react";
import type { FiloStore } from "../state/useFilo";
import { Composer } from "./Composer";
import { LineStack } from "./LineStack";

export interface WritingCanvasProps {
  store: FiloStore;
}

/**
 * The full-screen writing surface: the committed lines stacked upward and the
 * composer pinned at the bottom, plus the two — and only two — non-interruptive
 * canvas recovery actions (undo-last, restore-raw) in the lower chrome (§4.3,
 * §7). Seal / export / rename / delete deliberately live elsewhere.
 */
export function WritingCanvas({ store }: WritingCanvasProps) {
  const bottomRef = useRef<HTMLDivElement>(null);

  // Keep the newest line in view as the stack grows.
  useEffect(() => {
    bottomRef.current?.scrollIntoView?.({ block: "end" });
  }, [store.lines.length]);

  function handleSurfaceKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    // Cmd/Ctrl+Backspace — undo the most recent line (§4.3 suggested binding).
    if ((e.metaKey || e.ctrlKey) && e.key === "Backspace") {
      e.preventDefault();
      if (store.canUndo) void store.undoLast();
    }
  }

  const latest = store.latestLine;
  const canRestoreRaw =
    !!latest &&
    !latest.id.startsWith("optimistic-") &&
    latest.corrected_text !== null &&
    latest.corrected_text !== latest.raw_text;

  return (
    <div className="writing-canvas" onKeyDown={handleSurfaceKeyDown}>
      <div className="canvas-scroll">
        {store.showFirstRun ? (
          <p className="first-run" data-testid="first-run">
            Write one line, press Enter, keep going.
          </p>
        ) : null}
        <LineStack lines={store.lines} />
        <div ref={bottomRef} />
      </div>

      <div className="lower-chrome">
        <button
          type="button"
          className="undo-last"
          data-testid="undo-last"
          disabled={!store.canUndo}
          onClick={() => void store.undoLast()}
          title="Undo last (⌘/Ctrl+⌫)"
        >
          Undo last
        </button>
        <button
          type="button"
          className="restore-raw"
          data-testid="restore-raw"
          disabled={!canRestoreRaw}
          onClick={() => void store.restoreRawLatest()}
          title="Restore the latest line to what you typed"
        >
          Restore raw
        </button>
      </div>

      <Composer
        value={store.composer}
        composing={store.composing}
        onChange={store.setComposer}
        onCompositionStart={store.handleCompositionStart}
        onCompositionEnd={store.handleCompositionEnd}
        onCommit={store.commitNormal}
        onCommitBlank={store.commitBlank}
      />
    </div>
  );
}

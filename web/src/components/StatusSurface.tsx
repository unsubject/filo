import type { CanvasNotice, StatusKind } from "../state/useFilo";

const NOTICE_COPY: Record<CanvasNotice["kind"], string> = {
  line_commit_failed: "Could not save your last line. Your text is safe.",
  correction_failed: "Corrections paused. They will retry.",
  seal_failed: "Seal did not complete. Your draft is untouched.",
  export_unavailable: "Nothing to export yet — seal the document first.",
  load_failed: "Could not open this document.",
};

/** Notices that offer a quiet retry action. */
const RETRYABLE = new Set<CanvasNotice["kind"]>([
  "line_commit_failed",
  "correction_failed",
  "seal_failed",
  "load_failed",
]);

export interface StatusSurfaceProps {
  status: StatusKind;
  statusLabel: string;
  notice: CanvasNotice | null;
  onRetry?: (notice: CanvasNotice) => void;
}

/**
 * The single, unobtrusive status affordance (§4.1). Text-only, edge-anchored,
 * never a modal/toast/badge-in-line-stack. The around-canvas notice (if any) is
 * a quiet line of copy with an optional retry — also never interruptive.
 */
export function StatusSurface({
  status,
  statusLabel,
  notice,
  onRetry,
}: StatusSurfaceProps) {
  return (
    <div className="status-surface" aria-live="polite">
      {notice ? (
        <span className="status-notice" data-testid="canvas-notice">
          <span data-testid={`notice-${notice.kind}`}>
            {NOTICE_COPY[notice.kind]}
          </span>
          {RETRYABLE.has(notice.kind) && onRetry ? (
            <button
              type="button"
              className="status-retry"
              data-testid="notice-retry"
              onClick={() => onRetry(notice)}
            >
              Retry
            </button>
          ) : null}
        </span>
      ) : null}
      <span
        className="status-glyph"
        data-testid="status-surface"
        data-status={status}
        title={statusLabel}
      >
        {statusLabel}
      </span>
    </div>
  );
}

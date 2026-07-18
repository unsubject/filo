import { useRef, type KeyboardEvent } from "react";

export interface ComposerProps {
  value: string;
  composing: boolean;
  onChange: (value: string) => void;
  onCompositionStart: () => void;
  onCompositionEnd: () => void;
  /** Plain Enter / Cmd|Ctrl+Enter / send button — commit a non-empty line. */
  onCommit: () => void;
  /** Shift+Enter — commit an intentional blank line. */
  onCommitBlank: () => void;
}

/**
 * The single composer, pinned at the bottom. It owns the DOM wiring for the
 * full keyboard contract (§4.2). The actual "is it non-empty / are we
 * composing" decisions live in the store, which double-guards every commit.
 */
export function Composer({
  value,
  composing,
  onChange,
  onCompositionStart,
  onCompositionEnd,
  onCommit,
  onCommitBlank,
}: ComposerProps) {
  const ref = useRef<HTMLTextAreaElement>(null);

  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key !== "Enter") return;

    // Belt-and-suspenders IME guard: our own composition flag OR the browser's
    // native signal (isComposing / the legacy keyCode 229). If composing, let
    // the IME select candidates — never commit, never preventDefault.
    const nativeComposing =
      e.nativeEvent.isComposing || e.nativeEvent.keyCode === 229;
    if (composing || nativeComposing) return;

    e.preventDefault();
    if (e.shiftKey) {
      onCommitBlank();
    } else {
      // Plain Enter and Cmd/Ctrl+Enter are both explicit non-empty commits.
      onCommit();
    }
  }

  return (
    <div className="composer">
      <textarea
        ref={ref}
        className="composer-input"
        data-testid="composer"
        aria-label="Write a line"
        value={value}
        rows={1}
        spellCheck={false}
        autoCorrect="off"
        autoCapitalize="off"
        autoComplete="off"
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={handleKeyDown}
        onCompositionStart={onCompositionStart}
        onCompositionEnd={onCompositionEnd}
      />
      <button
        type="button"
        className="composer-send"
        data-testid="send-button"
        aria-label="Send line"
        // Gated by composition state, exactly like Enter.
        disabled={composing}
        onClick={() => onCommit()}
      >
        Send
      </button>
    </div>
  );
}

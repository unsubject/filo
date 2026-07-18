import { useState } from "react";
import { setAuthToken } from "../api/client";

export interface TokenGateProps {
  /** Called after a non-empty token is stored, so the app can re-render. */
  onSaved: () => void;
  /**
   * Optional brief notice shown above the field — e.g. when the app returns to
   * the gate because a request 401'd on a wrong/expired token.
   */
  notice?: string;
}

/**
 * A one-time, distraction-free gate shown when no bearer token is present
 * (`!hasAuthToken()`). It lives OUTSIDE the writing canvas and stores the token
 * at RUNTIME via `setAuthToken` (localStorage) — the token is never baked into
 * the static bundle (spec §6). Kept quiet and text-only, consistent with the
 * rest of the chrome.
 */
export function TokenGate({ onSaved, notice }: TokenGateProps) {
  const [value, setValue] = useState("");

  function save() {
    const token = value.trim();
    if (!token) return;
    setAuthToken(token);
    setValue("");
    onSaved();
  }

  return (
    <div className="around-canvas token-gate" data-testid="token-gate">
      {notice ? (
        <p className="token-notice" role="alert" data-testid="token-notice">
          {notice}
        </p>
      ) : null}
      <p>Enter your filo access token to begin.</p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
      >
        <input
          type="password"
          className="token-input"
          data-testid="token-input"
          aria-label="filo access token"
          autoComplete="off"
          spellCheck={false}
          placeholder="Access token"
          value={value}
          onChange={(e) => setValue(e.target.value)}
        />
        <button type="submit" data-testid="token-save" disabled={!value.trim()}>
          Save
        </button>
      </form>
      <p className="token-hint">
        Stored only in this browser (localStorage). It is never sent anywhere but
        the filo API.
      </p>
    </div>
  );
}

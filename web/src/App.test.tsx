import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup, within } from "@testing-library/react";
import App from "./App";
import { createFakeApi, type FakeApi } from "./test/fakeApi";

afterEach(cleanup);

/** Bootstrap App with a fresh in-memory API and open one empty document. */
async function openFreshDoc(): Promise<{
  api: FakeApi;
  composer: HTMLTextAreaElement;
}> {
  const api = createFakeApi();
  render(<App api={api} correctionDebounceMs={0} />);
  const start = await screen.findByTestId("first-create");
  fireEvent.click(start);
  const composer = (await screen.findByTestId(
    "composer",
  )) as HTMLTextAreaElement;
  return { api, composer };
}

function type(composer: HTMLTextAreaElement, value: string) {
  fireEvent.change(composer, { target: { value } });
}

function committedLines() {
  return screen.queryAllByTestId("committed-line");
}

describe("filo keyboard contract & recovery", () => {
  let composer: HTMLTextAreaElement;
  let api: FakeApi;

  beforeEach(async () => {
    ({ api, composer } = await openFreshDoc());
  });

  it("commits a line when Enter is pressed and not composing", async () => {
    type(composer, "hello world");
    fireEvent.keyDown(composer, { key: "Enter" });

    await screen.findByText("hello world");
    expect(committedLines()).toHaveLength(1);
    // Composer clears after the server acknowledges the commit (§5.6).
    await waitFor(() => expect(composer.value).toBe(""));
  });

  it("does NOT commit while an IME composition is active", async () => {
    fireEvent.compositionStart(composer);
    type(composer, "nihao"); // romanization mid-composition
    fireEvent.keyDown(composer, { key: "Enter" });

    // Enter during composition must select candidates, never commit.
    expect(committedLines()).toHaveLength(0);

    fireEvent.compositionEnd(composer);
    // The typed text is still in the composer, untouched.
    expect(composer.value).toBe("nihao");
  });

  it("does nothing on empty composer + Enter, but Shift+Enter adds one blank line", async () => {
    // Empty composer + Enter -> no-op (no accidental blank line).
    fireEvent.keyDown(composer, { key: "Enter" });
    expect(committedLines()).toHaveLength(0);

    // Shift+Enter -> exactly one intentional blank line.
    fireEvent.keyDown(composer, { key: "Enter", shiftKey: true });
    await waitFor(() => expect(committedLines()).toHaveLength(1));
    expect(committedLines()[0]).toHaveAttribute("data-blank", "true");
  });

  it("undo-last removes the most recent committed line", async () => {
    type(composer, "first");
    fireEvent.keyDown(composer, { key: "Enter" });
    await screen.findByText("first");
    type(composer, "second");
    fireEvent.keyDown(composer, { key: "Enter" });
    await screen.findByText("second");
    expect(committedLines()).toHaveLength(2);

    fireEvent.click(screen.getByTestId("undo-last"));

    await waitFor(() => expect(committedLines()).toHaveLength(1));
    expect(screen.queryByText("second")).toBeNull();
    expect(screen.getByText("first")).toBeInTheDocument();
  });

  it("restore-raw returns the latest line to exactly what was typed", async () => {
    type(composer, "teh dog");
    fireEvent.keyDown(composer, { key: "Enter" });

    // Silent correction turns "teh" into "the" in place.
    await screen.findByText("the dog");
    expect(screen.queryByText("teh dog")).toBeNull();

    const restore = await screen.findByTestId("restore-raw");
    await waitFor(() => expect(restore).toBeEnabled());
    fireEvent.click(restore);

    // Restore-raw brings back the exact typed text.
    await screen.findByText("teh dog");
    expect(screen.queryByText("the dog")).toBeNull();
  });

  it("the mobile send button commits a line like Enter", async () => {
    type(composer, "sent via button");
    fireEvent.click(screen.getByTestId("send-button"));

    await screen.findByText("sent via button");
    expect(committedLines()).toHaveLength(1);
  });

  it("retains composer text and retries when a commit fails (§5.6)", async () => {
    api.failNextCommit();
    type(composer, "flaky line");
    fireEvent.keyDown(composer, { key: "Enter" });

    // Quiet around-canvas notice; typed text is never lost.
    await screen.findByTestId("notice-line_commit_failed");
    expect(composer.value).toBe("flaky line");

    fireEvent.click(screen.getByTestId("notice-retry"));

    await waitFor(() =>
      expect(screen.queryByTestId("notice-line_commit_failed")).toBeNull(),
    );
    const stack = screen.getByTestId("line-stack");
    expect(within(stack).getByText("flaky line")).toBeInTheDocument();
  });
});

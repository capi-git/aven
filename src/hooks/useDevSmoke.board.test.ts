// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { memoryStorage } from "../lib/devSmoke";

vi.mock("../lib/harness/child", () => ({ resolveClaudeBinary: vi.fn() }));
vi.mock("../lib/floatingSidebar", () => ({
  nativeFloatingSidebar: { send: vi.fn(), listen: vi.fn() },
}));

import { checkBoard } from "./useDevSmoke";

const PROJECT = "/tmp/check/project";

type Flaws = {
  /** Open board shows no columns. */
  empty?: boolean;
  /** Cmd+W leaves it open. */
  kept?: boolean;
};

let listening = new AbortController();

/** The workspace as far as the check reads and drives it. */
function app(flaws: Flaws = {}) {
  listening = new AbortController();
  const button = document.createElement("button");
  button.setAttribute("aria-label", "Open board");
  document.body.append(button);
  let screen: HTMLElement | null = null;
  button.addEventListener("click", () => {
    screen = document.createElement("div");
    screen.dataset.workBoard = PROJECT;
    screen.innerHTML = flaws.empty
      ? ""
      : '<section data-board-column="idea">Ideas</section>';
    document.body.append(screen);
  });
  window.addEventListener(
    "keydown",
    (event) => {
      if (event.key !== "w" || !(event.metaKey || event.ctrlKey)) return;
      if (!flaws.kept) screen?.remove();
    },
    { signal: listening.signal },
  );
  return { motion: { showWorkspace: vi.fn() } };
}

describe("Open board in the real-app check", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal("localStorage", memoryStorage());
    // happy-dom lays nothing out: anything in the document is on screen.
    vi.spyOn(Element.prototype, "getClientRects").mockImplementation(function (
      this: Element,
    ) {
      return (this.isConnected
        ? [{ width: 1, height: 1 }]
        : []) as unknown as DOMRectList;
    });
  });
  afterEach(() => {
    listening.abort();
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    document.body.innerHTML = "";
  });

  const run = async (flaws?: Flaws) => {
    const state = app(flaws);
    const result = checkBoard(() => state as never, PROJECT).then(
      (detail) => ({ detail }),
      (error: Error) => ({ error: error.message }),
    );
    await vi.runAllTimersAsync();
    return result;
  };

  it("passes when the board opens with its columns and Cmd+W closes it", async () => {
    expect(await run()).toEqual({
      detail:
        "Open board opened the project's board with its columns; Cmd+W closed it",
    });
  });

  it("fails when the board shows no columns", async () => {
    expect(await run({ empty: true })).toEqual({
      error: "Timed out waiting for the board's columns",
    });
  });

  it("fails when Cmd+W leaves it open", async () => {
    expect(await run({ kept: true })).toEqual({
      error: "Timed out waiting for Cmd+W to close the board",
    });
  });
});

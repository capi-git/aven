// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ensureAvos, getCrew, resetCrewsCache } from "../lib/crews";
import { memoryStorage } from "../lib/devSmoke";

vi.mock("../lib/harness/child", () => ({ resolveClaudeBinary: vi.fn() }));
vi.mock("../lib/floatingSidebar", () => ({
  nativeFloatingSidebar: { send: vi.fn(), listen: vi.fn() },
}));

import { checkBoard } from "./useDevSmoke";

const PROJECT = "/tmp/check/project";

type Flaws = {
  /** Open Avos shows the old Board's columns. */
  board?: boolean;
  /** The line about chats outside the board shows above it. */
  outside?: boolean;
  /** Cmd+W leaves it open. */
  kept?: boolean;
};

let listening = new AbortController();

/** The workspace as far as the check reads and drives it. */
function app(flaws: Flaws = {}) {
  listening = new AbortController();
  const button = document.createElement("button");
  button.setAttribute("aria-label", "Open Avos");
  document.body.append(button);
  let screen: HTMLElement | null = null;
  button.addEventListener("click", () => {
    ensureAvos(PROJECT);
    screen = document.createElement("div");
    screen.dataset.workBoard = PROJECT;
    screen.innerHTML = `<div data-avos-meet>Hi, I'm Avos.</div>${
      flaws.board ? '<section data-board-column="idea">Ideas</section>' : ""
    }${flaws.outside ? "<div data-board-outside>1 chat</div>" : ""}`;
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

describe("Open Avos in the real-app check", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal("localStorage", memoryStorage());
    resetCrewsCache();
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

  it("passes when it meets the project's Avos, with no Board, and Cmd+W closes it", async () => {
    expect(await run()).toEqual({
      detail:
        "Open Avos opened the project's Avos on meeting it, with no Board columns and no line about chats outside the board; Cmd+W closed it",
    });
    // What it saved is forgotten, for the crew steps after.
    expect(getCrew(PROJECT)).toBeUndefined();
  });

  it("fails when the old Board's columns show", async () => {
    expect(await run({ board: true })).toEqual({
      error: "The old Board's columns showed",
    });
  });

  it("fails when the line about chats outside the board shows", async () => {
    expect(await run({ outside: true })).toEqual({
      error: "The line about chats outside the board showed",
    });
  });

  it("fails when Cmd+W leaves it open", async () => {
    expect(await run({ kept: true })).toEqual({
      error: "Timed out waiting for Cmd+W to close Avos",
    });
  });
});

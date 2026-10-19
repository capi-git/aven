// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Session } from "../lib/session";

vi.mock("../lib/harness/child", () => ({ resolveClaudeBinary: vi.fn() }));
vi.mock("../lib/floatingSidebar", () => ({
  nativeFloatingSidebar: { send: vi.fn(), listen: vi.fn() },
}));

import { SMOKE_REPLY } from "../lib/devSmoke";
import { BOARD_EDIT_FILE, checkBoard } from "./useDevSmoke";

const PROJECT = "/tmp/check/project";

type Flaws = {
  /** The card stays under Building after the turn ends. */
  noReview?: boolean;
  /** The card's button leaves the board on screen. */
  boardStays?: boolean;
  /** Cmd+W leaves the board tab open. */
  boardKept?: boolean;
  /** Add on the outside line puts nothing on the board. */
  addFails?: boolean;
};

let listening = new AbortController();

/** The workspace as far as the board check reads and drives it. */
function app(flaws: Flaws = {}) {
  // The board's tab, and whether it is the one on screen.
  let boardTab = false;
  let boardOpen = false;
  let outsideOpen = false;
  let focused = "";
  const linked = new Set<string>();
  listening = new AbortController();
  window.addEventListener(
    "keydown",
    (event) => {
      if (event.key !== "w" || !(event.metaKey || event.ctrlKey)) return;
      if (boardOpen && !flaws.boardKept) {
        boardTab = false;
        boardOpen = false;
        draw();
      }
    },
    { signal: listening.signal },
  );
  const state = {
    sessions: [] as Session[],
    floatingSidebarLabel: null,
    expectFloatingSidebar: false,
    newProjectTask: vi.fn((path: string) => {
      const id = `task-${state.sessions.length + 1}`;
      state.sessions = [
        ...state.sessions,
        { id, harness: "claude", cwd: path, busy: false, blocks: [] },
      ] as unknown as Session[];
      focused = id;
      draw();
    }),
    submit: vi.fn((id: string, text: string) => {
      const hold = /AVEN_SMOKE_HOLD (\d+)/.exec(text);
      update(id, { busy: true });
      setTimeout(
        () =>
          update(id, {
            busy: false,
            blocks: [{ id: "r", role: "assistant", text: SMOKE_REPLY }],
          } as Partial<Session>),
        hold ? Number(hold[1]) : 0,
      );
    }),
  };
  function update(id: string, patch: Partial<Session>) {
    state.sessions = state.sessions.map((session) =>
      session.id === id ? { ...session, ...patch } : session,
    );
    draw();
  }
  function card(session: Session) {
    const column = session.busy || flaws.noReview ? "building" : "review";
    const line =
      column === "review" ? `${BOARD_EDIT_FILE} · +1 −0` : "Thinking";
    const buttons =
      column === "review"
        ? '<button class="work-board-action">Review</button><button class="work-board-action">Ship it</button>'
        : "";
    return [
      column,
      `<article data-board-card="card-${session.id}" data-board-chats="${session.id}"><button class="work-board-card-open">Chat</button><span>${line}</span>${buttons}</article>`,
    ] as const;
  }
  function outside() {
    const loose = state.sessions.filter(
      (session) => session.busy && !linked.has(session.id),
    );
    if (!loose.length) return "";
    const rows = outsideOpen
      ? loose
          .map(
            (session) =>
              `<li data-outside-chat="${session.id}"><button class="work-board-action">Add</button></li>`,
          )
          .join("")
      : "";
    return `<div data-board-outside><button class="work-board-outside-toggle">${loose.length} chat working outside the board</button><button class="work-board-outside-add">Add it</button><ul>${rows}</ul></div>`;
  }
  function draw() {
    const cards = state.sessions
      .filter((session) => linked.has(session.id))
      .map(card);
    const columns = ["idea", "building", "review", "shipped"]
      .map(
        (id) =>
          `<section data-board-column="${id}">${cards
            .filter(([column]) => column === id)
            .map(([, html]) => html)
            .join("")}</section>`,
      )
      .join("");
    document.body.innerHTML = `
      <div class="personal-titlebar"><button aria-label="Open board"></button></div>
      ${boardTab ? `<div data-work-board="${PROJECT}"${boardOpen ? "" : " data-hidden"}>${outside()}${columns}</div>` : ""}
      ${boardOpen ? "" : `<div data-session-drop="${focused}"></div>`}`;
    document
      .querySelector('button[aria-label="Open board"]')!
      .addEventListener("click", () => {
        boardTab = true;
        boardOpen = true;
        draw();
      });
    document
      .querySelector(".work-board-outside-toggle")
      ?.addEventListener("click", () => {
        outsideOpen = !outsideOpen;
        draw();
      });
    document
      .querySelectorAll<HTMLElement>("[data-outside-chat]")
      .forEach((row) =>
        row.querySelector("button")!.addEventListener("click", () => {
          if (!flaws.addFails) linked.add(row.dataset.outsideChat!);
          draw();
        }),
      );
    document
      .querySelectorAll<HTMLButtonElement>(".work-board-card-open")
      .forEach((button) =>
        button.addEventListener("click", () => {
          boardOpen = !!flaws.boardStays;
          draw();
        }),
      );
  }
  draw();
  return state;
}

describe("the real-app check's board step", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(Element.prototype, "getClientRects").mockImplementation(function (
      this: Element,
    ) {
      return (
        this.closest("[data-hidden]") ? [] : [new DOMRect(0, 0, 10, 10)]
      ) as never;
    });
  });
  afterEach(() => {
    listening.abort();
    vi.useRealTimers();
    vi.restoreAllMocks();
    document.body.innerHTML = "";
  });

  const run = async (flaws?: Flaws) => {
    const state = app(flaws);
    const result = checkBoard(() => state as never, PROJECT).then(
      (detail) => ({ detail }),
      (error: Error) => ({ error: error.message }),
    );
    await vi.runAllTimersAsync();
    return { state, outcome: await result };
  };

  it("passes when the added card moves from Building to Review and opens the chat", async () => {
    const { state, outcome } = await run();
    expect(outcome).toEqual({
      detail: `four columns; added from the line for chats outside the board, the card moved from Building to Review with ${BOARD_EDIT_FILE} and offered Review, Ship it; pressing it opened the chat; Cmd+W closed the board`,
    });
    // The turn edits the file through the stand-in, held while the board opens.
    expect(state.submit.mock.calls[0]?.[1]).toContain(
      `AVEN_SMOKE_EDIT ${BOARD_EDIT_FILE}`,
    );
  });

  it("fails when the card never reaches Review", async () => {
    const { outcome } = await run({ noReview: true });
    expect(outcome).toEqual({
      error: "Timed out waiting for the chat's card to move to Review",
    });
  });

  it("fails when adding the chat from the outside line gives it no card", async () => {
    const { outcome } = await run({ addFails: true });
    expect(outcome).toEqual({
      error: "Timed out waiting for the chat's card under Building",
    });
  });

  it("fails when the board is left open", async () => {
    const { outcome } = await run({ boardKept: true });
    expect(outcome).toEqual({
      error: "Timed out waiting for Cmd+W to close the board",
    });
  });

  it("fails when pressing the card does not open the chat", async () => {
    const { outcome } = await run({ boardStays: true });
    expect(outcome).toEqual({
      error:
        "Timed out waiting for the card to open its chat (chat not on screen, focused unknown, board on screen in undefined)",
    });
  });
});

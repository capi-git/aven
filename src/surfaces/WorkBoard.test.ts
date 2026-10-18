// @vitest-environment happy-dom
import { act, createElement, type ProfilerOnRenderCallback } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { noteChatReview } from "../lib/chatReview";
import type { ChatStatusWord } from "../lib/chatStatus";
import { recordShipped } from "../lib/shippedChats";
import type { TeamRun } from "../lib/teamRuns";
import type { BoardChat } from "../lib/workBoard";
import {
  installWorkBoardActions,
  publishWorkBoardFeed,
  resetWorkBoardFeed,
  type WorkBoardActions,
  type WorkBoardFeed,
} from "../lib/workBoardFeed";
import { WorkBoard } from "./WorkBoard";

// The header's mark renders only when the drawn board does, and each card's
// mascots only when that card does: their Profilers count those renders.
const renders = vi.hoisted(() => ({ board: 0, cards: 0 }));
vi.mock("../chrome/ProjectMark", async () => {
  const react = await import("react");
  const onRender: ProfilerOnRenderCallback = () => {
    renders.board += 1;
  };
  return {
    ProjectMark: () =>
      react.createElement(
        react.Profiler,
        { id: "mark", onRender },
        react.createElement("span", { "data-mark": "" }),
      ),
  };
});
vi.mock("../chrome/TeamCard", async (importOriginal) => {
  const react = await import("react");
  const onRender: ProfilerOnRenderCallback = () => {
    renders.cards += 1;
  };
  return {
    TeamCardButton: (
      await importOriginal<typeof import("../chrome/TeamCard")>()
    ).TeamCardButton,
    TeamMiniFaces: ({
      members,
      active,
    }: {
      members: { sessionId: string }[];
      active?: boolean;
    }) =>
      react.createElement(
        react.Profiler,
        { id: "faces", onRender },
        react.createElement("span", {
          "data-faces": members.map((member) => member.sessionId).join(","),
          "data-active": active ? "true" : undefined,
        }),
      ),
  };
});

const PROJECT = "/work/site";
const NOW = new Date(2026, 9, 17, 15, 0).getTime();

let root: Root;
let container: HTMLDivElement;
let actions: {
  [K in keyof WorkBoardActions]: ReturnType<
    typeof vi.fn<(...args: Parameters<WorkBoardActions[K]>) => void>
  >;
};

const chat = (id: string, patch: Partial<BoardChat> = {}): BoardChat => ({
  id,
  cwd: PROJECT,
  workCwd: PROJECT,
  title: `Chat ${id}`,
  harness: "claude",
  at: NOW - 1_000,
  ...patch,
});

function feed(
  chats: BoardChat[],
  statuses: Record<string, ChatStatusWord>,
  teams: TeamRun[] = [],
): WorkBoardFeed {
  return { chats, statuses, teams };
}

async function render(visible = true) {
  await act(async () =>
    root.render(createElement(WorkBoard, { project: PROJECT, visible })),
  );
}

const column = (id: string) =>
  container.querySelector<HTMLElement>(`[data-board-column="${id}"]`)!;
const cardIn = (columnId: string, sessionId: string) =>
  column(columnId).querySelector<HTMLElement>(
    `[data-board-card][data-session-id="${sessionId}"]`,
  );
const button = (scope: Element, name: string) =>
  [...scope.querySelectorAll<HTMLButtonElement>("button")].find(
    (entry) => entry.textContent === name,
  )!;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const values = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  });
  resetWorkBoardFeed();
  actions = {
    openChat: vi.fn(),
    allow: vi.fn(),
    review: vi.fn(),
    ship: vi.fn(),
    watch: vi.fn(),
    compare: vi.fn(),
    preview: vi.fn(),
    openCommit: vi.fn(),
    openUrl: vi.fn(),
  };
  installWorkBoardActions(actions);
  renders.board = 0;
  renders.cards = 0;
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  resetWorkBoardFeed();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("WorkBoard", () => {
  it("says it is loading until the workspace tells it the chats", async () => {
    await render();
    expect(container.textContent).toContain("Loading chats…");
    expect(column("working").textContent).toContain("Loading…");
    expect(column("working").textContent).not.toContain("Nothing running");
    await act(async () => publishWorkBoardFeed(feed([], {})));
    expect(container.textContent).not.toContain("Loading");
    expect(column("working").textContent).toContain("Nothing running");
  });

  it("shows four calm, empty columns with the project's name and today's line", async () => {
    publishWorkBoardFeed(feed([], {}));
    await render();
    expect(
      [...container.querySelectorAll("[data-board-column] h2")].map(
        (heading) => heading.textContent,
      ),
    ).toEqual(["Needs you0", "Working0", "Ready to review0", "Shipped0"]);
    expect(container.querySelector("h1")?.textContent).toBe("site");
    expect(container.textContent).toContain("Today: 0 shipped · 0 in progress");
    expect(column("needs-you").textContent).toContain("Nothing needs you");
    expect(column("working").textContent).toContain("Nothing running");
    expect(column("review").textContent).toContain("Nothing to review");
  });

  it("puts each chat in its column with the right buttons, which act on it", async () => {
    noteChatReview(
      {
        sessionId: "fix",
        project: PROJECT,
        cwd: PROJECT,
        files: [{ relative: "src/Row.js", additions: 40, deletions: 6 }],
        title: "Fix sign-in redirect",
        harness: "codex",
      },
      NOW - 5_000,
    );
    recordShipped([
      {
        sessionId: "done",
        project: PROJECT,
        cwd: PROJECT,
        at: NOW - 60_000,
        pr: { number: 42, url: "https://github.com/o/r/pull/42" },
        title: "Passcode optional",
        harness: "claude",
      },
    ]);
    publishWorkBoardFeed(
      feed(
        [
          chat("ask", {
            waiting: {
              kind: "approval",
              detail: "npm run deploy",
              requestId: 7,
            },
          }),
          chat("run", { startedAt: NOW - 120_000, doing: "Edit App.tsx" }),
        ],
        { ask: "needs-you", run: "working", fix: "review", done: "shipped" },
      ),
    );
    await render();
    const ask = cardIn("needs-you", "ask")!;
    expect(ask.textContent).toContain(
      "Claude wants your approval: npm run deploy",
    );
    await act(async () => button(ask, "Allow").click());
    expect(actions.allow).toHaveBeenCalledWith("ask", 7);
    await act(async () => button(ask, "Open chat").click());
    expect(actions.openChat).toHaveBeenCalledWith("ask");

    const run = cardIn("working", "run")!;
    expect(run.textContent).toContain("Edit App.tsx · 2m");
    expect(run.querySelector("[data-faces]")?.getAttribute("data-active")).toBe(
      "true",
    );

    const fix = cardIn("review", "fix")!;
    expect(fix.textContent).toContain("Fix sign-in redirect");
    expect(fix.textContent).toContain("Row.js · +40 −6");
    await act(async () => button(fix, "Review").click());
    expect(actions.review).toHaveBeenCalledWith("fix", PROJECT);
    await act(async () => button(fix, "Ship it").click());
    expect(actions.ship).toHaveBeenCalledWith("fix", PROJECT);

    const done = cardIn("shipped", "done")!;
    expect(done.textContent).toContain("PR #42");
    await act(async () => button(done, "Open PR #42").click());
    expect(actions.openUrl).toHaveBeenCalledWith(
      "https://github.com/o/r/pull/42",
    );

    // Clicking a card opens its chat.
    await act(async () =>
      fix.querySelector<HTMLButtonElement>(".work-board-card-open")!.click(),
    );
    expect(actions.openChat).toHaveBeenLastCalledWith("fix");
    expect(container.textContent).toContain("Today: 1 shipped · 2 in progress");
  });

  it("shows a team as one card that Watch opens", async () => {
    const team: TeamRun = {
      id: "race:r1",
      kind: "race",
      key: "r1",
      origin: { sessionId: "origin" },
      project: PROJECT,
      title: "Team panel polish",
      status: "running",
      progress: "1 of 2 done",
      members: ["l1", "l2"].map((sessionId) => ({
        sessionId,
        harness: "codex" as const,
        model: "m",
        label: sessionId,
        role: "lane" as const,
        state: "working" as const,
        stateLabel: "Working",
      })),
      startedAt: NOW - 60_000,
      updatedAt: NOW - 60_000,
    };
    publishWorkBoardFeed(
      feed(
        [chat("origin"), chat("l1"), chat("l2")],
        { origin: "racing", l1: "racing", l2: "racing" },
        [team],
      ),
    );
    await render();
    const cards = column("working").querySelectorAll("[data-board-card]");
    expect(cards).toHaveLength(1);
    expect(cards[0].getAttribute("data-team")).toBe("race");
    expect(cards[0].textContent).toContain("Racing · 1 of 2 done");
    expect(
      cards[0].querySelector("[data-faces]")?.getAttribute("data-faces"),
    ).toBe("l1,l2");
    await act(async () => button(cards[0], "Watch").click());
    expect(actions.watch).toHaveBeenCalledWith("race:r1");
  });

  it("draws nothing again for a feed that changed nothing it shows", async () => {
    const chats = [chat("run", { startedAt: NOW - 1_000, doing: "Thinking" })];
    publishWorkBoardFeed(feed(chats, { run: "working" }));
    await render();
    const drawn = { board: renders.board, cards: renders.cards };
    const mutations: MutationRecord[] = [];
    const observer = new MutationObserver((records) =>
      mutations.push(...records),
    );
    observer.observe(container, {
      subtree: true,
      childList: true,
      attributes: true,
      characterData: true,
    });
    // New objects with the same content, as a streamed reply would leave.
    await act(async () =>
      publishWorkBoardFeed(feed([...chats], { run: "working" })),
    );
    // Another project's chat changing.
    await act(async () =>
      publishWorkBoardFeed(
        feed([...chats, chat("far", { cwd: "/work/other" })], {
          run: "working",
          far: "working",
        }),
      ),
    );
    observer.disconnect();
    expect(renders).toEqual(drawn);
    expect(mutations).toEqual([]);
  });

  it("keeps a hidden board as it was, then catches up when shown", async () => {
    publishWorkBoardFeed(feed([chat("run")], { run: "working" }));
    await render(false);
    expect(cardIn("working", "run")).not.toBeNull();
    const drawn = renders.board;
    await act(async () => publishWorkBoardFeed(feed([], {})));
    expect(renders.board).toBe(drawn);
    expect(cardIn("working", "run")).not.toBeNull();
    await render(true);
    expect(cardIn("working", "run")).toBeNull();
  });

  it("glides a card that moved to another column from where it was", async () => {
    // Columns side by side, cards stacked: a rect from the card's column.
    const x: Record<string, number> = {
      "needs-you": 0,
      working: 200,
      review: 400,
      shipped: 600,
    };
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
      function (this: HTMLElement) {
        const column = this.getAttribute("data-column");
        const left = column ? x[column] : 0;
        return {
          x: left,
          y: 100,
          left,
          top: 100,
          right: left + 180,
          bottom: 160,
          width: column ? 180 : 800,
          height: 60,
          toJSON: () => ({}),
        } as DOMRect;
      },
    );
    vi.stubGlobal("matchMedia", () => ({ matches: false }));
    const frames: FrameRequestCallback[] = [];
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) =>
      frames.push(callback),
    );
    vi.stubGlobal("cancelAnimationFrame", () => {});
    publishWorkBoardFeed(feed([chat("a")], { a: "working" }));
    await render();
    expect(cardIn("working", "a")?.hasAttribute("data-gliding")).toBe(false);
    await act(async () =>
      noteChatReview(
        {
          sessionId: "a",
          project: PROJECT,
          cwd: PROJECT,
          files: [{ relative: "a.ts", additions: 1, deletions: 0 }],
        },
        NOW,
      ),
    );
    await act(async () =>
      publishWorkBoardFeed(feed([chat("a")], { a: "review" })),
    );
    // Drawn first where it was, in the Working column…
    const moved = cardIn("review", "a")!;
    expect(moved.getAttribute("data-gliding")).toBe("start");
    expect(moved.style.transform).toBe("translate(-200px, 0px)");
    // …then let go, so the stylesheet's transition carries it across.
    for (const frame of frames.splice(0)) frame(0);
    expect(moved.getAttribute("data-gliding")).toBe("");
    expect(moved.style.transform).toBe("");
    moved.dispatchEvent(
      Object.assign(new Event("transitionend"), { propertyName: "transform" }),
    );
    expect(moved.hasAttribute("data-gliding")).toBe(false);
  });

  it("does not glide from the corner after it was set aside", async () => {
    let laidOut = true;
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
      function (this: HTMLElement) {
        const column = this.getAttribute("data-column");
        const left = !laidOut
          ? 0
          : column === "review"
            ? 400
            : column === "working"
              ? 200
              : 0;
        const size = laidOut ? 100 : 0;
        return {
          x: left,
          y: 0,
          left,
          top: 0,
          right: left + size,
          bottom: size,
          width: size,
          height: size,
          toJSON: () => ({}),
        } as DOMRect;
      },
    );
    vi.stubGlobal("matchMedia", () => ({ matches: false }));
    publishWorkBoardFeed(feed([chat("a")], { a: "working" }));
    await render();
    // Set aside with no layout, it still redraws when a card changes column.
    laidOut = false;
    await act(async () =>
      noteChatReview(
        {
          sessionId: "a",
          project: PROJECT,
          cwd: PROJECT,
          files: [{ relative: "a.ts", additions: 1, deletions: 0 }],
        },
        NOW,
      ),
    );
    await act(async () =>
      publishWorkBoardFeed(feed([chat("a")], { a: "review" })),
    );
    expect(cardIn("review", "a")?.hasAttribute("data-gliding")).toBe(false);
    // Back on screen, the next change starts over rather than gliding from
    // the corner it measured while it had no layout.
    laidOut = true;
    await act(async () =>
      publishWorkBoardFeed(feed([chat("a")], { a: "working" })),
    );
    const card = cardIn("working", "a")!;
    expect(card.hasAttribute("data-gliding")).toBe(false);
    expect(card.style.transform).toBe("");
  });

  it("does not move cards with reduced motion", async () => {
    vi.stubGlobal("matchMedia", () => ({ matches: true }));
    publishWorkBoardFeed(feed([chat("a")], { a: "working" }));
    await render();
    await act(async () => publishWorkBoardFeed(feed([], {})));
    publishWorkBoardFeed(feed([chat("b")], { b: "working" }));
    await act(async () =>
      publishWorkBoardFeed(feed([chat("b")], { b: "needs-you" })),
    );
    const card = cardIn("needs-you", "b")!;
    expect(card.hasAttribute("data-gliding")).toBe(false);
    expect(card.hasAttribute("data-glide-enter")).toBe(false);
  });
});

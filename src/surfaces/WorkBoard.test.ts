// @vitest-environment happy-dom
import { act, createElement, type ProfilerOnRenderCallback } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { noteChatReview } from "../lib/chatReview";
import type { ChatStatusWord } from "../lib/chatStatus";
import {
  addFeatureCards,
  featureBoardState,
  memoryFeatureCardBackend,
  setFeatureCardBackend,
  type FeatureCardBackend,
  type FeatureCardDraft,
} from "../lib/featureCards";
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
// The card menu and the delete question, as plain buttons.
vi.mock("../chrome/ExplorerMenu", async () => {
  const react = await import("react");
  return {
    ExplorerMenu: ({
      items,
      onPick,
    }: {
      items: { kind: string; id?: string; label?: string }[];
      onPick: (id: string) => void;
    }) =>
      react.createElement(
        "div",
        { "data-menu": "" },
        items
          .filter((item) => item.kind === "item")
          .map((item) =>
            react.createElement(
              "button",
              { key: item.id, onClick: () => onPick(item.id!) },
              item.label,
            ),
          ),
      ),
  };
});
vi.mock("../chrome/ConfirmDialog", async () => {
  const react = await import("react");
  return {
    ConfirmDialog: ({
      title,
      onConfirm,
      onCancel,
    }: {
      title: string;
      onConfirm: () => void;
      onCancel: () => void;
    }) =>
      react.createElement(
        "div",
        { "data-confirm-dialog": title },
        react.createElement("button", { onClick: onCancel }, "Cancel"),
        react.createElement(
          "button",
          { "data-confirm": "", onClick: onConfirm },
          "Delete",
        ),
      ),
  };
});

const PROJECT = "/work/site";
const NOW = new Date(2026, 9, 17, 15, 0).getTime();
const DAY = 86_400_000;

let root: Root;
let container: HTMLDivElement;
let storage: FeatureCardBackend;
let actions: {
  [K in keyof WorkBoardActions]: ReturnType<
    typeof vi.fn<
      (
        ...args: Parameters<WorkBoardActions[K]>
      ) => ReturnType<WorkBoardActions[K]>
    >
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

/** Let the board read and save its cards. */
async function settle() {
  await act(async () => {
    for (let round = 0; round < 4; round += 1)
      await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

async function render(visible = true) {
  await act(async () =>
    root.render(createElement(WorkBoard, { project: PROJECT, visible })),
  );
  await settle();
}

async function cards(drafts: FeatureCardDraft[]) {
  const added = await addFeatureCards(PROJECT, drafts);
  await settle();
  return added;
}

const column = (id: string) =>
  container.querySelector<HTMLElement>(`[data-board-column="${id}"]`)!;
const cardIn = (columnId: string, cardId: string) =>
  column(columnId).querySelector<HTMLElement>(`[data-board-card="${cardId}"]`);
const titlesIn = (columnId: string) =>
  [...column(columnId).querySelectorAll(".work-board-card-name")].map(
    (name) => name.textContent,
  );
const button = (scope: Element, name: string) =>
  [...scope.querySelectorAll<HTMLButtonElement>("button")].find(
    (entry) => entry.textContent === name,
  )!;
const saved = async () => storage.list("/work/site");

async function type(input: HTMLInputElement, value: string) {
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )!.set!;
    setter.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function press(target: Element, key: string) {
  await act(async () => {
    target.dispatchEvent(
      new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }),
    );
  });
}

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
  document.documentElement.removeAttribute("data-motion");
  storage = memoryFeatureCardBackend();
  setFeatureCardBackend(storage);
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
    build: vi.fn(() => "built"),
    draft: vi.fn(() => "drafted"),
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
  setFeatureCardBackend(null);
  document.documentElement.removeAttribute("data-motion");
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("WorkBoard", () => {
  it("says it is loading until the workspace tells it the chats", async () => {
    await render();
    expect(container.textContent).toContain("Loading…");
    expect(column("building").textContent).toContain("Loading…");
    expect(container.querySelector(".work-board-add-input")).toBeNull();
    await act(async () => publishWorkBoardFeed(feed([], {})));
    expect(container.textContent).not.toContain("Loading");
    expect(column("building").textContent).toContain("Nothing building");
  });

  it("shows Ideas, Building, Review and Shipped, inviting the first idea", async () => {
    publishWorkBoardFeed(feed([], {}));
    await render();
    expect(
      [...container.querySelectorAll("[data-board-column] h2")].map(
        (heading) => heading.textContent,
      ),
    ).toEqual(["Ideas0", "Building0", "Review0", "Shipped0"]);
    expect(container.querySelector("h1")?.textContent).toBe("site");
    expect(container.textContent).toContain("Today: 0 shipped · 0 in progress");
    expect(column("idea").textContent).toContain(
      "Write down what you want built next.",
    );
    expect(column("review").textContent).toContain("Nothing to review");
  });

  it("adds an idea with Enter, and Escape clears the box", async () => {
    publishWorkBoardFeed(feed([], {}));
    await render();
    const input = container.querySelector<HTMLInputElement>(
      'input[aria-label="Add an idea"]',
    )!;
    await type(input, "  Dark mode  ");
    await act(async () => input.form!.requestSubmit());
    await settle();
    expect(titlesIn("idea")).toEqual(["Dark mode"]);
    expect(input.value).toBe("");
    expect((await saved()).map((card) => card.title)).toEqual(["Dark mode"]);
    expect(column("idea").textContent).not.toContain("Write down");
    await type(input, "Export");
    await press(input, "Escape");
    expect(input.value).toBe("");
    expect(titlesIn("idea")).toEqual(["Dark mode"]);
  });

  it("Build sends the card to a new chat and moves it to Building", async () => {
    publishWorkBoardFeed(feed([], {}));
    await render();
    const [idea] = await cards([
      { title: "Dark mode", note: "Follow the system setting." },
    ]);
    const card = cardIn("idea", idea.id)!;
    await act(async () => button(card, "Build").click());
    await settle();
    expect(actions.build).toHaveBeenCalledWith(
      PROJECT,
      "Dark mode\n\nFollow the system setting.",
    );
    expect(cardIn("building", idea.id)).not.toBeNull();
    expect((await saved())[0]).toMatchObject({
      column: "building",
      chatIds: ["built"],
    });
    // Its chat starts work: the card shows it at work, and stays.
    await act(async () =>
      publishWorkBoardFeed(
        feed([chat("built", { startedAt: NOW, doing: "Edit theme.css" })], {
          built: "working",
        }),
      ),
    );
    await settle();
    const working = cardIn("building", idea.id)!;
    expect(working.textContent).toContain("Edit theme.css");
    expect(
      working.querySelector("[data-faces]")?.getAttribute("data-active"),
    ).toBe("true");
  });

  it("Open as draft starts a chat with the brief typed in and leaves the card in Ideas", async () => {
    publishWorkBoardFeed(feed([], {}));
    await render();
    const [idea] = await cards([{ title: "Search" }]);
    await act(async () =>
      cardIn("idea", idea.id)!
        .querySelector<HTMLButtonElement>(".work-board-card-more")!
        .click(),
    );
    await act(async () =>
      button(container.querySelector("[data-menu]")!, "Open as draft").click(),
    );
    await settle();
    expect(actions.draft).toHaveBeenCalledWith(PROJECT, "Search");
    expect(actions.build).not.toHaveBeenCalled();
    expect(cardIn("idea", idea.id)).not.toBeNull();
    expect(featureBoardState(PROJECT).cards[0].chatIds).toEqual(["drafted"]);
  });

  it("moves a card by itself from its chat's state, with the buttons each column needs", async () => {
    publishWorkBoardFeed(feed([], {}));
    await render();
    const [card] = await cards([
      { title: "Sign-in fix", chatIds: ["fix"], column: "building" },
    ]);
    await act(async () =>
      publishWorkBoardFeed(
        feed(
          [
            chat("fix", {
              waiting: { kind: "approval", detail: "npm i", requestId: 7 },
            }),
          ],
          { fix: "needs-you" },
        ),
      ),
    );
    await settle();
    // Waiting on you: it stays, amber, with Allow.
    const waiting = cardIn("building", card.id)!;
    expect(waiting.hasAttribute("data-needs-you")).toBe(true);
    expect(waiting.querySelector(".work-board-needs-you")?.textContent).toBe(
      "Needs you · Claude wants your approval: npm i",
    );
    await act(async () => button(waiting, "Allow").click());
    expect(actions.allow).toHaveBeenCalledWith("fix", 7);

    await act(async () =>
      noteChatReview(
        {
          sessionId: "fix",
          project: PROJECT,
          cwd: PROJECT,
          files: [{ relative: "src/Row.js", additions: 40, deletions: 6 }],
        },
        NOW,
      ),
    );
    await act(async () =>
      publishWorkBoardFeed(feed([chat("fix")], { fix: "review" })),
    );
    await settle();
    const review = cardIn("review", card.id)!;
    expect(review.textContent).toContain("Row.js · +40 −6");
    await act(async () => button(review, "Review").click());
    expect(actions.review).toHaveBeenCalledWith("fix", PROJECT);
    await act(async () => button(review, "Ship it").click());
    expect(actions.ship).toHaveBeenCalledWith("fix", PROJECT);
    expect((await saved())[0].column).toBe("review");
    // Clicking the card opens its chat.
    await act(async () =>
      review.querySelector<HTMLButtonElement>(".work-board-card-open")!.click(),
    );
    expect(actions.openChat).toHaveBeenLastCalledWith("fix");
    expect(container.textContent).toContain("Today: 0 shipped · 1 in progress");
  });

  it("keeps a card moved by hand there until its chat really changes", async () => {
    publishWorkBoardFeed(feed([chat("run")], { run: "working" }));
    await render();
    const [card] = await cards([{ title: "Search", chatIds: ["run"] }]);
    expect(cardIn("building", card.id)).not.toBeNull();
    await act(async () =>
      cardIn("building", card.id)!
        .querySelector<HTMLButtonElement>(".work-board-card-more")!
        .click(),
    );
    await act(async () =>
      button(container.querySelector("[data-menu]")!, "Move to Review").click(),
    );
    await settle();
    expect(cardIn("review", card.id)).not.toBeNull();
    // The same state again keeps it where it was put.
    await act(async () =>
      publishWorkBoardFeed(feed([chat("run")], { run: "working" })),
    );
    await settle();
    expect(cardIn("review", card.id)).not.toBeNull();
    // A real change in its chat: it follows the chat again.
    await act(async () =>
      publishWorkBoardFeed(
        feed([chat("run", { waiting: { kind: "question", detail: "?" } })], {
          run: "needs-you",
        }),
      ),
    );
    await act(async () =>
      publishWorkBoardFeed(feed([chat("run")], { run: "working" })),
    );
    await settle();
    expect(cardIn("building", card.id)).not.toBeNull();
  });

  it("edits a card's words and deletes it after asking", async () => {
    publishWorkBoardFeed(feed([], {}));
    await render();
    const [card] = await cards([{ title: "Export" }]);
    const more = () =>
      container
        .querySelector<HTMLButtonElement>(".work-board-card-more")!
        .click();
    await act(async () => more());
    await act(async () =>
      button(container.querySelector("[data-menu]")!, "Edit").click(),
    );
    const title = container.querySelector<HTMLInputElement>(
      'input[aria-label="Title"]',
    )!;
    await type(title, "Export to CSV");
    await act(async () => title.form!.requestSubmit());
    await settle();
    expect(titlesIn("idea")).toEqual(["Export to CSV"]);
    // Escape leaves an edit unsaved.
    await act(async () => more());
    await act(async () =>
      button(container.querySelector("[data-menu]")!, "Edit").click(),
    );
    const again = container.querySelector<HTMLInputElement>(
      'input[aria-label="Title"]',
    )!;
    await type(again, "Something else");
    await press(again, "Escape");
    expect(titlesIn("idea")).toEqual(["Export to CSV"]);

    await act(async () => more());
    await act(async () =>
      button(container.querySelector("[data-menu]")!, "Delete").click(),
    );
    expect(
      container
        .querySelector("[data-confirm-dialog]")
        ?.getAttribute("data-confirm-dialog"),
    ).toBe("Delete this card?");
    await act(async () =>
      container.querySelector<HTMLButtonElement>("[data-confirm]")!.click(),
    );
    await settle();
    expect(cardIn("idea", card.id)).toBeNull();
    expect(await saved()).toEqual([]);
  });

  it("drags a card to another column, and Escape puts it back", async () => {
    const x: Record<string, number> = {
      idea: 0,
      building: 200,
      review: 400,
      shipped: 600,
    };
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
      function (this: HTMLElement) {
        const id =
          this.dataset.boardColumn ??
          this.closest<HTMLElement>("[data-board-column]")?.dataset.boardColumn;
        const left = id ? x[id] : 0;
        return {
          x: left,
          y: 0,
          left,
          top: 0,
          right: left + 180,
          bottom: 600,
          width: id ? 180 : 800,
          height: 600,
          toJSON: () => ({}),
        } as DOMRect;
      },
    );
    publishWorkBoardFeed(feed([], {}));
    await render();
    const [card] = await cards([{ title: "Search" }]);
    const pointer = (type: string, clientX: number) =>
      new PointerEvent(type, {
        bubbles: true,
        button: 0,
        pointerId: 1,
        clientX,
        clientY: 50,
      });
    const drag = async (to: number, finish: () => void) => {
      const element = cardIn("idea", card.id)!;
      await act(async () => {
        element
          .querySelector(".work-board-card-name")!
          .dispatchEvent(pointer("pointerdown", 50));
        window.dispatchEvent(pointer("pointermove", 60));
        window.dispatchEvent(pointer("pointermove", to));
      });
      expect(element.hasAttribute("data-dragging")).toBe(true);
      expect(column("review").hasAttribute("data-drop-target")).toBe(
        to === 450,
      );
      await act(async () => finish());
      await settle();
    };
    // Escape: back where it was.
    await drag(450, () =>
      window.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      ),
    );
    expect(cardIn("idea", card.id)).not.toBeNull();
    expect(column("review").hasAttribute("data-drop-target")).toBe(false);
    window.dispatchEvent(pointer("pointerup", 450));
    // Let go over Review: it moves there, and the click that ends the drag
    // does not open the card.
    const dragged = cardIn("idea", card.id)!;
    await drag(450, () => {
      window.dispatchEvent(pointer("pointerup", 450));
      dragged
        .querySelector<HTMLButtonElement>(".work-board-card-open")!
        .click();
    });
    expect(cardIn("review", card.id)).not.toBeNull();
    expect(cardIn("review", card.id)!.hasAttribute("data-dragging")).toBe(
      false,
    );
    expect(container.querySelector('input[aria-label="Title"]')).toBeNull();
    expect((await saved())[0].column).toBe("review");
    // A plain click on an idea without a chat edits it.
    const [other] = await cards([{ title: "Other" }]);
    await act(async () =>
      cardIn("idea", other.id)!
        .querySelector<HTMLButtonElement>(".work-board-card-open")!
        .click(),
    );
    expect(container.querySelector('input[aria-label="Title"]')).not.toBeNull();
  });

  it("sums up chats working outside the board, and adds them", async () => {
    publishWorkBoardFeed(
      feed([chat("a"), chat("b"), chat("c")], {
        a: "working",
        b: "working",
        c: "working",
      }),
    );
    await render();
    await cards([{ title: "Mine", chatIds: ["c"] }]);
    const line = container.querySelector<HTMLElement>("[data-board-outside]")!;
    expect(line.textContent).toBe("2 chats working outside the board·Add them");
    // The chats themselves, on request.
    await act(async () =>
      line
        .querySelector<HTMLButtonElement>(".work-board-outside-toggle")!
        .click(),
    );
    expect(
      [...line.querySelectorAll(".work-board-outside-chat")].map(
        (entry) => entry.querySelector(".work-board-card-name")?.textContent,
      ),
    ).toEqual(["Chat a", "Chat b"]);
    await act(async () => button(line, "Add them").click());
    await settle();
    expect(titlesIn("building").sort()).toEqual(["Chat a", "Chat b", "Mine"]);
    expect(container.querySelector("[data-board-outside]")).toBeNull();
  });

  it("folds shipped cards older than a week", async () => {
    publishWorkBoardFeed(feed([], {}));
    await render();
    await cards([{ title: "New", column: "shipped" }]);
    await storage.put("/work/site", PROJECT, {
      id: "old",
      title: "Old",
      column: "shipped",
      chatIds: [],
      createdAt: NOW - 20 * DAY,
      updatedAt: NOW - 20 * DAY,
      movedAt: NOW - 10 * DAY,
      shippedAt: NOW - 10 * DAY,
    });
    await render(false);
    await render(true);
    expect(titlesIn("shipped")).toEqual(["New"]);
    expect(container.textContent).toContain("Today: 1 shipped · 0 in progress");
    await act(async () => button(column("shipped"), "1 older").click());
    expect(titlesIn("shipped")).toEqual(["New", "Old"]);
    await act(async () =>
      button(column("shipped"), "Show this week only").click(),
    );
    expect(titlesIn("shipped")).toEqual(["New"]);
  });

  it("shows a race a card's chat started as that card's work, with Watch", async () => {
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
    const [card] = await cards([{ title: "Polish", chatIds: ["origin"] }]);
    const drawn = cardIn("building", card.id)!;
    expect(drawn.getAttribute("data-team")).toBe("race");
    expect(drawn.textContent).toContain("Racing · 1 of 2 done");
    expect(
      drawn.querySelector("[data-faces]")?.getAttribute("data-faces"),
    ).toBe("l1,l2");
    await act(async () => button(drawn, "Watch").click());
    expect(actions.watch).toHaveBeenCalledWith("race:r1");
    expect(container.querySelector("[data-board-outside]")).toBeNull();
  });

  it("draws nothing again for a feed that changed nothing it shows", async () => {
    const chats = [chat("run", { startedAt: NOW - 1_000, doing: "Thinking" })];
    publishWorkBoardFeed(feed(chats, { run: "working" }));
    await render();
    await cards([{ title: "Search", chatIds: ["run"] }]);
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
    await settle();
    observer.disconnect();
    expect(renders).toEqual(drawn);
    expect(mutations).toEqual([]);
  });

  it("keeps a hidden board as it was, then catches up when shown", async () => {
    publishWorkBoardFeed(feed([chat("run")], { run: "working" }));
    await render();
    const [card] = await cards([{ title: "Search", chatIds: ["run"] }]);
    await render(false);
    expect(cardIn("building", card.id)).not.toBeNull();
    const drawn = renders.board;
    await act(async () =>
      publishWorkBoardFeed(
        feed([chat("run", { waiting: { kind: "question", detail: "?" } })], {
          run: "needs-you",
        }),
      ),
    );
    expect(renders.board).toBe(drawn);
    expect(cardIn("building", card.id)?.hasAttribute("data-needs-you")).toBe(
      false,
    );
    await render(true);
    expect(cardIn("building", card.id)?.hasAttribute("data-needs-you")).toBe(
      true,
    );
  });

  it("glides a card that moved to another column from where it was", async () => {
    // Columns side by side, cards stacked: a rect from the card's column.
    const x: Record<string, number> = {
      idea: 0,
      building: 200,
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
    const [card] = await cards([{ title: "A", chatIds: ["a"] }]);
    frames.splice(0);
    expect(cardIn("building", card.id)?.hasAttribute("data-gliding")).toBe(
      false,
    );
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
    // Drawn first where it was, in the Building column…
    const moved = cardIn("review", card.id)!;
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

  it("does not move cards with Aven's Reduce motion on", async () => {
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
      function (this: HTMLElement) {
        const left = this.getAttribute("data-column") === "shipped" ? 600 : 200;
        return {
          x: left,
          y: 0,
          left,
          top: 0,
          right: left + 180,
          bottom: 60,
          width: 180,
          height: 60,
          toJSON: () => ({}),
        } as DOMRect;
      },
    );
    vi.stubGlobal("matchMedia", () => ({ matches: false }));
    vi.stubGlobal("requestAnimationFrame", () => 0);
    vi.stubGlobal("cancelAnimationFrame", () => {});
    publishWorkBoardFeed(
      feed([chat("a"), chat("b")], { a: "working", b: "working" }),
    );
    await render();
    const [a, b] = await cards([
      { title: "A", chatIds: ["a"] },
      { title: "B", chatIds: ["b"] },
    ]);
    // With motion on, a card that moves glides.
    await act(async () =>
      publishWorkBoardFeed(
        feed([chat("a"), chat("b")], { a: "shipped", b: "working" }),
      ),
    );
    expect(cardIn("shipped", a.id)?.getAttribute("data-gliding")).toBe("start");
    // With Reduce motion on in Settings, it is simply there.
    document.documentElement.setAttribute("data-motion", "reduce");
    await act(async () =>
      publishWorkBoardFeed(
        feed([chat("a"), chat("b")], { a: "shipped", b: "shipped" }),
      ),
    );
    const moved = cardIn("shipped", b.id)!;
    expect(moved.hasAttribute("data-gliding")).toBe(false);
    expect(moved.style.transform).toBe("");
  });

  it("tries a failing move by itself once, not over and over", async () => {
    publishWorkBoardFeed(feed([], {}));
    await render();
    await cards([{ title: "Search", chatIds: ["run"] }]);
    const put = vi.fn(() => Promise.reject("disk full"));
    setFeatureCardBackend({ ...storage, put });
    await render(false);
    await render(true);
    await act(async () =>
      publishWorkBoardFeed(feed([chat("run")], { run: "working" })),
    );
    await settle();
    await settle();
    expect(put).toHaveBeenCalledTimes(1);
    expect(container.querySelector('[role="alert"]')?.textContent).toBe(
      "Couldn't save the board: disk full",
    );
  });

  it("says when the board can't be saved", async () => {
    publishWorkBoardFeed(feed([], {}));
    await render();
    setFeatureCardBackend({
      ...storage,
      put: () => Promise.reject("The board is full."),
    });
    await render(false);
    await render(true);
    const input = container.querySelector<HTMLInputElement>(
      'input[aria-label="Add an idea"]',
    )!;
    await type(input, "One more");
    await act(async () => input.form!.requestSubmit());
    await settle();
    expect(container.querySelector('[role="alert"]')?.textContent).toBe(
      "Couldn't save the board: The board is full.",
    );
    expect(titlesIn("idea")).toEqual([]);
  });
});

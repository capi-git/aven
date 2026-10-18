// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  discussionStore,
  resetDiscussionStore,
  type DiscussionHost,
  type DiscussionParty,
} from "../lib/discussions";
import { PANEL_TOP_INSET } from "../lib/discussionPanel";
import { newSession, type Block, type Session } from "../lib/session";
import { TEAM_PANEL_PREFIX } from "../lib/teamWatch";
import { useTeamWatch, type TeamWatchControls } from "../hooks/useTeamWatch";

vi.mock("./AgentMarkdown", () => ({
  AgentMarkdown: ({ text }: { text: string }) =>
    createElement("div", { "data-markdown": "" }, text),
}));

import { TeamWatchFloat } from "./TeamWatchPanel";

const party = (sessionId: string, title: string, codex = false) =>
  ({
    sessionId,
    harness: codex ? "codex" : "claude",
    model: codex ? "GPT-5.4" : "Opus 5.5",
    title,
    cwd: "/work/site",
  }) satisfies DiscussionParty;
const A = party("a", "Caching plan");
const B = party("b", "Review", true);

let root: Root;
let container: HTMLDivElement;
let values: Map<string, string>;
let panel: TeamWatchControls;
let sessions: Session[];
const host: DiscussionHost = {
  options: () => ({ candidates: [] }),
  start: () => null,
};

function Workspace() {
  panel = useTeamWatch("main", {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => void values.set(key, value),
  });
  return createElement(TeamWatchFloat, {
    panel,
    sessions,
    host,
    popOuts: null,
  });
}

async function mount() {
  await act(async () => root.render(createElement(Workspace)));
}

const saved = () =>
  JSON.parse(values.get(`${TEAM_PANEL_PREFIX}main`) ?? "null") as {
    rect?: { x: number; y: number; width: number; height: number };
    mode: string;
    watching: string[];
    expanded: string | null;
    seen: Record<string, number>;
  } | null;
const float = () =>
  container.querySelector<HTMLElement>("[data-discussion-panel]");
const pills = () => [
  ...container.querySelectorAll<HTMLElement>("[data-discussion-pill]"),
];
const text = (element: Element | null | undefined) =>
  element?.textContent?.replace(/\s+/g, " ").trim();

function pointer(
  type: string,
  target: EventTarget,
  clientX: number,
  clientY: number,
) {
  target.dispatchEvent(
    new PointerEvent(type, {
      bubbles: true,
      cancelable: true,
      button: 0,
      clientX,
      clientY,
    }),
  );
}

/** Press at (x, y), move to (x + dx, y + dy) and release. */
async function drag(target: Element, dx: number, dy: number, x = 600, y = 400) {
  await act(async () => {
    pointer("pointerdown", target, x, y);
    pointer("pointermove", window, x + dx, y + dy);
    pointer("pointerup", window, x + dx, y + dy);
  });
}

/** A two-round discussion between `a` and `b`, `turns` of it done. */
function discuss(
  id: string,
  a: DiscussionParty,
  b: DiscussionParty,
  turns = 0,
) {
  const store = discussionStore();
  store.start({ id, a, b, topic: `Topic ${id}`, rounds: 2 });
  for (let turn = 0; turn < turns; turn += 1) {
    store.markDelivered(id);
    store.settle(id, turn, { status: "completed", text: `reply ${turn}` });
  }
  store.markDelivered(id);
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  values = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  });
  resetDiscussionStore("main");
  sessions = [];
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  resetDiscussionStore();
  vi.unstubAllGlobals();
});

describe("the discussion panel over the workspace", () => {
  it("opens the first time a discussion starts, in the corner, over panes and under menus", async () => {
    discuss("d1", A, B);
    await mount();
    expect(float()).toBeNull();
    await act(async () => panel.started("discuss:d1"));
    const panelElement = float()!;
    expect(panelElement.dataset.discussionPanel).toBe("d1");
    // Cut out of a native browser page beneath it, as menus are.
    expect(panelElement.dataset.nativeBrowserOccluded).toBe("true");
    expect(panelElement.style.zIndex).toBe("60");
    expect(text(panelElement.querySelector(".discussion-float-title"))).toBe(
      "Discussion · “Topic d1”",
    );
    const rect = saved()!.rect!;
    expect(rect.x + rect.width).toBeLessThanOrEqual(window.innerWidth);
    expect(rect.y).toBeGreaterThanOrEqual(PANEL_TOP_INSET);
    expect(panelElement.style.left).toBe(`${rect.x}px`);
    expect(saved()).toMatchObject({
      watching: ["discuss:d1"],
      expanded: "discuss:d1",
    });
  });

  it("is dragged by its header and kept inside the window, below the title bar", async () => {
    discuss("d1", A, B);
    await mount();
    await act(async () => panel.started("discuss:d1"));
    const before = saved()!.rect!;
    await drag(float()!.querySelector(".discussion-float-title")!, -60, -30);
    expect(saved()!.rect).toEqual({
      ...before,
      x: before.x - 60,
      y: before.y - 30,
    });
    // Far past the top-left corner: it stops at the window's edge and the
    // title bar, clear of the traffic lights.
    await drag(
      float()!.querySelector(".discussion-float-title")!,
      -5000,
      -5000,
    );
    expect(saved()!.rect).toMatchObject({ x: 8, y: PANEL_TOP_INSET });
    // Its buttons are not handles.
    const rect = saved()!.rect;
    await drag(float()!.querySelector("[data-discussion-close]")!, 100, 100);
    expect(saved()!.rect).toEqual(rect);
  });

  it("is resized from its edges and corners", async () => {
    discuss("d1", A, B);
    await mount();
    await act(async () => panel.started("discuss:d1"));
    const before = saved()!.rect!;
    await drag(float()!.querySelector("[data-edge='w']")!, -80, 0);
    expect(saved()!.rect).toMatchObject({
      x: before.x - 80,
      width: before.width + 80,
      y: before.y,
    });
    await drag(float()!.querySelector("[data-edge='s']")!, 0, -40);
    expect(saved()!.rect!.height).toBe(before.height - 40);
  });

  it("shrinks to a pill and comes back, and is remembered in this window", async () => {
    discuss("d1", A, B, 1);
    await mount();
    await act(async () => panel.started("discuss:d1"));
    await act(async () =>
      float()!.querySelector<HTMLElement>("[data-discussion-shrink]")!.click(),
    );
    expect(float()).toBeNull();
    const [pill] = pills();
    expect(pill.dataset.discussionPill).toBe("d1");
    expect(pill.dataset.nativeBrowserOccluded).toBe("true");
    expect(text(pill)).toContain("Round 1 of 2");
    expect(text(pill.querySelector(".discussion-pill-status"))).toBe(
      "Codex is replying…",
    );
    expect(pill.querySelectorAll("[data-discussion-avatar]")).toHaveLength(2);
    expect(saved()).toMatchObject({ mode: "pill", expanded: null });

    // Reopened later in this window: still a pill, where it was.
    await act(async () => root.unmount());
    root = createRoot(container);
    await mount();
    expect(float()).toBeNull();
    expect(pills()).toHaveLength(1);
    // Dragged: the pill moves, and the click that ends the drag is not a
    // press.
    const before = saved()!.rect!;
    await drag(pills()[0], -100, -50);
    await act(async () => pills()[0].click());
    expect(float()).toBeNull();
    expect(saved()!.rect).toMatchObject({
      x: before.x - 100,
      y: before.y - 50,
    });
    // Pressed: the panel comes back.
    await act(async () => pills()[0].click());
    expect(float()?.dataset.discussionPanel).toBe("d1");
    expect(saved()).toMatchObject({ mode: "open", expanded: "discuss:d1" });
  });

  it("shows one discussion at a time, the others as stacked pills", async () => {
    const C = party("c", "Docs");
    const D = party("d", "Docs review", true);
    discuss("d1", A, B, 1);
    discuss("d2", C, D);
    await mount();
    await act(async () => panel.started("discuss:d1"));
    await act(async () => panel.started("discuss:d2"));
    expect(float()?.dataset.discussionPanel).toBe("d2");
    expect(pills().map((pill) => pill.dataset.discussionPill)).toEqual(["d1"]);
    // One needs you: its pill says so, in amber.
    await act(async () =>
      discussionStore().pause("d1", "“Review” needs your approval.", "b"),
    );
    expect(pills()[0].dataset.state).toBe("needs-you");
    expect(text(pills()[0])).toContain("Needs you");
    // Shrinking the panel stacks both.
    await act(async () => panel.shrink());
    expect(pills().map((pill) => pill.dataset.discussionPill)).toEqual([
      "d2",
      "d1",
    ]);
    // Closing one leaves the other; the discussion itself goes on.
    await act(async () => panel.close("discuss:d2"));
    expect(pills().map((pill) => pill.dataset.discussionPill)).toEqual(["d1"]);
    expect(discussionStore().get("d2")?.status).toBe("active");
  });

  it("shows Finished once a discussion ends, and stays until closed", async () => {
    discuss("d1", A, B, 3);
    await mount();
    await act(async () => panel.open("discuss:d1"));
    await act(async () =>
      discussionStore().settle("d1", 3, { status: "completed", text: "Fine." }),
    );
    expect(
      text(float()!.querySelector("[data-discussion-cast] [role='status']")),
    ).toBe("Finished · 2 rounds");
    await act(async () => panel.shrink());
    expect(pills()[0].dataset.state).toBe("done");
    expect(text(pills()[0])).toContain("Finished");
  });

  it("drops a discussion that no longer exists", async () => {
    discuss("d1", A, B);
    await mount();
    await act(async () => panel.started("discuss:d1"));
    await act(async () => discussionStore().forgetChat("a"));
    expect(float()).toBeNull();
    expect(saved()?.watching).toEqual([]);
  });
});

describe("a long thread in the panel", () => {
  /** Relays into the starting chat, as the broker sends them. */
  function chatA(id: string, turns: number): Session {
    const blocks: Block[] = [];
    for (let turn = 0; turn < turns; turn += 2) {
      blocks.push({
        id: `relay-${turn}`,
        role: "user",
        text: turn === 0 ? `Topic ${id}` : `reply ${turn - 1}`,
        startedAt: turn,
        discussion: {
          id,
          turn,
          rounds: 4,
          partner: { harness: "codex", model: "GPT-5.4", title: "Review" },
        },
      });
      blocks.push({
        id: `a-${turn}`,
        role: "assistant",
        text: `reply ${turn}`,
      });
    }
    return { ...newSession("claude", "/work/site"), id: "a", blocks };
  }

  function discussFour(turns: number) {
    const store = discussionStore();
    store.start({ id: "d1", a: A, b: B, topic: "Topic d1", rounds: 4 });
    for (let turn = 0; turn < turns; turn += 1) {
      store.markDelivered("d1");
      store.settle("d1", turn, { status: "completed", text: `reply ${turn}` });
    }
    store.markDelivered("d1");
  }

  const messages = () =>
    [
      ...container.querySelectorAll<HTMLElement>("[data-discussion-message]"),
    ].map((message) => message.dataset.discussionMessage);

  it("reads the other chat's replies from the chat that started it when it is not loaded", async () => {
    discussFour(4);
    sessions = [chatA("d1", 6)];
    await mount();
    await act(async () => panel.open("discuss:d1"));
    await act(async () =>
      container
        .querySelector<HTMLElement>("[data-discussion-fold] button")!
        .click(),
    );
    expect(
      [
        ...container.querySelectorAll(
          "[data-discussion-message][data-side='b']",
        ),
      ].map((message) => text(message.querySelector("[data-markdown]"))),
    ).toEqual(["reply 1", "reply 3"]);
  });

  it("folds older rounds, jumps by round from its rail, and marks what is new", async () => {
    discussFour(5);
    sessions = [chatA("d1", 6)];
    // Seen up to reply 3 when the user last looked.
    values.set(
      "aven.teamPanel.main",
      JSON.stringify({
        mode: "open",
        watching: ["discuss:d1"],
        expanded: null,
        seen: { "discuss:d1": 3 },
        rect: { x: 300, y: 100, width: 430, height: 590 },
      }),
    );
    await mount();
    await act(async () => panel.open("discuss:d1"));
    // Round 1 folds; round 2 holds the first new reply, so it stays.
    expect(text(container.querySelector("[data-discussion-fold]"))).toBe(
      "Show round 1",
    );
    expect(messages()).toEqual(["2", "3", "4"]);
    const mark = container.querySelector("[data-discussion-new]");
    expect(text(mark)).toBe("2 new since you looked");
    expect(
      mark!.compareDocumentPosition(
        container.querySelector("[data-discussion-message='3']")!,
      ) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    // Now seen.
    expect(saved()?.seen["discuss:d1"]).toBe(5);
    // The rail lists every round; pressing a folded one unfolds it.
    const rail = [
      ...container.querySelectorAll<HTMLElement>(
        "[data-discussion-rail-round]",
      ),
    ];
    expect(rail.map((button) => button.dataset.discussionRailRound)).toEqual([
      "1",
      "2",
      "3",
    ]);
    await act(async () => rail[0].click());
    expect(container.querySelector("[data-discussion-fold]")).toBeNull();
    expect(messages()).toEqual(["0", "1", "2", "3", "4"]);
  });

  it("folds all but the last two rounds when nothing is new", async () => {
    discussFour(7);
    sessions = [chatA("d1", 8)];
    await mount();
    await act(async () => panel.open("discuss:d1"));
    expect(text(container.querySelector("[data-discussion-fold]"))).toBe(
      "Show rounds 1–2",
    );
    // Only the visible rounds are drawn.
    expect(messages()).toEqual(["4", "5", "6"]);
    expect(container.querySelector("[data-discussion-new]")).toBeNull();
    await act(async () =>
      container
        .querySelector<HTMLElement>("[data-discussion-fold] button")!
        .click(),
    );
    expect(messages()).toHaveLength(7);
  });
});

// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./AgentMarkdown", () => ({
  AgentMarkdown: ({ text }: { text: string }) => text,
}));
vi.mock("@tauri-apps/api/core", () => ({
  isTauri: () => false,
  invoke: vi.fn(async () => null),
}));

import type { Discussion } from "../lib/discussions";
import type { TeamMember, TeamRun } from "../lib/teamRuns";
import type { TeamWatchAction, TeamWatchView } from "../lib/teamWatch";
import type {
  TeamWatchWindow as Bridge,
  TeamWatchWindowState,
} from "../lib/teamWatchBridge";
import { TeamWatchWindow } from "./TeamWatchWindow";

const member = (sessionId: string, patch: Partial<TeamMember>): TeamMember => ({
  sessionId,
  harness: "claude",
  model: "Opus",
  label: "Claude Code · Opus",
  role: "lane",
  state: "working",
  stateLabel: "Working",
  ...patch,
});

const race: TeamRun = {
  id: "race:r1",
  kind: "race",
  key: "r1",
  origin: { sessionId: "chat" },
  project: "/work/site",
  title: "Fix the login loop",
  status: "running",
  progress: "1 of 2 done",
  members: [
    member("l0", { state: "done", stateLabel: "Done", reply: "Fixed it." }),
    member("l1", {
      harness: "codex",
      label: "Codex · GPT-5",
      doing: "Edit redirect.ts",
    }),
  ],
  startedAt: 0,
  updatedAt: 0,
};

const can = {
  jumpIn: false,
  build: false,
  openChat: true,
  openAgents: false,
  compare: true,
};

function state(
  view: TeamWatchView | null,
  patch: Partial<TeamWatchWindowState> = {},
): TeamWatchWindowState {
  return {
    team: "race:r1",
    snapshot: {
      view,
      theme: { mode: "light", accent: "#157d82", background: "#edf5f7" },
    },
    revision: 1,
    ownerClosed: false,
    ...patch,
  };
}

/** The host as the page sees it: its state, and what it sent. */
function fakeBridge(initial: TeamWatchWindowState) {
  let push: ((next: TeamWatchWindowState) => void) | undefined;
  const sent: TeamWatchAction[] = [];
  let refuse: string | null = null;
  const bridge: Bridge = {
    state: vi.fn(async () => initial),
    ready: vi.fn(async () => {}),
    onState: vi.fn(async (callback) => {
      push = callback;
      return () => {
        push = undefined;
      };
    }),
    send: vi.fn(async (action: TeamWatchAction) => {
      sent.push(action);
      return refuse;
    }),
    dismiss: vi.fn(async () => {}),
    dispose: vi.fn(),
  };
  return {
    bridge,
    sent,
    push: (next: TeamWatchWindowState) => push?.(next),
    refuseWith: (text: string | null) => {
      refuse = text;
    },
  };
}

let root: Root;
let container: HTMLDivElement;

async function show(bridge: Bridge) {
  await act(async () =>
    root.render(createElement(TeamWatchWindow, { bridge })),
  );
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 40));
  });
}

const words = (element: Element | null | undefined) =>
  element?.textContent?.replace(/\s+/g, " ").trim();
const press = async (selector: string) => {
  const button = container.querySelector<HTMLElement>(selector);
  expect(button, selector).toBeTruthy();
  await act(async () => button!.click());
  await act(async () => {
    await Promise.resolve();
  });
};

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  document.documentElement.className = "";
  vi.unstubAllGlobals();
});

describe("a team's panel in a window of its own", () => {
  it("draws what its owner sent, in its colours, and shows itself once drawn", async () => {
    const host = fakeBridge(state({ team: race, race: {}, can }));
    await show(host.bridge);
    const root = container.querySelector<HTMLElement>(
      "[data-team-watch-window]",
    );
    expect(root?.dataset.teamWatchWindow).toBe("race:r1");
    expect(document.documentElement.classList).toContain("team-watch-window");
    expect(document.documentElement.classList).toContain("theme-light");
    expect(
      document.documentElement.style.getPropertyValue("--team-watch-window-bg"),
    ).toBe("#edf5f7");
    expect(container.querySelectorAll("[data-team-lane]")).toHaveLength(2);
    expect(words(container.querySelector(".team-watch-reply"))).toBe(
      "Fixed it.",
    );
    expect(host.bridge.ready).toHaveBeenCalledWith(1);
    // Its header is the window's title bar, with no shrink.
    const bar = container.querySelector("[data-discussion-drag]");
    expect(bar?.hasAttribute("data-tauri-drag-region")).toBe(true);
    expect(container.querySelector("[data-team-shrink]")).toBeNull();
    expect(container.querySelector("[data-team-pop-out]")).toBeNull();
  });

  it("sends each press to its owner and shows a refusal", async () => {
    const host = fakeBridge(state({ team: race, race: {}, can }));
    await show(host.bridge);
    await press("[data-team-compare]");
    expect(host.sent).toEqual([{ kind: "compare" }]);
    host.refuseWith("This window can't compare the agents.");
    await press('[data-team-stop="race"]');
    expect(host.sent.at(-1)).toEqual({ kind: "stop" });
    expect(words(container.querySelector(".team-watch-problem"))).toBe(
      "This window can't compare the agents.",
    );
    await press("[data-team-pop-in]");
    expect(host.sent.at(-1)).toEqual({ kind: "watch" });
    await press("[data-team-close]");
    expect(host.bridge.dismiss).toHaveBeenCalled();
  });

  it("follows its owner's updates, and keeps the newest", async () => {
    const host = fakeBridge(state({ team: race, race: {}, can }));
    await show(host.bridge);
    const ready: TeamRun = {
      ...race,
      status: "ready",
      progress: "Ready to compare · 2 of 2 done",
    };
    await act(async () =>
      host.push(state({ team: ready, race: {}, can }, { revision: 3 })),
    );
    expect(words(container.querySelector(".team-watch-status"))).toBe(
      "Ready to compare · 2 of 2 done",
    );
    await act(async () =>
      host.push(state({ team: race, race: {}, can }, { revision: 2 })),
    );
    expect(words(container.querySelector(".team-watch-status"))).toBe(
      "Ready to compare · 2 of 2 done",
    );
  });

  it("says so once its owning window closed, and only closes", async () => {
    const host = fakeBridge(state({ team: race, race: {}, can }));
    await show(host.bridge);
    await act(async () =>
      host.push(
        state(
          { team: race, race: {}, can },
          { revision: 2, ownerClosed: true },
        ),
      ),
    );
    expect(words(container.querySelector(".team-watch-closed p"))).toBe(
      "This team's window was closed.",
    );
    expect(container.querySelector("[data-team-lane]")).toBeNull();
    expect(container.querySelector("[data-team-pop-in]")).toBeNull();
    await press("[data-team-watch-close]");
    expect(host.bridge.dismiss).toHaveBeenCalled();
  });

  it("says so when the team is gone", async () => {
    const host = fakeBridge(state(null));
    await show(host.bridge);
    expect(words(container.querySelector(".team-watch-closed p"))).toBe(
      "This team is no longer available.",
    );
  });

  it("shows a discussion's thread, and passes on what the user adds", async () => {
    const discussion: Discussion = {
      id: "d1",
      owner: "main",
      a: {
        sessionId: "a",
        harness: "claude",
        model: "Opus",
        title: "Caching",
        cwd: "/w",
      },
      b: {
        sessionId: "b",
        harness: "codex",
        model: "GPT-5",
        title: "Review",
        cwd: "/w",
      },
      topic: "Cache the lookups?",
      rounds: 2,
      settled: 1,
      relay: "",
      delivered: true,
      status: "active",
      startedAt: 0,
      updatedAt: 0,
    };
    const team: TeamRun = {
      ...race,
      id: "discuss:d1",
      kind: "discuss",
      key: "d1",
      progress: "Round 1 of 2",
    };
    const host = fakeBridge(
      state({
        team,
        discussion: {
          record: discussion,
          cwd: { a: "/w", b: "/w" },
          items: [
            { kind: "topic", key: "topic", text: "Cache the lookups?" },
            { kind: "round", key: "round-1", round: 1, rounds: 2 },
            {
              kind: "reply",
              key: "turn-0",
              side: "a",
              turn: 0,
              text: "Yes, by URL.",
              stance: null,
            },
          ],
        },
        can: { ...can, jumpIn: true },
      }),
    );
    await show(host.bridge);
    expect(
      container.querySelector('[data-discussion-view="d1"]'),
    ).not.toBeNull();
    expect(container.textContent).toContain("Yes, by URL.");
    const field = container.querySelector<HTMLTextAreaElement>(
      "[data-discussion-jump] textarea",
    )!;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype,
        "value",
      )!.set!;
      setter.call(field, "Mind the TTL.");
      field.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await press(".discussion-jump-send");
    expect(host.sent).toEqual([{ kind: "jump-in", text: "Mind the TTL." }]);
    expect(field.value).toBe("");
  });
});

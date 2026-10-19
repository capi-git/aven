// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  GETTING_STARTED_KEY,
  completeGettingStarted,
  gettingStartedCard,
  gettingStartedProgress,
  hasFirstMessage,
  hasOpenedPage,
  hasShipped,
  hideGettingStarted,
  loadGettingStarted,
  offerGettingStarted,
  parseGettingStarted,
  recordGettingStarted,
  saveGettingStarted,
  shouldShowGettingStarted,
  subscribeGettingStarted,
  type GettingStartedSignals,
} from "./gettingStarted";

let values: Map<string, string>;

beforeEach(() => {
  values = new Map();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, String(value)),
    removeItem: (key: string) => values.delete(key),
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const none: GettingStartedSignals = {
  agent: false,
  project: false,
  message: false,
  preview: false,
  ship: false,
};

describe("Getting started progress", () => {
  it("puts Start on the first step not done, in order", () => {
    expect(gettingStartedProgress(none, []).next).toBe("agent");
    const two = gettingStartedProgress(
      { ...none, agent: true, project: true },
      [],
    );
    expect(two).toMatchObject({
      doneCount: 2,
      next: "message",
      allDone: false,
    });
    // A later step done out of order still leaves the earlier one next.
    expect(
      gettingStartedProgress({ ...none, agent: true, preview: true }, []).next,
    ).toBe("project");
  });

  it("keeps a step ticked after its signal goes", () => {
    const state = {
      offered: true,
      hidden: false,
      completed: false,
      ticked: [],
    };
    const previewed = recordGettingStarted(state, { ...none, preview: true });
    expect(previewed.ticked).toEqual(["preview"]);
    // The preview tab was closed again.
    expect(recordGettingStarted(previewed, none)).toBe(previewed);
    expect(gettingStartedProgress(none, previewed.ticked).steps[3]).toEqual({
      id: "preview",
      done: true,
    });
  });

  it("is all done only with all five", () => {
    const all = { agent: true, project: true, message: true, preview: true };
    expect(gettingStartedProgress({ ...all, ship: false }, []).allDone).toBe(
      false,
    );
    expect(gettingStartedProgress({ ...all, ship: true }, [])).toMatchObject({
      allDone: true,
      next: null,
      doneCount: 5,
    });
  });

  it("names each step for Home with its line", () => {
    const card = gettingStartedCard(
      gettingStartedProgress({ ...none, agent: true }, []),
      {
        agent: "Claude Code is ready",
        project: "sample-site",
        message: "Try “Make the heading bigger”",
        preview: "Ask the agent to open a preview beside the chat",
        ship: "Review the change and commit it",
      },
    );
    expect(card.steps.map((step) => step.title)).toEqual([
      "Connect an agent",
      "Add a project",
      "Send your first message",
      "Preview it",
      "Ship it",
    ]);
    expect(card.steps[0]).toMatchObject({
      done: true,
      detail: "Claude Code is ready",
    });
    expect(card.next).toBe("project");
  });
});

describe("Getting started signals", () => {
  const isProject = (cwd: string) => cwd !== "~" && !cwd.includes("scratch");

  it("counts a message you typed in a project's chat", () => {
    const typed = {
      cwd: "/work/site",
      blocks: [{ role: "user" }, { role: "assistant" }],
    };
    expect(hasFirstMessage([typed], [], isProject)).toBe(true);
  });

  it("does not count chats with no project, Aven's own turns, relays, workers or Inbox questions", () => {
    const user = [{ role: "user" }];
    expect(
      hasFirstMessage(
        [
          { cwd: "~", blocks: user },
          { cwd: "/scratch/a", blocks: user },
          { cwd: "/work/site", blocks: [] },
          { cwd: "/work/site", blocks: [{ role: "assistant" }] },
          { cwd: "/work/site", blocks: [{ role: "user", internal: true }] },
          { cwd: "/work/site", blocks: [{ role: "user", discussion: {} }] },
          { cwd: "/work/site", orchestrationLeadId: "lead", blocks: user },
          { cwd: "/work/site", inboxAsk: {}, blocks: user },
        ],
        [{ cwd: "/scratch/b" }],
        isProject,
      ),
    ).toBe(false);
  });

  it("counts a saved chat in a project, since only chats with your message are saved", () => {
    expect(hasFirstMessage([], [{ cwd: "/work/site" }], isProject)).toBe(true);
  });

  it("counts a real page in the browser, not an empty tab", () => {
    expect(hasOpenedPage({})).toBe(false);
    expect(
      hasOpenedPage({
        "/work/site": { tabs: [{ url: "" }, { url: "about:blank" }] },
      }),
    ).toBe(false);
    expect(
      hasOpenedPage({
        "/work/site": { tabs: [{ url: "" }] },
        "/work/other": { tabs: [{ url: "http://127.0.0.1:5173/" }] },
      }),
    ).toBe(true);
  });

  it("counts any ship recorded by Ship it", () => {
    expect(hasShipped({})).toBe(false);
    expect(hasShipped({ chat: { at: 1, shippedAt: 1 } })).toBe(true);
  });
});

describe("Getting started storage", () => {
  it("is offered only once the walkthrough began on this install", () => {
    expect(shouldShowGettingStarted(loadGettingStarted())).toBe(false);
    offerGettingStarted();
    expect(shouldShowGettingStarted(loadGettingStarted())).toBe(true);
    // Offering again keeps what was ticked.
    saveGettingStarted({ ...loadGettingStarted(), ticked: ["agent"] });
    offerGettingStarted();
    expect(loadGettingStarted().ticked).toEqual(["agent"]);
  });

  it("is gone for good once hidden", () => {
    offerGettingStarted();
    const listener = vi.fn();
    const stop = subscribeGettingStarted(listener);
    try {
      hideGettingStarted();
      expect(listener).toHaveBeenCalled();
    } finally {
      stop();
    }
    expect(loadGettingStarted()).toMatchObject({
      offered: true,
      hidden: true,
    });
    expect(shouldShowGettingStarted(loadGettingStarted())).toBe(false);
  });

  it("is gone for good once completed", () => {
    offerGettingStarted();
    completeGettingStarted();
    expect(shouldShowGettingStarted(loadGettingStarted())).toBe(false);
  });

  it("reads damaged saved values as never offered", () => {
    for (const raw of ["{", "[]", JSON.stringify({ offered: "yes" })]) {
      values.set(GETTING_STARTED_KEY, raw);
      expect(loadGettingStarted(), raw).toEqual({
        offered: false,
        hidden: false,
        completed: false,
        ticked: [],
      });
    }
    expect(
      parseGettingStarted(
        JSON.stringify({ offered: true, ticked: ["ship", "nope", "agent"] }),
      ).ticked,
    ).toEqual(["agent", "ship"]);
  });

  it("works without storage", () => {
    vi.stubGlobal("localStorage", {
      getItem: () => {
        throw new Error("private mode");
      },
      setItem: () => {
        throw new Error("quota");
      },
    });
    expect(loadGettingStarted().offered).toBe(false);
    expect(() => offerGettingStarted()).not.toThrow();
    expect(() => hideGettingStarted()).not.toThrow();
  });
});

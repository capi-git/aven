// @vitest-environment happy-dom
import { act, createElement, Profiler } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  discussionStore,
  resetDiscussionStore,
  type DiscussionHost,
  type DiscussionParty,
} from "../lib/discussions";
import type { DiscussionWrapUpMeta } from "../lib/session";
import {
  DiscussionActions,
  DiscussionWrapUpNote,
} from "./DiscussionWrapUpNote";

const A: DiscussionParty = {
  sessionId: "a",
  harness: "claude",
  model: "Claude Sonnet 5",
  title: "Caching plan",
  cwd: "/work/site",
};
const B: DiscussionParty = {
  sessionId: "b",
  harness: "codex",
  model: "GPT-5",
  title: "Review",
  cwd: "/work/site",
};

let root: Root;
let container: HTMLDivElement;
let renders: number;

function host() {
  return {
    options: () => ({ candidates: [] }),
    start: () => null,
    open: vi.fn<(id: string) => void>(),
    build: vi.fn<(id: string, side: "a" | "b") => string | null>(() => null),
  } satisfies DiscussionHost;
}

/** A one-round discussion that used up its rounds: ended after 2 turns. */
function complete(id = "d1") {
  const store = discussionStore();
  store.start({ id, a: A, b: B, topic: "Cache the lookups?", rounds: 1 });
  store.markDelivered(id);
  store.settle(id, 0, { status: "completed", text: "Cache by URL." });
  store.markDelivered(id);
  store.settle(id, 1, { status: "completed", text: "Agreed, with a TTL." });
}

function summed(agreed: string[], open: string[]) {
  const store = discussionStore();
  store.claimSummary("d1");
  store.finishSummary("d1", 2, {
    status: "done",
    agreed,
    open,
    model: "Claude Haiku 4.5",
  });
}

async function render(
  meta: DiscussionWrapUpMeta = { id: "d1", settled: 2 },
  actions?: DiscussionHost,
) {
  await act(async () =>
    root.render(
      createElement(
        DiscussionActions,
        { host: actions },
        createElement(
          Profiler,
          { id: "note", onRender: () => (renders += 1) },
          createElement(DiscussionWrapUpNote, { meta }),
        ),
      ),
    ),
  );
}

const card = () =>
  container.querySelector<HTMLElement>("[data-discussion-wrapup]");
const text = (selector: string) =>
  container.querySelector(selector)?.textContent?.replace(/\s+/g, " ").trim();
const items = (kind: string) =>
  [...container.querySelectorAll(`[data-discussion-list="${kind}"] li`)].map(
    (item) => item.textContent,
  );

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const values = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  });
  resetDiscussionStore("main");
  renders = 0;
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

describe("where a discussion landed, in the chat that started it", () => {
  it("says it is summing up, then shows both lists, with the buttons and a link to the page", async () => {
    complete();
    const actions = host();
    await render(undefined, actions);
    expect(card()?.dataset.discussionWrapup).toBe("summing");
    expect(card()?.classList).toContain("discussion-wrapup-compact");
    expect(text(".discussion-wrapup-title")).toBe("Where they landed");
    expect(text(".discussion-wrapup-wait")).toBe("Summing up…");
    expect(
      [...container.querySelectorAll("[data-discussion-build]")].map(
        (button) => button.textContent,
      ),
    ).toEqual(["Have Claude Sonnet 5 build it", "Have Codex GPT-5 build it"]);

    await act(async () => summed(["Cache by URL", "Add a TTL"], []));
    expect(card()?.dataset.discussionWrapup).toBe("done");
    expect(items("agreed")).toEqual(["Cache by URL", "Add a TTL"]);
    expect(text("[data-discussion-list='open'] .discussion-wrapup-empty")).toBe(
      "Nothing left open.",
    );
    expect(text(".discussion-wrapup-model")).toBe(
      "Summed up by Claude Haiku 4.5",
    );

    const link = container.querySelector<HTMLElement>(
      "[data-discussion-wrapup-open]",
    )!;
    expect(link.textContent).toBe("Open discussion");
    await act(async () => link.click());
    expect(actions.open).toHaveBeenCalledExactlyOnceWith("d1");
  });

  it("builds as the page's buttons do", async () => {
    complete();
    const actions = host();
    await render(undefined, actions);
    const buttons = [
      ...container.querySelectorAll<HTMLElement>("[data-discussion-build]"),
    ];
    await act(async () => buttons[1].click());
    expect(actions.build).toHaveBeenCalledExactlyOnceWith("d1", "b");
    expect(buttons[1].dataset.sent).toBe("true");
    actions.build.mockReturnValueOnce(
      "“Caching plan” isn't open in this window.",
    );
    await act(async () => buttons[0].click());
    expect(text(".discussion-wrapup-problem")).toBe(
      "“Caching plan” isn't open in this window.",
    );
  });

  it("keeps the buttons without lists when the summary failed", async () => {
    complete();
    await render(undefined, host());
    await act(async () => {
      discussionStore().claimSummary("d1");
      discussionStore().finishSummary("d1", 2, { status: "failed" });
    });
    expect(card()?.dataset.discussionWrapup).toBe("plain");
    expect(container.querySelector("[data-discussion-list]")).toBeNull();
    expect(container.querySelectorAll("[data-discussion-build]")).toHaveLength(
      2,
    );
  });

  it("shows nothing for a stopped discussion", async () => {
    const store = discussionStore();
    store.start({ id: "d1", a: A, b: B, topic: "Topic", rounds: 2 });
    store.stop("d1");
    await render({ id: "d1", settled: 0 }, host());
    expect(container.innerHTML).toBe("");
  });

  it("shows the lists it kept as plain text once the discussion is gone, or nothing", async () => {
    await render(
      { id: "d1", settled: 2, agreed: ["Cache by URL"], open: ["Errors"] },
      host(),
    );
    expect(card()?.dataset.discussionWrapup).toBe("saved");
    expect(text(".discussion-wrapup-title")).toBe("Where they landed");
    expect(items("agreed")).toEqual(["Cache by URL"]);
    expect(items("open")).toEqual(["Errors"]);
    // Nothing to build or open without the discussion.
    expect(container.querySelector("button")).toBeNull();

    await render({ id: "d1", settled: 2 }, host());
    expect(container.innerHTML).toBe("");
  });

  it("goes back to the kept lists once the discussion continues past that ending", async () => {
    complete();
    await act(async () => summed(["Cache by URL"], []));
    const meta = {
      id: "d1",
      settled: 2,
      agreed: ["Cache by URL"],
      open: [],
    };
    await render(meta, host());
    expect(card()?.dataset.discussionWrapup).toBe("done");
    await act(async () => {
      discussionStore().interject("d1", "And eviction?");
    });
    expect(card()?.dataset.discussionWrapup).toBe("saved");
    expect(container.querySelector("button")).toBeNull();
  });

  it("has no buttons or link where the window can't act on discussions", async () => {
    complete();
    await render();
    expect(card()?.dataset.discussionWrapup).toBe("summing");
    expect(container.querySelector("button")).toBeNull();
  });

  it("re-renders only when its own discussion's wrap-up changes", async () => {
    complete();
    await render(undefined, host());
    expect(renders).toBe(1);
    const store = discussionStore();
    await act(async () => {
      // Another discussion starts, and this one's closing notes go out.
      store.start({
        id: "d2",
        a: { ...A, sessionId: "x" },
        b: { ...B, sessionId: "y" },
        topic: "Other",
        rounds: 2,
      });
      store.notePosted("d1", "a");
      store.notePosted("d1", "b");
    });
    expect(renders).toBe(1);
    await act(async () => store.claimSummary("d1"));
    expect(renders).toBe(2);
    await act(async () => store.stop("d2"));
    expect(renders).toBe(2);
    await act(async () =>
      store.finishSummary("d1", 2, {
        status: "done",
        agreed: ["Cache by URL"],
        open: [],
        model: "Claude Haiku 4.5",
      }),
    );
    expect(renders).toBe(3);
    expect(card()?.dataset.discussionWrapup).toBe("done");
  });
});

// @vitest-environment happy-dom
import { act, createElement, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  newDiscussionTab,
  newEditorPane,
  type EditorPane,
  type LayoutNode,
} from "../lib/layout";
import { newSession, type Session } from "../lib/session";
import { paneDropFromPoint } from "../lib/paneDrop";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(async () => []),
  isTauri: () => false,
  convertFileSrc: (path: string) => path,
}));
vi.mock("@tauri-apps/api/event", () => ({ listen: async () => () => {} }));
vi.mock("../lib/paneDrop", () => ({
  paneDropFromPoint: vi.fn(),
  useExternalPaneDrop: () => null,
}));
vi.mock("../lib/composerDrafts", () => ({
  readComposerDraft: () => undefined,
  updateComposerDraft: () => {},
  retainComposerDraft: () => () => {},
}));
// The panes' bodies are not under test: only what frames them.
vi.mock("../chrome/Composer", () => ({ Composer: () => null }));
vi.mock("../chrome/SessionReview", () => ({ SessionReview: () => null }));
vi.mock("../chrome/PromptOutline", () => ({ PromptOutline: () => null }));
vi.mock("../chrome/DevPreviewChip", () => ({ DevPreviewChip: () => null }));
vi.mock("../chrome/MemoryKeeper", () => ({ MemoryKeeperOffer: () => null }));
vi.mock("../chrome/DuplicateServerChip", () => ({
  DuplicateServerChip: () => null,
}));
vi.mock("./SessionRunStatus", () => ({ SessionRunStatus: () => null }));
vi.mock("./EmptySession", () => ({ EmptySession: () => null }));
vi.mock("./AgentTranscript", () => ({
  AgentTranscript: () => createElement("p", { "data-transcript": "" }),
}));
vi.mock("./DiscussionView", () => ({ DiscussionView: () => null }));

import { PaneTree } from "./PaneTree";

const chat = (id: string, title: string): Session => ({
  ...newSession("claude", "/repo"),
  id,
  title,
  blocks: [{ id: `${id}-hello`, role: "user", text: "Hello" }],
});
const split = (a: string, b: string): LayoutNode => ({
  type: "split",
  id: "split",
  dir: "right",
  sizes: [0.5, 0.5],
  children: [
    { type: "leaf", id: a },
    { type: "leaf", id: b },
  ],
});

let root: Root;
let container: HTMLDivElement;
let props: ComponentProps<typeof PaneTree>;
let page: EditorPane;

async function render(patch: Partial<ComponentProps<typeof PaneTree>> = {}) {
  props = { ...props, ...patch };
  await act(async () => root.render(createElement(PaneTree, props)));
}
const pane = (id: string) =>
  container.querySelector<HTMLElement>(`[data-pane-id="${id}"]`)!;
const strips = (id: string) => [...pane(id).querySelectorAll(".aven-tab-bar")];
const strip = (id: string) =>
  pane(id).querySelector<HTMLElement>("[data-pane-strip]")!;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("localStorage", {
    getItem: () => null,
    setItem: () => {},
    removeItem: () => {},
  });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  page = newEditorPane(
    newDiscussionTab({
      id: "d1",
      topic: "Cache it?",
      a: { sessionId: "a", cwd: "/repo" },
      b: { sessionId: "b" },
    }),
  );
  props = {
    visible: true,
    layout: { type: "leaf", id: "a" },
    sessions: [chat("a", "Alpha"), chat("b", "Beta")],
    editorPanes: [page],
    dirtyFileIds: new Set(),
    fileErrorCounts: new Map(),
    focusedId: "a",
    composerFocused: false,
    recents: [],
    onFocus: vi.fn(),
    onClose: vi.fn(),
    onMovePane: vi.fn(),
    onRatio: vi.fn(),
  } as unknown as ComponentProps<typeof PaneTree>;
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("pane name strips", () => {
  it("leaves a tab with a single pane without a strip", async () => {
    await render();
    expect(container.querySelector("[data-session-drop='a']")).not.toBeNull();
    expect(container.querySelector("[data-pane-strip]")).toBeNull();
    expect(container.querySelector(".aven-tab-bar")).toBeNull();
    expect(container.querySelector("[data-session-pane-controls]")).toBeNull();
  });

  it("gives each pane of a split exactly one strip, above its content", async () => {
    await render({ layout: split("a", page.id) });
    // The chat's strip is its own; the page keeps its tab row and gets no other.
    expect(strips("a")).toHaveLength(1);
    expect(strips(page.id)).toHaveLength(1);
    expect(pane(page.id).querySelector("[data-pane-strip]")).toBeNull();
    expect(pane(page.id).textContent).toContain("Cache it?");
    // Laid out in the pane's column, before the transcript, not over it.
    const chatStrip = strip("a");
    expect(chatStrip.parentElement?.dataset.sessionDrop).toBe("a");
    expect(chatStrip.className).not.toMatch(/\babsolute\b/);
    expect(
      chatStrip.nextElementSibling?.querySelector("[data-transcript]"),
    ).not.toBeNull();
    expect(container.querySelector("[data-session-pane-controls]")).toBeNull();
    expect(container.querySelector(".session-pane-controls")).toBeNull();
  });

  it("names each chat and marks only the focused pane active, in the shared tab style", async () => {
    await render({ layout: split("a", "b"), focusedId: "b" });
    expect(strips("a")).toHaveLength(1);
    expect(strips("b")).toHaveLength(1);
    const name = (id: string) =>
      strip(id).querySelector("[data-pane-strip-label]")?.textContent;
    expect(name("a")).toBe("Alpha");
    expect(name("b")).toBe("Beta");
    expect(strip("a").getAttribute("aria-label")).toBe("Alpha");
    const tab = (id: string) =>
      strip(id).querySelector<HTMLElement>(".aven-tab")!;
    expect(tab("a").dataset.active).toBe("false");
    expect(tab("b").dataset.active).toBe("true");
    expect(tab("b").classList).toContain("aven-tab-slot");
    expect(
      tab("b").querySelector(".aven-tab-button .aven-tab-label"),
    ).not.toBeNull();
    expect(tab("b").querySelector("button.aven-tab-close")).not.toBeNull();
    // The provider mark sits in the tab, like the chat's own tab.
    expect(
      tab("b").querySelector(
        ".personal-title-tab-identity [data-provider='claude']",
      ),
    ).not.toBeNull();
    // A name that fits has no tooltip.
    expect(
      strip("b")
        .querySelector("[data-pane-strip-label]")
        ?.hasAttribute("title"),
    ).toBe(false);

    await render({ focusedId: "a" });
    expect(tab("a").dataset.active).toBe("true");
    expect(tab("b").dataset.active).toBe("false");

    // Beside a file pane, the file pane's own row takes the focus state.
    await render({ layout: split("a", page.id), focusedId: page.id });
    expect(tab("a").dataset.active).toBe("false");
    expect(
      pane(page.id)
        .querySelector(".aven-tab-bar")
        ?.getAttribute("data-pane-focused"),
    ).toBe("true");
  });

  it("shows a cut-off name in a tooltip", async () => {
    await render({ layout: split("a", "b") });
    const label = strip("a").querySelector<HTMLElement>(
      "[data-pane-strip-label]",
    )!;
    Object.defineProperty(label, "scrollWidth", { value: 300 });
    Object.defineProperty(label, "clientWidth", { value: 120 });
    await act(async () =>
      label.dispatchEvent(new PointerEvent("pointerover", { bubbles: true })),
    );
    expect(label.title).toBe("Alpha");
  });

  it("closes its own pane from the keyboard-reachable close button", async () => {
    await render({ layout: split("a", "b") });
    const close = strip("a").querySelector<HTMLButtonElement>(
      'button[aria-label="Close pane"]',
    )!;
    expect(close.title).toMatch(/^Close Pane \(.+W\)$/);
    expect(close.tabIndex).toBe(0);
    close.focus();
    expect(document.activeElement).toBe(close);
    await act(async () => close.click());
    expect(props.onClose).toHaveBeenCalledExactlyOnceWith("a");
    expect(props.onMovePane).not.toHaveBeenCalled();
  });

  it("moves the pane when its strip is dragged", async () => {
    await render({ layout: split("a", "b") });
    const handle = strip("a");
    expect(
      handle.querySelector('[aria-label="Drag to move or split this pane"]'),
    ).not.toBeNull();
    handle.setPointerCapture = vi.fn();
    handle.releasePointerCapture = vi.fn();
    vi.mocked(paneDropFromPoint).mockImplementation((x) =>
      x > 100 ? { id: "b", edge: "right" } : null,
    );
    const pointer = (target: EventTarget, type: string, x: number) =>
      act(async () =>
        target.dispatchEvent(
          new PointerEvent(type, {
            bubbles: true,
            button: 0,
            pointerId: 1,
            clientX: x,
            clientY: 10,
          }),
        ),
      );
    // Anywhere on the strip, even its name, picks the pane up.
    await pointer(
      handle.querySelector("[data-pane-strip-label]")!,
      "pointerdown",
      20,
    );
    await pointer(window, "pointermove", 180);
    await pointer(window, "pointerup", 180);
    expect(props.onMovePane).toHaveBeenCalledExactlyOnceWith("a", "b", "right");
  });
});

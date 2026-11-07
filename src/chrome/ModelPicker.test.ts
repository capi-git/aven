// @vitest-environment happy-dom
import { act, createElement, useRef, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

/** What the model list looked like in the commit that first showed it. */
const firstFrame = vi.hoisted(() => ({
  tab: null as string | null,
  highlighted: [] as string[],
  scrolled: [] as string[],
}));

vi.mock("../lib/harness/availability", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/harness/availability")>()),
  probeHarnessAvailability: vi.fn(async () => {}),
  isHarnessAvailable: () => true,
}));
vi.mock("../lib/harness/registry", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/harness/registry")>()),
  refreshHarnessCatalogs: vi.fn(async () => {}),
}));
// Snapshot the DOM from a layout effect on the popover's mount. It runs in
// the same commit as the picker's own layout effects, before any paint and
// before passive effects could correct the first frame.
vi.mock("./Popover", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./Popover")>();
  const react = await import("react");
  return {
    ...actual,
    Popover: (props: Parameters<typeof actual.Popover>[0]) => {
      react.useLayoutEffect(() => {
        firstFrame.tab =
          document
            .querySelector('[role="tab"][aria-selected="true"]')
            ?.getAttribute("title") ?? null;
        const rows = document.querySelector('[role="listbox"]')?.children;
        firstFrame.highlighted = [...(rows ?? [])]
          .filter((row) => row.getAttribute("data-active") === "true")
          .map((row) => row.textContent ?? "");
        firstFrame.scrolled = [...scrolled];
      }, []);
      return react.createElement(actual.Popover, props);
    },
  };
});

const scrolled: string[] = [];
const { AgentPanel } = await import("./AgentPill");
const { modelsFor } = await import("../lib/models");
const { HARNESS_TITLE } = await import("../lib/session");

/**
 * Opens the model list as the message box does, in the agent panel: the
 * list's provider tab, highlight and scroll are its own.
 */
function Opener({ model }: { model: string }) {
  const [open, setOpen] = useState(false);
  const anchor = useRef<HTMLDivElement>(null);
  return createElement(
    "div",
    { ref: anchor },
    createElement("button", {
      type: "button",
      "aria-haspopup": "dialog",
      onClick: () => setOpen(true),
    }),
    open
      ? createElement(AgentPanel, {
          anchor,
          harness: "claude",
          model,
          modelSettings: {},
          runtimeMode: "supervised",
          showAccess: false,
          busy: false,
          onModelChange: vi.fn(),
          onRuntimeModeChange: vi.fn(),
          onDismiss: () => setOpen(false),
        })
      : null,
  );
}

let root: Root;
let host: HTMLDivElement;
let storage: Map<string, string>;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  storage = new Map();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key),
  });
  scrolled.length = 0;
  vi.spyOn(HTMLElement.prototype, "scrollIntoView").mockImplementation(
    function (this: HTMLElement) {
      scrolled.push(this.textContent ?? "");
    },
  );
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it("opens on the chat's provider with the current model highlighted and in view", async () => {
  const claude = modelsFor("claude");
  expect(claude.length).toBeGreaterThan(1);
  const current = claude[claude.length - 1];
  await act(async () =>
    root.render(createElement(Opener, { model: current.id })),
  );
  // Another picker remembered a provider tab after this one mounted.
  storage.set("monocode.modelPickerTab", "claude");
  await act(async () =>
    host.querySelector<HTMLButtonElement>("button[aria-haspopup]")!.click(),
  );

  expect(firstFrame.tab).toBe(HARNESS_TITLE.claude);
  expect(firstFrame.highlighted).toHaveLength(1);
  expect(firstFrame.highlighted[0]).toContain(current.name);
  expect(firstFrame.scrolled.at(-1)).toContain(current.name);
});

it("never paints the first row highlighted before moving to the current model", async () => {
  storage.set("monocode.modelPickerTab", "claude");
  const claude = modelsFor("claude");
  const current = claude[claude.length - 1];
  await act(async () =>
    root.render(createElement(Opener, { model: current.id })),
  );
  await act(async () =>
    host.querySelector<HTMLButtonElement>("button[aria-haspopup]")!.click(),
  );
  expect(firstFrame.highlighted).toEqual([
    expect.stringContaining(current.name),
  ]);
  expect(firstFrame.scrolled).toEqual([expect.stringContaining(current.name)]);
});

it("opens on the chat's own provider, not the tab another chat left", async () => {
  // Another chat last browsed Codex; this one runs Claude.
  storage.set("monocode.modelPickerTab", "codex");
  const claude = modelsFor("claude");
  const current = claude[claude.length - 1];
  await act(async () =>
    root.render(createElement(Opener, { model: current.id })),
  );
  await act(async () =>
    host.querySelector<HTMLButtonElement>("button[aria-haspopup]")!.click(),
  );
  expect(firstFrame.tab).toBe(HARNESS_TITLE.claude);
  expect(firstFrame.highlighted).toEqual([
    expect.stringContaining(current.name),
  ]);
  expect(firstFrame.scrolled.at(-1)).toContain(current.name);
  // Opening does not overwrite the tab the user last chose.
  expect(storage.get("monocode.modelPickerTab")).toBe("codex");
});

it("opens on Favorites when it was left there and holds the chat's model", async () => {
  const claude = modelsFor("claude");
  const current = claude[claude.length - 1];
  storage.set("monocode.modelPickerTab", "favorites");
  storage.set("monocode.favoriteModels", JSON.stringify([current.id]));
  await act(async () =>
    root.render(createElement(Opener, { model: current.id })),
  );
  await act(async () =>
    host.querySelector<HTMLButtonElement>("button[aria-haspopup]")!.click(),
  );
  expect(firstFrame.tab).toBe("Favorites");
  expect(firstFrame.highlighted).toEqual([
    expect.stringContaining(current.name),
  ]);
});

it("opens, filters, moves its highlight and closes without adding or removing a wheel listener", async () => {
  // In WebKit each wheel listener added or removed restyles the whole page.
  storage.set("monocode.modelPickerTab", "claude");
  // A model the search below leaves out, so only the highlight is lit.
  const current = modelsFor("claude").find(
    (item) => !/sonnet/i.test(item.name),
  )!;
  await act(async () =>
    root.render(createElement(Opener, { model: current.id })),
  );
  const open = () =>
    act(async () =>
      host.querySelector<HTMLButtonElement>("button[aria-haspopup]")!.click(),
    );
  const close = () =>
    act(async () => {
      window.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      );
    });
  const listbox = () =>
    document.querySelector<HTMLElement>(
      '[role="listbox"][aria-label="Models"]',
    );
  const rows = () => listbox()?.querySelectorAll('[role="option"]').length ?? 0;
  // React listens on a portal's container the first time one mounts there.
  await open();
  await close();
  expect(listbox()).toBeNull();

  const wheelListeners = countWheelListeners();
  await open();
  const all = rows();
  expect(all).toBeGreaterThan(1);
  const search = document.querySelector<HTMLInputElement>(
    'input[aria-label="Search models"]',
  )!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )!.set!.call(search, "sonnet");
    search.dispatchEvent(new Event("input", { bubbles: true }));
  });
  expect(rows()).toBeGreaterThan(1);
  expect(rows()).toBeLessThan(all);
  const highlighted = () =>
    [...listbox()!.children].findIndex(
      (row) => row.getAttribute("data-active") === "true",
    );
  expect(highlighted()).toBe(0);
  await act(async () => {
    search.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "ArrowDown",
        bubbles: true,
        cancelable: true,
      }),
    );
  });
  expect(highlighted()).toBe(1);
  // The browser scrolls the list and keeps the wheel in it.
  expect(listbox()!.classList.contains("overscroll-none")).toBe(true);
  await close();
  expect(listbox()).toBeNull();
  expect(wheelListeners()).toEqual({ added: 0, removed: 0 });
});

/**
 * Wheel listeners added and removed from now on, on any element, the
 * document or the window. happy-dom's nodes inherit them from its own
 * EventTarget, not the global one, and the window's are bound copies.
 */
function countWheelListeners() {
  const node = Object.getPrototypeOf(Node.prototype) as EventTarget;
  const spies = (method: "addEventListener" | "removeEventListener") => [
    vi.spyOn(node, method),
    vi.spyOn(window, method),
  ];
  const added = spies("addEventListener");
  const removed = spies("removeEventListener");
  const wheel = (list: typeof added) =>
    list.flatMap((spy) => spy.mock.calls).filter(([type]) => type === "wheel")
      .length;
  return () => ({ added: wheel(added), removed: wheel(removed) });
}

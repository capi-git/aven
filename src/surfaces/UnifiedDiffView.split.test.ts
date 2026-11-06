// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { buildUnifiedFile } from "../lib/unifiedDiff";
import { UnifiedDiffView, type UnifiedDiffFileModel } from "./UnifiedDiffView";

vi.mock("./syntaxTokens", () => ({
  highlightDiffFile: () => new Promise(() => {}),
}));
const added = vi.hoisted(() => vi.fn());
vi.mock("../lib/quoteDraft", () => ({ requestAddToChat: added }));

let root: Root;
let host: HTMLDivElement;
let width = 1000;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const data = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
    removeItem: (key: string) => void data.delete(key),
  });
  width = 1000;
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockImplementation(
    () => width,
  );
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function model(): UnifiedDiffFileModel {
  const diff = buildUnifiedFile(
    "one\nconst total = price * count;\nthree\n",
    "one\nconst total = price * quantity;\nthree\nfour\n",
  );
  return {
    id: "a.ts",
    path: "src/a.ts",
    label: "src/a.ts",
    additions: diff.additions,
    deletions: diff.deletions,
    blocks: diff.blocks,
  };
}

async function render() {
  await act(async () =>
    root.render(createElement(UnifiedDiffView, { files: [model()] })),
  );
}

const sideButton = () =>
  host.querySelector<HTMLButtonElement>('button[aria-label="Side by side"]');

it("marks the changed words and switches to side by side, remembered", async () => {
  await render();
  const marks = [...host.querySelectorAll("[data-word-change]")].map(
    (node) => node.textContent,
  );
  expect(marks).toEqual(["count", "quantity"]);
  expect(host.querySelector('[data-diff-side="new"]')).toBeNull();

  await act(async () => sideButton()!.click());
  expect(sideButton()!.getAttribute("aria-pressed")).toBe("true");
  expect(localStorage.getItem("aven.diff.layout")).toBe("split");
  const oldSide = host.querySelector('[data-diff-side="old"]')!;
  const newSide = host.querySelector('[data-diff-side="new"]')!;
  expect(oldSide.textContent).toContain("count");
  expect(oldSide.textContent).not.toContain("four");
  expect(newSide.textContent).toContain("quantity");
  expect(newSide.textContent).toContain("four");
  expect(
    [...newSide.querySelectorAll("[data-word-change]")].map(
      (node) => node.textContent,
    ),
  ).toEqual(["quantity"]);
});

it("comments on a line of either side", async () => {
  localStorage.setItem("aven.diff.layout", "split");
  await render();
  const oldSide = host.querySelector('[data-diff-side="old"]')!;
  const newSide = host.querySelector('[data-diff-side="new"]')!;
  const oldButton = oldSide.querySelector<HTMLButtonElement>(
    'button[aria-label="Comment on line 2"]',
  )!;
  await act(async () => oldButton.click());
  const box = document.querySelector<HTMLTextAreaElement>("textarea")!;
  expect(document.body.textContent).toContain("src/a.ts:2");
  await act(async () => {
    const set = Object.getOwnPropertyDescriptor(
      HTMLTextAreaElement.prototype,
      "value",
    )!.set!;
    set.call(box, "Why this name?");
    box.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () =>
    document.querySelector<HTMLButtonElement>('button[type="submit"]')!.click(),
  );
  expect(added).toHaveBeenCalledWith(
    expect.stringContaining("> -const total = price * count;"),
    "plain",
  );
  const newButton = newSide.querySelector<HTMLButtonElement>(
    'button[aria-label="Comment on line 4"]',
  )!;
  await act(async () => newButton.click());
  expect(document.body.textContent).toContain("src/a.ts:4");
});

it("shows one column in a narrow pane and hides the choice", async () => {
  localStorage.setItem("aven.diff.layout", "split");
  width = 400;
  await render();
  expect(sideButton()).toBeNull();
  expect(host.querySelector('[data-diff-side="new"]')).toBeNull();
});

it("moves between changes with j and k, but not while typing", async () => {
  vi.spyOn(HTMLElement.prototype, "scrollHeight", "get").mockReturnValue(5000);
  const scrollTo = vi
    .spyOn(Element.prototype, "scrollTo")
    .mockImplementation(() => {});
  await render();
  const view = host.firstElementChild as HTMLElement;
  const press = (key: string, target: Element = view) =>
    act(async () => {
      target.dispatchEvent(
        new KeyboardEvent("keydown", { key, bubbles: true }),
      );
    });
  await press("j");
  // The second change ("four") lands two lines below the top.
  expect(scrollTo).toHaveBeenLastCalledWith(
    expect.objectContaining({ top: 40 }),
  );
  await press("k");
  expect(scrollTo).toHaveBeenLastCalledWith(
    expect.objectContaining({ top: 0 }),
  );
  const calls = scrollTo.mock.calls.length;
  const field = document.createElement("textarea");
  view.appendChild(field);
  await press("j", field);
  expect(scrollTo.mock.calls.length).toBe(calls);
});

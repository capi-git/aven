// @vitest-environment happy-dom
import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  resetReviewQueueForTest,
  reviewComments,
  setReviewProject,
} from "../lib/reviewQueue";
import { DiffCommentComposer } from "./DiffCommentComposer";

const mocks = vi.hoisted(() => ({ addToChat: vi.fn() }));
vi.mock("../lib/quoteDraft", () => ({ requestAddToChat: mocks.addToChat }));
vi.mock("../chrome/Popover", () => ({
  Popover: ({ children }: { children: ReactNode }) =>
    createElement("div", null, children),
}));

let root: Root;
let container: HTMLDivElement;
let stored: Map<string, string>;
const onDismiss = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  stored = new Map();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => stored.get(key) ?? null,
    setItem: (key: string, value: string) => void stored.set(key, value),
    removeItem: (key: string) => void stored.delete(key),
  });
  resetReviewQueueForTest();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

async function render() {
  await act(async () =>
    root.render(
      createElement(DiffCommentComposer, {
        path: "src/a.ts",
        target: {
          line: { kind: "add", newNumber: 12, text: "const a = 1;" },
          anchor: { x: 0, y: 0 },
        } as never,
        onDismiss,
      }),
    ),
  );
}

async function type(value: string) {
  const field = container.querySelector("textarea")!;
  const set = Object.getOwnPropertyDescriptor(
    HTMLTextAreaElement.prototype,
    "value",
  )!.set!;
  await act(async () => {
    set.call(field, value);
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

function text(label: string) {
  return Array.from(
    container.querySelectorAll<HTMLButtonElement>("button"),
  ).find((button) => button.textContent?.trim() === label);
}

describe("DiffCommentComposer and Review", () => {
  it("keeps a comment in the project's Review without sending it", async () => {
    setReviewProject("/p");
    await render();
    await type("Rename this");
    await act(async () => text("Add to review")!.click());
    expect(mocks.addToChat).not.toHaveBeenCalled();
    expect(reviewComments("/p")).toEqual([
      expect.objectContaining({
        path: "src/a.ts",
        startLine: 12,
        endLine: 12,
        quote: "const a = 1;",
        marker: "+",
        text: "Rename this",
      }),
    ]);
    expect(onDismiss).toHaveBeenCalledOnce();
  });

  it("sends at once with Add to chat, filing it as done", async () => {
    setReviewProject("/p");
    await render();
    await type("Rename this");
    await act(async () => text("Add to chat")!.click());
    expect(mocks.addToChat).toHaveBeenCalledWith(
      expect.stringContaining("Rename this"),
      "plain",
    );
    expect(reviewComments("/p")[0]?.sentAt).toBeTypeOf("number");
  });

  it("adds straight to the chat with no project open", async () => {
    await render();
    expect(text("Add to review")).toBeUndefined();
    await type("Rename this");
    await act(async () => text("Add to chat")!.click());
    expect(mocks.addToChat).toHaveBeenCalledOnce();
  });
});

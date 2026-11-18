// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  addReviewComment,
  resetReviewQueueForTest,
  reviewComments,
  setReviewProject,
} from "../lib/reviewQueue";
import { ReviewPanel, reviewLocation } from "./ReviewPanel";

const mocks = vi.hoisted(() => ({
  prStatus: vi.fn(),
  thread: vi.fn(),
  addToChat: vi.fn(),
  openUrl: vi.fn(),
}));

vi.mock("../lib/fs", () => ({ gitPrStatus: mocks.prStatus }));
vi.mock("../lib/githubTasks", () => ({ githubWorkItemThread: mocks.thread }));
vi.mock("../lib/quoteDraft", () => ({ requestAddToChat: mocks.addToChat }));
vi.mock("../lib/inAppLinks", () => ({ openInAppUrl: mocks.openUrl }));

let root: Root;
let container: HTMLDivElement;
let stored: Map<string, string>;
const onOpenDiff = vi.fn();
const onOpenAllChanges = vi.fn();

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
  setReviewProject("/p");
  mocks.prStatus.mockResolvedValue(null);
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
      createElement(ReviewPanel, {
        cwd: "/p",
        enabled: true,
        onOpenDiff,
        onOpenAllChanges,
      }),
    ),
  );
}

function text(label: string) {
  return Array.from(
    container.querySelectorAll<HTMLButtonElement>("button"),
  ).find((button) => button.textContent?.trim() === label);
}

describe("ReviewPanel", () => {
  it("says what shows up here when nothing waits, and opens every change", async () => {
    await render();
    expect(container.textContent).toContain("Nothing to review");
    expect(container.textContent).toContain(
      "Comments you leave on a diff, and your pull request’s review threads, show up here.",
    );
    expect(container.textContent).toContain(
      "or select lines in any diff to comment",
    );
    await act(async () => text("Review changes")!.click());
    expect(onOpenAllChanges).toHaveBeenCalledOnce();
    await act(async () => text("Done")!.click());
    expect(container.textContent).toContain("Nothing done yet");
    expect(container.textContent).toContain(
      "Comments you send and threads that get resolved show up here.",
    );
    await act(async () => text("Open")!.click());
  });

  it("lists open comments, sends one to the chat and moves it to Done", async () => {
    addReviewComment({
      path: "src/a.ts",
      startLine: 4,
      endLine: 4,
      quote: "const a = 1;",
      marker: "+",
      text: "Use a better name",
      message: "Diff comment on `src/a.ts:4`",
    });
    await render();
    expect(container.textContent).toContain("src/a.ts:4");
    expect(container.textContent).toContain("Use a better name");
    await act(async () =>
      container.querySelector<HTMLButtonElement>(".review-item-main")!.click(),
    );
    expect(onOpenDiff).toHaveBeenCalledWith("/p/src/a.ts");
    await act(async () => text("Send to chat")!.click());
    expect(mocks.addToChat).toHaveBeenCalledWith(
      "Diff comment on `src/a.ts:4`",
      "plain",
    );
    expect(container.textContent).toContain("All caught up");
    await act(async () => text("See what’s done")!.click());
    expect(container.textContent).toContain("Use a better name");
    await act(async () =>
      container
        .querySelector<HTMLButtonElement>(
          '[aria-label="Remove comment on src/a.ts:4"]',
        )!
        .click(),
    );
    expect(reviewComments("/p")).toHaveLength(0);
    await act(async () => text("Open")!.click());
  });

  it("sends every open comment together", async () => {
    addReviewComment({ path: "a.ts", text: "one", message: "First" });
    addReviewComment({ path: "b.ts", text: "two", message: "Second" });
    await render();
    await act(async () => text("Send all to chat")!.click());
    expect(mocks.addToChat).toHaveBeenCalledExactlyOnceWith(
      "First\n\nSecond",
      "plain",
    );
    expect(reviewComments("/p").every((c) => c.sentAt)).toBe(true);
  });

  it("lists the open pull request's review threads, resolved ones under Done", async () => {
    mocks.prStatus.mockResolvedValue({
      number: 7,
      title: "x",
      url: "u",
      state: "open",
    });
    const thread = (id: string, resolved: boolean) => ({
      id,
      kind: "review_comment",
      author: "sam",
      body: `Thread ${id}`,
      createdAt: "",
      url: `https://github.com/t/${id}`,
      state: "",
      path: "a.ts",
      line: 2,
      resolved,
      threadId: id,
      replies: [],
    });
    mocks.thread.mockResolvedValue({
      comments: [thread("1", false), thread("2", true)],
      truncated: false,
      reviewDecision: "",
      baseRefName: "main",
      headRefName: "f",
    });
    await render();
    await act(async () => {
      await Promise.resolve();
    });
    expect(mocks.thread).toHaveBeenCalledWith("/p", "pr", 7);
    expect(container.textContent).toContain("Thread 1");
    expect(container.textContent).not.toContain("Thread 2");
    await act(async () => text("Done")!.click());
    expect(container.textContent).toContain("Thread 2");
    await act(async () => text("Open")!.click());
  });

  it("names a line range", () => {
    expect(reviewLocation({ path: "a.ts", startLine: 2, endLine: 5 })).toBe(
      "a.ts:2–5",
    );
    expect(reviewLocation({ path: "a.ts" })).toBe("a.ts");
  });
});

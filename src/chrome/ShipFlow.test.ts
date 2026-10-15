// @vitest-environment happy-dom
import { act, createElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GitChangedFile, GitDiffIndex, GitPr } from "../lib/fs";
import { generateCommitMessage } from "../lib/harness";
import {
  createLiveSessionStore,
  LiveSessionsContext,
} from "../lib/liveSessions";
import { newSession, type Session } from "../lib/session";
import { ShipFlow } from "./ShipFlow";

const mocks = vi.hoisted(() => ({
  calls: [] as string[],
  failPush: null as string | null,
  checks: [] as { name: string; state: string; url: string }[][],
  ask: vi.fn(async () => true),
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: async (command: string) => {
    mocks.calls.push(command);
    if (command === "git_push" && mocks.failPush) {
      const reason = mocks.failPush;
      mocks.failPush = null;
      throw reason;
    }
    if (command === "git_pr_create") return "https://github.com/o/r/pull/12\n";
    if (command === "git_pr_checks")
      return {
        number: 12,
        url: "https://github.com/o/r/pull/12",
        state: "open",
        checks: mocks.checks.shift() ?? [],
      };
    return undefined;
  },
}));
vi.mock("@tauri-apps/plugin-dialog", () => ({ ask: mocks.ask }));
vi.mock("../lib/harness", () => ({
  generateCommitMessage: vi.fn(async () => "Add the ship flow"),
  generatePrContent: vi.fn(async () => ({
    title: "Add the ship flow",
    body: "## Summary",
    base: "main",
    head: "feature",
  })),
}));
vi.mock("../lib/inAppLinks", () => ({ openInAppUrl: vi.fn() }));

let root: Root;
let container: HTMLDivElement;
let onClose: ReturnType<typeof vi.fn<() => void>>;
let onMutated: ReturnType<typeof vi.fn<() => void>>;

const index = (overrides: Partial<GitDiffIndex> = {}): GitDiffIndex => ({
  branch: "feature",
  files: [],
  additions: 0,
  deletions: 0,
  remote: "origin",
  upstream: "origin/feature",
  defaultBranch: "main",
  ahead: 0,
  behind: 0,
  aheadOfDefault: 0,
  ...overrides,
});

const file = (relative: string, additions: number, deletions: number) =>
  ({
    path: `/repo/${relative}`,
    relative,
    status: "modified",
    additions,
    deletions,
    staged: false,
    unstaged: true,
  }) satisfies GitChangedFile;

function testedSession(): Session {
  return {
    ...newSession("claude", "/repo"),
    id: "s1",
    blocks: [
      { id: "u", role: "user", text: "Fix it", startedAt: 1 },
      {
        id: "t",
        role: "tool",
        text: "npm test",
        tool: {
          kind: "execute",
          title: "npm test",
          status: "completed",
          detail: "Tests  12 passed (12)",
        },
      },
    ],
  };
}

function Host(props: {
  index: GitDiffIndex;
  pr?: GitPr | null;
  sessions?: Session[];
  initialMessage?: string;
}) {
  const [message, setMessage] = useState(props.initialMessage ?? "");
  return createElement(
    LiveSessionsContext.Provider,
    { value: createLiveSessionStore(props.sessions ?? []) },
    createElement(ShipFlow, {
      cwd: "/repo",
      index: props.index,
      files: [file("a.ts", 3, 1), file("b.ts", 2, 0)],
      pr: props.pr ?? null,
      enabled: true,
      message,
      onMessageChange: setMessage,
      onBusyChange: () => {},
      onMutated,
      onPrChanged: () => {},
      onClose,
    }),
  );
}

async function render(props: Parameters<typeof Host>[0]) {
  await act(async () => root.render(createElement(Host, props)));
}

function button(name: string): HTMLButtonElement {
  const found = Array.from(
    container.querySelectorAll<HTMLButtonElement>("button"),
  ).find(
    (candidate) =>
      candidate.getAttribute("aria-label") === name ||
      candidate.textContent?.trim() === name,
  );
  if (!found) throw new Error(`No button ${name}`);
  return found;
}

async function settle(ms = 0) {
  await act(async () => vi.advanceTimersByTimeAsync(ms));
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const values = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  });
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(document, "hidden", "get").mockReturnValue(false);
  mocks.calls.length = 0;
  mocks.failPush = null;
  mocks.checks = [];
  mocks.ask.mockClear();
  mocks.ask.mockResolvedValue(true);
  onClose = vi.fn<() => void>();
  onMutated = vi.fn<() => void>();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("ShipFlow", () => {
  it("writes the message, opens a pull request and watches its checks until they finish", async () => {
    mocks.checks = [
      [
        { name: "web", state: "pending", url: "" },
        { name: "rust", state: "pass", url: "" },
      ],
      [
        { name: "web", state: "pass", url: "" },
        { name: "rust", state: "pass", url: "" },
      ],
    ];
    await render({ index: index(), sessions: [testedSession()] });
    expect(container.textContent).toContain("2 files");
    expect(container.textContent).toContain("+5");
    expect(container.textContent).toContain("Tests passed");
    expect(container.textContent).toContain("npm test · 12 passed");

    // The message is written from staged changes, so everything is staged first.
    await act(async () => button("Write the commit message").click());
    await settle();
    expect(mocks.calls).toEqual(["git_stage_all"]);
    expect(generateCommitMessage).toHaveBeenCalledOnce();
    expect(container.querySelector("textarea")?.value).toBe(
      "Add the ship flow",
    );

    mocks.calls.length = 0;
    await act(async () => button("Open PR").click());
    await act(async () => button("Commit, push & open PR").click());
    await settle();
    expect(mocks.calls).toEqual([
      "git_stage_all",
      "git_commit",
      "git_push",
      "git_pr_create",
      "git_pr_checks",
    ]);
    expect(localStorage.getItem("aven.shipMode")).toBe("pr");
    expect(container.textContent).toContain("Shipped");
    expect(container.textContent).toContain("Opened PR #12");
    expect(container.textContent).toContain("1 of 2 checks running");
    expect(vi.getTimerCount()).toBe(1);

    await settle(8000);
    expect(container.textContent).toContain("All 2 checks passed");
    expect(vi.getTimerCount()).toBe(0);
    expect(onMutated).toHaveBeenCalled();
  });

  it("resumes after a failed push without committing twice", async () => {
    mocks.failPush = "rejected: fetch first";
    await render({ index: index(), initialMessage: "Fix it" });
    await act(async () => button("Commit & push").click());
    await settle();
    expect(container.textContent).toContain(
      "Committed, but the push failed. rejected: fetch first",
    );
    mocks.calls.length = 0;
    await act(async () => button("Try again").click());
    await settle();
    expect(mocks.calls).toEqual(["git_push"]);
    expect(container.textContent).toContain("Committed 2 files");
    expect(container.textContent).toContain("pushed to origin/feature");
  });

  it("says when no tests ran, needs a message, and closes on Escape", async () => {
    await render({ index: index({ remote: null, upstream: null }) });
    expect(container.textContent).toContain("No tests ran");
    expect(button("Commit").getAttribute("aria-checked")).toBe("true");
    expect(button("Push").disabled).toBe(true);
    const primary =
      container.querySelector<HTMLButtonElement>(".ship-flow-primary")!;
    expect(primary.disabled).toBe(true);
    await act(async () =>
      container
        .querySelector("section")!
        .dispatchEvent(
          new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
        ),
    );
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("asks before pushing to the default branch", async () => {
    mocks.ask.mockResolvedValueOnce(false);
    await render({
      index: index({ branch: "main", upstream: "origin/main" }),
      initialMessage: "Hotfix",
    });
    await act(async () => button("Commit & push").click());
    await settle();
    expect(mocks.ask).toHaveBeenCalledWith(
      'Push to default branch "main"?',
      expect.objectContaining({ kind: "warning" }),
    );
    expect(mocks.calls).toEqual([]);
  });

  it("reports the open pull request a push updates", async () => {
    mocks.checks = [[{ name: "web", state: "fail", url: "https://ci/1" }]];
    const pr: GitPr = {
      number: 3,
      title: "Open",
      url: "https://github.com/o/r/pull/3",
      state: "open",
    };
    await render({ index: index(), pr, initialMessage: "More" });
    expect(button("Open PR").disabled).toBe(true);
    expect(container.textContent).toContain("Updates PR #3.");
    await act(async () => button("Commit & push").click());
    await settle();
    expect(container.textContent).toContain("Updated PR #3");
    expect(container.textContent).toContain("1 of 1 check failed");
    expect(vi.getTimerCount()).toBe(0);
    await act(async () =>
      container
        .querySelector<HTMLButtonElement>(".ship-flow-checks-head")!
        .click(),
    );
    expect(container.textContent).toContain("Failed");
  });
});

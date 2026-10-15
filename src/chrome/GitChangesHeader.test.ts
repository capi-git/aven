// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GitDiffIndex, GitHistoryCommit } from "../lib/fs";
import { ChangesHeader, CleanState } from "./GitChangesHeader";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(async () => undefined),
  convertFileSrc: (path: string) => path,
}));

let root: Root;
let container: HTMLDivElement;
const NOW = Date.UTC(2026, 9, 15, 12);

const index = (overrides: Partial<GitDiffIndex> = {}): GitDiffIndex => ({
  branch: "feature/ship",
  files: [],
  additions: 0,
  deletions: 0,
  remote: "origin",
  upstream: "origin/feature/ship",
  defaultBranch: "main",
  ahead: 0,
  behind: 0,
  aheadOfDefault: 0,
  ...overrides,
});

const lastCommit: GitHistoryCommit = {
  sha: "a".repeat(40),
  shortSha: "aaaaaaa",
  parents: [],
  author: "Jack",
  timestamp: NOW / 1000 - 3 * 3600,
  subject: "Make the panel nicer",
  refs: [],
  head: true,
};

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const values = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  });
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

describe("ChangesHeader", () => {
  it("shows the project, copy, branch, where it stands and the last commit", async () => {
    const onOpenBranchPicker = vi.fn();
    const onOpenCommit = vi.fn();
    await act(async () =>
      root.render(
        createElement(ChangesHeader, {
          cwd: "/copies/ship",
          projectCwd: "/work/aven",
          index: index({ ahead: 2, behind: 1 }),
          lastCommit,
          copyLabel: "Copy · Ship",
          now: NOW,
          onOpenBranchPicker,
          onOpenCommit,
        }),
      ),
    );
    const text = container.textContent ?? "";
    expect(text).toContain("aven");
    expect(text).toContain("Copy · Ship");
    expect(text).toContain("feature/ship");
    expect(text).toContain("↑2");
    expect(text).toContain("↓1");
    expect(text).toContain("Make the panel nicer");
    expect(text).toContain("3h ago");
    expect(container.querySelector(".project-mark")).not.toBeNull();
    const branch = container.querySelector<HTMLButtonElement>(
      '[aria-label="Switch branch: feature/ship"]',
    )!;
    await act(async () => branch.click());
    expect(onOpenBranchPicker).toHaveBeenCalledWith(branch);
    await act(async () =>
      container.querySelector<HTMLButtonElement>(".git-hero-commit")!.click(),
    );
    expect(onOpenCommit).toHaveBeenCalledWith(lastCommit);
  });

  it("says when a branch is up to date or not published yet", async () => {
    await act(async () =>
      root.render(
        createElement(ChangesHeader, {
          cwd: "/work/aven",
          index: index(),
          lastCommit: null,
          copyLabel: null,
          now: NOW,
        }),
      ),
    );
    expect(container.textContent).toContain("Up to date");
    expect(
      container.querySelector('[aria-label="Branch: feature/ship"]'),
    ).not.toBeNull();
    await act(async () =>
      root.render(
        createElement(ChangesHeader, {
          cwd: "/work/aven",
          index: index({ upstream: null }),
          lastCommit: null,
          copyLabel: null,
          now: NOW,
        }),
      ),
    );
    expect(container.textContent).toContain("Not on origin yet");
  });
});

describe("CleanState", () => {
  it("shows the mascot, status, last commit and next steps", async () => {
    const onShowHistory = vi.fn();
    const onOpenBranchPicker = vi.fn();
    await act(async () =>
      root.render(
        createElement(CleanState, {
          cwd: "/work/aven",
          title: "main is clean and up to date",
          detail: "Matches origin/main",
          noGit: false,
          lastCommit,
          now: NOW,
          onShowHistory,
          onOpenBranchPicker,
        }),
      ),
    );
    const text = container.textContent ?? "";
    expect(text).toContain("All clean");
    expect(text).toContain("main is clean and up to date");
    expect(text).toContain("Last commit");
    expect(container.querySelector("svg.git-clean-mascot")).not.toBeNull();
    const buttons = Array.from(container.querySelectorAll("button"));
    expect(buttons.map((b) => b.textContent)).toEqual([
      "History",
      "Switch branch",
      "New branch",
    ]);
    await act(async () => buttons[0].click());
    expect(onShowHistory).toHaveBeenCalledOnce();
    await act(async () => buttons[2].click());
    expect(onOpenBranchPicker).toHaveBeenCalledWith(buttons[2]);
  });

  it("explains a folder without Git and offers no Git actions", async () => {
    await act(async () =>
      root.render(
        createElement(CleanState, {
          cwd: "/work/notes",
          title: "Nothing to commit",
          detail: "This copy",
          noGit: true,
          lastCommit: null,
          now: NOW,
          onShowHistory: vi.fn(),
          onOpenBranchPicker: vi.fn(),
        }),
      ),
    );
    expect(container.textContent).toContain("No Git here yet");
    expect(container.textContent).toContain(
      "This folder isn't a Git repository.",
    );
    expect(container.querySelectorAll("button")).toHaveLength(0);
  });
});

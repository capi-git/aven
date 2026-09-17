// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GitChangesPanel } from "./GitChangesPanel";
import { notifyGitChanged, type GitDiffIndex, type GitPr } from "../lib/fs";

const mocks = vi.hoisted(() => ({
  diffIndex: vi.fn(),
  stageAll: vi.fn(),
  applyStats: vi.fn(),
  invalidate: vi.fn(),
  prStatus: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (command: string, args: { cwd: string }) => {
    if (command === "git_diff_index") return mocks.diffIndex(args.cwd);
    if (command === "git_stage_all") return mocks.stageAll(args.cwd);
    if (command === "git_pr_status") return mocks.prStatus(args.cwd);
    throw new Error(`Unexpected native command: ${command}`);
  },
}));
vi.mock("../lib/harness", () => ({
  generateCommitMessage: vi.fn(),
  generatePrContent: vi.fn(),
}));
vi.mock("../lib/fileWatch", () => ({
  invalidateWatchedFiles: mocks.invalidate,
}));
vi.mock("../hooks/useProjectDiffStats", () => ({
  applyProjectDiffStats: mocks.applyStats,
}));
vi.mock("./FileTypeIcon", () => ({ FileTypeIcon: () => null }));
vi.mock("./GitHistoryGraph", () => ({
  GitHistoryGraph: () => null,
  GraphResizeSash: () => null,
  GRAPH_PANEL_DEFAULT: 240,
  GRAPH_PANEL_MIN: 120,
  loadGraphPanelHeight: () => 240,
  saveGraphPanelHeight: vi.fn(),
}));

let root: Root;
let container: HTMLDivElement;
let hidden: boolean;
let cwd: string;
let sequence = 0;
let index: GitDiffIndex;

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  hidden = false;
  vi.spyOn(document, "hidden", "get").mockImplementation(() => hidden);
  cwd = `/git-polling-${++sequence}`;
  index = {
    branch: "feature",
    files: [],
    additions: 0,
    deletions: 0,
    remote: null,
    upstream: null,
    defaultBranch: "main",
    ahead: 0,
    behind: 0,
    aheadOfDefault: 0,
  };
  mocks.diffIndex.mockResolvedValue(index);
  mocks.stageAll.mockResolvedValue(undefined);
  mocks.prStatus.mockResolvedValue(null);
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

async function render(enabled = true) {
  await act(async () =>
    root.render(
      createElement(GitChangesPanel, {
        cwd,
        enabled,
        onOpenFile: vi.fn(),
        onOpenAllChanges: vi.fn(),
        onOpenCommit: vi.fn(),
      }),
    ),
  );
}

async function visibility(value: boolean) {
  hidden = value;
  await act(async () => document.dispatchEvent(new Event("visibilitychange")));
}

describe("Changes panel visibility polling", () => {
  it("retains PR state without hidden focus reads or late hidden publications", async () => {
    index.remote = "origin";
    const previous: GitPr = {
      number: 1,
      title: "Previous PR",
      url: "https://example.com/pr/1",
      state: "open",
    };
    mocks.prStatus.mockResolvedValue(previous);
    await render();
    expect(
      container.querySelector('[title="View PR #1: Previous PR"]'),
    ).not.toBeNull();
    let finish!: (pr: GitPr) => void;
    mocks.prStatus.mockImplementationOnce(
      () =>
        new Promise<GitPr>((resolve) => {
          finish = resolve;
        }),
    );
    await act(async () => window.dispatchEvent(new Event("focus")));
    const reads = mocks.prStatus.mock.calls.length;
    await render(false);
    await act(async () => {
      window.dispatchEvent(new Event("focus"));
      document.dispatchEvent(new Event("visibilitychange"));
      notifyGitChanged();
      await vi.advanceTimersByTimeAsync(4000);
      finish({ ...previous, number: 2, title: "Stale result" });
    });
    expect(mocks.prStatus).toHaveBeenCalledTimes(reads);
    expect(
      container.querySelector('[title="View PR #1: Previous PR"]'),
    ).not.toBeNull();
    expect(container.textContent).not.toContain("Stale result");
    expect(vi.getTimerCount()).toBe(0);
    mocks.prStatus.mockResolvedValue({
      ...previous,
      number: 3,
      title: "Current PR",
    });
    await render(true);
    expect(mocks.prStatus).toHaveBeenCalledTimes(reads + 1);
    expect(
      container.querySelector('[title="View PR #3: Current PR"]'),
    ).not.toBeNull();
  });

  it("has no hidden timer, resumes one timer with a fresh load, and cleans up on close", async () => {
    hidden = true;
    await render();
    expect(mocks.diffIndex).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
    await visibility(false);
    expect(mocks.diffIndex).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(1);
    await visibility(false);
    expect(vi.getTimerCount()).toBe(1);
    mocks.diffIndex.mockClear();
    await act(async () => vi.advanceTimersByTimeAsync(2000));
    expect(mocks.diffIndex).toHaveBeenCalledOnce();
    await visibility(true);
    expect(vi.getTimerCount()).toBe(0);
    await act(async () => {
      window.dispatchEvent(new Event("focus"));
      notifyGitChanged();
      await vi.advanceTimersByTimeAsync(6000);
    });
    expect(mocks.diffIndex).toHaveBeenCalledOnce();
    await visibility(false);
    expect(mocks.diffIndex).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(1);
    await act(async () => root.render(null));
    expect(vi.getTimerCount()).toBe(0);
    await act(async () => {
      notifyGitChanged();
      window.dispatchEvent(new Event("focus"));
    });
    expect(mocks.diffIndex).toHaveBeenCalledTimes(2);
  });

  it("drops queued refreshes and late publications when an in-flight load becomes hidden", async () => {
    let complete!: (value: GitDiffIndex) => void;
    mocks.diffIndex.mockImplementationOnce(
      () =>
        new Promise<GitDiffIndex>((resolve) => {
          complete = resolve;
        }),
    );
    await render();
    await act(async () => notifyGitChanged());
    await visibility(true);
    await act(async () => complete(index));
    expect(mocks.diffIndex).toHaveBeenCalledOnce();
    expect(mocks.applyStats).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
    await visibility(false);
    expect(mocks.diffIndex).toHaveBeenCalledTimes(2);
    expect(mocks.applyStats).toHaveBeenCalledOnce();
  });

  it("does not restart a queued load after the panel is unmounted", async () => {
    let complete!: (value: GitDiffIndex) => void;
    mocks.diffIndex.mockImplementationOnce(
      () =>
        new Promise<GitDiffIndex>((resolve) => {
          complete = resolve;
        }),
    );
    await render();
    await act(async () => notifyGitChanged());
    await act(async () => root.render(null));
    await act(async () => complete(index));
    expect(mocks.diffIndex).toHaveBeenCalledOnce();
    expect(mocks.applyStats).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("keeps a mutation-triggered manual refresh deferred while hidden", async () => {
    index.files = [
      {
        path: `${cwd}/file.ts`,
        relative: "file.ts",
        status: "modified",
        additions: 1,
        deletions: 0,
        staged: false,
        unstaged: true,
      },
    ];
    let completeStage!: () => void;
    mocks.stageAll.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          completeStage = resolve;
        }),
    );
    await render();
    expect(mocks.diffIndex).toHaveBeenCalledOnce();
    await act(async () =>
      container
        .querySelector<HTMLButtonElement>('[title="Stage All Changes"]')!
        .click(),
    );
    expect(mocks.stageAll).toHaveBeenCalledOnce();
    await visibility(true);
    await act(async () => completeStage());
    await act(async () => vi.advanceTimersByTimeAsync(6000));
    expect(mocks.diffIndex).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
    await visibility(false);
    expect(mocks.diffIndex).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(1);
  });
});

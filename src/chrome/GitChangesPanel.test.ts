// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GitChangesPanel, gitStatusSummary } from "./GitChangesPanel";
import {
  notifyGitChanged,
  type GitChangedFile,
  type GitDiffIndex,
  type GitPr,
} from "../lib/fs";
import { generateCommitMessage } from "../lib/harness";

const mocks = vi.hoisted(() => ({
  diffIndex: vi.fn(),
  stageAll: vi.fn(),
  applyStats: vi.fn(),
  invalidate: vi.fn(),
  prStatus: vi.fn(),
  squashMerge: vi.fn(),
  ask: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (command: string, args: { cwd: string }) => {
    if (command === "git_diff_index") return mocks.diffIndex(args.cwd);
    if (command === "git_stage_all") return mocks.stageAll(args.cwd);
    if (command === "git_pr_status") return mocks.prStatus(args.cwd);
    if (command === "git_pr_squash_merge")
      return mocks.squashMerge(args.cwd, (args as { number?: number }).number);
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
  useProjectDiffStats: () => null,
}));
vi.mock("./FileTypeIcon", () => ({ FileTypeIcon: () => null }));
vi.mock("./GitCopies", () => ({ GitCopies: () => null }));
vi.mock("./GitHousekeeping", () => ({ GitHousekeeping: () => null }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ ask: mocks.ask }));
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

async function render(enabled = true, onOpenAllChanges = vi.fn()) {
  await act(async () =>
    root.render(
      createElement(GitChangesPanel, {
        cwd,
        enabled,
        onOpenFile: vi.fn(),
        onOpenAllChanges,
        onOpenCommit: vi.fn(),
      }),
    ),
  );
}

function changed(
  relative: string,
  staged: boolean,
  unstaged: boolean,
): GitChangedFile {
  return {
    path: `${cwd}/${relative}`,
    relative,
    status: "modified",
    additions: 1,
    deletions: 0,
    staged,
    unstaged,
  };
}

function button(label: string) {
  return container.querySelector<HTMLButtonElement>(`[aria-label="${label}"]`);
}

describe("GitChangesPanel commit message generation", () => {
  it("cancels promptly and ignores a late result after a retry", async () => {
    index.files = [changed("change.ts", true, false)];
    let resolveFirst!: (message: string) => void;
    vi.mocked(generateCommitMessage)
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveFirst = resolve;
          }),
      )
      .mockResolvedValueOnce("New message");
    await render();

    await act(async () => button("Generate commit message")!.click());
    const signal = vi.mocked(generateCommitMessage).mock.calls[0]?.[2];
    expect(signal?.aborted).toBe(false);

    await act(async () => button("Cancel commit message generation")!.click());
    expect(signal?.aborted).toBe(true);
    expect(button("Generate commit message")?.disabled).toBe(false);
    expect(container.querySelector("textarea")?.disabled).toBe(false);

    await act(async () => button("Generate commit message")!.click());
    expect(container.querySelector("textarea")?.value).toBe("New message");

    await act(async () => resolveFirst("Old message"));
    expect(container.querySelector("textarea")?.value).toBe("New message");
  });
});

describe("GitChangesPanel Open All Changes", () => {
  it("scopes the review to the section it was opened from", async () => {
    index.files = [changed("a.ts", true, true), changed("b.ts", false, true)];
    const onOpenAllChanges = vi.fn();
    await render(true, onOpenAllChanges);
    const opens = [
      ...container.querySelectorAll<HTMLButtonElement>(
        '[title="Open All Changes"]',
      ),
    ];
    expect(opens).toHaveLength(2);
    await act(async () => opens[0].click());
    await act(async () => opens[1].click());
    expect(onOpenAllChanges.mock.calls).toEqual([["staged"], ["unstaged"]]);
  });
});

async function visibility(value: boolean) {
  hidden = value;
  await act(async () => document.dispatchEvent(new Event("visibilitychange")));
}

describe("pull request merging", () => {
  it("squash-merges the open pull request only after confirming", async () => {
    index.remote = "origin";
    index.upstream = "origin/feature";
    mocks.prStatus.mockResolvedValue({
      number: 4,
      title: "Tab groups",
      url: "https://example.com/pr/4",
      state: "open",
    });
    mocks.squashMerge.mockResolvedValue(undefined);
    await render();
    const merge = () =>
      Array.from(container.querySelectorAll("button")).find(
        (button) => button.textContent === "Squash and merge",
      );
    expect(merge()).toBeDefined();
    mocks.ask.mockResolvedValueOnce(false);
    await act(async () => merge()!.click());
    expect(mocks.squashMerge).not.toHaveBeenCalled();
    mocks.ask.mockResolvedValueOnce(true);
    await act(async () => merge()!.click());
    expect(mocks.ask).toHaveBeenLastCalledWith(
      expect.stringContaining("Squash and merge PR #4 into main?"),
      expect.objectContaining({ okLabel: "Squash and merge" }),
    );
    expect(mocks.squashMerge).toHaveBeenCalledExactlyOnceWith(cwd, 4);
  });

  it("offers no merge without an open pull request", async () => {
    index.remote = "origin";
    mocks.prStatus.mockResolvedValue({
      number: 5,
      title: "Done",
      url: "https://example.com/pr/5",
      state: "merged",
    });
    await render();
    expect(container.textContent).not.toContain("Squash and merge");
  });
});

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

describe("clean copy status", () => {
  const base: GitDiffIndex = {
    branch: "main",
    files: [],
    additions: 0,
    deletions: 0,
    remote: "origin",
    upstream: "origin/main",
    defaultBranch: "main",
    ahead: 0,
    behind: 0,
    aheadOfDefault: 0,
  };

  it("says a synced copy is clean and up to date", () => {
    expect(gitStatusSummary(base)).toEqual({
      tone: "ok",
      title: "main is clean and up to date",
      detail: "Matches origin/main",
    });
  });

  it("points out commits to push, unpublished branches and local-only folders", () => {
    expect(gitStatusSummary({ ...base, ahead: 2 })).toMatchObject({
      tone: "info",
      title: "2 unpushed commits",
    });
    expect(
      gitStatusSummary({ ...base, branch: "feature", upstream: null }),
    ).toMatchObject({ tone: "info", title: "feature isn't on origin yet" });
    expect(gitStatusSummary({ ...base, remote: null })).toMatchObject({
      tone: "neutral",
      title: "Nothing to commit",
    });
  });
});

describe("Changes header", () => {
  it("switches branch from the header, which holds what the footer used to", async () => {
    const onOpenBranchPicker = vi.fn();
    await act(async () =>
      root.render(
        createElement(GitChangesPanel, {
          cwd,
          enabled: true,
          onOpenFile: vi.fn(),
          onOpenAllChanges: vi.fn(),
          onOpenCommit: vi.fn(),
          onOpenBranchPicker,
        }),
      ),
    );
    await act(async () => {
      await Promise.resolve();
    });
    const branch = button("Switch branch: feature")!;
    expect(branch.disabled).toBe(false);
    await act(async () => branch.click());
    expect(onOpenBranchPicker).toHaveBeenCalledWith(branch);
  });

  it("shows the branch without a switcher when none is supplied", async () => {
    await render();
    await act(async () => {
      await Promise.resolve();
    });
    expect(button("Switch branch: feature")).toBeNull();
    expect(button("Branch: feature")?.disabled).toBe(true);
  });
});

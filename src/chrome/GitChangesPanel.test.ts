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
import {
  closeImageViewer,
  imageViewerSnapshot,
  registerImageViewerHost,
} from "../lib/imageViewer";
import { requestShip, takeShipRequest } from "../lib/shipRequest";

const mocks = vi.hoisted(() => ({
  /** Git commands that change the copy, in the order they ran. */
  writes: [] as string[],
  diffIndex: vi.fn(),
  diffFiles: vi.fn(),
  stageAll: vi.fn(),
  applyStats: vi.fn(),
  invalidate: vi.fn(),
  prStatus: vi.fn(),
  squashMerge: vi.fn(),
  ask: vi.fn(),
  history: vi.fn(),
  graph: vi.fn(),
}));

/** Writes the panel and Ship it make, which only need to succeed here. */
const GIT_WRITES = new Set([
  "git_stage_file",
  "git_unstage_file",
  "git_unstage_all",
  "git_discard_file",
  "git_discard_all",
  "git_commit",
  "git_push",
]);

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (command: string, args: { cwd: string; relative?: string }) => {
    if (GIT_WRITES.has(command)) {
      mocks.writes.push(
        args.relative ? `${command} ${args.relative}` : command,
      );
      return Promise.resolve(undefined);
    }
    if (command === "git_diff_files") return mocks.diffFiles(args.cwd);
    if (command === "git_diff_index") return mocks.diffIndex(args.cwd);
    if (command === "git_stage_all") {
      mocks.writes.push(command);
      return mocks.stageAll(args.cwd);
    }
    if (command === "git_pr_status") return mocks.prStatus(args.cwd);
    if (command === "git_pr_squash_merge")
      return mocks.squashMerge(args.cwd, (args as { number?: number }).number);
    if (command === "git_history") return mocks.history(args.cwd);
    throw new Error(`Unexpected native command: ${command}`);
  },
}));
vi.mock("../lib/harness", () => ({
  generateCommitMessage: vi.fn(),
  generatePrContent: vi.fn(),
  textModelLabel: () => "Claude Haiku 4.5",
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
  GitHistoryGraph: (props: unknown) => {
    mocks.graph(props);
    return null;
  },
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
/** This test's localStorage; CI's Node has none of its own to rely on. */
let stored: Map<string, string>;

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  stored = new Map();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => stored.get(key) ?? null,
    setItem: (key: string, value: string) => void stored.set(key, value),
    removeItem: (key: string) => void stored.delete(key),
  });
  mocks.writes.length = 0;
  hidden = false;
  vi.spyOn(document, "hasFocus").mockReturnValue(true);
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
  mocks.diffFiles.mockResolvedValue(index);
  mocks.stageAll.mockResolvedValue(undefined);
  mocks.prStatus.mockResolvedValue(null);
  mocks.history.mockResolvedValue({ head: null, commits: [] });
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

describe("GitChangesPanel Open All Changes", () => {
  it("opens every change from the single list", async () => {
    index.files = [changed("a.ts", true, false), changed("b.ts", false, true)];
    const onOpenAllChanges = vi.fn();
    await render(true, onOpenAllChanges);
    const opens = container.querySelectorAll<HTMLButtonElement>(
      '[title="Open All Changes"]',
    );
    expect(opens).toHaveLength(1);
    await act(async () => opens[0].click());
    expect(onOpenAllChanges).toHaveBeenCalledExactlyOnceWith();
  });

  it("scopes the review to the section it was opened from", async () => {
    stored.set("aven.changesStaging", "1");
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

describe("changed pictures", () => {
  it("open in the image viewer beside the section's other pictures; other files open their diff", async () => {
    const unregister = registerImageViewerHost();
    index.files = [
      changed("shots/a.png", false, true),
      changed("src/b.ts", false, true),
      changed("shots/c.png", false, true),
    ];
    const onOpenFile = vi.fn();
    await act(async () =>
      root.render(
        createElement(GitChangesPanel, {
          cwd,
          enabled: true,
          onOpenFile,
          onOpenAllChanges: vi.fn(),
          onOpenCommit: vi.fn(),
        }),
      ),
    );
    const row = (relative: string) =>
      container.querySelector<HTMLButtonElement>(
        `button[title="${relative}"]`,
      )!;
    await act(async () => row("shots/c.png").click());
    expect(onOpenFile).not.toHaveBeenCalled();
    expect(imageViewerSnapshot()).toMatchObject({
      index: 1,
      items: [
        { name: "a.png", path: `${cwd}/shots/a.png` },
        { name: "c.png", path: `${cwd}/shots/c.png` },
      ],
    });
    closeImageViewer();
    await act(async () => row("src/b.ts").click());
    expect(onOpenFile).toHaveBeenCalledExactlyOnceWith(
      `${cwd}/src/b.ts`,
      "unstaged",
    );
    unregister();
    await act(async () => row("shots/a.png").click());
    expect(onOpenFile).toHaveBeenLastCalledWith(
      `${cwd}/shots/a.png`,
      "unstaged",
    );
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
    expect(mocks.diffIndex).not.toHaveBeenCalled();
    expect(mocks.diffFiles).toHaveBeenCalledOnce();
    await visibility(true);
    expect(vi.getTimerCount()).toBe(0);
    await act(async () => {
      window.dispatchEvent(new Event("focus"));
      notifyGitChanged();
      await vi.advanceTimersByTimeAsync(6000);
    });
    expect(mocks.diffIndex).not.toHaveBeenCalled();
    await visibility(false);
    expect(mocks.diffIndex).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(1);
    await act(async () => root.render(null));
    expect(vi.getTimerCount()).toBe(0);
    await act(async () => {
      notifyGitChanged();
      window.dispatchEvent(new Event("focus"));
    });
    expect(mocks.diffIndex).toHaveBeenCalledOnce();
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
    stored.set("aven.changesStaging", "1");
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

describe("active window Git polling", () => {
  it("stops polling while unfocused and refreshes full status immediately on focus", async () => {
    await render();
    await act(async () => window.dispatchEvent(new Event("blur")));
    expect(vi.getTimerCount()).toBe(0);
    await act(async () => vi.advanceTimersByTimeAsync(60_000));
    expect(mocks.diffIndex).toHaveBeenCalledOnce();
    expect(mocks.diffFiles).not.toHaveBeenCalled();
    await act(async () => window.dispatchEvent(new Event("focus")));
    expect(mocks.diffIndex).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(1);
  });

  it("shows an agent's changes while on screen without focus", async () => {
    await render();
    expect(container.textContent).not.toContain("app.js");
    // Aven on a second screen while another app has focus.
    await act(async () => window.dispatchEvent(new Event("blur")));
    mocks.diffIndex.mockResolvedValue({
      ...index,
      files: [
        changed("app.js", false, true),
        changed("style.css", false, true),
      ],
      additions: 2,
    });
    // The agent's turn ended.
    await act(async () => notifyGitChanged(cwd));
    expect(mocks.diffIndex).toHaveBeenCalledTimes(2);
    expect(container.textContent).toContain("app.js");
    expect(container.textContent).toContain("style.css");
    // One read for the event; polling still waits for focus.
    expect(vi.getTimerCount()).toBe(0);
    await act(async () => vi.advanceTimersByTimeAsync(60_000));
    expect(mocks.diffIndex).toHaveBeenCalledTimes(2);
    expect(mocks.diffFiles).not.toHaveBeenCalled();
  });

  it("reads the folder again for Ship it while the window is out of focus", async () => {
    await render();
    await act(async () => window.dispatchEvent(new Event("blur")));
    mocks.diffIndex.mockResolvedValue({
      ...index,
      files: [changed("app.js", false, true)],
      additions: 1,
    });
    // Pressed in the floating panel's own window: this one stays unfocused.
    await act(async () => requestShip(cwd, "chat-1"));
    expect(mocks.diffIndex).toHaveBeenCalledTimes(2);
    const flow = container.querySelector('[aria-label="Ship it"]');
    expect(flow?.textContent).toContain("1 file");
    expect(flow?.textContent).not.toContain("Nothing to commit");
  });

  it("polls changed files cheaply while retaining sync metadata, spaces quiet checks out, then refreshes divergence", async () => {
    index.remote = "origin";
    index.upstream = "origin/feature";
    index.ahead = 2;
    await render();
    mocks.diffFiles.mockResolvedValue({
      ...index,
      remote: null,
      upstream: null,
      ahead: 0,
      files: [changed("changed.ts", false, true)],
      additions: 1,
    });
    await act(async () => vi.advanceTimersByTimeAsync(2000));
    expect(mocks.diffFiles).toHaveBeenCalledOnce();
    expect(mocks.diffIndex).toHaveBeenCalledOnce();
    expect(container.textContent).toContain("changed.ts");
    expect(container.textContent).toContain("↑2");
    // Nothing changes after that: checks at 4, 6, 9, 13.5, 19.5 and 25.5 s
    // (2 s, then 1.5x, at most 6 s), and the 31.5 s check is a full sync.
    await act(async () => vi.advanceTimersByTimeAsync(30_000));
    expect(mocks.diffIndex).toHaveBeenCalledTimes(2);
    expect(mocks.diffFiles).toHaveBeenCalledTimes(7);
    await act(async () => notifyGitChanged());
    expect(mocks.diffIndex).toHaveBeenCalledTimes(3);
  });

  it("refreshes sync metadata immediately after an external branch checkout", async () => {
    index.remote = "origin";
    index.upstream = "origin/feature";
    index.ahead = 2;
    await render();
    const next = {
      ...index,
      branch: "main",
      upstream: "origin/main",
      ahead: 0,
    };
    mocks.diffFiles.mockResolvedValue({
      ...next,
      remote: null,
      upstream: null,
    });
    mocks.diffIndex.mockResolvedValue(next);
    await act(async () => vi.advanceTimersByTimeAsync(2000));
    expect(mocks.diffFiles).toHaveBeenCalledOnce();
    expect(mocks.diffIndex).toHaveBeenCalledTimes(2);
    expect(container.textContent).toContain("main is clean and up to date");
    expect(container.textContent).not.toContain("↑2");
  });
});

describe("Ship it", () => {
  function shipButton() {
    return Array.from(container.querySelectorAll("button")).find(
      (candidate) => candidate.textContent?.trim() === "Ship it",
    );
  }

  it("sums up the changes and opens the flow", async () => {
    index.remote = "origin";
    index.upstream = "origin/feature";
    index.behind = 1;
    index.files = [
      { ...changed("a.ts", false, true), additions: 7, deletions: 2 },
      { ...changed("b.ts", false, true), additions: 0, deletions: 4 },
    ];
    await render();
    expect(container.textContent).toContain("2 files");
    expect(container.textContent).toContain("+7");
    expect(container.textContent).toContain("−6");
    // Each row shows its own lines and a bar sized against the largest file.
    const stats = container.querySelectorAll(".git-file-stats");
    expect(stats).toHaveLength(2);
    expect(stats[0].textContent).toBe("+7−2");
    // Create PR waits for the files; Ship it offers the pull request instead.
    expect(container.textContent).not.toContain("Create PR");
    // Ship it can't pull, so the incoming commit keeps its Sync button.
    expect(container.textContent).toContain("Sync Changes");
    await act(async () => shipButton()!.click());
    expect(container.querySelector('[aria-label="Ship it"]')).not.toBeNull();
    expect(container.textContent).toContain("No tests ran");
    expect(container.textContent).not.toContain("Sync Changes");
    await act(async () =>
      container
        .querySelector<HTMLButtonElement>('[aria-label="Close Ship it"]')!
        .click(),
    );
    expect(container.querySelector('[aria-label="Ship it"]')).toBeNull();
    expect(shipButton()).toBeDefined();
  });

  it("lets the history yield its room to the flow until it is opened again", async () => {
    index.files = [changed("a.ts", false, true)];
    await render();
    const graph = () =>
      mocks.graph.mock.lastCall?.[0] as {
        expanded: boolean;
        onToggleExpanded: () => void;
      };
    expect(graph().expanded).toBe(true);
    await act(async () => shipButton()!.click());
    expect(graph().expanded).toBe(false);
    await act(async () => graph().onToggleExpanded());
    expect(graph().expanded).toBe(true);
    expect(container.querySelector('[aria-label="Ship it"]')).not.toBeNull();
    await act(async () =>
      container
        .querySelector<HTMLButtonElement>('[aria-label="Close Ship it"]')!
        .click(),
    );
    expect(graph().expanded).toBe(true);
  });

  it("opens the flow for a request made for this folder elsewhere", async () => {
    index.files = [changed("a.ts", false, true)];
    requestShip("/somewhere-else", "s0");
    await render();
    expect(container.querySelector('[aria-label="Ship it"]')).toBeNull();
    takeShipRequest("/somewhere-else");
    await act(async () => requestShip(cwd, "s1"));
    expect(container.querySelector('[aria-label="Ship it"]')).not.toBeNull();
  });

  it("starts the flow afresh each time Ship it is pressed again", async () => {
    index.files = [changed("a.ts", false, true)];
    await render();
    await act(async () => requestShip(cwd, "s1"));
    const first = container.querySelector('[aria-label="Ship it"]');
    expect(first).not.toBeNull();
    // A later press, as after a finished ship whose "Shipped" card is still
    // shown, replaces that card with a new flow.
    await act(async () => {
      vi.advanceTimersByTime(1);
      requestShip(cwd, "s1");
    });
    const second = container.querySelector('[aria-label="Ship it"]');
    expect(second).not.toBeNull();
    expect(second).not.toBe(first);
  });
});

describe("clean copy", () => {
  it("shows the mascot state with the last commit and next steps", async () => {
    mocks.history.mockResolvedValue({
      head: "abc",
      commits: [
        {
          sha: "abc",
          shortSha: "abc",
          parents: [],
          author: "Jack",
          timestamp: Math.floor(Date.now() / 1000) - 120,
          subject: "Ship the redesign",
          refs: [],
          head: true,
        },
      ],
    });
    await render();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(container.textContent).toContain("All clean");
    expect(container.textContent).toContain("Ship the redesign");
    expect(container.textContent).toContain("2m ago");
    expect(container.textContent).toContain("History");
  });

  it("calls a folder without branch or commits a folder without Git", async () => {
    index.branch = null;
    await render();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(container.textContent).toContain("No Git here yet");
    expect(container.textContent).not.toContain("All clean");
  });
});

function textButton(text: string) {
  return Array.from(
    container.querySelectorAll<HTMLButtonElement>("button"),
  ).find((candidate) => candidate.textContent?.trim() === text);
}

function typeInto(field: HTMLTextAreaElement, value: string) {
  const setValue = Object.getOwnPropertyDescriptor(
    HTMLTextAreaElement.prototype,
    "value",
  )!.set!;
  setValue.call(field, value);
  field.dispatchEvent(new Event("input", { bubbles: true }));
}

/** The file list's section headers, by title. */
function sectionTitles() {
  return Array.from(
    container.querySelectorAll(".tracking-\\[0\\.04em\\]"),
    (title) => title.textContent,
  );
}

function row(relative: string) {
  return container.querySelector<HTMLButtonElement>(
    `button[title^="${relative}"]`,
  )!;
}

/** A row's button; with staging shown, from whichever section offers it. */
function rowAction(relative: string, title: string) {
  for (const found of container.querySelectorAll<HTMLButtonElement>(
    `button[title^="${relative}"]`,
  )) {
    const action = found
      .closest("li")!
      .querySelector<HTMLButtonElement>(`[title="${title}"]`);
    if (action) return action;
  }
  return null;
}

describe("Ship it as the one way to commit", () => {
  it("leaves no separate commit box or Commit menu beside it", async () => {
    index.files = [changed("a.ts", true, false), changed("b.ts", false, true)];
    await render();
    expect(textButton("Ship it")).toBeDefined();
    expect(container.querySelector("textarea")).toBeNull();
    expect(button("Generate commit message")).toBeNull();
    expect(button("Commit options")).toBeNull();
    expect(textButton("Commit")).toBeUndefined();
    expect(container.textContent).not.toContain("Commit & Push");
  });

  it("commits only, and keeps a message typed before it was closed", async () => {
    index.remote = "origin";
    index.upstream = "origin/feature";
    index.files = [changed("a.ts", false, true)];
    await render();
    const field = () =>
      container.querySelector<HTMLTextAreaElement>(
        '[aria-label="Commit message"]',
      )!;
    await act(async () => textButton("Ship it")!.click());
    await act(async () => typeInto(field(), "Fix the footer"));
    await act(async () => button("Close Ship it")!.click());
    await act(async () => textButton("Ship it")!.click());
    expect(field().value).toBe("Fix the footer");

    const commitOnly = Array.from(
      container.querySelectorAll<HTMLButtonElement>(
        '[aria-label="How far to ship"] [role="radio"]',
      ),
    ).find((radio) => radio.textContent === "Commit")!;
    await act(async () => commitOnly.click());
    expect(commitOnly.getAttribute("aria-checked")).toBe("true");
    await act(async () =>
      container.querySelector<HTMLButtonElement>(".ship-flow-primary")!.click(),
    );
    await act(async () => vi.advanceTimersByTimeAsync(0));
    expect(mocks.writes).toEqual(["git_stage_all", "git_commit"]);
    expect(container.textContent).toContain("Committed 1 file");
  });

  /** Ship it's choice of files, as "All 2" or "Staged 1". */
  function checkedScope() {
    return container.querySelector(
      '[aria-label="Files to ship"] [aria-checked="true"]',
    )?.textContent;
  }

  it("ships every file by default while staging is hidden, even with some staged", async () => {
    index.files = [changed("a.ts", true, false), changed("b.ts", false, true)];
    await render();
    await act(async () => textButton("Ship it")!.click());
    expect(checkedScope()).toBe("All 2");
    expect(container.querySelector(".ship-flow-count")?.textContent).toContain(
      "2 files",
    );
  });

  it("keeps a staged subset by default while staging is shown", async () => {
    stored.set("aven.changesStaging", "1");
    index.files = [changed("a.ts", true, false), changed("b.ts", false, true)];
    await render();
    await act(async () => textButton("Ship it")!.click());
    expect(checkedScope()).toBe("Staged 1");
    expect(container.querySelector(".ship-flow-count")?.textContent).toContain(
      "1 file",
    );
  });
});

describe("sync actions beside Ship it", () => {
  beforeEach(() => {
    index.remote = "origin";
    index.upstream = "origin/feature";
  });

  it("still pushes and publishes existing commits while files are uncommitted", async () => {
    index.ahead = 2;
    index.aheadOfDefault = 2;
    index.files = [changed("a.ts", false, true)];
    await render();
    expect(container.textContent).toContain("↑2");
    expect(container.textContent).toContain("Sync Changes");
    // The pull request waits for Ship it to commit the files.
    expect(container.textContent).not.toContain("Create PR");
    mocks.diffIndex.mockResolvedValue({ ...index, upstream: null, ahead: 0 });
    await act(async () => notifyGitChanged(cwd));
    expect(container.textContent).toContain("Not on origin yet");
    expect(container.textContent).toContain("Publish Branch");
  });

  it("keeps publishing, syncing and opening a PR for a clean branch", async () => {
    index.ahead = 2;
    index.aheadOfDefault = 2;
    await render();
    expect(container.textContent).toContain("Sync Changes");
    expect(container.textContent).toContain("Create PR");
    mocks.diffIndex.mockResolvedValue({ ...index, upstream: null });
    await act(async () => notifyGitChanged(cwd));
    expect(container.textContent).toContain("Publish Branch");
  });
});

describe("one list of changes", () => {
  it("lists every changed file once by default, without staging buttons", async () => {
    index.files = [
      changed("a.ts", true, false),
      changed("b.ts", false, true),
      changed("c.ts", true, true),
    ];
    await render();
    expect(sectionTitles()).toEqual(["Changes"]);
    expect(container.querySelectorAll("li")).toHaveLength(3);
    expect(container.querySelector('[title="Stage All Changes"]')).toBeNull();
    expect(container.querySelector('[title="Stage Changes"]')).toBeNull();
    expect(container.querySelector('[title="Unstage Changes"]')).toBeNull();
    expect(rowAction("b.ts", "Discard Changes")).not.toBeNull();
    expect(
      container.querySelector('[title="Discard All Changes"]'),
    ).not.toBeNull();
  });

  it("marks staged files quietly so nothing staged is hidden", async () => {
    index.files = [
      changed("a.ts", true, false),
      changed("b.ts", false, true),
      changed("c.ts", true, true),
    ];
    await render();
    expect(row("a.ts").title).toBe("a.ts (staged)");
    expect(row("b.ts").title).toBe("b.ts");
    expect(row("c.ts").title).toBe("c.ts (partly staged)");
    const marked = (relative: string) =>
      row(relative).closest("li")!.querySelector("[data-staged-mark]");
    expect(marked("a.ts")).not.toBeNull();
    expect(marked("b.ts")).toBeNull();
    expect(marked("c.ts")).not.toBeNull();
  });

  it("opens the newest edits, or the staged change when that is all there is", async () => {
    index.files = [changed("a.ts", true, false), changed("b.ts", true, true)];
    const onOpenFile = vi.fn();
    await act(async () =>
      root.render(
        createElement(GitChangesPanel, {
          cwd,
          enabled: true,
          onOpenFile,
          onOpenAllChanges: vi.fn(),
          onOpenCommit: vi.fn(),
          selectedPath: "a.ts",
          selectedKind: "staged",
        }),
      ),
    );
    await act(async () => row("a.ts").click());
    await act(async () => row("b.ts").click());
    expect(onOpenFile.mock.calls).toEqual([
      [`${cwd}/a.ts`, "staged"],
      [`${cwd}/b.ts`, "unstaged"],
    ]);
    // The open file's row stays selected whichever side it shows.
    expect(row("a.ts").closest("div")!.className).toContain("bg-content/10");
  });

  it("brings back Staged and Changes with a toggle it remembers", async () => {
    index.files = [changed("a.ts", true, false), changed("b.ts", false, true)];
    await render();
    const toggle = button("Show staging")!;
    expect(toggle.getAttribute("aria-pressed")).toBe("false");
    await act(async () => toggle.click());
    expect(sectionTitles()).toEqual(["Staged", "Changes"]);
    expect(button("Hide staging")?.getAttribute("aria-pressed")).toBe("true");
    expect(rowAction("a.ts", "Unstage Changes")).not.toBeNull();
    expect(rowAction("b.ts", "Stage Changes")).not.toBeNull();
    expect(
      container.querySelector('[title="Stage All Changes"]'),
    ).not.toBeNull();
    expect(container.querySelector("[data-staged-mark]")).toBeNull();
    expect(stored.get("aven.changesStaging")).toBe("1");

    // Opened again later, the panel keeps the split.
    await act(async () => root.unmount());
    root = createRoot(container);
    await render();
    expect(sectionTitles()).toEqual(["Staged", "Changes"]);
    await act(async () => button("Hide staging")!.click());
    expect(sectionTitles()).toEqual(["Changes"]);
    expect(stored.get("aven.changesStaging")).toBe("0");
  });

  it("discards a file back to its last commit, staged changes too, after asking", async () => {
    index.files = [
      { ...changed("both.ts", true, true) },
      { ...changed("new.ts", true, false), status: "added" },
      changed("edit.ts", false, true),
    ];
    await render();
    mocks.ask.mockResolvedValueOnce(false);
    await act(async () => rowAction("both.ts", "Discard Changes")!.click());
    expect(mocks.ask).toHaveBeenLastCalledWith(
      "Discard all changes in both.ts, including staged changes? This cannot be undone.",
      expect.objectContaining({ okLabel: "Discard" }),
    );
    expect(mocks.writes).toEqual([]);

    mocks.ask.mockResolvedValueOnce(true);
    await act(async () => rowAction("both.ts", "Discard Changes")!.click());
    expect(mocks.writes).toEqual([
      "git_unstage_file both.ts",
      "git_discard_file both.ts",
    ]);

    mocks.writes.length = 0;
    mocks.ask.mockResolvedValueOnce(true);
    await act(async () => rowAction("new.ts", "Discard Changes")!.click());
    expect(mocks.ask).toHaveBeenLastCalledWith(
      "Delete new file new.ts? This cannot be undone.",
      expect.objectContaining({ okLabel: "Delete" }),
    );
    expect(mocks.writes).toEqual([
      "git_unstage_file new.ts",
      "git_discard_file new.ts",
    ]);

    mocks.writes.length = 0;
    mocks.ask.mockResolvedValueOnce(true);
    await act(async () => rowAction("edit.ts", "Discard Changes")!.click());
    expect(mocks.ask).toHaveBeenLastCalledWith(
      "Discard changes in edit.ts? This cannot be undone.",
      expect.objectContaining({ okLabel: "Discard" }),
    );
    // Unstaged anyway, in case something was staged since the list loaded.
    expect(mocks.writes).toEqual([
      "git_unstage_file edit.ts",
      "git_discard_file edit.ts",
    ]);
  });

  it("discards every file from the header, staged ones too, after asking", async () => {
    index.files = [changed("a.ts", true, false), changed("b.ts", false, true)];
    await render();
    const discardAll = container.querySelector<HTMLButtonElement>(
      '[title="Discard All Changes"]',
    )!;
    mocks.ask.mockResolvedValueOnce(true);
    await act(async () => discardAll.click());
    expect(mocks.ask).toHaveBeenLastCalledWith(
      "Discard all changes in 2 files, including staged changes? This cannot be undone.",
      expect.objectContaining({ okLabel: "Discard" }),
    );
    expect(mocks.writes).toEqual(["git_unstage_all", "git_discard_all"]);
  });

  it("unstages before discarding every file even when none looked staged", async () => {
    index.files = [changed("a.ts", false, true), changed("b.ts", false, true)];
    await render();
    mocks.ask.mockResolvedValueOnce(true);
    await act(async () =>
      container
        .querySelector<HTMLButtonElement>('[title="Discard All Changes"]')!
        .click(),
    );
    expect(mocks.writes).toEqual(["git_unstage_all", "git_discard_all"]);
  });

  it("keeps staged changes when discarding from the Changes section", async () => {
    stored.set("aven.changesStaging", "1");
    index.files = [changed("a.ts", true, true), changed("b.ts", false, true)];
    await render();
    mocks.ask.mockResolvedValueOnce(true);
    await act(async () => rowAction("a.ts", "Discard Changes")!.click());
    expect(mocks.ask).toHaveBeenLastCalledWith(
      "Discard changes in a.ts? This cannot be undone.",
      expect.objectContaining({ okLabel: "Discard" }),
    );
    expect(mocks.writes).toEqual(["git_discard_file a.ts"]);
    mocks.writes.length = 0;
    mocks.ask.mockResolvedValueOnce(true);
    await act(async () =>
      container
        .querySelector<HTMLButtonElement>('[title="Discard All Changes"]')!
        .click(),
    );
    expect(mocks.ask).toHaveBeenLastCalledWith(
      "Discard all unstaged changes in 2 files? This cannot be undone.",
      expect.objectContaining({ okLabel: "Discard" }),
    );
    expect(mocks.writes).toEqual(["git_discard_all"]);
  });
});

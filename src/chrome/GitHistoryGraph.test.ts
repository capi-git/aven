// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  GitHistoryGraph,
  HISTORY_ROW_PX,
  historyGraphExtensions,
} from "./GitHistoryGraph";
import { historyItemGraph, layoutGitGraph } from "../lib/gitGraph";
import {
  notifyGitChanged,
  type GitHistory,
  type GitHistoryCommit,
} from "../lib/fs";

const mocks = vi.hoisted(() => ({ history: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (command: string, args: { cwd: string }) => {
    if (command === "git_history") return mocks.history(args.cwd);
    throw new Error(`Unexpected native command: ${command}`);
  },
}));

let root: Root;
let container: HTMLDivElement;
let cwd: string;
let sequence = 0;

function history(subject: string): GitHistory {
  const commit: GitHistoryCommit = {
    sha: subject,
    shortSha: subject,
    parents: [],
    author: "Test",
    timestamp: 1,
    subject,
    refs: [],
    head: true,
  };
  return { head: commit.sha, commits: [commit] };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.spyOn(document, "hidden", "get").mockReturnValue(false);
  cwd = `/history-retained-${++sequence}`;
  mocks.history.mockResolvedValue(history("Original commit"));
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function render(enabled = true, branch?: string | null) {
  await act(async () =>
    root.render(
      createElement(GitHistoryGraph, {
        cwd,
        enabled,
        expanded: true,
        branch,
        onToggleExpanded: vi.fn(),
        onOpenCommit: vi.fn(),
      }),
    ),
  );
}

describe("retained Git history lifecycle", () => {
  it("keeps the author in the tooltip without repeating a single author in every row", async () => {
    const first = history("First commit").commits[0]!;
    mocks.history.mockResolvedValue({
      head: first.sha,
      commits: [
        first,
        { ...first, sha: "second", subject: "Second commit", head: false },
      ],
    });
    await render();
    const rows = Array.from(
      container.querySelectorAll<HTMLButtonElement>(".git-history-item"),
    );
    expect(rows).toHaveLength(2);
    expect(rows.every((row) => row.title.includes("Test"))).toBe(true);
    expect(rows.every((row) => !row.textContent?.includes("Test"))).toBe(true);
  });

  it("shows authors when history contains several contributors, including refreshed authors", async () => {
    const first = history("First commit").commits[0]!;
    const second = {
      ...first,
      sha: "second",
      subject: "Second commit",
      head: false,
    };
    mocks.history.mockResolvedValue({
      head: first.sha,
      commits: [first, second],
    });
    await render();
    mocks.history.mockResolvedValue({
      head: first.sha,
      commits: [first, { ...second, author: "Other" }],
    });
    await act(async () => notifyGitChanged());
    expect(container.textContent).toContain("Test");
    expect(container.textContent).toContain("Other");
  });

  it("keeps warm rows and scroll while hidden without starting background reads", async () => {
    await render();
    const row = container.querySelector(".git-history-item");
    const scroll = container.querySelector<HTMLElement>(".overflow-y-auto")!;
    scroll.scrollTop = 70;
    await render(false);
    await act(async () => {
      window.dispatchEvent(new Event("focus"));
      document.dispatchEvent(new Event("visibilitychange"));
      notifyGitChanged();
    });
    expect(mocks.history).toHaveBeenCalledOnce();
    expect(container.querySelector(".git-history-item")).toBe(row);
    expect(scroll.scrollTop).toBe(70);
    await render(true);
    expect(mocks.history).toHaveBeenCalledTimes(2);
    expect(container.querySelector(".git-history-item")).toBe(row);
    expect(scroll.scrollTop).toBe(70);
  });

  it("ignores a previous visibility generation after hiding and reopening", async () => {
    await render();
    let finish!: (value: GitHistory) => void;
    mocks.history.mockImplementationOnce(
      () =>
        new Promise<GitHistory>((resolve) => {
          finish = resolve;
        }),
    );
    await act(async () => notifyGitChanged());
    await render(false);
    mocks.history.mockResolvedValue(history("Current commit"));
    await render(true);
    await act(async () => finish(history("Stale commit")));
    expect(container.textContent).toContain("Current commit");
    expect(container.textContent).not.toContain("Stale commit");
  });

  it("does not publish old-project history into a new project", async () => {
    let finish!: (value: GitHistory) => void;
    mocks.history.mockImplementationOnce(
      () =>
        new Promise<GitHistory>((resolve) => {
          finish = resolve;
        }),
    );
    await render();
    cwd = `${cwd}-other`;
    mocks.history.mockResolvedValue(history("Other project"));
    await render();
    await act(async () => finish(history("Old project")));
    expect(container.textContent).toContain("Other project");
    expect(container.textContent).not.toContain("Old project");
  });
});

describe("history rows", () => {
  it("shows the message, then refs, short sha and age", async () => {
    const commit: GitHistoryCommit = {
      sha: "f".repeat(40),
      shortSha: "fffffff",
      parents: [],
      author: "Test",
      timestamp: Math.floor(Date.now() / 1000) - 3 * 3600,
      subject: "Add the ship flow",
      refs: [
        { name: "main", kind: "local" },
        { name: "origin/main", kind: "remote" },
        { name: "v1.0.0", kind: "tag" },
      ],
      head: true,
    };
    mocks.history.mockResolvedValue({ head: commit.sha, commits: [commit] });
    await render();
    const row = container.querySelector(".git-history-item")!;
    expect(row.querySelector(".git-history-subject")?.textContent).toBe(
      "Add the ship flow",
    );
    expect(row.querySelector(".git-history-sha")?.textContent).toBe("fffffff");
    expect(row.querySelector(".git-history-age")?.textContent).toBe("3h ago");
    // Two chips, then a count for the rest.
    expect(row.querySelectorAll(".git-history-ref")).toHaveLength(2);
    expect(row.querySelector(".git-history-more")?.textContent).toBe("+1");
    expect(container.textContent).toContain("History");
  });

  it("explains an empty history in plain words", async () => {
    let finish!: (value: GitHistory) => void;
    mocks.history.mockImplementationOnce(
      () =>
        new Promise<GitHistory>((resolve) => {
          finish = resolve;
        }),
    );
    await render(true, "main");
    expect(container.textContent).toContain("Loading history");
    await act(async () => finish({ head: null, commits: [] }));
    expect(container.textContent).toContain("No commits yet");
    expect(container.textContent).toContain("Your first commit on main");
    await render(true, null);
    expect(container.textContent).toContain("Not a Git repository");
  });

  it("carries lanes through the taller row and centres the node", () => {
    const rows = layoutGitGraph([
      { sha: "c", parents: ["b"], head: true },
      { sha: "b", parents: ["a"] },
      { sha: "a", parents: [] },
    ]);
    const middle = rows[1]!;
    const graph = historyItemGraph(middle);
    const { offset, paths } = historyGraphExtensions(
      graph,
      middle,
      HISTORY_ROW_PX,
    );
    expect(offset).toBe((HISTORY_ROW_PX - graph.height) / 2);
    expect(paths.map((path) => path.d)).toEqual([
      `M 11 0 V ${offset}`,
      `M 11 ${offset + graph.height} V ${HISTORY_ROW_PX}`,
    ]);
    // The root commit has nothing below it.
    const last = rows[2]!;
    expect(
      historyGraphExtensions(historyItemGraph(last), last, HISTORY_ROW_PX)
        .paths,
    ).toHaveLength(1);
  });
});

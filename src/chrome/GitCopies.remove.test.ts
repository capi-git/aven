// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { invoke } from "@tauri-apps/api/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createLiveSessionStore,
  LiveSessionsContext,
} from "../lib/liveSessions";
import { newSession } from "../lib/session";
import { subscribeOpenChatRequests } from "../lib/shipRequest";
import { GitCopies } from "./GitCopies";
import type { GitWorktree } from "../lib/fs";

const file = {
  path: "/copies/a.ts",
  relative: "a.ts",
  status: "modified",
  additions: 1,
  deletions: 0,
  staged: false,
  unstaged: true,
};

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

const finished = {
  path: "/copies/done",
  branch: "feat/done",
  current: false,
  primary: false,
  files: [],
  additions: 0,
  deletions: 0,
  aheadOfDefault: 0,
  behindDefault: 0,
  mergedIntoDefault: true,
};

describe("other copy status and removal", () => {
  let container: HTMLDivElement;
  let root: Root;
  let worktrees: (typeof finished)[];

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    // Most tests look at the open section; one checks the folded default.
    const values = new Map<string, string>([["aven.parallelWorkOpen", "1"]]);
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
    });
    worktrees = [
      {
        ...finished,
        path: "/repo",
        branch: "main",
        primary: true,
        current: true,
      },
      finished,
    ];
    vi.mocked(invoke).mockImplementation(async (command) => {
      if (command === "git_worktrees") return worktrees;
      if (command === "git_worktree_remove") {
        worktrees = worktrees.filter((item) => item.path !== finished.path);
        return undefined;
      }
      throw new Error(`unexpected ${command}`);
    });
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  const button = (label: string) =>
    [...container.querySelectorAll("button")].find((item) =>
      item.textContent?.includes(label),
    );

  it("does not call different commit history unmerged work", async () => {
    worktrees[1] = {
      ...finished,
      aheadOfDefault: 2,
      behindDefault: 20,
      mergedIntoDefault: false,
    };
    await act(async () =>
      root.render(createElement(GitCopies, { cwd: "/repo", enabled: true })),
    );
    const row = button("Done")!;
    expect(row.querySelector(".git-copy-short")?.textContent).toBe(
      "2 to merge",
    );
    // The full line is in the row's tooltip, with the counts, and in the
    // row when opened.
    expect(row.title).toContain(
      "Has work not in main yet · main has newer work",
    );
    expect(row.title).toContain(
      "2 commits not in main yet. main has 20 newer commits.",
    );
    await act(async () => row.click());
    const status = container.querySelector<HTMLElement>(".git-copy-status")!;
    expect(status.textContent).toBe(
      "Has work not in main yet · main has newer work",
    );
    expect(status.title).toContain("may already be in main");
    expect(container.querySelector(".git-copies-count")?.textContent).toBe(
      "· 1",
    );
    expect(container.textContent).toContain("Parallel work");
    expect(container.textContent).not.toContain("Merged");
  });

  it("starts folded to one line, remembers when it is opened, and explains itself on the first open", async () => {
    localStorage.removeItem("aven.parallelWorkOpen");
    worktrees[1] = { ...finished, aheadOfDefault: 1, mergedIntoDefault: false };
    const sessions = createLiveSessionStore([
      { ...newSession("claude", "/copies/done"), busy: true },
    ]);
    const render = () =>
      act(async () =>
        root.render(
          createElement(
            LiveSessionsContext.Provider,
            { value: sessions },
            createElement(GitCopies, { cwd: "/repo", enabled: true }),
          ),
        ),
      );
    await render();
    const toggle = button("Parallel work")!;
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(toggle.textContent).toContain("· 1");
    // A moving mark for each copy whose agent is working.
    expect(
      container.querySelectorAll(".git-copies-working .project-mark"),
    ).toHaveLength(1);
    expect(container.querySelector(".git-copy-line")).toBeNull();
    expect(container.querySelector(".git-copies-explainer")).toBeNull();
    await act(async () => toggle.click());
    expect(localStorage.getItem("aven.parallelWorkOpen")).toBe("1");
    expect(container.querySelector(".git-copies-explainer")?.textContent).toBe(
      "Separate copies of this project, so agents can work without touching your main folder.",
    );
    await act(async () => root.render(null));
    await render();
    expect(button("Parallel work")!.getAttribute("aria-expanded")).toBe("true");
    expect(container.querySelector(".git-copies-explainer")).toBeNull();
    await act(async () => button("Parallel work")!.click());
    expect(localStorage.getItem("aven.parallelWorkOpen")).toBeNull();
  });

  it("shows the chat working in a copy and opens it", async () => {
    worktrees[1] = { ...finished, aheadOfDefault: 1, mergedIntoDefault: false };
    const working = {
      ...newSession("claude", "/copies/done"),
      id: "chat-1",
      title: "Mascot briefing",
      busy: true,
    };
    const opened = vi.fn();
    const stop = subscribeOpenChatRequests(opened);
    await act(async () =>
      root.render(
        createElement(
          LiveSessionsContext.Provider,
          { value: createLiveSessionStore([working]) },
          createElement(GitCopies, { cwd: "/repo", enabled: true }),
        ),
      ),
    );
    // Folded or open, the header shows the working agent.
    expect(
      container.querySelector(
        '.git-copies-working[aria-label="1 agent working"]',
      ),
    ).not.toBeNull();
    expect(
      container.querySelector('.git-copy-dot[aria-label="Agent working"]'),
    ).not.toBeNull();
    expect(button("Done")!.title).toContain("Mascot briefing · agent working");
    await act(async () => button("Done")!.click());
    expect(container.querySelector(".git-copy-chat")?.textContent).toBe(
      "Mascot briefing · agent working",
    );
    await act(async () => button("Open chat")!.click());
    stop();
    expect(opened).toHaveBeenCalledWith("chat-1");
    // A copy with commits main lacks can be shipped from here.
    expect(button("Ship it")).toBeDefined();
  });

  it.each([
    { behindDefault: 0, label: "Up to date with main" },
    { behindDefault: 3, label: "main has newer work" },
  ])("reports the main folder as $label", async ({ behindDefault, label }) => {
    worktrees = [
      {
        ...finished,
        path: "/repo",
        branch: "main",
        primary: true,
        behindDefault,
      },
      { ...finished, current: true },
    ];
    await act(async () =>
      root.render(
        createElement(GitCopies, { cwd: "/copies/done", enabled: true }),
      ),
    );
    expect(button("Main folder")?.title).toContain(label);
    await act(async () => button("Main folder")!.click());
    expect(container.querySelector(".git-copy-status")?.textContent).toBe(
      label,
    );
  });

  it("asks first, then removes the copy and refreshes the list", async () => {
    await act(async () =>
      root.render(createElement(GitCopies, { cwd: "/repo", enabled: true })),
    );
    await act(async () => button("merged into main")!.click());
    await act(async () => button("Done")!.click());
    await act(async () => button("Remove")!.click());
    expect(container.textContent).toContain(
      "The folder will be deleted. Copies with ignored files must be backed up and cleared first.",
    );
    expect(invoke).not.toHaveBeenCalledWith(
      "git_worktree_remove",
      expect.anything(),
    );

    await act(async () => button("Cancel")!.click());
    expect(button("Remove copy")).toBeUndefined();

    await act(async () => button("Remove")!.click());
    await act(async () => button("Remove copy")!.click());
    expect(invoke).toHaveBeenCalledWith("git_worktree_remove", {
      cwd: "/repo",
      path: "/copies/done",
    });
    expect(container.querySelector(".git-copies")).toBeNull();
  });

  it("keeps the copy and shows why when removal fails", async () => {
    vi.mocked(invoke).mockImplementation(async (command) => {
      if (command === "git_worktrees") return worktrees;
      throw new Error("The copy that's open here can't be removed.");
    });
    await act(async () =>
      root.render(createElement(GitCopies, { cwd: "/repo", enabled: true })),
    );
    await act(async () => button("merged into main")!.click());
    await act(async () => button("Done")!.click());
    await act(async () => button("Remove")!.click());
    await act(async () => button("Remove copy")!.click());
    expect(container.querySelector('[role="alert"]')?.textContent).toBe(
      "The copy that's open here can't be removed.",
    );
    expect(button("Done")).toBeDefined();
  });

  it("never offers to remove or ship a clean main folder", async () => {
    worktrees = [
      { ...finished, path: "/repo", branch: "main", primary: true },
      { ...finished, current: true },
    ];
    await act(async () =>
      root.render(
        createElement(GitCopies, { cwd: "/copies/done", enabled: true }),
      ),
    );
    await act(async () => button("Main folder")!.click());
    expect(button("Show in Finder")).toBeDefined();
    expect(button("Remove")).toBeUndefined();
    expect(button("Ship it")).toBeUndefined();
  });
  it("tucks merged copies, squash-merged ones included, into one quiet row", async () => {
    worktrees = [
      worktrees[0],
      {
        ...finished,
        path: "/copies/next",
        branch: "feat/next",
        aheadOfDefault: 2,
        mergedIntoDefault: false,
      },
      {
        ...finished,
        path: "/copies/squashed",
        branch: "feat/squashed",
        aheadOfDefault: 3,
        behindDefault: 40,
      },
      finished,
    ];
    await act(async () =>
      root.render(createElement(GitCopies, { cwd: "/repo", enabled: true })),
    );
    expect(container.querySelector(".git-copies-count")?.textContent).toBe(
      "· 1",
    );
    const row = button("merged into main")!;
    expect(row.textContent).toBe("2 merged into main");
    expect(row.getAttribute("aria-expanded")).toBe("false");
    expect(button("Next")).toBeDefined();
    expect(button("Squashed")).toBeUndefined();
    expect(button("Done")).toBeUndefined();

    await act(async () => row.click());
    expect(row.getAttribute("aria-expanded")).toBe("true");
    expect(button("Squashed")?.textContent).toBe("SquashedMerged");
    expect(button("Done")?.textContent).toBe("DoneMerged");
    expect(button("Next")?.textContent).toBe("Next2 to merge");
  });

  it("cleans up finished copies after naming them, skipping one in use", async () => {
    const race = {
      id: "race-1",
      project: "/repo",
      root: "/repo",
      base: "abc",
      prompt: "Try designs",
      createdAt: 1,
      uncommitted: false,
      untracked: false,
      state: "kept",
      lanes: [
        {
          sessionId: "s0",
          harness: "claude",
          model: "opus",
          label: "Claude Code",
          path: "/races/race-1/0",
          branch: "aven/race/race-1-0",
        },
      ],
    };
    vi.stubGlobal("localStorage", {
      getItem: (key: string) =>
        key === "aven.parallelWorkOpen" ? "1" : JSON.stringify([race]),
      setItem: vi.fn(),
    });
    const at = (name: string, extra: Partial<typeof finished> = {}) => ({
      ...finished,
      path: `/copies/${name}`,
      branch: `feat/${name}`,
      ...extra,
    });
    worktrees = [
      worktrees[0],
      at("alpha"),
      at("beta", { aheadOfDefault: 3 }),
      at("gamma"),
      at("delta"),
      { ...finished, path: "/races/race-1/0", branch: "aven/race/race-1-0" },
    ];
    vi.mocked(invoke).mockImplementation(async (command, args) => {
      const { path, lanes } = (args ?? {}) as {
        path?: string;
        lanes?: { path: string }[];
      };
      if (command === "git_worktrees") return worktrees;
      if (command === "git_worktree_remove") {
        if (path === "/copies/delta")
          throw new Error("This copy contains ignored files or folders.");
        worktrees = worktrees.filter((item) => item.path !== path);
        return undefined;
      }
      if (command === "race_cleanup") {
        worktrees = worktrees.filter(
          (item) => !lanes!.some((lane) => lane.path === item.path),
        );
        return undefined;
      }
      throw new Error(`unexpected ${command}`);
    });
    const sessions = createLiveSessionStore([
      { ...newSession("claude", "/copies/gamma"), busy: true },
    ]);
    await act(async () =>
      root.render(
        createElement(
          LiveSessionsContext.Provider,
          { value: sessions },
          createElement(GitCopies, { cwd: "/repo", enabled: true }),
        ),
      ),
    );
    // Nothing in progress: the header counts the merged copies instead.
    expect(container.querySelector(".git-copies-count")?.textContent).toBe(
      "· 5 merged",
    );
    expect(button("5 merged into main")).toBeDefined();

    await act(async () => button("Clean up")!.click());
    const confirm = container.querySelector(
      '[aria-label="Clean up finished copies?"]',
    )!;
    expect(confirm.textContent).toContain(
      "Remove 4 finished copies: Beta, Alpha, Delta and Try designs?",
    );
    expect(confirm.textContent).toContain(
      "Keeping Gamma (an agent is using it).",
    );
    await act(async () => button("Cancel")!.click());
    expect(button("Remove 4 copies")).toBeUndefined();
    expect(invoke).not.toHaveBeenCalledWith(
      "git_worktree_remove",
      expect.anything(),
    );

    await act(async () => button("Clean up")!.click());
    const listed = vi.mocked(invoke).mock.calls.length;
    await act(async () => button("Remove 4 copies")!.click());
    const removals = vi
      .mocked(invoke)
      .mock.calls.slice(listed)
      .filter(
        ([command]) =>
          command !== "git_worktrees" && command !== "session_list_by_project",
      );
    expect(removals).toEqual([
      ["git_worktree_remove", { cwd: "/repo", path: "/copies/beta" }],
      ["git_worktree_remove", { cwd: "/repo", path: "/copies/alpha" }],
      ["git_worktree_remove", { cwd: "/repo", path: "/copies/delta" }],
      ["race_cleanup", { root: "/repo", lanes: [race.lanes[0]] }],
    ]);
    expect(container.querySelector('[role="status"]')?.textContent).toBe(
      "Removed 3 copies.",
    );
    expect(container.querySelector('[role="alert"]')?.textContent).toBe(
      "Delta: This copy contains ignored files or folders.",
    );
    // The list was read again after the removals.
    expect(
      vi
        .mocked(invoke)
        .mock.calls.slice(listed)
        .filter(([command]) => command === "git_worktrees").length,
    ).toBeGreaterThanOrEqual(2);
    expect(button("2 merged into main")).toBeDefined();
    await act(async () => button("merged into main")!.click());
    expect(button("Gamma")).toBeDefined();
    expect(button("Delta")).toBeDefined();
    expect(button("Alpha")).toBeUndefined();
  });

  it("says so when every finished copy has to stay", async () => {
    const sessions = createLiveSessionStore([
      { ...newSession("claude", "/copies/done"), busy: true },
    ]);
    await act(async () =>
      root.render(
        createElement(
          LiveSessionsContext.Provider,
          { value: sessions },
          createElement(GitCopies, { cwd: "/repo", enabled: true }),
        ),
      ),
    );
    await act(async () => button("Clean up")!.click());
    expect(container.textContent).toContain(
      "Nothing can be cleaned up right now.",
    );
    expect(container.textContent).toContain(
      "Keeping Done (an agent is using it).",
    );
    await act(async () => button("Close")!.click());
    expect(button("Clean up")).toBeDefined();
    expect(invoke).not.toHaveBeenCalledWith(
      "git_worktree_remove",
      expect.anything(),
    );
  });
});

describe("parallel work rows", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    const values = new Map<string, string>([["aven.parallelWorkOpen", "1"]]);
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
    });
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("shows three rows, working agents first, then reveals the rest", async () => {
    const at = (name: string, extra: Partial<GitWorktree> = {}) => ({
      ...finished,
      path: `/copies/${name}`,
      branch: `feat/${name}`,
      mergedIntoDefault: false,
      ...extra,
    });
    vi.mocked(invoke).mockImplementation(async (command) => {
      if (command === "git_worktrees")
        return [
          {
            ...finished,
            path: "/repo",
            branch: "main",
            primary: true,
            current: true,
          },
          at("alpha", { files: [{ ...file, relative: "a.ts" }] }),
          at("beta", { aheadOfDefault: 78 }),
          at("gamma", {
            aheadOfDefault: 2,
            files: [{ ...file, relative: "g.ts" }],
          }),
          at("delta", { aheadOfDefault: 1 }),
          at("epsilon"),
        ];
      if (command === "session_list_by_project") return [];
      throw new Error(`unexpected ${command}`);
    });
    const sessions = createLiveSessionStore([
      { ...newSession("claude", "/copies/gamma"), busy: true },
    ]);
    await act(async () =>
      root.render(
        createElement(
          LiveSessionsContext.Provider,
          { value: sessions },
          createElement(GitCopies, { cwd: "/repo", enabled: true }),
        ),
      ),
    );
    const rows = () =>
      [...container.querySelectorAll(".git-copy-line")].map((row) => [
        row.querySelector(".git-copy-name")?.textContent,
        row.querySelector(".git-copy-short")?.textContent,
        [...row.querySelectorAll(".git-copy-dot")]
          .map((dot) => dot.getAttribute("data-dot"))
          .join(" "),
      ]);
    expect(rows()).toEqual([
      ["Gamma", "1 file changed · 2 to merge", "working uncommitted"],
      ["Alpha", "1 file changed", "uncommitted"],
      ["Beta", "78 to merge", ""],
    ]);
    const more = [...container.querySelectorAll("button")].find(
      (item) => item.textContent === "+2 more",
    )!;
    await act(async () => more.click());
    expect(rows().map(([name]) => name)).toEqual([
      "Gamma",
      "Alpha",
      "Beta",
      "Delta",
      "Epsilon",
    ]);
  });
});

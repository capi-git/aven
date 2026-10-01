// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { invoke } from "@tauri-apps/api/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GitCopies } from "./GitCopies";

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
};

describe("other copy status and removal", () => {
  let container: HTMLDivElement;
  let root: Root;
  let worktrees: (typeof finished)[];

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
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
    worktrees[1] = { ...finished, aheadOfDefault: 2, behindDefault: 20 };
    await act(async () =>
      root.render(createElement(GitCopies, { cwd: "/repo", enabled: true })),
    );
    const pill = container.querySelector<HTMLElement>(".git-copy-pill")!;
    expect(pill.textContent).toBe("2 commits");
    expect(pill.title).toContain("Changes may already be merged");
    expect(container.querySelector(".git-copies-title span")?.textContent).toBe(
      "1 copy",
    );
    expect(container.textContent).not.toContain("to merge");
    expect(container.textContent).not.toContain("with work");
  });

  it("does not call the up-to-date main copy zero commits to merge", async () => {
    worktrees = [
      { ...finished, path: "/repo", branch: "main", primary: true },
      { ...finished, current: true },
    ];
    await act(async () =>
      root.render(
        createElement(GitCopies, { cwd: "/copies/done", enabled: true }),
      ),
    );
    expect(container.querySelector(".git-copy-pill")?.textContent).toBe(
      "Up to date",
    );
  });

  it("asks first, then removes the copy and refreshes the list", async () => {
    await act(async () =>
      root.render(createElement(GitCopies, { cwd: "/repo", enabled: true })),
    );
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
    await act(async () => button("Done")!.click());
    await act(async () => button("Remove")!.click());
    await act(async () => button("Remove copy")!.click());
    expect(container.querySelector('[role="alert"]')?.textContent).toBe(
      "The copy that's open here can't be removed.",
    );
    expect(button("Done")).toBeDefined();
  });

  it("never offers to remove the main copy", async () => {
    worktrees = [
      { ...finished, path: "/repo", branch: "main", primary: true },
      { ...finished, current: true },
    ];
    await act(async () =>
      root.render(
        createElement(GitCopies, { cwd: "/copies/done", enabled: true }),
      ),
    );
    await act(async () => button("Main copy")!.click());
    expect(button("Show in Finder")).toBeDefined();
    expect(button("Remove")).toBeUndefined();
  });
});

// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GitHistoryGraph } from "./GitHistoryGraph";
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

async function render(enabled = true) {
  await act(async () =>
    root.render(
      createElement(GitHistoryGraph, {
        cwd,
        enabled,
        expanded: true,
        onToggleExpanded: vi.fn(),
        onOpenCommit: vi.fn(),
      }),
    ),
  );
}

describe("retained Git history lifecycle", () => {
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

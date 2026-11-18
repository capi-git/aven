// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GitDiffIndex, GitPr } from "../lib/fs";
import { MergePath } from "./MergePath";

const mocks = vi.hoisted(() => ({
  ask: vi.fn(),
  squashMerge: vi.fn(),
  refresh: vi.fn(),
  state: { index: null as GitDiffIndex | null, pr: null as GitPr | null },
}));

vi.mock("@tauri-apps/plugin-dialog", () => ({ ask: mocks.ask }));
vi.mock("../lib/gitHousekeeping", () => ({
  gitPrSquashMerge: mocks.squashMerge,
}));
vi.mock("../hooks/useMergePath", () => ({
  useMergePath: () => ({
    index: mocks.state.index,
    pr: mocks.state.pr,
    error: null,
    nextIn: 9,
    loading: false,
    refresh: mocks.refresh,
  }),
}));
vi.mock("../hooks/usePrChecks", () => ({
  usePrChecks: () => ({
    checks: null,
    summary: null,
    error: null,
    loading: false,
    refresh: vi.fn(),
  }),
}));
vi.mock("./DotSpinner", () => ({ DotSpinner: () => null }));

let root: Root;
let container: HTMLDivElement;

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  mocks.state.index = {
    branch: "feature",
    files: [],
    additions: 0,
    deletions: 0,
    remote: "origin",
    upstream: "origin/feature",
    defaultBranch: "main",
    ahead: 0,
    behind: 0,
    aheadOfDefault: 2,
  };
  mocks.state.pr = null;
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
    root.render(createElement(MergePath, { cwd: "/p", enabled: true })),
  );
}

function merge() {
  return Array.from(container.querySelectorAll("button")).find(
    (button) => button.textContent === "Squash and merge",
  );
}

describe("Checks: merging the pull request", () => {
  it("squash-merges the open pull request only after confirming", async () => {
    mocks.state.pr = {
      number: 4,
      title: "Tab groups",
      url: "https://example.com/pr/4",
      state: "open",
    };
    mocks.squashMerge.mockResolvedValue(undefined);
    await render();
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
    expect(mocks.squashMerge).toHaveBeenCalledExactlyOnceWith("/p", 4);
    expect(mocks.refresh).toHaveBeenCalled();
  });

  it("offers no merge without an open pull request", async () => {
    mocks.state.pr = {
      number: 5,
      title: "Done",
      url: "https://example.com/pr/5",
      state: "merged",
    };
    await render();
    expect(merge()).toBeUndefined();
  });

  it("keeps the refresh countdown at the foot", async () => {
    await render();
    expect(container.querySelector(".merge-path-footer")?.textContent).toBe(
      "Refreshing in 9s",
    );
  });
});

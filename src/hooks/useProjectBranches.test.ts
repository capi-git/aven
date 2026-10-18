// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { notifyGitChanged } from "../lib/fs";
import { useProjectBranches } from "./useProjectBranches";

const branches = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (command: string) => {
    if (command === "git_branches") return branches();
    throw new Error(`Unexpected native command: ${command}`);
  },
}));

let root: Root;
let container: HTMLDivElement;
let hidden = false;
let shown: string | null = null;

function Branch() {
  shown = useProjectBranches("/repo", true)?.current ?? null;
  return null;
}

const answer = (current: string) => ({
  current,
  detached: false,
  branches: [{ name: current, current: true, remote: false }],
});

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  hidden = false;
  shown = null;
  vi.spyOn(document, "hidden", "get").mockImplementation(() => hidden);
  branches.mockResolvedValue(answer("main"));
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("the status bar's branch", () => {
  it("follows a checkout while the window is on screen without focus", async () => {
    await act(async () => root.render(createElement(Branch)));
    expect(shown).toBe("main");
    window.dispatchEvent(new Event("blur"));
    branches.mockResolvedValue(answer("feature"));
    await act(async () => notifyGitChanged("/repo"));
    expect(shown).toBe("feature");
  });

  it("waits while hidden and reads once back on screen", async () => {
    await act(async () => root.render(createElement(Branch)));
    const reads = branches.mock.calls.length;
    hidden = true;
    branches.mockResolvedValue(answer("feature"));
    await act(async () => notifyGitChanged("/repo"));
    expect(branches).toHaveBeenCalledTimes(reads);
    hidden = false;
    await act(async () =>
      document.dispatchEvent(new Event("visibilitychange")),
    );
    expect(shown).toBe("feature");
  });
});

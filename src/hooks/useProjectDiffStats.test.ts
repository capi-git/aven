// @vitest-environment happy-dom
import { act, createElement, Fragment } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  applyProjectDiffStats,
  useProjectDiffStats,
} from "./useProjectDiffStats";
import { notifyGitChanged } from "../lib/fs";

const { readStats } = vi.hoisted(() => ({ readStats: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (command: string, args: { cwd: string }) => {
    if (command === "git_diff_stats") return readStats(args.cwd);
    throw new Error(`Unexpected native command: ${command}`);
  },
}));

let root: Root;
let container: HTMLDivElement;
let hidden: boolean;
let cwd: string;
let sequence = 0;

function Probe({ path, enabled }: { path: string; enabled: boolean }) {
  const stats = useProjectDiffStats(path, enabled);
  return stats
    ? createElement("span", null, `+${stats.additions} -${stats.deletions}`)
    : null;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  hidden = false;
  vi.spyOn(document, "hidden", "get").mockImplementation(() => hidden);
  readStats.mockResolvedValue({ files: 4, additions: 64872, deletions: 14719 });
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  cwd = `/stats-${++sequence}`;
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function render(enabled: boolean, path = cwd) {
  await act(async () => root.render(createElement(Probe, { path, enabled })));
}

describe("useProjectDiffStats", () => {
  it("reads real stats only while enabled and visible", async () => {
    await render(false);
    expect(readStats).not.toHaveBeenCalled();
    await render(true);
    expect(readStats).toHaveBeenCalledOnce();
    expect(container.textContent).toBe("+64872 -14719");
    hidden = true;
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
      window.dispatchEvent(new Event("focus"));
      notifyGitChanged();
    });
    expect(readStats).toHaveBeenCalledOnce();
    await render(false);
    hidden = false;
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
      notifyGitChanged();
    });
    expect(readStats).toHaveBeenCalledOnce();
  });

  it("shares one read between surfaces and accepts published Git index stats", async () => {
    await act(async () =>
      root.render(
        createElement(
          Fragment,
          null,
          createElement(Probe, { path: cwd, enabled: true }),
          createElement(Probe, { path: cwd, enabled: true }),
        ),
      ),
    );
    expect(readStats).toHaveBeenCalledOnce();
    await act(async () =>
      applyProjectDiffStats(cwd, { files: 2, additions: 17, deletions: 3 }),
    );
    expect(container.textContent).toBe("+17 -3+17 -3");
    expect(readStats).toHaveBeenCalledOnce();
  });

  it("does not invent zero stats when a folder is not a repository", async () => {
    readStats.mockRejectedValue(new Error("Not a Git repository"));
    await render(true);
    expect(container.textContent).toBe("");
    await render(true, "~");
    expect(readStats).toHaveBeenCalledOnce();
  });
});

// @vitest-environment happy-dom
import { act, createElement, Fragment } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  applyProjectDiffStats,
  useProjectDiffStats,
  useProjectsDiffFiles,
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

  it("reloads a project only for changes in its own folder", async () => {
    const other = `${cwd}-other`;
    await act(async () =>
      root.render(
        createElement(
          Fragment,
          null,
          createElement(Probe, { path: cwd, enabled: true }),
          createElement(Probe, { path: other, enabled: true }),
        ),
      ),
    );
    expect(readStats).toHaveBeenCalledTimes(2);
    readStats.mockClear();
    await act(async () => notifyGitChanged(`${cwd}/src/app.ts`));
    expect(readStats.mock.calls).toEqual([[cwd]]);
    readStats.mockClear();
    await act(async () => notifyGitChanged("/somewhere/else"));
    expect(readStats).not.toHaveBeenCalled();
    // A change that names no folder still means everything.
    await act(async () => notifyGitChanged());
    expect(readStats.mock.calls.map(([path]) => path).sort()).toEqual(
      [cwd, other].sort(),
    );
  });
});

describe("useProjectsDiffFiles", () => {
  let latest: Readonly<Record<string, number>> = {};

  function Counts({ paths }: { paths: string[] }) {
    latest = useProjectsDiffFiles(paths, true);
    return null;
  }

  async function show(paths: string[]) {
    await act(async () => root.render(createElement(Counts, { paths })));
  }

  async function advance(ms: number) {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(ms);
    });
  }

  beforeEach(() => {
    vi.useFakeTimers();
    latest = {};
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("waits out launch, then reads every listed project through a small pool", async () => {
    const pending = new Map<string, (files: number) => void>();
    readStats.mockImplementation(
      (path: string) =>
        new Promise((resolve) =>
          pending.set(path, (files) =>
            resolve({ files, additions: files, deletions: 0 }),
          ),
        ),
    );
    const paths = [`${cwd}/a`, `${cwd}/b`, `${cwd}/c`];
    await show(paths);
    expect(readStats).not.toHaveBeenCalled();
    await advance(1_500);
    // Two at a time, so a long project list never runs git all at once.
    expect(readStats.mock.calls.map(([path]) => path)).toEqual(
      paths.slice(0, 2),
    );
    await act(async () => pending.get(paths[0])!(3));
    expect(readStats).toHaveBeenCalledTimes(3);
    await act(async () => {
      pending.get(paths[1])!(0);
      pending.get(paths[2])!(12);
    });
    // Keyed by project; clean folders are left out.
    expect(latest).toEqual({ [paths[0]]: 3, [paths[2]]: 12 });
  });

  it("settles a burst of agent edits into one read of that project only", async () => {
    const paths = [`${cwd}/a`, `${cwd}/b`];
    await show(paths);
    await advance(1_500);
    expect(readStats).toHaveBeenCalledTimes(2);
    const first = latest;
    readStats.mockClear();
    for (let edit = 0; edit < 5; edit += 1)
      await act(async () => notifyGitChanged(`${paths[0]}/file-${edit}.ts`));
    expect(readStats).not.toHaveBeenCalled();
    await advance(1_000);
    expect(readStats.mock.calls).toEqual([[paths[0]]]);
    // Same counts: the sidebar keeps the same object and skips a render.
    expect(latest).toBe(first);
  });

  it("reuses fresh counts on focus, and reads nothing while hidden", async () => {
    const paths = [`${cwd}/a`];
    await show(paths);
    await advance(1_500);
    readStats.mockClear();
    await act(async () => window.dispatchEvent(new Event("focus")));
    await advance(10);
    expect(readStats).not.toHaveBeenCalled();

    hidden = true;
    await act(async () => notifyGitChanged(paths[0]));
    await advance(1_000);
    expect(readStats).not.toHaveBeenCalled();
    hidden = false;
    // The change seen while hidden is read on return.
    await act(async () =>
      document.dispatchEvent(new Event("visibilitychange")),
    );
    await advance(10);
    expect(readStats.mock.calls).toEqual([[paths[0]]]);
  });

  it("refreshes stale counts on focus after the longer background interval", async () => {
    const paths = [`${cwd}/a`];
    await show(paths);
    await advance(1_500);
    readStats.mockClear();
    await advance(60_000);
    await act(async () => window.dispatchEvent(new Event("focus")));
    await advance(10);
    expect(readStats).not.toHaveBeenCalled();
    await advance(60_000);
    await act(async () => window.dispatchEvent(new Event("focus")));
    await advance(10);
    expect(readStats).toHaveBeenCalledOnce();
  });
});

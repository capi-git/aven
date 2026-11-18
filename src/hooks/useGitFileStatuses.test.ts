// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useGitFileStatuses } from "./useGitFileStatuses";
import { useProjectDiffStats } from "./useProjectDiffStats";
import { beginSidePanelOpen, endSidePanelOpen } from "../lib/sidePanel";

const mocks = vi.hoisted(() => ({
  index: vi.fn(),
  stats: vi.fn(),
  gitListeners: new Set<() => void>(),
  dirListeners: new Set<() => void>(),
}));

vi.mock("../lib/fs", () => ({
  gitDiffIndex: mocks.index,
  gitDiffStats: mocks.stats,
  subscribeGitChanged: (listener: () => void) => {
    mocks.gitListeners.add(listener);
    return () => mocks.gitListeners.delete(listener);
  },
  // Diff stats hear the changed folder; these tests report unnamed changes.
  subscribeGitChangedPath: (listener: (path: string | null) => void) => {
    const unnamed = () => listener(null);
    mocks.gitListeners.add(unnamed);
    return () => mocks.gitListeners.delete(unnamed);
  },
  gitChangeAffects: () => true,
}));
vi.mock("../lib/fileTree", () => ({
  subscribeDirsChanged: (listener: () => void) => {
    mocks.dirListeners.add(listener);
    return () => mocks.dirListeners.delete(listener);
  },
}));

let project = 0;
let hidden = false;
let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.clearAllMocks();
  hidden = false;
  vi.spyOn(document, "hidden", "get").mockImplementation(() => hidden);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  mocks.index.mockResolvedValue({ files: [] });
  mocks.stats.mockResolvedValue({ files: 0, additions: 0, deletions: 0 });
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

for (const [name, hook, read, response] of [
  ["file statuses", useGitFileStatuses, mocks.index, { files: [] }],
  [
    "diff stats",
    useProjectDiffStats,
    mocks.stats,
    { files: 0, additions: 0, deletions: 0 },
  ],
] as const) {
  describe(`${name} visibility maintenance`, () => {
    let cwd: string;
    function Probe({ enabled = true }: { enabled?: boolean }) {
      hook(cwd, enabled);
      return null;
    }
    beforeEach(() => {
      cwd = `/maintenance-${++project}`;
    });

    it("does no initial or event-driven git work while hidden, then resumes", async () => {
      hidden = true;
      await act(async () => root.render(createElement(Probe)));
      await act(async () => {
        window.dispatchEvent(new Event("focus"));
        for (const listener of mocks.gitListeners) listener();
      });
      expect(read).not.toHaveBeenCalled();
      hidden = false;
      await act(async () =>
        document.dispatchEvent(new Event("visibilitychange")),
      );
      expect(read).toHaveBeenCalledTimes(1);
    });

    it("drops queued work when the last panel closes and refreshes on reopen", async () => {
      let finish!: (value: unknown) => void;
      read.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finish = resolve;
          }),
      );
      await act(async () => root.render(createElement(Probe)));
      await act(async () => {
        for (const listener of mocks.gitListeners) listener();
        root.render(createElement(Probe, { enabled: false }));
      });
      await act(async () => finish(response));
      expect(read).toHaveBeenCalledTimes(1);
      await act(async () => root.render(createElement(Probe)));
      expect(read).toHaveBeenCalledTimes(2);
    });

    it("does not chain a pending request after the window becomes hidden", async () => {
      let finish!: (value: unknown) => void;
      read.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finish = resolve;
          }),
      );
      await act(async () => root.render(createElement(Probe)));
      await act(async () => {
        for (const listener of mocks.gitListeners) listener();
        hidden = true;
        document.dispatchEvent(new Event("visibilitychange"));
        finish(response);
      });
      expect(read).toHaveBeenCalledTimes(1);
      hidden = false;
      await act(async () =>
        document.dispatchEvent(new Event("visibilitychange")),
      );
      expect(read).toHaveBeenCalledTimes(2);
    });

    it("shares one request between two visible consumers of the same project", async () => {
      await act(async () =>
        root.render(
          createElement(
            "div",
            null,
            createElement(Probe),
            createElement(Probe),
          ),
        ),
      );
      expect(read).toHaveBeenCalledTimes(1);
    });
  });
}

describe("diff stats resume freshness", () => {
  let cwd: string;
  let now: number;
  function Probe({ enabled = true }: { enabled?: boolean }) {
    useProjectDiffStats(cwd, enabled);
    return null;
  }
  beforeEach(() => {
    cwd = `/maintenance-${++project}`;
    now = 1_000_000;
    vi.spyOn(Date, "now").mockImplementation(() => now);
  });

  it("reuses fresh stats on focus and visibility but reloads them once stale", async () => {
    await act(async () => root.render(createElement(Probe)));
    expect(mocks.stats).toHaveBeenCalledTimes(1);

    now += 29_000;
    await act(async () => {
      window.dispatchEvent(new Event("focus"));
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(mocks.stats).toHaveBeenCalledTimes(1);

    now += 1_000;
    await act(async () => window.dispatchEvent(new Event("focus")));
    expect(mocks.stats).toHaveBeenCalledTimes(2);
  });

  it("always reloads when git reports a change", async () => {
    await act(async () => root.render(createElement(Probe)));
    await act(async () => {
      for (const listener of mocks.gitListeners) listener();
    });
    expect(mocks.stats).toHaveBeenCalledTimes(2);
  });

  it("trusts stats on a quick reopen, unless Git changed or they grew old", async () => {
    const close = () =>
      act(async () => root.render(createElement(Probe, { enabled: false })));
    const open = () => act(async () => root.render(createElement(Probe)));
    await open();
    await close();
    now += 5_000;
    await open();
    expect(mocks.stats).toHaveBeenCalledTimes(1);

    await close();
    await act(async () => {
      for (const listener of mocks.gitListeners) listener();
    });
    await open();
    expect(mocks.stats).toHaveBeenCalledTimes(2);

    await close();
    now += 30_000;
    await open();
    expect(mocks.stats).toHaveBeenCalledTimes(3);
  });

  it("reloads on resume after a git change arrived while hidden", async () => {
    await act(async () => root.render(createElement(Probe)));
    hidden = true;
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
      for (const listener of mocks.gitListeners) listener();
    });
    expect(mocks.stats).toHaveBeenCalledTimes(1);
    hidden = false;
    now += 1_000;
    await act(async () =>
      document.dispatchEvent(new Event("visibilitychange")),
    );
    expect(mocks.stats).toHaveBeenCalledTimes(2);
  });
});

describe("file statuses on a reopen", () => {
  let cwd: string;
  let now: number;
  function Probe({ enabled = true }: { enabled?: boolean }) {
    useGitFileStatuses(cwd, enabled);
    return null;
  }
  beforeEach(() => {
    cwd = `/statuses-${++project}`;
    now = 1_000_000;
    vi.spyOn(Date, "now").mockImplementation(() => now);
  });

  it("reuses colours read moments ago, and reads after a Git change or a while", async () => {
    const close = () =>
      act(async () => root.render(createElement(Probe, { enabled: false })));
    const open = () => act(async () => root.render(createElement(Probe)));
    await open();
    expect(mocks.index).toHaveBeenCalledTimes(1);
    await close();
    now += 5_000;
    await open();
    expect(mocks.index).toHaveBeenCalledTimes(1);

    // Heard while open, a change reads at once and again on the next show.
    await act(async () => {
      for (const listener of mocks.gitListeners) listener();
    });
    expect(mocks.index).toHaveBeenCalledTimes(2);
    await close();
    now += 30_000;
    await open();
    expect(mocks.index).toHaveBeenCalledTimes(3);
  });

  it("waits for the side panel to slide in before reading", async () => {
    beginSidePanelOpen();
    await act(async () => root.render(createElement(Probe)));
    expect(mocks.index).not.toHaveBeenCalled();
    await act(async () => endSidePanelOpen());
    expect(mocks.index).toHaveBeenCalledTimes(1);
  });
});

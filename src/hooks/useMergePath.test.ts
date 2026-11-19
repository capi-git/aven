// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useMergePath, type MergePathState } from "./useMergePath";

const mocks = vi.hoisted(() => ({
  index: vi.fn(),
  pr: vi.fn(),
  gitListeners: new Set<(path: string | null) => void>(),
}));

vi.mock("../lib/fs", () => ({
  gitDiffIndex: mocks.index,
  gitPrStatus: mocks.pr,
  subscribeGitChangedPath: (listener: (path: string | null) => void) => {
    mocks.gitListeners.add(listener);
    return () => mocks.gitListeners.delete(listener);
  },
  gitChangeAffects: (changed: string | null, cwd: string) =>
    !changed || changed === cwd || changed.startsWith(`${cwd}/`),
}));
vi.mock("../lib/prChecks", () => ({ gitPrChecks: vi.fn() }));

import { clearSharedGitReads } from "../lib/sharedGitReads";

let hidden = false;
const gitChanged = (path: string | null) =>
  act(async () => {
    for (const listener of mocks.gitListeners) listener(path);
    await Promise.resolve();
    await Promise.resolve();
  });

let container: HTMLDivElement;
let root: Root;
let latest: MergePathState | null = null;
let renders = 0;

function Probe(props: {
  options?: { refreshS?: number; countdown?: boolean };
  copies?: number;
}) {
  latest = useMergePath("/repo", true, props.options);
  renders += 1;
  return null;
}

/** Several views of one copy at once, as split chats and the Checks tab. */
function Several(props: { count: number }) {
  return createElement(
    "div",
    null,
    Array.from({ length: props.count }, (_, index) =>
      createElement(Probe, { key: index, options: { countdown: false } }),
    ),
  );
}

async function mount(options?: { refreshS?: number; countdown?: boolean }) {
  await act(async () => {
    root.render(createElement(Probe, { options }));
  });
  // Let the first read finish.
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  hidden = false;
  vi.spyOn(document, "hidden", "get").mockImplementation(() => hidden);
  clearSharedGitReads();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  mocks.index.mockResolvedValue({ files: [] });
  mocks.pr.mockResolvedValue(null);
  latest = null;
  renders = 0;
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("useMergePath", () => {
  it("counts down and reads again every 15 seconds by default", async () => {
    await mount();
    expect(mocks.index).toHaveBeenCalledTimes(1);
    expect(latest?.nextIn).toBe(15);
    await act(async () => vi.advanceTimersByTime(1_000));
    expect(latest?.nextIn).toBe(14);
    await act(async () => vi.advanceTimersByTime(14_000));
    expect(mocks.index).toHaveBeenCalledTimes(2);
  });

  it("without a countdown, reads at its own pace and does not draw every second", async () => {
    await mount({ refreshS: 60, countdown: false });
    expect(mocks.index).toHaveBeenCalledTimes(1);
    expect(latest?.nextIn).toBeNull();
    const before = renders;
    await act(async () => vi.advanceTimersByTime(30_000));
    expect(renders).toBe(before);
    expect(mocks.index).toHaveBeenCalledTimes(1);
    await act(async () => vi.advanceTimersByTime(30_000));
    expect(mocks.index).toHaveBeenCalledTimes(2);
    expect(latest?.nextIn).toBeNull();
  });

  it("shares one read between every view of a copy", async () => {
    await act(async () => {
      root.render(createElement(Several, { count: 3 }));
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(mocks.index).toHaveBeenCalledTimes(1);
    expect(mocks.pr).toHaveBeenCalledTimes(1);
    // A Git change reaches all three in the same moment: one read.
    await act(async () => vi.advanceTimersByTime(6_000));
    await gitChanged("/repo");
    expect(mocks.index).toHaveBeenCalledTimes(2);
    expect(mocks.pr).toHaveBeenCalledTimes(2);
  });

  it("reads again only for a Git change in its own copy", async () => {
    await mount({ countdown: false });
    expect(mocks.index).toHaveBeenCalledTimes(1);
    await gitChanged("/elsewhere");
    expect(mocks.index).toHaveBeenCalledTimes(1);
    await gitChanged("/repo/src");
    expect(mocks.index).toHaveBeenCalledTimes(2);
  });

  it("waits until the window shows again to read a change made while hidden", async () => {
    await mount({ countdown: false });
    hidden = true;
    await gitChanged("/repo");
    expect(mocks.index).toHaveBeenCalledTimes(1);
    hidden = false;
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(mocks.index).toHaveBeenCalledTimes(2);
  });
});

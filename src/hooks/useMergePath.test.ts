// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useMergePath, type MergePathState } from "./useMergePath";

const mocks = vi.hoisted(() => ({
  index: vi.fn(),
  pr: vi.fn(),
}));

vi.mock("../lib/fs", () => ({
  gitDiffIndex: mocks.index,
  gitPrStatus: mocks.pr,
  subscribeGitChanged: () => () => {},
}));

let container: HTMLDivElement;
let root: Root;
let latest: MergePathState | null = null;
let renders = 0;

function Probe(props: {
  options?: { refreshS?: number; countdown?: boolean };
}) {
  latest = useMergePath("/repo", true, props.options);
  renders += 1;
  return null;
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
  vi.spyOn(document, "hidden", "get").mockReturnValue(false);
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
});

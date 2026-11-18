import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FsEntry } from "./fs";
import {
  forgetDir,
  listCachedDir,
  notifyDirsChanged,
  peekDir,
  refreshCachedDirs,
  refreshDir,
  resetFileTreeForTest,
  subscribeDirsChanged,
} from "./fileTree";
import {
  beginSidePanelOpen,
  endSidePanelOpen,
  resetSidePanelForTest,
  SIDE_PANEL_FRESH_MS,
} from "./sidePanel";

const root = "/tmp/empty-project";

function entry(name: string): FsEntry {
  return {
    name,
    path: `${root}/${name}`,
    isDir: false,
    ignored: false,
  };
}

const listDir = vi.fn<(path: string) => Promise<FsEntry[]>>();

vi.mock("./fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./fs")>();
  return {
    ...actual,
    listDir: (path: string) => listDir(path),
  };
});

describe("fileTree cache", () => {
  beforeEach(() => {
    resetFileTreeForTest();
    forgetDir(root);
    listDir.mockReset();
  });

  afterEach(() => {
    resetSidePanelForTest();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("keeps the first listing until refreshDir", async () => {
    listDir.mockResolvedValueOnce([]);
    await listCachedDir(root);
    expect(peekDir(root)).toEqual([]);

    listDir.mockResolvedValueOnce([entry("hello.ts")]);
    expect(await listCachedDir(root)).toEqual([]);
    expect(listDir).toHaveBeenCalledTimes(1);

    expect(await refreshDir(root)).toEqual([entry("hello.ts")]);
    expect(peekDir(root)).toEqual([entry("hello.ts")]);
  });

  it("refreshCachedDirs re-lists every cached folder", async () => {
    listDir.mockResolvedValueOnce([]);
    await listCachedDir(root);
    listDir.mockResolvedValueOnce([entry("created.ts")]);
    await refreshCachedDirs();
    expect(peekDir(root)).toEqual([entry("created.ts")]);
  });

  it("notifyDirsChanged refreshes the cache and tells listeners", async () => {
    vi.useFakeTimers();
    listDir.mockResolvedValueOnce([]);
    await listCachedDir(root);

    const onChange = vi.fn();
    const stop = subscribeDirsChanged(onChange);
    listDir.mockResolvedValueOnce([entry("from-agent.ts")]);
    notifyDirsChanged();
    expect(peekDir(root)).toEqual([]);

    await vi.runAllTimersAsync();
    expect(peekDir(root)).toEqual([entry("from-agent.ts")]);
    expect(onChange).toHaveBeenCalledTimes(1);
    stop();
  });

  it("reads nothing while no explorer is open, and re-reads once one opens", async () => {
    vi.useFakeTimers();
    listDir.mockResolvedValueOnce([]);
    await listCachedDir(root);
    const onChange = vi.fn();
    const stop = subscribeDirsChanged(onChange, { refreshCache: false });
    notifyDirsChanged();
    await vi.runAllTimersAsync();
    expect(listDir).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledOnce();
    // The folder still shows at once when an explorer opens...
    expect(peekDir(root)).toEqual([]);
    const explorer = vi.fn();
    const close = subscribeDirsChanged(explorer);
    // ...and is read again, the change having gone unread.
    expect(peekDir(root)).toBeNull();
    expect(explorer).toHaveBeenCalledOnce();
    listDir.mockResolvedValueOnce([entry("new.ts")]);
    expect(await listCachedDir(root)).toEqual([entry("new.ts")]);
    expect(listDir).toHaveBeenCalledTimes(2);
    close();
    stop();
  });

  it("cancels a scheduled directory scan when the last explorer closes", async () => {
    vi.useFakeTimers();
    listDir.mockResolvedValueOnce([]);
    await listCachedDir(root);
    const stop = subscribeDirsChanged(vi.fn());
    notifyDirsChanged();
    stop();
    await vi.runAllTimersAsync();
    expect(listDir).toHaveBeenCalledTimes(1);
    expect(peekDir(root)).toEqual([]);
    // The scan it skipped is owed when an explorer opens again.
    const again = subscribeDirsChanged(vi.fn());
    expect(peekDir(root)).toBeNull();
    again();
  });

  it("keeps folders across a quick close and reopen", async () => {
    vi.useFakeTimers();
    listDir.mockResolvedValueOnce([]);
    const first = subscribeDirsChanged(vi.fn());
    await listCachedDir(root);
    first();
    expect(peekDir(root)).toEqual([]);
    vi.advanceTimersByTime(SIDE_PANEL_FRESH_MS - 1_000);
    const second = subscribeDirsChanged(vi.fn());
    expect(peekDir(root)).toEqual([]);
    expect(await listCachedDir(root)).toEqual([]);
    expect(listDir).toHaveBeenCalledTimes(1);
    second();
  });

  it("re-reads after a long close once the side panel has slid in", async () => {
    vi.useFakeTimers();
    listDir.mockResolvedValueOnce([]);
    const first = subscribeDirsChanged(vi.fn());
    await listCachedDir(root);
    first();
    vi.advanceTimersByTime(SIDE_PANEL_FRESH_MS);
    beginSidePanelOpen();
    const explorer = vi.fn();
    const second = subscribeDirsChanged(explorer);
    // During the slide the old folder shows and nothing is read.
    expect(peekDir(root)).toEqual([]);
    expect(explorer).not.toHaveBeenCalled();
    endSidePanelOpen();
    expect(peekDir(root)).toBeNull();
    expect(explorer).toHaveBeenCalledOnce();
    second();
  });

  it("lets go of other projects' folders on a refresh instead of reading them", async () => {
    vi.useFakeTimers();
    const other = "/tmp/other-project";
    listDir.mockResolvedValue([]);
    await listCachedDir(root);
    await listCachedDir(`${root}/src`);
    await listCachedDir(other);
    const stop = subscribeDirsChanged(vi.fn(), { root });
    listDir.mockClear();
    notifyDirsChanged();
    await vi.runAllTimersAsync();
    expect(listDir.mock.calls.map(([path]) => path).sort()).toEqual([
      root,
      `${root}/src`,
    ]);
    expect(peekDir(other)).toBeNull();
    stop();
    listDir.mockReset();
  });

  it("does not repopulate an invalidated cache with a stale in-flight listing", async () => {
    let finish!: (entries: FsEntry[]) => void;
    listDir.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const stop = subscribeDirsChanged(vi.fn());
    const pending = listCachedDir(root);
    vi.stubGlobal("document", { hidden: true });
    notifyDirsChanged();
    finish([entry("old.ts")]);
    await pending;
    expect(peekDir(root)).toBeNull();
    stop();
  });

  it("skips a queued scan if the document hides before the debounce ends", async () => {
    vi.useFakeTimers();
    const visibility = { hidden: false };
    vi.stubGlobal("document", visibility);
    listDir.mockResolvedValueOnce([]);
    await listCachedDir(root);
    const stop = subscribeDirsChanged(vi.fn());
    notifyDirsChanged();
    visibility.hidden = true;
    await vi.runAllTimersAsync();
    expect(listDir).toHaveBeenCalledTimes(1);
    expect(peekDir(root)).toBeNull();
    stop();
  });
});

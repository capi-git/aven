import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FsEntry } from "./fs";
import {
  forgetDir,
  listCachedDir,
  notifyDirsChanged,
  peekDir,
  refreshCachedDirs,
  refreshDir,
  subscribeDirsChanged,
} from "./fileTree";

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
    forgetDir(root);
    listDir.mockReset();
  });

  afterEach(() => {
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

  it("invalidates without disk reads when no explorer is subscribed", async () => {
    vi.useFakeTimers();
    listDir.mockResolvedValueOnce([]);
    await listCachedDir(root);
    const onChange = vi.fn();
    const stop = subscribeDirsChanged(onChange, { refreshCache: false });
    notifyDirsChanged();
    await vi.runAllTimersAsync();
    expect(listDir).toHaveBeenCalledTimes(1);
    expect(peekDir(root)).toBeNull();
    expect(onChange).toHaveBeenCalledOnce();

    listDir.mockResolvedValueOnce([entry("new.ts")]);
    expect(await listCachedDir(root)).toEqual([entry("new.ts")]);
    expect(listDir).toHaveBeenCalledTimes(2);
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
    expect(peekDir(root)).toBeNull();
  });

  it("drops directory snapshots on close so reopening lists current contents", async () => {
    listDir.mockResolvedValueOnce([]);
    await listCachedDir(root);
    const stop = subscribeDirsChanged(vi.fn());
    stop();
    expect(peekDir(root)).toBeNull();
    expect(listDir).toHaveBeenCalledTimes(1);
    listDir.mockResolvedValueOnce([entry("after-close.ts")]);
    expect(await listCachedDir(root)).toEqual([entry("after-close.ts")]);
    expect(listDir).toHaveBeenCalledTimes(2);
  });

  it("does not repopulate an invalidated cache with a stale in-flight listing", async () => {
    let finish!: (entries: FsEntry[]) => void;
    listDir.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const pending = listCachedDir(root);
    notifyDirsChanged();
    finish([entry("old.ts")]);
    await pending;
    expect(peekDir(root)).toBeNull();
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

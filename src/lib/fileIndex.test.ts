import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ProjectFile } from "./fs";
import { listProjectFiles } from "./fs";
import {
  invalidateProjectFiles,
  loadProjectFiles,
  peekProjectFiles,
  rememberOpenedFile,
  resolveOpenablePath,
  subscribeProjectFiles,
} from "./fileIndex";
import { notifyDirsChanged } from "./fileTree";

const cwd = "/Users/me/project";
const files: ProjectFile[] = [
  {
    name: "App.tsx",
    path: "/Users/me/project/apps/desktop/src/App.tsx",
    relative: "apps/desktop/src/App.tsx",
  },
  {
    name: "App.tsx",
    path: "/Users/me/project/apps/web/src/App.tsx",
    relative: "apps/web/src/App.tsx",
  },
  {
    name: "main.tsx",
    path: "/Users/me/project/apps/desktop/src/main.tsx",
    relative: "apps/desktop/src/main.tsx",
  },
];

const extra: ProjectFile = {
  name: "pasted.ts",
  path: "/Users/me/project/pasted.ts",
  relative: "pasted.ts",
};

vi.mock("./fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./fs")>();
  return {
    ...actual,
    homeDir: vi.fn(async () => "/Users/me"),
    listProjectFiles: vi.fn(async () => files),
  };
});

const list = vi.mocked(listProjectFiles);

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

describe("resolveOpenablePath", () => {
  beforeEach(() => {
    invalidateProjectFiles();
    list.mockReset();
    list.mockResolvedValue(files);
  });

  it("maps a basename-only link to the shortest matching project path", async () => {
    const resolved = await resolveOpenablePath(cwd, "App.tsx");
    expect(resolved).toBe(files[1].path);
  });

  it("prefers recently opened files for ambiguous basenames", async () => {
    rememberOpenedFile(cwd, files[1].path);
    const resolved = await resolveOpenablePath(cwd, "App.tsx");
    expect(resolved).toBe(files[1].path);
  });

  it("matches a relative project path", async () => {
    const resolved = await resolveOpenablePath(
      cwd,
      "apps/desktop/src/main.tsx",
    );
    expect(resolved).toBe(files[2].path);
  });

  it("resolves home folders and files without scanning or fuzzy-matching the project", async () => {
    list.mockRejectedValue(new Error("Unrelated project is unavailable"));
    expect(await resolveOpenablePath("/Volumes/Projects/app", "~/.agents/skills")).toBe("/Users/me/.agents/skills");
    expect(await resolveOpenablePath(cwd, "~/My Notes/SKILL.md:12")).toBe("/Users/me/My Notes/SKILL.md");
    expect(await resolveOpenablePath(cwd, "~")).toBe("/Users/me");
    expect(list).not.toHaveBeenCalled();
  });

  it("honors paths outside the project instead of opening a same-named project file", async () => {
    expect(await resolveOpenablePath(cwd, "/Users/me/.agents/skills/main.tsx")).toBe("/Users/me/.agents/skills/main.tsx");
    expect(list).not.toHaveBeenCalled();
  });
});

describe("loadProjectFiles", () => {
  beforeEach(() => {
    invalidateProjectFiles();
    list.mockReset();
    list.mockResolvedValue(files);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    invalidateProjectFiles();
  });

  it("returns the cached listing until refresh", async () => {
    await loadProjectFiles(cwd);
    list.mockResolvedValue([...files, extra]);
    expect(await loadProjectFiles(cwd)).toEqual(files);
    expect(list).toHaveBeenCalledTimes(1);
    expect(await loadProjectFiles(cwd, true)).toEqual([...files, extra]);
    expect(peekProjectFiles(cwd)).toEqual([...files, extra]);
  });

  it("does not drop a refresh that arrives while a scan is in flight", async () => {
    const first = deferred<ProjectFile[]>();
    const second = deferred<ProjectFile[]>();
    list.mockImplementationOnce(() => first.promise);
    list.mockImplementationOnce(() => second.promise);

    const initial = loadProjectFiles(cwd);
    const refresh = loadProjectFiles(cwd, true);
    expect(list).toHaveBeenCalledTimes(2);

    first.resolve(files);
    expect(await initial).toEqual(files);
    expect(peekProjectFiles(cwd)).toBeNull();

    second.resolve([...files, extra]);
    expect(await refresh).toEqual([...files, extra]);
    expect(peekProjectFiles(cwd)).toEqual([...files, extra]);
  });

  it("reuses the in-flight scan when refresh is not requested", async () => {
    const pending = deferred<ProjectFile[]>();
    list.mockImplementationOnce(() => pending.promise);

    const first = loadProjectFiles(cwd);
    const second = loadProjectFiles(cwd);
    expect(list).toHaveBeenCalledTimes(1);

    pending.resolve(files);
    expect(await first).toEqual(files);
    expect(await second).toEqual(files);
  });

  it("notifies subscribers when the listing changes", async () => {
    const onChange = vi.fn();
    const stop = subscribeProjectFiles(onChange);
    await loadProjectFiles(cwd);
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(peekProjectFiles(cwd)).toEqual(files);
    stop();
  });

  it("reloads after a directory change", async () => {
    vi.useFakeTimers();
    await loadProjectFiles(cwd);
    list.mockResolvedValue([...files, extra]);

    const onChange = vi.fn();
    const stop = subscribeProjectFiles(onChange);
    onChange.mockClear();
    notifyDirsChanged();

    await vi.runAllTimersAsync();
    expect(peekProjectFiles(cwd)).toEqual([...files, extra]);
    expect(onChange).toHaveBeenCalled();
    stop();
  });

  it("invalidates without rescanning while the file consumer is closed", async () => {
    vi.useFakeTimers();
    await loadProjectFiles(cwd);
    list.mockResolvedValue([...files, extra]);
    notifyDirsChanged();
    await vi.runAllTimersAsync();
    expect(list).toHaveBeenCalledTimes(1);
    expect(peekProjectFiles(cwd)).toBeNull();

    const stop = subscribeProjectFiles(vi.fn());
    await vi.runAllTimersAsync();
    expect(list).toHaveBeenCalledTimes(2);
    expect(peekProjectFiles(cwd)).toEqual([...files, extra]);
    stop();
  });

  it("cancels a queued rescan when the last file consumer closes", async () => {
    vi.useFakeTimers();
    await loadProjectFiles(cwd);
    const stop = subscribeProjectFiles(vi.fn());
    notifyDirsChanged();
    stop();
    await vi.runAllTimersAsync();
    expect(list).toHaveBeenCalledTimes(1);
    expect(peekProjectFiles(cwd)).toBeNull();
    list.mockResolvedValue([...files, extra]);
    expect(await loadProjectFiles(cwd)).toEqual([...files, extra]);
    expect(list).toHaveBeenCalledTimes(2);
  });

  it("pauses a queued index scan while hidden and resumes on a visible change", async () => {
    vi.useFakeTimers();
    const visibility = { hidden: false };
    vi.stubGlobal("document", visibility);
    await loadProjectFiles(cwd);
    const stop = subscribeProjectFiles(vi.fn());
    notifyDirsChanged();
    visibility.hidden = true;
    await vi.runAllTimersAsync();
    expect(list).toHaveBeenCalledTimes(1);
    visibility.hidden = false;
    list.mockResolvedValue([...files, extra]);
    notifyDirsChanged();
    await vi.runAllTimersAsync();
    expect(list).toHaveBeenCalledTimes(2);
    expect(peekProjectFiles(cwd)).toEqual([...files, extra]);
    stop();
  });

  it("does not drop a scan for a different project", async () => {
    const other = "/Users/me/other";
    const pending = deferred<ProjectFile[]>();
    list.mockImplementationOnce(() => pending.promise);

    const scan = loadProjectFiles(other);
    invalidateProjectFiles(cwd);
    pending.resolve(files);

    expect(await scan).toEqual(files);
    expect(peekProjectFiles(other)).toEqual(files);
  });
});

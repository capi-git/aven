// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  gitFileDiff,
  homeDir,
  inspectPaths,
  listDir,
  readTextFile,
  type PathInfo,
} from "../lib/fs";
import { watchFile } from "../lib/fileWatch";
import { FileEditor } from "./FileEditor";

vi.mock("../lib/fs", async (original) => ({
  ...(await original<typeof import("../lib/fs")>()),
  readTextFile: vi.fn(),
  inspectPaths: vi.fn(),
  homeDir: vi.fn(),
  listDir: vi.fn(),
  gitFileDiff: vi.fn(),
}));
vi.mock("../lib/fileWatch", () => ({ watchFile: vi.fn(() => () => {}) }));
vi.mock("./AgentMarkdown", () => ({
  MarkdownPreview: ({ text }: { text: string }) =>
    createElement("article", null, text),
}));
vi.mock("./editorChrome", async (original) => ({
  ...(await original<typeof import("./editorChrome")>()),
  languageForPath: async () => [],
}));

let root: Root;
let host: HTMLDivElement;
const onOpenFile = vi.fn();
const missingPath = new Error(
  "/project/~/.agents/skills: No such file or directory (os error 2)",
);
const info = (path: string, isDir = true): PathInfo => ({
  path,
  name: path.slice(path.lastIndexOf("/") + 1),
  size: 0,
  isDir,
});
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("requestAnimationFrame", () => 1);
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
  vi.mocked(readTextFile)
    .mockReset()
    .mockRejectedValue(new Error("Not a file"));
  vi.mocked(inspectPaths).mockReset().mockResolvedValue([]);
  vi.mocked(homeDir).mockReset().mockResolvedValue("/Users/test");
  vi.mocked(listDir).mockReset().mockResolvedValue([]);
  vi.mocked(gitFileDiff).mockClear();
  vi.mocked(watchFile).mockClear();
  onOpenFile.mockReset();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});
function render(path: string, cwd = "/project", showDiff = false) {
  return act(async () =>
    root.render(
      createElement(FileEditor, {
        path,
        cwd,
        active: true,
        showDiff,
        onOpenFile,
        onDirtyChange: vi.fn(),
      }),
    ),
  );
}

describe("file editor folder recovery", () => {
  it("does not attach text or diff watchers to a restored folder tab", async () => {
    vi.mocked(inspectPaths).mockResolvedValue([info("/project/skills")]);
    await render("/project/skills", "/project", true);
    expect(host.querySelector(".directory-view")).not.toBeNull();
    expect(gitFileDiff).not.toHaveBeenCalled();
    expect(watchFile).not.toHaveBeenCalled();
  });

  it("leaves a successful text read on the existing editor path", async () => {
    vi.mocked(readTextFile).mockResolvedValue("# Existing text");
    await render("/project/~/literal.md");
    expect(host.querySelector("article")?.textContent).toBe("# Existing text");
    expect(inspectPaths).not.toHaveBeenCalled();
    expect(homeDir).not.toHaveBeenCalled();
    expect(listDir).not.toHaveBeenCalled();
  });

  it("uses expanded directory metadata to render an in-app folder", async () => {
    vi.mocked(inspectPaths).mockResolvedValue([
      info("/Users/test/.agents/skills"),
    ]);
    vi.mocked(listDir).mockResolvedValue([
      {
        name: "SKILL.md",
        path: "/Users/test/.agents/skills/SKILL.md",
        isDir: false,
        ignored: false,
      },
    ]);
    await render("~/.agents/skills");
    expect(host.querySelector(".directory-view-path")?.textContent).toBe(
      "/Users/test/.agents/skills",
    );
    expect(host.textContent).not.toContain("Couldn’t open");
    await act(async () =>
      host
        .querySelector<HTMLButtonElement>(
          'button[aria-label="Open file SKILL.md"]',
        )!
        .click(),
    );
    expect(onOpenFile).toHaveBeenCalledExactlyOnceWith(
      "/Users/test/.agents/skills/SKILL.md",
    );
    expect(homeDir).not.toHaveBeenCalled();
  });

  it("recovers the saved project-prefixed home folder only after the original path is missing", async () => {
    vi.mocked(readTextFile).mockRejectedValue(missingPath);
    vi.mocked(inspectPaths)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([info("/Users/test/.agents/skills")]);
    await render("/project/~/.agents/skills");
    expect(inspectPaths).toHaveBeenNthCalledWith(1, [
      "/project/~/.agents/skills",
    ]);
    expect(inspectPaths).toHaveBeenNthCalledWith(2, [
      "/Users/test/.agents/skills",
    ]);
    expect(listDir).toHaveBeenCalledWith("/Users/test/.agents/skills");
    expect(readTextFile).toHaveBeenCalledExactlyOnceWith(
      "/project/~/.agents/skills",
    );
  });

  it.each([true, false])(
    "preserves a real literal tilde path (directory: %s)",
    async (isDir) => {
      const path = "/project/~/.agents/skills";
      vi.mocked(inspectPaths).mockResolvedValue([info(path, isDir)]);
      await render(path);
      expect(homeDir).not.toHaveBeenCalled();
      if (isDir) expect(listDir).toHaveBeenCalledWith(path);
      else expect(host.textContent).toContain("Not a file");
    },
  );

  it("does not redirect a recovered regular file or infer a different project prefix", async () => {
    vi.mocked(readTextFile).mockRejectedValue(missingPath);
    vi.mocked(inspectPaths)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([info("/Users/test/note.md", false)]);
    await render("/project/~/note.md");
    expect(host.textContent).toContain("No such file or directory");
    expect(listDir).not.toHaveBeenCalled();
    expect(onOpenFile).not.toHaveBeenCalled();
    vi.mocked(homeDir).mockClear();
    await render("/different/~/.agents/skills");
    expect(homeDir).not.toHaveBeenCalled();
  });

  it("preserves the original read error if metadata is unavailable, and allows retry", async () => {
    vi.mocked(readTextFile).mockRejectedValue(new Error("Permission denied"));
    vi.mocked(inspectPaths).mockRejectedValueOnce(
      new Error("Metadata unavailable"),
    );
    await render("/project/skills");
    expect(host.textContent).toContain("Permission denied");
    expect(host.textContent).not.toContain("Metadata unavailable");
    vi.mocked(inspectPaths).mockResolvedValue([info("/project/skills")]);
    await act(async () =>
      [...host.querySelectorAll("button")]
        .find((button) => button.textContent?.includes("Retry"))!
        .click(),
    );
    expect(host.querySelector(".directory-view")).not.toBeNull();
  });

  it("does not reinterpret a legacy-shaped path when metadata access is denied", async () => {
    vi.mocked(readTextFile).mockRejectedValue(
      new Error("/project/~/.agents/skills: Permission denied (os error 13)"),
    );
    vi.mocked(inspectPaths).mockResolvedValue([]);
    await render("/project/~/.agents/skills");
    expect(host.textContent).toContain("Permission denied");
    expect(homeDir).not.toHaveBeenCalled();
    expect(listDir).not.toHaveBeenCalled();
  });

  it("ignores metadata from a closed path", async () => {
    const old = deferred<PathInfo[]>();
    vi.mocked(inspectPaths)
      .mockReturnValueOnce(old.promise)
      .mockResolvedValue([info("/new")]);
    await render("/old");
    await render("/new");
    await act(async () => old.resolve([info("/old")]));
    expect(host.querySelector(".directory-view-path")?.textContent).toBe(
      "/new",
    );
    expect(listDir).not.toHaveBeenCalledWith("/old");
  });

  it("cancels legacy recovery when its home lookup finishes after switching files", async () => {
    vi.mocked(readTextFile).mockRejectedValue(missingPath);
    const home = deferred<string>();
    vi.mocked(homeDir).mockReturnValue(home.promise);
    await render("/project/~/.agents/skills");
    vi.mocked(inspectPaths).mockResolvedValue([info("/new")]);
    await render("/new");
    await act(async () => home.resolve("/Users/test"));
    expect(inspectPaths).not.toHaveBeenCalledWith([
      "/Users/test/.agents/skills",
    ]);
    expect(host.querySelector(".directory-view-path")?.textContent).toBe(
      "/new",
    );
  });
});

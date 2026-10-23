import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PathInfo, ProjectFile } from "./fs";
import type { Block } from "./session";

const native = vi.hoisted(() => ({ tauri: true }));
const fs = vi.hoisted(() => ({
  inspectPaths: vi.fn(),
  listProjectFiles: vi.fn(),
  revealPath: vi.fn(),
}));
const dialog = vi.hoisted(() => ({ message: vi.fn() }));
vi.mock("@tauri-apps/api/core", async (original) => ({
  ...(await original<typeof import("@tauri-apps/api/core")>()),
  isTauri: () => native.tauri,
}));
vi.mock("@tauri-apps/plugin-dialog", async (original) => ({
  ...(await original<typeof import("@tauri-apps/plugin-dialog")>()),
  message: dialog.message,
}));
vi.mock("./fs", async (original) => ({
  ...(await original<typeof import("./fs")>()),
  inspectPaths: fs.inspectPaths,
  listProjectFiles: fs.listProjectFiles,
  revealPath: fs.revealPath,
}));

const {
  chatFileReferences,
  fileReferences,
  locateFileReference,
  openFileReference,
  resolveFileReference,
  revealFileReference,
  touchedFilePaths,
} = await import("./fileReferences");
const { invalidateProjectFiles, loadProjectFiles } =
  await import("./fileIndex");
const { fileLinkHref } = await import("./inAppLinks");

// The reported chat: a project folder that is not a Git repository, with
// the file the agent wrote two folders down, under names with spaces.
const CWD = "/Users/me/Developer/ClippedIn Website";
const LLMS = `${CWD}/ClippedIn Website/design-review/ai-discoverability/llms.txt`;

/** Files on the mocked disk. */
let disk: Set<string>;

const info = (path: string): PathInfo => ({
  path,
  name: path.slice(path.lastIndexOf("/") + 1),
  size: 1,
  isDir: false,
});
const indexed = (path: string): ProjectFile => ({
  path,
  name: path.slice(path.lastIndexOf("/") + 1),
  relative: path.slice(CWD.length + 1),
});
let blockId = 0;
const wrote = (path: string, status = "completed"): Block => ({
  id: `tool-${++blockId}`,
  role: "tool",
  text: "Write",
  tool: { kind: "edit", status, preview: { kind: "write", path } },
});
const reply = (text: string): Block => ({
  id: `reply-${++blockId}`,
  role: "assistant",
  text,
});

beforeEach(() => {
  const stored = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => stored.get(key) ?? null,
    setItem: (key: string, value: string) => void stored.set(key, value),
    removeItem: (key: string) => void stored.delete(key),
  });
  native.tauri = true;
  disk = new Set();
  fs.inspectPaths
    .mockReset()
    .mockImplementation(async (paths: string[]) =>
      paths.filter((path) => disk.has(path)).map(info),
    );
  fs.listProjectFiles.mockReset().mockResolvedValue([]);
  fs.revealPath.mockReset().mockResolvedValue(undefined);
  dialog.message.mockReset().mockResolvedValue(undefined);
  invalidateProjectFiles();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("a bare file name in a reply", () => {
  it("resolves to the file this chat's agent wrote, in a nested non-Git folder", async () => {
    const blocks = [wrote(LLMS), reply("Wrote `llms.txt`.")];
    const references = fileReferences(CWD, touchedFilePaths(blocks, CWD));

    expect(references.resolve("llms.txt")).toEqual({
      path: LLMS,
      written: "llms.txt",
      source: "chat",
    });
    expect(references.resolve("llms.txt:4")).toMatchObject({
      path: LLMS,
      navigation: { line: 4 },
    });
    // A Markdown link arrives wrapped as an internal fragment.
    expect(references.resolve(fileLinkHref("llms.txt"))?.path).toBe(LLMS);

    disk.add(LLMS);
    const open = vi.fn();
    openFileReference(references.resolve("llms.txt:4")!, references, open);
    await vi.waitFor(() =>
      expect(open).toHaveBeenCalledExactlyOnceWith(LLMS, { line: 4 }),
    );
    // A file the chat touched is checked before any project scan.
    expect(fs.listProjectFiles).not.toHaveBeenCalled();
  });

  it("prefers the most recent touched file and skips failed calls", () => {
    const blocks = [
      wrote(`${CWD}/a/notes.md`),
      wrote(`${CWD}/b/notes.md`),
      wrote(`${CWD}/c/notes.md`, "failed"),
    ];
    expect(touchedFilePaths(blocks, CWD)).toEqual([
      `${CWD}/b/notes.md`,
      `${CWD}/a/notes.md`,
    ]);
    const references = fileReferences(CWD, touchedFilePaths(blocks, CWD));
    expect(references.resolve("notes.md")?.path).toBe(`${CWD}/b/notes.md`);
  });

  it("links a bare name with a line only when Aven knows the file", () => {
    const files = [indexed(`${CWD}/src/App.tsx`)];
    expect(
      resolveFileReference("App.tsx:12:3", { cwd: CWD, touched: [], files }),
    ).toEqual({
      path: `${CWD}/src/App.tsx`,
      written: "App.tsx",
      source: "index",
      navigation: { line: 12, column: 3 },
    });
    // A host and port reads the same way; nothing by that name is known.
    expect(
      resolveFileReference("example.com:8080", {
        cwd: CWD,
        touched: [],
        files,
      }),
    ).toBeUndefined();
  });

  it("reads relative tool paths against the chat's folder", () => {
    expect(touchedFilePaths([wrote("src/app.ts")], CWD)).toEqual([
      `${CWD}/src/app.ts`,
    ]);
  });

  it("prefers what its own turn touched over a later turn", () => {
    const chat = chatFileReferences(CWD, [
      [`${CWD}/a/index.ts`],
      [`${CWD}/b/index.ts`],
    ]);
    expect(chat.forTurn(0).resolve("index.ts")?.path).toBe(`${CWD}/a/index.ts`);
    expect(chat.forTurn(1).resolve("index.ts")?.path).toBe(`${CWD}/b/index.ts`);
    // Unknown turn: the whole chat, newest first.
    expect(chat.forTurn().resolve("index.ts")?.path).toBe(`${CWD}/b/index.ts`);
    expect(chat.forTurn(1)).toBe(chat.forTurn(1));
  });

  it("uses the project's file index when exactly one file matches", async () => {
    expect(
      resolveFileReference("llms.txt", {
        cwd: CWD,
        touched: [],
        files: [indexed(LLMS), indexed(`${CWD}/robots.txt`)],
      }),
    ).toEqual({ path: LLMS, written: "llms.txt", source: "index" });

    // The renderer only peeks at a listing already loaded.
    const references = fileReferences(CWD);
    expect(references.resolve("llms.txt")?.source).toBe("join");
    fs.listProjectFiles.mockResolvedValue([indexed(LLMS)]);
    await loadProjectFiles(CWD);
    expect(references.resolve("llms.txt")).toMatchObject({
      path: LLMS,
      source: "index",
    });
  });

  it("does not guess between several matches in the index", async () => {
    const files = [indexed(`${CWD}/a/index.ts`), indexed(`${CWD}/b/index.ts`)];
    expect(
      resolveFileReference("index.ts", { cwd: CWD, touched: [], files }),
    ).toMatchObject({ path: `${CWD}/index.ts`, source: "join" });

    fs.listProjectFiles.mockResolvedValue(files);
    disk = new Set(files.map((file) => file.path));
    const references = fileReferences(CWD);
    const open = vi.fn();
    openFileReference(references.resolve("index.ts")!, references, open);
    await vi.waitFor(() =>
      expect(dialog.message).toHaveBeenCalledExactlyOnceWith(
        "There's more than one index.ts in this project.",
        expect.objectContaining({ kind: "info" }),
      ),
    );
    expect(open).not.toHaveBeenCalled();
  });

  it("opens the file of that name in the project folder when there is one", () => {
    const files = [
      indexed(`${CWD}/README.md`),
      indexed(`${CWD}/docs/README.md`),
    ];
    expect(
      resolveFileReference("README.md", { cwd: CWD, touched: [], files }),
    ).toMatchObject({ path: `${CWD}/README.md`, source: "index" });
  });

  it("never opens a tab for a file that is nowhere, and says so", async () => {
    const references = fileReferences(CWD, [`${CWD}/robots.txt`]);
    const reference = references.resolve("llms.txt")!;
    expect(reference).toMatchObject({
      path: `${CWD}/llms.txt`,
      source: "join",
    });

    const open = vi.fn();
    openFileReference(reference, references, open);
    await vi.waitFor(() =>
      expect(dialog.message).toHaveBeenCalledExactlyOnceWith(
        "Couldn't find llms.txt in this project.",
        expect.objectContaining({ kind: "info" }),
      ),
    );
    expect(open).not.toHaveBeenCalled();

    revealFileReference(reference, references);
    await vi.waitFor(() => expect(dialog.message).toHaveBeenCalledTimes(2));
    expect(fs.revealPath).not.toHaveBeenCalled();
  });

  it("finds a file the index has not seen yet when it is on disk at the join", async () => {
    const references = fileReferences(CWD);
    disk.add(`${CWD}/llms.txt`);
    await expect(
      locateFileReference(references.resolve("llms.txt")!, references),
    ).resolves.toEqual({ path: `${CWD}/llms.txt` });
  });
});

describe("a relative path with folders", () => {
  const RELATIVE = "design-review/ai-discoverability/llms.txt";
  const JOINED = `${CWD}/${RELATIVE}`;

  it("is found where the chat touched it when it is not under the project folder", async () => {
    const references = fileReferences(CWD, [LLMS]);
    expect(references.resolve(RELATIVE)).toMatchObject({
      path: LLMS,
      source: "chat",
    });
    disk.add(LLMS);
    await expect(
      locateFileReference(references.resolve(RELATIVE)!, references),
    ).resolves.toEqual({ path: LLMS });
  });

  it("keeps the project folder's file when it exists there", async () => {
    expect(
      resolveFileReference(RELATIVE, {
        cwd: CWD,
        touched: [LLMS],
        files: [indexed(JOINED), indexed(LLMS)],
      }),
    ).toMatchObject({ path: JOINED, source: "index" });

    const references = fileReferences(CWD, [LLMS]);
    disk = new Set([JOINED, LLMS]);
    await expect(
      locateFileReference(references.resolve(RELATIVE)!, references),
    ).resolves.toEqual({ path: JOINED });
  });

  it("only joins a path that climbs out with ..", () => {
    const references = fileReferences(CWD, [LLMS]);
    expect(references.resolve("../other/llms.txt")).toMatchObject({
      path: "/Users/me/Developer/other/llms.txt",
      source: "join",
    });
  });
});

describe("absolute and home paths", () => {
  it("resolve as written, whatever the chat touched", () => {
    const references = fileReferences(CWD, [LLMS]);
    expect(references.resolve("/elsewhere/llms.txt")).toEqual({
      path: "/elsewhere/llms.txt",
      written: "/elsewhere/llms.txt",
      source: "written",
    });
    expect(references.resolve("~/notes/llms.txt")?.path).toBe(
      "~/notes/llms.txt",
    );
    expect(references.resolve("file:///x/llms.txt#L2")).toMatchObject({
      path: "/x/llms.txt",
      navigation: { line: 2 },
    });
    expect(references.resolve("https://example.com/llms.txt")).toBeUndefined();
  });

  it("are not opened when nothing is there", async () => {
    const references = fileReferences(CWD);
    const open = vi.fn();
    openFileReference(
      references.resolve("/elsewhere/llms.txt")!,
      references,
      open,
    );
    await vi.waitFor(() =>
      expect(dialog.message).toHaveBeenCalledWith(
        "llms.txt isn't at that location.",
        expect.anything(),
      ),
    );
    expect(open).not.toHaveBeenCalled();
  });
});

describe("when the disk cannot be checked", () => {
  it("opens the best guess at once outside the desktop app", () => {
    native.tauri = false;
    const references = fileReferences(CWD);
    const open = vi.fn();
    openFileReference(references.resolve("llms.txt")!, references, open);
    expect(open).toHaveBeenCalledExactlyOnceWith(`${CWD}/llms.txt`, undefined);
    expect(fs.inspectPaths).not.toHaveBeenCalled();
  });

  it("opens the best guess when the check fails", async () => {
    fs.inspectPaths.mockRejectedValue(new Error("unavailable"));
    const references = fileReferences(CWD, [LLMS]);
    const open = vi.fn();
    openFileReference(references.resolve("llms.txt")!, references, open);
    await vi.waitFor(() =>
      expect(open).toHaveBeenCalledExactlyOnceWith(LLMS, undefined),
    );
  });
});

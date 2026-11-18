// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  WorkspaceInspector,
  type WorkspaceInspectorProps,
} from "./WorkspaceInspector";

const mocks = vi.hoisted(() => ({
  runScript: vi.fn(() => Promise.resolve()),
  setups: {} as Record<string, string>,
}));

vi.mock("./FileTree", () => ({
  FileTree: () => createElement("div", { "data-content": "files" }),
}));
vi.mock("../hooks/useGitFileStatuses", () => ({
  useGitFileStatuses: () => ({ files: new Map(), dirs: new Map() }),
}));
vi.mock("../hooks/useProjectDiffStats", () => ({
  useProjectDiffStats: () => null,
}));
vi.mock("./DotSpinner", () => ({ DotSpinner: () => null }));
vi.mock("../lib/fs", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/fs")>()),
  listDir: () => Promise.resolve([]),
  readTextFile: () => Promise.reject(new Error("none")),
}));
vi.mock("../lib/projectScripts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/projectScripts")>()),
  loadSetupScript: (project: string) => mocks.setups[project] ?? "",
  setupRanIn: () => false,
  runScript: mocks.runScript,
}));

let root: Root;
let container: HTMLDivElement;
let props: WorkspaceInspectorProps;

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const stored = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => stored.get(key) ?? null,
    setItem: (key: string, value: string) => void stored.set(key, value),
    removeItem: (key: string) => void stored.delete(key),
  });
  mocks.setups = { "/a": "echo a", "/b": "echo b" };
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  props = {
    active: true,
    cwd: "/a",
    gitCwd: "/a",
    tab: "files",
    onTabChange: vi.fn(),
    onOpenFile: vi.fn(),
    onOpenDiff: vi.fn(),
    onOpenAllChanges: vi.fn(),
    onOpenCommit: vi.fn(),
    filesSearchOpen: false,
    onFilesSearchOpenChange: vi.fn(),
  };
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

async function render(patch: Partial<WorkspaceInspectorProps> = {}) {
  props = { ...props, ...patch };
  await act(async () => root.render(createElement(WorkspaceInspector, props)));
}

describe("WorkspaceInspector project switch", () => {
  it("runs the new project's setup in its fresh copy, never the last project's", async () => {
    await render();
    expect(mocks.runScript).not.toHaveBeenCalled();
    await render({ cwd: "/b", gitCwd: "/b-copy" });
    expect(mocks.runScript).toHaveBeenCalledOnce();
    expect(mocks.runScript).toHaveBeenCalledWith(
      "setup",
      "Setup",
      "echo b",
      "/b-copy",
    );
  });

  it("runs nothing in a fresh copy of a project without a setup script", async () => {
    await render();
    await render({ cwd: "/c", gitCwd: "/c-copy" });
    expect(mocks.runScript).not.toHaveBeenCalled();
  });
});

// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  WorkspaceInspector,
  type WorkspaceInspectorProps,
} from "./WorkspaceInspector";

const mocks = vi.hoisted(() => ({
  loadFiles: vi.fn(),
  loadChanges: vi.fn(),
  mountFiles: vi.fn(),
}));

vi.mock("./FileTree", () => {
  mocks.loadFiles();
  return {
    FileTree: () => {
      mocks.mountFiles();
      return createElement("div", { "data-content": "files" });
    },
  };
});
vi.mock("../hooks/useGitFileStatuses", () => ({
  useGitFileStatuses: () => ({ files: new Map(), dirs: new Map() }),
}));
vi.mock("./SourceControl", () => {
  mocks.loadChanges();
  return { SourceControl: () => null };
});

let root: Root;
let container: HTMLDivElement;

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const props: WorkspaceInspectorProps = {
  active: false,
  cwd: "/project",
  tab: "files",
  onTabChange: () => undefined,
  onOpenFile: () => undefined,
  onOpenDiff: () => undefined,
  onOpenAllChanges: () => undefined,
  onOpenCommit: () => undefined,
  filesSearchOpen: false,
  onFilesSearchOpenChange: () => undefined,
};

describe("WorkspaceInspector preload", () => {
  it("loads a closed panel's tab once startup settles, without mounting it", async () => {
    await act(async () =>
      root.render(createElement(WorkspaceInspector, props)),
    );
    expect(mocks.loadFiles).not.toHaveBeenCalled();
    await act(async () => vi.advanceTimersByTimeAsync(5_000));
    expect(mocks.loadFiles).toHaveBeenCalledOnce();
    expect(mocks.loadChanges).not.toHaveBeenCalled();
    expect(mocks.mountFiles).not.toHaveBeenCalled();
    // Opened now, the tab draws at once rather than its loading line.
    await act(async () =>
      root.render(
        createElement(WorkspaceInspector, { ...props, active: true }),
      ),
    );
    expect(container.textContent).not.toContain("Loading");
    expect(container.querySelector('[data-content="files"]')).not.toBeNull();
  });
});

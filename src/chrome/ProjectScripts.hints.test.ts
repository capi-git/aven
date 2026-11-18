// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { beginSidePanelOpen, endSidePanelOpen } from "../lib/sidePanel";
import { resetSidePanelReadsForTest } from "../lib/sidePanelReads";
import { ProjectScripts } from "./ProjectScripts";

const fs = vi.hoisted(() => ({
  listDir: vi.fn(),
  readTextFile: vi.fn(),
  subscribeGitChanged: () => () => undefined,
}));
vi.mock("../lib/fs", () => fs);
vi.mock("./DotSpinner", () => ({ DotSpinner: () => null }));

let root: Root;
let container: HTMLDivElement;
let project = 0;
let path: string;

beforeEach(() => {
  vi.clearAllMocks();
  resetSidePanelReadsForTest();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const stored = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => stored.get(key) ?? null,
    setItem: (key: string, value: string) => void stored.set(key, value),
    removeItem: (key: string) => void stored.delete(key),
  });
  path = `/hints-${++project}`;
  fs.listDir.mockResolvedValue([
    { name: "package.json", path: `${path}/package.json`, isDir: false },
  ]);
  fs.readTextFile.mockResolvedValue(
    JSON.stringify({ scripts: { dev: "vite" } }),
  );
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

async function render(active: boolean) {
  await act(async () =>
    root.render(
      createElement(ProjectScripts, { project: path, cwd: path, active }),
    ),
  );
}

describe("ProjectScripts hints", () => {
  it("lists the project once per read, after the side panel slides in", async () => {
    beginSidePanelOpen();
    await render(true);
    expect(fs.listDir).not.toHaveBeenCalled();
    await act(async () => endSidePanelOpen());
    expect(fs.listDir).toHaveBeenCalledOnce();
    expect(fs.readTextFile).toHaveBeenCalledOnce();
  });

  it("reuses hints read moments ago when the panel shows again", async () => {
    await render(true);
    await render(false);
    await render(true);
    expect(fs.listDir).toHaveBeenCalledOnce();
  });

  it("reads no package.json in a project without one", async () => {
    fs.listDir.mockResolvedValue([]);
    await render(true);
    expect(fs.listDir).toHaveBeenCalledOnce();
    expect(fs.readTextFile).not.toHaveBeenCalled();
  });
});

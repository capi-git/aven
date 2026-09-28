// @vitest-environment happy-dom
import { act, createElement, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  newChangesTab,
  newFileTab,
  newPlanTab,
  newTerminalFile,
} from "../lib/layout";
import type { WorkspaceMenuPanelSnapshot } from "../lib/workspaceMenuPanel";
import { SurfaceTabs } from "./SurfaceTabs";

const mocks = vi.hoisted(() => ({ panel: vi.fn(), sortable: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => true }));
vi.mock("../hooks/useWorkspaceMenuPanel", () => ({
  useWorkspaceMenuPanel: mocks.panel,
}));
vi.mock("../lib/usagePanel", () => ({
  useUsagePanelTheme: () => ({
    mode: "dark",
    background: "#222",
    text: "#fff",
    accent: "#aaa",
  }),
}));
vi.mock("../hooks/useSortable", () => ({
  useSortable: (ids: string[], onReorder: (ids: string[]) => void) => {
    mocks.sortable(ids, onReorder);
    return {
      draggingId: null,
      toIndex: null,
      fromIndex: null,
      setContainerRef: () => {},
      setItemRef: () => {},
      onItemPointerDown: () => {},
      consumeClick: () => false,
    };
  },
}));

type Props = ComponentProps<typeof SurfaceTabs>;
type Panel = {
  snapshot: WorkspaceMenuPanelSnapshot;
  onSelect: (id: string) => void;
};
let root: Root;
let host: HTMLElement;
let props: Props;
const a = newFileTab("/repo/a.md", "/repo");
const b = newFileTab("/repo/b.md", "/repo");
const c = newFileTab("/repo/c.md", "/repo");
const tabLabels = () =>
  Array.from(host.querySelectorAll('[role="tab"] .aven-preview-tab-label')).map(
    (tab) => tab.textContent,
  );
const button = (label: string) =>
  Array.from(host.querySelectorAll("button")).find(
    (node) =>
      node.getAttribute("aria-label") === label || node.textContent === label,
  )!;
const render = async (patch: Partial<Props> = {}) => {
  props = { ...props, ...patch };
  await act(async () => root.render(createElement(SurfaceTabs, props)));
};
const click = async (node: HTMLElement) => act(async () => node.click());
const openRecent = async () => {
  await click(button("Recent files"));
  return mocks.panel.mock.calls.at(-1)![0] as Panel;
};

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  mocks.panel.mockClear();
  mocks.sortable.mockClear();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  props = {
    files: [a, b, c],
    activeFileId: c.id,
    dirtyFileIds: new Set(),
    fileErrorCounts: new Map(),
    onSelectFile: vi.fn(),
    onCloseFile: vi.fn(),
    onKeepFile: vi.fn(),
    onReorder: vi.fn(),
  };
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

it("shows one preview and can recover every older file from searchable Recent", async () => {
  await render();
  expect(tabLabels()).toEqual(["c.md"]);
  expect(host.querySelectorAll(".aven-preview-badge")).toHaveLength(1);
  const recent = await openRecent();
  expect(recent.snapshot.searchable).toBe(true);
  expect(recent.snapshot.items.map((item) => item.label)).toEqual([
    "c.md",
    "b.md",
    "a.md",
  ]);
  await act(async () => recent.onSelect("menu-item-2"));
  expect(props.onSelectFile).toHaveBeenCalledExactlyOnceWith(a.id);
  await render({ activeFileId: a.id });
  expect(tabLabels()).toEqual(["a.md"]);
  expect(props.files).toEqual([a, b, c]);
});

it("keeps previews through either action without resurfacing older hidden tabs", async () => {
  await render();
  await click(button("Keep open"));
  expect(props.onKeepFile).toHaveBeenCalledExactlyOnceWith(c.id);
  await render({ files: [a, b, { ...c, kept: true }] });
  expect(tabLabels()).toEqual(["c.md"]);
  expect(host.querySelector(".aven-preview-badge")).toBeNull();
  await render({ activeFileId: b.id });
  expect(tabLabels()).toEqual(["b.md", "c.md"]);
  await act(async () =>
    host
      .querySelector('[role="tab"]')!
      .dispatchEvent(new MouseEvent("dblclick", { bubbles: true })),
  );
  expect(props.onKeepFile).toHaveBeenLastCalledWith(b.id);
});

it("retains dirty, kept and special surfaces beside the single ordinary preview", async () => {
  const plan = newPlanTab("session", "block", "Plan", "/repo");
  const changes = newChangesTab("/repo");
  const terminal = newTerminalFile("/repo");
  await render({
    files: [a, b, c, plan, changes, terminal],
    dirtyFileIds: new Set([a.id]),
  });
  expect(tabLabels()).toEqual(["a.md", "c.md", "Plan", "Changes", "repo"]);
  expect(host.querySelector('[aria-label="Unsaved changes"]')).not.toBeNull();
  await render({
    files: [{ ...a, kept: true }, b, c, plan, changes, terminal],
    dirtyFileIds: new Set(),
  });
  expect(tabLabels()).toEqual(["a.md", "c.md", "Plan", "Changes", "repo"]);
  expect(host.querySelector('[aria-label="Unsaved changes"]')).toBeNull();
});

it("reorders visible tabs with the complete original identity list", async () => {
  await render({ files: [{ ...a, kept: true }, b, c] });
  const [visible, reorder] = mocks.sortable.mock.calls.at(-1)!;
  expect(visible).toEqual([a.id, c.id]);
  reorder([c.id, a.id]);
  expect(props.onReorder).toHaveBeenCalledExactlyOnceWith([c.id, b.id, a.id]);
});

it("disambiguates matching names in Recent by their full paths", async () => {
  const other = newFileTab("/repo/docs/a.md", "/repo");
  await render({ files: [a, other], activeFileId: other.id });
  const recent = await openRecent();
  expect(recent.snapshot.items.map((item) => item.label)).toEqual([
    "a.md",
    "a.md",
  ]);
  expect(recent.snapshot.items.map((item) => item.description)).toEqual([
    other.path,
    a.path,
  ]);
});

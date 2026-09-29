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
const tab = (label: string) =>
  Array.from(host.querySelectorAll<HTMLButtonElement>('[role="tab"]')).find(
    (node) =>
      node.querySelector(".aven-preview-tab-label")?.textContent === label,
  )!;
const keydown = async (
  node: HTMLElement,
  key: string,
  options: KeyboardEventInit = {},
) => {
  const event = new KeyboardEvent("keydown", {
    bubbles: true,
    cancelable: true,
    key,
    ...options,
  });
  await act(async () => node.dispatchEvent(event));
  return event;
};
const selectOnRender = (id: string) => {
  props = { ...props, activeFileId: id };
  root.render(createElement(SurfaceTabs, props));
};
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

it("uses one tab stop and activates visible tabs with arrows, Home and End", async () => {
  await render({
    files: [a, b, c].map((file) => ({ ...file, kept: true })),
    activeFileId: b.id,
    onSelectFile: vi.fn(selectOnRender),
  });
  expect([
    tab("a.md").tabIndex,
    tab("b.md").tabIndex,
    tab("c.md").tabIndex,
  ]).toEqual([-1, 0, -1]);
  expect(button("Close a.md").tabIndex).toBe(-1);
  expect(button("Close b.md").tabIndex).toBe(0);
  tab("b.md").focus();
  expect((await keydown(tab("b.md"), "ArrowRight")).defaultPrevented).toBe(
    true,
  );
  expect(document.activeElement).toBe(tab("c.md"));
  expect(props.activeFileId).toBe(c.id);
  expect(tab("c.md").tabIndex).toBe(0);

  await keydown(tab("c.md"), "ArrowRight");
  expect(document.activeElement).toBe(tab("a.md"));
  await keydown(tab("a.md"), "ArrowLeft");
  expect(document.activeElement).toBe(tab("c.md"));
  await keydown(tab("c.md"), "Home");
  expect(document.activeElement).toBe(tab("a.md"));
  await keydown(tab("a.md"), "End");
  expect(document.activeElement).toBe(tab("c.md"));
  expect(props.onSelectFile).toHaveBeenCalledTimes(5);
});

it("navigates retained files and terminals without selecting hidden recent previews", async () => {
  const terminal = newTerminalFile("/repo", "Console");
  await render({
    files: [a, b, c, terminal],
    dirtyFileIds: new Set([a.id]),
    onSelectFile: vi.fn(selectOnRender),
  });
  expect(tabLabels()).toEqual(["a.md", "c.md", "Console"]);
  tab("c.md").focus();
  await keydown(tab("c.md"), "ArrowRight");
  expect(document.activeElement).toBe(tab("Console"));
  expect(tabLabels()).toEqual(["a.md", "Console"]);
  await keydown(tab("Console"), "ArrowLeft");
  expect(document.activeElement).toBe(tab("a.md"));
  expect(props.onSelectFile).toHaveBeenNthCalledWith(1, terminal.id);
  expect(props.onSelectFile).toHaveBeenNthCalledWith(2, a.id);
  expect(props.onKeepFile).not.toHaveBeenCalled();
  expect(props.onCloseFile).not.toHaveBeenCalled();
  expect(props.onReorder).not.toHaveBeenCalled();
  expect(props.files.map((file) => file.id)).toEqual([
    a.id,
    b.id,
    c.id,
    terminal.id,
  ]);
});

it("leaves close controls, actions, text fields and modified navigation keys alone", async () => {
  await render({
    files: [{ ...a, kept: true }, b, c],
    trailing: createElement("input", { "aria-label": "Rename terminal" }),
  });
  for (const node of [
    button("Close c.md"),
    button("Keep open"),
    button("Recent files"),
    host.querySelector("input")!,
  ]) {
    node.focus();
    expect((await keydown(node, "ArrowLeft")).defaultPrevented).toBe(false);
    expect(document.activeElement).toBe(node);
  }
  for (const modifier of ["altKey", "ctrlKey", "metaKey", "shiftKey"]) {
    expect(
      (await keydown(tab("c.md"), "Home", { [modifier]: true }))
        .defaultPrevented,
    ).toBe(false);
  }
  expect((await keydown(tab("c.md"), "ArrowDown")).defaultPrevented).toBe(
    false,
  );
  expect(props.onSelectFile).not.toHaveBeenCalled();
});

it("restores focus after a focused close control is removed", async () => {
  await render({ files: [{ ...a, kept: true }, b, c] });
  button("Close c.md").focus();
  await click(button("Close c.md"));
  expect(props.onCloseFile).toHaveBeenCalledExactlyOnceWith(c.id);
  // The parent can defer the close while it confirms unsaved changes.
  await render();
  expect(document.activeElement).toBe(button("Close c.md"));
  await render({ files: [{ ...a, kept: true }, b], activeFileId: b.id });
  expect(document.activeElement).toBe(tab("b.md"));
  expect(props.onSelectFile).not.toHaveBeenCalled();
});

it("recovers focus when an active preview disappears and when the list becomes empty", async () => {
  await render({ files: [{ ...a, kept: true }, b, c] });
  tab("c.md").focus();
  await render({ activeFileId: a.id });
  expect(tabLabels()).toEqual(["a.md"]);
  expect(document.activeElement).toBe(tab("a.md"));
  await render({ files: [], activeFileId: "" });
  const tablist = host.querySelector<HTMLElement>('[role="tablist"]')!;
  expect(document.activeElement).toBe(tablist);
  expect(tablist.tabIndex).toBe(0);
});

it("keeps focus outside the tabs when a deferred close finishes", async () => {
  await render({ files: [{ ...a, kept: true }, b, c] });
  button("Close c.md").focus();
  await click(button("Close c.md"));
  const dialogInput = document.createElement("input");
  document.body.append(dialogInput);
  try {
    dialogInput.focus();
    await render({ files: [{ ...a, kept: true }, b], activeFileId: b.id });
    expect(document.activeElement).toBe(dialogInput);
  } finally {
    dialogInput.remove();
  }
});

it("does not recover a tab control that the user already blurred", async () => {
  await render({ files: [{ ...a, kept: true }, b, c] });
  tab("c.md").focus();
  tab("c.md").blur();
  await render({ files: [{ ...a, kept: true }, b], activeFileId: b.id });
  expect(document.activeElement).toBe(document.body);
});

it("keeps the first visible tab reachable while the active identity is unavailable", async () => {
  await render({
    files: [{ ...a, kept: true }, { ...b, kept: true }, c],
    activeFileId: "missing",
    onSelectFile: vi.fn(selectOnRender),
  });
  expect(tabLabels()).toEqual(["a.md", "b.md"]);
  expect(tab("a.md").tabIndex).toBe(0);
  expect(tab("b.md").tabIndex).toBe(-1);
  await keydown(tab("a.md"), "End");
  expect(document.activeElement).toBe(tab("b.md"));
  expect(props.activeFileId).toBe(b.id);
});

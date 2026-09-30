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
import { SurfaceTabs } from "./SurfaceTabs";

const mocks = vi.hoisted(() => ({ sortable: vi.fn() }));
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
let root: Root;
let host: HTMLElement;
let props: Props;
const a = newFileTab("/repo/a.md", "/repo");
const b = newFileTab("/repo/b.md", "/repo");
const c = newFileTab("/repo/c.md", "/repo");
const tabLabels = () =>
  Array.from(host.querySelectorAll('[role="tab"]')).map((node) =>
    node.textContent?.trim(),
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
    (node) => node.textContent?.trim() === label,
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

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
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
    onReorder: vi.fn(),
  };
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

it("keeps each newly opened file visible beside earlier files", async () => {
  await render({ files: [a], activeFileId: a.id });
  expect(tabLabels()).toEqual(["a.md"]);
  await render({ files: [a, b], activeFileId: b.id });
  expect(tabLabels()).toEqual(["a.md", "b.md"]);
  await render({ files: [a, b, c], activeFileId: c.id });
  expect(tabLabels()).toEqual(["a.md", "b.md", "c.md"]);
  await click(tab("a.md"));
  expect(props.onSelectFile).toHaveBeenCalledExactlyOnceWith(a.id);
  await render({ activeFileId: a.id });
  expect(tabLabels()).toEqual(["a.md", "b.md", "c.md"]);
  expect(props.onCloseFile).not.toHaveBeenCalled();
});

it("shows files with mixed legacy retention metadata without pin or preview controls", async () => {
  await render({ files: [{ ...a, kept: true }, b, { ...c, kept: false }] });
  expect(tabLabels()).toEqual(["a.md", "b.md", "c.md"]);
  expect(host.querySelector('[title="Keep this file open"]')).toBeNull();
  expect(host.querySelector('[aria-label="Recent files"]')).toBeNull();
  expect(host.querySelector(".aven-preview-badge")).toBeNull();
  expect(host.querySelector("[data-preview]")).toBeNull();
  await act(async () =>
    tab("b.md").dispatchEvent(new MouseEvent("dblclick", { bubbles: true })),
  );
  expect(tabLabels()).toEqual(["a.md", "b.md", "c.md"]);
  expect(props.onCloseFile).not.toHaveBeenCalled();
  expect(props.onReorder).not.toHaveBeenCalled();
});

it("shows ordinary files and special surfaces while dirty state changes", async () => {
  const plan = newPlanTab("session", "block", "Plan", "/repo");
  const changes = newChangesTab("/repo");
  const terminal = newTerminalFile("/repo");
  await render({
    files: [a, b, c, plan, changes, terminal],
    dirtyFileIds: new Set([a.id]),
  });
  expect(tabLabels()).toEqual([
    "a.md",
    "b.md",
    "c.md",
    "Plan",
    "Changes",
    "repo",
  ]);
  expect(host.querySelector('[aria-label="Unsaved changes"]')).not.toBeNull();
  await render({ dirtyFileIds: new Set() });
  expect(tabLabels()).toEqual([
    "a.md",
    "b.md",
    "c.md",
    "Plan",
    "Changes",
    "repo",
  ]);
  expect(host.querySelector('[aria-label="Unsaved changes"]')).toBeNull();
});

it("reorders every open file identity regardless of legacy retention metadata", async () => {
  await render({ files: [{ ...a, kept: true }, b, c] });
  const [ids, reorder] = mocks.sortable.mock.calls.at(-1)!;
  expect(ids).toEqual([a.id, b.id, c.id]);
  reorder([c.id, a.id, b.id]);
  expect(props.onReorder).toHaveBeenCalledExactlyOnceWith([c.id, a.id, b.id]);
});

it("disambiguates files with matching names using their full path tooltips", async () => {
  const other = newFileTab("/repo/docs/a.md", "/repo");
  await render({ files: [a, other], activeFileId: other.id });
  expect(tabLabels()).toEqual(["a.md", "a.md"]);
  expect(
    Array.from(host.querySelectorAll('[role="tab"]')).map((node) =>
      node.getAttribute("title"),
    ),
  ).toEqual([a.path, other.path]);
  await click(host.querySelectorAll<HTMLButtonElement>('[role="tab"]')[0]);
  expect(props.onSelectFile).toHaveBeenCalledExactlyOnceWith(a.id);
});

it("uses one tab stop and activates files with arrows, Home and End", async () => {
  await render({ activeFileId: b.id, onSelectFile: vi.fn(selectOnRender) });
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

it("navigates every ordinary file beside a terminal without changing membership", async () => {
  const terminal = newTerminalFile("/repo", "Console");
  await render({
    files: [a, b, c, terminal],
    dirtyFileIds: new Set([a.id]),
    onSelectFile: vi.fn(selectOnRender),
  });
  tab("a.md").focus();
  await keydown(tab("a.md"), "ArrowRight");
  expect(document.activeElement).toBe(tab("b.md"));
  await keydown(tab("b.md"), "End");
  expect(document.activeElement).toBe(tab("Console"));
  await keydown(tab("Console"), "ArrowLeft");
  expect(document.activeElement).toBe(tab("c.md"));
  expect(tabLabels()).toEqual(["a.md", "b.md", "c.md", "Console"]);
  expect(props.onSelectFile).toHaveBeenNthCalledWith(1, b.id);
  expect(props.onSelectFile).toHaveBeenNthCalledWith(2, terminal.id);
  expect(props.onSelectFile).toHaveBeenNthCalledWith(3, c.id);
  expect(props.onCloseFile).not.toHaveBeenCalled();
  expect(props.onReorder).not.toHaveBeenCalled();
});

it("leaves close controls, trailing actions, text fields and modified keys alone", async () => {
  await render({
    trailing: createElement(
      "div",
      null,
      createElement("button", { "aria-label": "Trailing action" }, "Action"),
      createElement("input", { "aria-label": "Rename terminal" }),
    ),
  });
  for (const node of [
    button("Close c.md"),
    button("Trailing action"),
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
  await render();
  button("Close c.md").focus();
  await click(button("Close c.md"));
  expect(props.onCloseFile).toHaveBeenCalledExactlyOnceWith(c.id);
  // The parent can defer the close while it confirms unsaved changes.
  await render();
  expect(document.activeElement).toBe(button("Close c.md"));
  await render({ files: [a, b], activeFileId: b.id });
  expect(document.activeElement).toBe(tab("b.md"));
  expect(props.onSelectFile).not.toHaveBeenCalled();
});

it("recovers focus when the focused file closes and when the list becomes empty", async () => {
  await render();
  tab("c.md").focus();
  await render({ files: [a, b], activeFileId: a.id });
  expect(tabLabels()).toEqual(["a.md", "b.md"]);
  expect(document.activeElement).toBe(tab("a.md"));
  await render({ files: [], activeFileId: "" });
  const tablist = host.querySelector<HTMLElement>('[role="tablist"]')!;
  expect(document.activeElement).toBe(tablist);
  expect(tablist.tabIndex).toBe(0);
});

it("keeps focus outside the tabs when a deferred close finishes", async () => {
  await render();
  button("Close c.md").focus();
  await click(button("Close c.md"));
  const dialogInput = document.createElement("input");
  document.body.append(dialogInput);
  try {
    dialogInput.focus();
    await render({ files: [a, b], activeFileId: b.id });
    expect(document.activeElement).toBe(dialogInput);
  } finally {
    dialogInput.remove();
  }
});

it("does not recover a tab control that the user already blurred", async () => {
  await render();
  tab("c.md").focus();
  tab("c.md").blur();
  await render({ files: [a, b], activeFileId: b.id });
  expect(document.activeElement).toBe(document.body);
});

it("keeps all files reachable while the active identity is unavailable", async () => {
  await render({
    files: [{ ...a, kept: true }, { ...b, kept: true }, c],
    activeFileId: "missing",
    onSelectFile: vi.fn(selectOnRender),
  });
  expect(tabLabels()).toEqual(["a.md", "b.md", "c.md"]);
  expect(tab("a.md").tabIndex).toBe(0);
  expect(tab("b.md").tabIndex).toBe(-1);
  await keydown(tab("a.md"), "End");
  expect(document.activeElement).toBe(tab("c.md"));
  expect(props.activeFileId).toBe(c.id);
});

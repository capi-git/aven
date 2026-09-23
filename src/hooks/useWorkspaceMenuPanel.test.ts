// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  nativeWorkspaceMenuPanel,
  type WorkspaceMenuPanelHandle,
  type WorkspaceMenuPanelSnapshot,
} from "../lib/workspaceMenuPanel";
import { useWorkspaceMenuPanel } from "./useWorkspaceMenuPanel";

vi.mock("../lib/workspaceMenuPanel", () => ({
  nativeWorkspaceMenuPanel: {
    listen: vi.fn(),
    open: vi.fn(),
    update: vi.fn(),
    close: vi.fn(),
  },
}));

type PanelEvent = WorkspaceMenuPanelHandle & { action?: string };
type Props = Parameters<typeof useWorkspaceMenuPanel>[0];
const label = "workspace-menu-panel-retained";
const first = { label, presentation: "first" };
const second = { label, presentation: "second" };
const snapshot: WorkspaceMenuPanelSnapshot = {
  title: "Tab actions",
  compact: true,
  theme: { mode: "dark", accent: "#6cabdd" },
  items: [
    { id: "menu-item-0", label: "Split left" },
    { id: "menu-item-1", label: "Combine tabs", disabled: true },
  ],
};
let host: HTMLDivElement;
let root: Root;
let anchorElement: HTMLButtonElement;
let props: Props;
let listeners: Map<string, Set<(event: PanelEvent) => void>>;

function Fixture(value: Props) {
  useWorkspaceMenuPanel(value);
  return null;
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
async function render(next: Partial<Props> = {}) {
  props = { ...props, ...next };
  await act(async () => root.render(createElement(Fixture, props)));
}
async function emit(name: string, event: PanelEvent) {
  await act(async () => {
    for (const callback of listeners.get(name) ?? []) callback(event);
  });
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  host = document.createElement("div");
  anchorElement = document.createElement("button");
  document.body.append(host, anchorElement);
  root = createRoot(host);
  listeners = new Map();
  props = {
    open: true,
    anchor: { current: anchorElement },
    snapshot,
    onSelect: vi.fn(),
    onClose: vi.fn(),
    onError: vi.fn(),
  };
  vi.mocked(nativeWorkspaceMenuPanel.listen).mockImplementation(
    async (event, callback) => {
      const callbacks = listeners.get(event) ?? new Set();
      const typed = callback as (event: PanelEvent) => void;
      callbacks.add(typed);
      listeners.set(event, callbacks);
      return () => {
        callbacks.delete(typed);
      };
    },
  );
  vi.mocked(nativeWorkspaceMenuPanel.open).mockResolvedValue(first);
  vi.mocked(nativeWorkspaceMenuPanel.update).mockResolvedValue(second);
  vi.mocked(nativeWorkspaceMenuPanel.close).mockResolvedValue(undefined);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  anchorElement.remove();
  vi.unstubAllGlobals();
  vi.resetAllMocks();
});

it("accepts only the current enabled action once and focuses its element anchor", async () => {
  await render();
  for (const event of [
    { ...first, label: "another-owner", action: "menu-item-0" },
    { ...first, presentation: "stale", action: "menu-item-0" },
    { ...first, action: "menu-item-1" },
    { ...first, action: "unknown" },
  ])
    await emit("workspace-menu-panel-action", event);
  expect(props.onSelect).not.toHaveBeenCalled();
  expect(props.onClose).not.toHaveBeenCalled();
  await emit("workspace-menu-panel-action", {
    ...first,
    action: "menu-item-0",
  });
  await emit("workspace-menu-panel-action", {
    ...first,
    action: "menu-item-0",
  });
  await emit("workspace-menu-panel-closed", first);
  expect(props.onSelect).toHaveBeenCalledExactlyOnceWith("menu-item-0");
  expect(props.onClose).toHaveBeenCalledOnce();
  expect(document.activeElement).toBe(anchorElement);
});

it("ignores delayed closed events when the same renderer reopens with a new nonce", async () => {
  await render();
  await render({ open: false });
  expect(nativeWorkspaceMenuPanel.close).toHaveBeenCalledExactlyOnceWith(
    "first",
  );
  vi.mocked(nativeWorkspaceMenuPanel.open).mockResolvedValue(second);
  await render({ open: true });
  await emit("workspace-menu-panel-closed", first);
  expect(props.onClose).not.toHaveBeenCalled();
  await emit("workspace-menu-panel-action", {
    ...second,
    action: "menu-item-0",
  });
  expect(props.onSelect).toHaveBeenCalledExactlyOnceWith("menu-item-0");
  expect(props.onClose).toHaveBeenCalledOnce();
});

it("does not route an old selection through reassigned item IDs while an update is pending", async () => {
  await render();
  const pending = deferred<WorkspaceMenuPanelHandle | null>();
  vi.mocked(nativeWorkspaceMenuPanel.update).mockReturnValue(pending.promise);
  const next: WorkspaceMenuPanelSnapshot = {
    ...snapshot,
    items: [{ id: "menu-item-0", label: "Close browser" }],
  };
  const newSelect = vi.fn();
  await render({ snapshot: next, onSelect: newSelect });
  expect(nativeWorkspaceMenuPanel.update).toHaveBeenCalledWith("first", next);
  await emit("workspace-menu-panel-action", {
    ...first,
    action: "menu-item-0",
  });
  await emit("workspace-menu-panel-closed", first);
  expect(newSelect).not.toHaveBeenCalled();
  // The old selection won in native code, so there is no new presentation.
  await act(async () => pending.resolve(null));
  expect(newSelect).not.toHaveBeenCalled();
  expect(props.onClose).toHaveBeenCalledOnce();
});

it("filters old actions after a content update succeeds and keeps point anchors focus-free", async () => {
  const point = { x: 250, y: 80, width: 0, height: 0 };
  await render({ anchor: { current: point } });
  const pending = deferred<WorkspaceMenuPanelHandle | null>();
  vi.mocked(nativeWorkspaceMenuPanel.update).mockReturnValue(pending.promise);
  const next = {
    ...snapshot,
    items: [{ id: "menu-item-0", label: "Close browser" }],
  };
  await render({ snapshot: next });
  await emit("workspace-menu-panel-action", {
    ...first,
    action: "menu-item-0",
  });
  await act(async () => pending.resolve(second));
  expect(props.onSelect).not.toHaveBeenCalled();
  expect(props.onClose).not.toHaveBeenCalled();
  await emit("workspace-menu-panel-action", {
    ...second,
    action: "menu-item-0",
  });
  expect(props.onSelect).toHaveBeenCalledExactlyOnceWith("menu-item-0");
  expect(document.activeElement).not.toBe(anchorElement);
});

it("closes only its own presentation when unmounted before open resolves", async () => {
  const pending = deferred<WorkspaceMenuPanelHandle>();
  vi.mocked(nativeWorkspaceMenuPanel.open).mockReturnValue(pending.promise);
  await render();
  expect(nativeWorkspaceMenuPanel.open).toHaveBeenCalledOnce();
  await act(async () => root.render(null));
  expect(nativeWorkspaceMenuPanel.close).not.toHaveBeenCalled();
  await act(async () => pending.resolve(first));
  expect(nativeWorkspaceMenuPanel.close).toHaveBeenCalledExactlyOnceWith(
    "first",
  );
  expect(props.onSelect).not.toHaveBeenCalled();
  expect(props.onClose).not.toHaveBeenCalled();
  expect(
    [...listeners.values()].every((callbacks) => callbacks.size === 0),
  ).toBe(true);
});

it("reanchors a new presentation when the same ref switches to a different tab", async () => {
  await render();
  const nextAnchor = document.createElement("button");
  document.body.append(nextAnchor);
  try {
    props.anchor.current = nextAnchor;
    vi.mocked(nativeWorkspaceMenuPanel.open).mockResolvedValue(second);
    await render();
    expect(nativeWorkspaceMenuPanel.close).toHaveBeenCalledExactlyOnceWith(
      "first",
    );
    expect(nativeWorkspaceMenuPanel.open).toHaveBeenCalledTimes(2);
    expect(nativeWorkspaceMenuPanel.open).toHaveBeenLastCalledWith(
      nextAnchor,
      snapshot,
    );
    await emit("workspace-menu-panel-closed", first);
    expect(props.onClose).not.toHaveBeenCalled();
    await emit("workspace-menu-panel-action", {
      ...second,
      action: "menu-item-0",
    });
    expect(document.activeElement).toBe(nextAnchor);
  } finally {
    nextAnchor.remove();
  }
});

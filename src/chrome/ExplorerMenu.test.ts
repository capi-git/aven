// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { WorkspaceMenuPanelSnapshot } from "../lib/workspaceMenuPanel";
import { ExplorerMenu, type ExplorerMenuItem } from "./ExplorerMenu";

const mocks = vi.hoisted(() => ({
  native: true,
  theme: {
    mode: "dark" as const,
    background: "#28312e",
    accent: "#98c5b3",
    text: "#f8f8f8",
  },
  panel: vi.fn(),
}));
vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => mocks.native }));
vi.mock("../hooks/useWorkspaceMenuPanel", () => ({
  useWorkspaceMenuPanel: mocks.panel,
}));
vi.mock("../lib/usagePanel", () => ({ useUsagePanelTheme: () => mocks.theme }));

type OpenPanel = {
  anchor: {
    current:
      HTMLElement | { x: number; y: number; width: number; height: number };
  };
  snapshot: WorkspaceMenuPanelSnapshot;
  onSelect: (id: string) => void;
  onClose: () => void;
  onError: () => void;
};
let host: HTMLElement;
let root: Root;
const items: ExplorerMenuItem[] = [
  {
    kind: "item",
    id: "picture-in-picture",
    label: "Picture in Picture",
    checked: true,
  },
  { kind: "sep" },
  { kind: "item", id: "disabled", label: "Focus this tab", disabled: true },
  {
    kind: "item",
    id: "close",
    label: "Close Browser",
    shortcut: "⌘W",
    danger: true,
  },
];
const panel = () => mocks.panel.mock.calls.at(-1)![0] as OpenPanel;
const render = async (extra: Record<string, unknown> = {}) => {
  const onPick = vi.fn();
  const onClose = vi.fn();
  await act(async () =>
    root.render(
      createElement(ExplorerMenu, {
        x: 5,
        y: 10,
        native: true,
        items,
        ariaLabel: "Tab actions",
        onPick,
        onClose,
        ...extra,
      }),
    ),
  );
  return { onPick, onClose };
};

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  mocks.native = true;
  mocks.panel.mockClear();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

it("uses an app-rendered native panel at the actual trigger with the workspace theme", async () => {
  const trigger = document.createElement("button");
  document.body.append(trigger);
  const { onPick } = await render({
    anchor: trigger,
    width: 280,
    align: "end",
  });
  expect(panel().anchor.current).toBe(trigger);
  expect(panel().snapshot).toMatchObject({
    title: "Tab actions",
    compact: true,
    width: 280,
    align: "end",
    gap: 0,
    theme: mocks.theme,
  });
  expect(document.querySelector('[role="menu"]')).toBeNull();
  expect(panel().snapshot.items).toEqual([
    expect.objectContaining({
      id: "menu-item-0",
      checked: true,
      separatorBefore: false,
    }),
    expect.objectContaining({
      id: "menu-item-2",
      disabled: true,
      separatorBefore: true,
    }),
    expect.objectContaining({
      id: "menu-item-3",
      shortcut: "⌘W",
      danger: true,
    }),
  ]);
  panel().onSelect("close");
  panel().onSelect("menu-item-2");
  panel().onSelect("menu-item-900");
  expect(onPick).not.toHaveBeenCalled();
  panel().onSelect("menu-item-3");
  expect(onPick).toHaveBeenCalledExactlyOnceWith("close");
  trigger.remove();
});

it("retains a stable anchor and semantic snapshot across callback and item identity changes", async () => {
  const first = await render();
  const initial = panel();
  expect(initial.anchor.current).toEqual({ x: 5, y: 10, width: 0, height: 0 });
  const next = await render({
    x: 20,
    y: 30,
    items: items.map((item) => ({ ...item })),
  });
  expect(panel().anchor).toBe(initial.anchor);
  expect(panel().snapshot).toBe(initial.snapshot);
  expect(panel().anchor.current).toEqual({ x: 20, y: 30, width: 0, height: 0 });
  panel().onSelect("menu-item-0");
  expect(first.onPick).not.toHaveBeenCalled();
  expect(next.onPick).toHaveBeenCalledExactlyOnceWith("picture-in-picture");
});

it("preserves full rect anchors and closes on failure without mounting an occluding fallback", async () => {
  const rect = new DOMRect(48, 27, 24, 20);
  const onError = vi.fn();
  const { onClose } = await render({ anchor: rect, gap: 4, onError });
  expect(panel().anchor.current).toEqual({
    x: 48,
    y: 27,
    width: 24,
    height: 20,
  });
  expect(panel().snapshot.gap).toBe(4);
  await act(async () => panel().onError());
  expect(onClose).toHaveBeenCalledOnce();
  expect(onError).toHaveBeenCalledOnce();
  expect(document.querySelector('[role="menu"]')).toBeNull();
});

it("dismisses native menus when their owning window moves its layout or loses the trigger", async () => {
  const trigger = document.createElement("button");
  document.body.append(trigger);
  const { onClose } = await render({ anchor: { current: trigger } });
  await act(async () => window.dispatchEvent(new Event("resize")));
  await act(async () => window.dispatchEvent(new Event("scroll")));
  expect(onClose).toHaveBeenCalledTimes(2);
  await act(async () => {
    trigger.remove();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  expect(onClose).toHaveBeenCalledTimes(3);
});

it("keeps arbitrary headers in the shared themed HTML design", async () => {
  const { onPick } = await render({
    header: createElement("strong", null, "Custom header"),
  });
  expect(mocks.panel).not.toHaveBeenCalled();
  const menu = document.querySelector('[role="menu"]')!;
  expect(menu.getAttribute("aria-label")).toBe("Tab actions");
  expect(
    document.querySelector(".workspace-menu-panel-custom-header")?.textContent,
  ).toBe("Custom header");
  expect(
    document
      .querySelector<HTMLElement>(".toolbar-panel")
      ?.style.getPropertyValue("--toolbar-panel-bg"),
  ).toBe(mocks.theme.background);
  await act(async () =>
    (menu.querySelectorAll("button")[2] as HTMLButtonElement).click(),
  );
  expect(onPick).toHaveBeenCalledExactlyOnceWith("close");
});

it("uses the same HTML menu immediately outside Tauri", async () => {
  mocks.native = false;
  await render();
  expect(mocks.panel).not.toHaveBeenCalled();
  expect(
    document
      .querySelector('[role="menuitemcheckbox"]')
      ?.getAttribute("aria-checked"),
  ).toBe("true");
  expect(document.querySelectorAll('[role="separator"]')).toHaveLength(1);
});

it("maps legacy centered alignment to the native host's start placement", async () => {
  await render({ align: "center" });
  expect(panel().snapshot.align).toBe("start");
});

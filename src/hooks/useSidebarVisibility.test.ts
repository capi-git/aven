// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const attach = vi.hoisted(() => vi.fn<() => Promise<string>>());
vi.mock("../lib/floatingSidebar", async (original) => ({
  ...(await original<typeof import("../lib/floatingSidebar")>()),
  nativeFloatingSidebar: { attach },
}));
vi.mock("../lib/browser", () => ({
  nativeBrowser: { listenPointer: vi.fn(async () => () => {}) },
}));

import { useSidebarVisibility } from "./useSidebarVisibility";

type Result = ReturnType<typeof useSidebarVisibility>;
let result: Result;
let root: Root;
let host: HTMLElement;

function Harness(props: { pinned: boolean; allowNativeLayer: boolean }) {
  result = useSidebarVisibility(props);
  return null;
}

async function render(props: { pinned: boolean; allowNativeLayer: boolean }) {
  await act(async () => {
    root.render(createElement(Harness, props));
  });
}

beforeEach(() => {
  (
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  attach.mockReset();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

it("creates the native layer only once the sidebar is first unpinned", async () => {
  attach.mockResolvedValue("floating-sidebar-main");
  await render({ pinned: true, allowNativeLayer: true });
  expect(attach).not.toHaveBeenCalled();
  expect(result.nativeSidebar).toBe(false);
  await render({ pinned: false, allowNativeLayer: true });
  expect(attach).toHaveBeenCalledOnce();
  expect(result.nativeSidebar).toBe(true);
  // Docking again keeps it.
  await render({ pinned: true, allowNativeLayer: true });
  expect(result.nativeSidebar).toBe(true);
  expect(attach).toHaveBeenCalledOnce();
});

it("counts a docked sidebar as shown once the native layer attaches", async () => {
  attach.mockResolvedValue("floating-sidebar-main");
  await render({ pinned: false, allowNativeLayer: true });
  await render({ pinned: true, allowNativeLayer: true });
  expect(result.floatingSidebarLayer).toBe("floating-sidebar-main");
  expect(result.nativeSidebar).toBe(true);
  // The DOM peek stands down for the native layer…
  expect(result.sidebarHover.visible).toBe(false);
  // …yet the docked sidebar is still on screen and must stay current.
  expect(result.sidebarShown).toBe(true);
});

it("follows the native layer's reveal while undocked", async () => {
  attach.mockResolvedValue("floating-sidebar-main");
  await render({ pinned: false, allowNativeLayer: true });
  expect(result.sidebarShown).toBe(false);
  await act(async () => result.setFloatingSidebarRevealed(true));
  expect(result.sidebarShown).toBe(true);
  await act(async () => result.setFloatingSidebarRevealed(false));
  expect(result.sidebarShown).toBe(false);
});

it("keeps the DOM peek where the native layer is not allowed", async () => {
  await render({ pinned: true, allowNativeLayer: false });
  expect(attach).not.toHaveBeenCalled();
  expect(result.nativeSidebar).toBe(false);
  expect(result.sidebarHover.visible).toBe(true);
  expect(result.sidebarShown).toBe(true);
  await render({ pinned: false, allowNativeLayer: false });
  expect(result.sidebarShown).toBe(false);
});

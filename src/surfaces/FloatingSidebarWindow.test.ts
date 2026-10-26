// @vitest-environment happy-dom
import { act, createContext, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const native = vi.hoisted(() => ({
  handlers: new Map<string, (payload: unknown) => void>(),
}));

vi.mock("@tauri-apps/api/webview", () => ({
  getCurrentWebview: () => ({ label: "floating-sidebar-main" }),
}));
vi.mock("../lib/floatingSidebar", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../lib/floatingSidebar")>();
  return {
    ...actual,
    nativeFloatingSidebar: {
      regions: vi.fn(async () => {}),
      send: vi.fn(async () => {}),
      listen: vi.fn(
        async (event: string, callback: (payload: unknown) => void) => {
          native.handlers.set(event, callback);
          return () => native.handlers.delete(event);
        },
      ),
    },
  };
});
// The card's contents are the workspace's own sidebar; only its place is
// under test here.
vi.mock("../chrome/Sidebar", () => ({
  Sidebar: () => createElement("aside", { className: "personal-sidebar" }),
}));
vi.mock("../chrome/AddProjectMenu", () => ({ AddProjectMenu: () => null }));
vi.mock("../chrome/OrchestrationActions", () => ({
  OrchestrationWorkers: createContext(null),
}));
vi.mock("../lib/devSmoke", () => ({
  devSmokeConfig: () => null,
  SMOKE_OVERLAY_EVENT: "smoke-overlay",
  SMOKE_OVERLAY_RESULT_EVENT: "smoke-overlay-result",
  waitFor: vi.fn(),
}));
vi.mock("../lib/uiScale", () => ({ applyUiScale: vi.fn(async () => 1) }));
vi.mock("../lib/updater", () => ({
  mirrorUpdater: vi.fn(),
  showMirroredUpdater: vi.fn(),
}));
vi.mock("../lib/models", () => ({ setHarnessModels: vi.fn() }));
vi.mock("../lib/orchestration", () => ({
  orchestrator: { mirror: vi.fn() },
}));
vi.mock("../lib/paneDrop", () => ({ setPaneDropBridge: vi.fn() }));

import {
  SNAPSHOT_EVENT,
  type FloatingSidebarSnapshot,
} from "../lib/floatingSidebar";
import { FloatingSidebarWindow } from "./FloatingSidebarWindow";

let host: HTMLDivElement;
let root: Root;

function setOwnHeight(height: number) {
  Object.defineProperty(window, "innerHeight", {
    configurable: true,
    value: height,
  });
}

const snapshot = {
  generation: 1,
  props: {},
  actions: [],
  appearance: { className: "is-mac", style: "", uiScale: 1 },
  // The workspace's body starts below its 40px title bar.
  body: { x: 0, y: 40, width: 1512, height: 857 },
  viewportHeight: 897,
  panes: [],
  orchestration: {
    runs: undefined,
    agentsByLead: undefined,
    selectedId: null,
    details: false,
  },
  updater: undefined,
  models: undefined,
} as unknown as FloatingSidebarSnapshot;

const bodyTop = () =>
  host.querySelector<HTMLElement>(".personal-shell-body")?.style.top;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  native.handlers.clear();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

describe("the hover sidebar's overlay", () => {
  it("places the card below the title bar again when its own height changes", async () => {
    // The window grew after the overlay started: a snapshot from the
    // resized workspace reaches it before its own new height does.
    setOwnHeight(810);
    await act(async () => root.render(createElement(FloatingSidebarWindow)));
    await act(async () => native.handlers.get(SNAPSHOT_EVENT)?.(snapshot));
    expect(bodyTop()).toBe(`${40 + 810 - 897}px`);

    // Its own resize arrives with no new snapshot; the card must still
    // move to where the workspace's body is.
    setOwnHeight(897);
    await act(async () => window.dispatchEvent(new Event("resize")));
    expect(bodyTop()).toBe("40px");
  });

  it("keeps the card level with the workspace's body when its viewport is shorter", async () => {
    // A viewport shorter than its view is anchored at the window's bottom.
    setOwnHeight(869);
    await act(async () => root.render(createElement(FloatingSidebarWindow)));
    await act(async () => native.handlers.get(SNAPSHOT_EVENT)?.(snapshot));
    expect(bodyTop()).toBe("12px");
  });
});

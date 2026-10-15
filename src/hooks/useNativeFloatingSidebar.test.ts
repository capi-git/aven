// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const native = vi.hoisted(() => {
  const handlers = new Map<string, (payload: unknown) => void>();
  return {
    handlers,
    sent: [] as { label: string; event: string; payload: unknown }[],
    setOpen: vi.fn(async () => {}),
    focusWorkspace: vi.fn(async () => {}),
    workspace: vi.fn(async () => {}),
  };
});

vi.mock("../lib/floatingSidebar", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../lib/floatingSidebar")>();
  return {
    ...actual,
    nativeFloatingSidebar: {
      attach: vi.fn(async () => "floating-sidebar-main"),
      workspace: native.workspace,
      regions: vi.fn(async () => {}),
      setOpen: native.setOpen,
      focusWorkspace: native.focusWorkspace,
      send: vi.fn(async (label: string, event: string, payload: unknown) => {
        native.sent.push({ label, event, payload });
      }),
      listen: vi.fn(
        async (event: string, callback: (payload: unknown) => void) => {
          native.handlers.set(event, callback);
          return () => native.handlers.delete(event);
        },
      ),
    },
  };
});

const dock = vi.hoisted(() => ({ requests: [] as unknown[] }));
vi.mock("./usePanelDockHandoff", () => ({
  requestDockHandoff: (...args: unknown[]) => dock.requests.push(args),
}));

import {
  ACTIVITY_EVENT,
  CALL_EVENT,
  DISMISS_EVENT,
  EDGE_CLICK_EVENT,
  POINTER_EVENT,
  RESULT_EVENT,
  SNAPSHOT_EVENT,
  type FloatingSidebarSnapshot,
} from "../lib/floatingSidebar";
import { useNativeFloatingSidebar } from "./useNativeFloatingSidebar";

type Options = Parameters<typeof useNativeFloatingSidebar>[0];

let root: Root;
let latest: ReturnType<typeof useNativeFloatingSidebar>;
let options: Options;

function Harness(props: Options) {
  latest = useNativeFloatingSidebar(props);
  return null;
}

async function render(next: Partial<Options> = {}) {
  options = { ...options, ...next };
  await act(async () => {
    root.render(createElement(Harness, options));
  });
}

function emit(event: string, payload: unknown = {}) {
  act(() => native.handlers.get(event)?.(payload));
}

async function flush() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(20);
  });
}

describe("useNativeFloatingSidebar", () => {
  beforeEach(async () => {
    vi.useFakeTimers();
    native.handlers.clear();
    native.sent.length = 0;
    native.setOpen.mockClear();
    native.focusWorkspace.mockClear();
    dock.requests.length = 0;
    root = createRoot(document.createElement("div"));
    options = {
      label: "floating-sidebar-main",
      props: {
        cwd: "/projects/aven",
        busySessionIds: new Set(["a"]),
        onSelectSession: vi.fn(),
        onNew: vi.fn(() => "new-session"),
      },
      handlers: { addExistingProject: vi.fn(), openWorkerDetails: undefined },
      extra: () => ({
        orchestration: {
          runs: [],
          agentsByLead: undefined,
          selectedId: null,
          details: false,
        },
      }),
      pinned: false,
      windowFocused: true,
      onToggleSidebar: vi.fn(),
      onRefreshSidebar: vi.fn(),
    };
    await render();
    await flush();
  });

  afterEach(() => {
    act(() => root.unmount());
    vi.useRealTimers();
  });

  it("publishes the sidebar's data and the callbacks it may call", () => {
    const published = native.sent.filter(
      (entry) => entry.event === SNAPSHOT_EVENT,
    );
    expect(published.length).toBeGreaterThan(0);
    const snapshot = published.at(-1)!.payload as FloatingSidebarSnapshot;
    expect(published.at(-1)!.label).toBe("floating-sidebar-main");
    expect(snapshot.props).toEqual({
      cwd: "/projects/aven",
      busySessionIds: { $set: ["a"] },
    });
    expect(snapshot.actions).toEqual([
      "addExistingProject",
      "cancelUpdateWait",
      "installUpdate",
      "onNew",
      "onSelectSession",
      "refreshUpdater",
      "restartUpdateNow",
    ]);
    // Native code starts closed whenever the workspace attaches.
    expect(native.setOpen).toHaveBeenCalledWith(false, false);
  });

  it("opens after resting on the edge and closes after leaving the card", async () => {
    native.setOpen.mockClear();
    emit(POINTER_EVENT, { inside: false, edge: true });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(150);
    });
    expect(native.setOpen).toHaveBeenLastCalledWith(true, true);
    expect(latest.revealed).toBe(true);
    emit(POINTER_EVENT, { inside: true, edge: false });
    emit(POINTER_EVENT, { inside: false, edge: false });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(90);
    });
    expect(native.setOpen).toHaveBeenLastCalledWith(false, true);
    expect(latest.revealed).toBe(false);
  });

  it("runs the overlay's calls in the workspace and returns their results", async () => {
    emit(CALL_EVENT, { id: 7, name: "onNew", args: [] });
    emit(CALL_EVENT, { id: 8, name: "onSelectSession", args: ["b"] });
    emit(CALL_EVENT, { id: 9, name: "removeEverything", args: [] });
    await flush();
    expect(options.props.onSelectSession).toHaveBeenCalledWith("b");
    const results = native.sent
      .filter((entry) => entry.event === RESULT_EVENT)
      .map((entry) => entry.payload);
    expect(results).toContainEqual({ id: 7, ok: true, value: "new-session" });
    expect(results).toContainEqual({ id: 8, ok: true });
    expect(results).toContainEqual({
      id: 9,
      ok: false,
      error: "Unknown sidebar action: removeEverything",
    });
    // Showing a session hands the keyboard back to the workspace.
    expect(native.focusWorkspace).toHaveBeenCalledTimes(2);
  });

  it("pins from the open card by docking from its place", async () => {
    emit(POINTER_EVENT, { inside: false, edge: true });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(150);
    });
    emit(ACTIVITY_EVENT, {
      interaction: false,
      focus: false,
      card: { x: 5, y: 45, width: 256, height: 800 },
    });
    native.setOpen.mockClear();
    await render({ pinned: true });
    expect(dock.requests).toEqual([[{ left: 5, top: 45 }, 90]]);
    expect(options.onRefreshSidebar).toHaveBeenCalledTimes(1);
    expect(native.setOpen).not.toHaveBeenCalled();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(50);
    });
    expect(native.setOpen).toHaveBeenLastCalledWith(false, false);
  });

  it("reloads the docked sidebar on pin only after the card was used", async () => {
    await render({ pinned: true });
    expect(options.onRefreshSidebar).not.toHaveBeenCalled();
    await render({ pinned: false });
    emit("floating-sidebar-closed");
    await render({ pinned: true });
    expect(options.onRefreshSidebar).toHaveBeenCalledTimes(1);
    expect(latest.dockHidden).toBe(true);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(50);
    });
    expect(latest.dockHidden).toBe(false);
  });

  it("toggles pinning from the edge, and closes on Escape or window blur", async () => {
    emit(EDGE_CLICK_EVENT);
    expect(options.onToggleSidebar).toHaveBeenCalledTimes(1);
    emit(POINTER_EVENT, { inside: false, edge: true });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(150);
    });
    emit(DISMISS_EVENT);
    expect(native.setOpen).toHaveBeenLastCalledWith(false, true);
    emit(POINTER_EVENT, { inside: false, edge: false });
    emit(POINTER_EVENT, { inside: false, edge: true });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(150);
    });
    expect(native.setOpen).toHaveBeenLastCalledWith(true, true);
    await render({ windowFocused: false });
    expect(native.setOpen).toHaveBeenLastCalledWith(false, true);
  });
});

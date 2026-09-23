// @vitest-environment happy-dom
import { act, createElement, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AccessPicker } from "./AccessPicker";

const mocks = vi.hoisted(() => ({
  supported: vi.fn(),
  open: vi.fn(),
  update: vi.fn(),
  close: vi.fn(),
  listen: vi.fn(),
}));
vi.mock("../lib/accessPanel", () => ({ nativeAccessPanel: mocks }));
vi.mock("../lib/usagePanel", () => ({
  useUsagePanelTheme: () => ({
    mode: "dark",
    accent: "#6cabdd",
    background: "#0b121a",
    text: "#ededed",
  }),
}));
vi.mock("./Popover", () => ({
  Popover: ({ children }: ComponentProps<"div">) =>
    createElement("div", { "data-popover-side": "bottom" }, children),
}));
let root: Root;
let container: HTMLDivElement;
const onChange = vi.fn();
const onClose = vi.fn();
let events: Map<string, (payload: { action?: string; label: string }) => void>;
let stops: ReturnType<typeof vi.fn>[];
beforeEach(() => {
  vi.resetAllMocks();
  events = new Map();
  stops = [];
  mocks.supported.mockReturnValue(true);
  mocks.open.mockResolvedValue("access-panel-1");
  mocks.update.mockResolvedValue(undefined);
  mocks.close.mockResolvedValue(undefined);
  mocks.listen.mockImplementation(async (event, handler) => {
    events.set(event, handler);
    const stop = vi.fn();
    stops.push(stop);
    return stop;
  });
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});
async function render(
  props: Partial<ComponentProps<typeof AccessPicker>> = {},
) {
  await act(async () =>
    root.render(
      createElement(AccessPicker, {
        value: "supervised",
        onChange,
        native: true,
        ...props,
      }),
    ),
  );
}
const trigger = () => container.querySelector<HTMLButtonElement>("button")!;
const overlay = () =>
  container.querySelector(
    '[role="menu"], [role="dialog"], [data-popover-side]',
  );
async function click() {
  await act(async () => trigger().click());
}

describe("app-rendered access popup", () => {
  it("opens above the browser without mounting a parent overlay and applies only selected modes", async () => {
    await render({ busy: true, onClose });
    await click();
    expect(mocks.open).toHaveBeenCalledOnce();
    expect(overlay()).toBeNull();
    expect(mocks.open.mock.calls[0][1]).toMatchObject({
      value: "supervised",
      busy: true,
      theme: { accent: "#6cabdd" },
    });
    expect(trigger().getAttribute("aria-expanded")).toBe("true");
    expect(onChange).not.toHaveBeenCalled();
    await act(async () =>
      events.get("access-panel-action")!({
        label: "old-panel",
        action: "full-access",
      }),
    );
    expect(onChange).not.toHaveBeenCalled();
    await act(async () =>
      events.get("access-panel-action")!({
        label: "access-panel-1",
        action: "full-access",
      }),
    );
    expect(onChange).toHaveBeenCalledExactlyOnceWith("full-access");
    expect(onClose).toHaveBeenCalledOnce();
    expect(trigger().getAttribute("aria-expanded")).toBe("false");
    expect(overlay()).toBeNull();
    expect(stops.every((stop) => stop.mock.calls.length === 1)).toBe(true);
  });
  it("dismisses on outside click without changing access", async () => {
    await render();
    await click();
    await act(async () =>
      events.get("access-panel-closed")!({ label: "access-panel-1" }),
    );
    expect(onChange).not.toHaveBeenCalled();
    expect(trigger().getAttribute("aria-expanded")).toBe("false");
  });
  it("updates selected access and busy state while the popup stays open", async () => {
    await render();
    await click();
    await render({ value: "auto", busy: true });
    expect(mocks.open).toHaveBeenCalledOnce();
    expect(mocks.update).toHaveBeenLastCalledWith(
      expect.objectContaining({ value: "auto", busy: true }),
      "access-panel-1",
    );
  });
  it("reports an opening error and can retry without an occluding fallback", async () => {
    mocks.open.mockRejectedValueOnce(new Error("Unavailable"));
    await render();
    await click();
    expect(container.querySelector('[role="status"]')?.textContent).toContain(
      "Could not open access options",
    );
    expect(onChange).not.toHaveBeenCalled();
    expect(overlay()).toBeNull();
    await click();
    expect(container.querySelector('[role="status"]')).toBeNull();
    expect(mocks.open).toHaveBeenCalledTimes(2);
  });
  it("closes a pending open before opening its replacement", async () => {
    let resolve!: (label: string) => void;
    mocks.open.mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    await render();
    await click();
    await click();
    await click();
    expect(mocks.open).toHaveBeenCalledOnce();
    await act(async () => resolve("access-panel-1"));
    expect(mocks.close).toHaveBeenCalledExactlyOnceWith("access-panel-1");
    expect(mocks.open).toHaveBeenCalledTimes(2);
    expect(mocks.close.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.open.mock.invocationCallOrder[1],
    );
  });
  it("ignores stale events that arrive before a new popup label resolves", async () => {
    let resolve!: (label: string) => void;
    mocks.open.mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    await render();
    await click();
    await act(async () => {
      events.get("access-panel-action")!({
        label: "old-panel",
        action: "full-access",
      });
      events.get("access-panel-closed")!({ label: "old-panel" });
      resolve("access-panel-1");
    });
    expect(onChange).not.toHaveBeenCalled();
    expect(trigger().getAttribute("aria-expanded")).toBe("true");
    await act(async () =>
      events.get("access-panel-action")!({
        label: "access-panel-1",
        action: "auto",
      }),
    );
    expect(onChange).toHaveBeenCalledExactlyOnceWith("auto");
  });
  it("releases a listener that finishes registering after unmount", async () => {
    let resolve!: (stop: () => void) => void;
    const lateStop = vi.fn();
    mocks.listen.mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    await render();
    await click();
    await act(async () => root.render(null));
    await act(async () => resolve(lateStop));
    expect(lateStop).toHaveBeenCalledOnce();
    expect(mocks.listen).toHaveBeenCalledTimes(2);
    expect(stops.every((stop) => stop.mock.calls.length === 1)).toBe(true);
    expect(mocks.close).not.toHaveBeenCalled();
    expect(mocks.open).not.toHaveBeenCalled();
  });
  it("ignores events and closes an opening popup after unmount", async () => {
    let resolve!: (label: string) => void;
    mocks.open.mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    await render({ onClose });
    await click();
    const receive = events.get("access-panel-action")!;
    await act(async () => root.render(null));
    await act(async () => {
      resolve("access-panel-1");
      receive({ label: "access-panel-1", action: "full-access" });
    });
    expect(onChange).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    expect(mocks.close).toHaveBeenCalledExactlyOnceWith("access-panel-1");
  });
  it.each([false, true])(
    "uses matching in-page options without a native host (opt-in %s)",
    async (native) => {
      mocks.supported.mockReturnValue(false);
      await render({ native });
      await click();
      expect(overlay()).not.toBeNull();
      expect(mocks.open).not.toHaveBeenCalled();
      const options = Array.from(
        container.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]'),
      );
      expect(options).toHaveLength(4);
      expect(document.activeElement).toBe(options[0]);
      await act(async () =>
        options[0].dispatchEvent(
          new KeyboardEvent("keydown", { key: "End", bubbles: true }),
        ),
      );
      expect(document.activeElement).toBe(options[3]);
      await act(async () => options[3].click());
      expect(onChange).toHaveBeenCalledExactlyOnceWith("full-access");
      expect(overlay()).toBeNull();
      expect(document.activeElement).toBe(trigger());
    },
  );
});

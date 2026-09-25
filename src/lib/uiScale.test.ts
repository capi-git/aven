// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  applyUiScale,
  normalizeUiScale,
  UI_SCALE_CHANGE_EVENT,
  UI_SCALE_DEFAULT,
  UI_SCALE_MAX,
  UI_SCALE_MIN,
  uiScaleCommand,
  zoomInUiScale,
  zoomOutUiScale,
} from "./uiScale";

const nativeZoom = vi.hoisted(() => ({ setZoom: vi.fn() }));
vi.mock("@tauri-apps/api/webview", () => ({
  getCurrentWebview: () => nativeZoom,
}));

beforeEach(() => {
  nativeZoom.setZoom.mockReset().mockResolvedValue(undefined);
});
afterEach(() => {
  document.documentElement.style.removeProperty("zoom");
  document.documentElement.style.removeProperty("--aven-titlebar-scale");
});

describe("ui scale", () => {
  it("keeps macOS frame compensation in step with native page zoom", async () => {
    document.documentElement.style.setProperty("zoom", "1.5");
    const onChange = vi.fn((_event: Event) =>
      document.documentElement.style.getPropertyValue("--aven-titlebar-scale"),
    );
    window.addEventListener(UI_SCALE_CHANGE_EVENT, onChange, { once: true });

    expect(await applyUiScale(0.5)).toBe(0.5);

    expect(nativeZoom.setZoom).toHaveBeenCalledWith(0.5);
    expect(document.documentElement.style.getPropertyValue("zoom")).toBe("");
    expect(onChange).toHaveReturnedWith("2");
    expect(onChange.mock.calls[0][0]).toMatchObject({ detail: 0.5 });
  });

  it("compensates the frame for the browser fallback and resets both scales", async () => {
    nativeZoom.setZoom.mockRejectedValue(new Error("No native webview"));

    await applyUiScale(2);
    expect(document.documentElement.style.getPropertyValue("zoom")).toBe("2");
    expect(
      document.documentElement.style.getPropertyValue("--aven-titlebar-scale"),
    ).toBe("0.5");

    await applyUiScale(UI_SCALE_DEFAULT);
    expect(document.documentElement.style.getPropertyValue("zoom")).toBe("1");
    expect(
      document.documentElement.style.getPropertyValue("--aven-titlebar-scale"),
    ).toBe("1");
  });

  it("clamps to the supported range and rounds to one decimal", () => {
    expect(normalizeUiScale(1)).toBe(1);
    expect(normalizeUiScale(1.05)).toBe(1.1);
    expect(normalizeUiScale(0)).toBe(UI_SCALE_MIN);
    expect(normalizeUiScale(99)).toBe(UI_SCALE_MAX);
    expect(normalizeUiScale(Number.NaN)).toBe(UI_SCALE_DEFAULT);
    expect(normalizeUiScale("junk")).toBe(UI_SCALE_DEFAULT);
  });

  it("steps in and out without float drift", () => {
    expect(zoomInUiScale(1)).toBe(1.1);
    expect(zoomOutUiScale(1.1)).toBe(1);
    // 10 steps up from 1 lands exactly on 2, not 1.9999999
    let scale = 1;
    for (let i = 0; i < 10; i += 1) scale = zoomInUiScale(scale);
    expect(scale).toBe(UI_SCALE_MAX);
    expect(zoomInUiScale(UI_SCALE_MAX)).toBe(UI_SCALE_MAX);
    expect(zoomOutUiScale(UI_SCALE_MIN)).toBe(UI_SCALE_MIN);
  });

  it("maps browser-standard zoom keys", () => {
    expect(uiScaleCommand({ key: "+", code: "Equal" })).toBe("zoom-in");
    expect(uiScaleCommand({ key: "=", code: "Equal" })).toBe("zoom-in");
    expect(uiScaleCommand({ key: "Add", code: "NumpadAdd" })).toBe("zoom-in");
    expect(uiScaleCommand({ key: "-", code: "Minus" })).toBe("zoom-out");
    expect(uiScaleCommand({ key: "_", code: "Minus" })).toBe("zoom-out");
    expect(uiScaleCommand({ key: "Subtract", code: "NumpadSubtract" })).toBe(
      "zoom-out",
    );
    expect(uiScaleCommand({ key: "0", code: "Digit0" })).toBe("zoom-reset");
    expect(uiScaleCommand({ key: "0", code: "Numpad0" })).toBe("zoom-reset");
    expect(uiScaleCommand({ key: "p", code: "KeyP" })).toBeNull();
  });
});

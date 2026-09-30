// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/window", () => ({}));

describe("pointerToPage", () => {
  it("maps a pointer on a 2x display when the primary display is 1x (macOS)", async () => {
    vi.resetModules();
    vi.doMock("./platform", () => ({ IS_MAC: true }));
    const { pointerToPage } = await import("./nativePointer");
    // Measured in Aven Dev: window at (-1180, 1479) points on a 2x display,
    // page zoomed to 0.8, pointer at window point (1300, 600).
    const point = pointerToPage(
      { x: 120, y: 2079 },
      { x: -2360, y: 2958 },
      { width: 3600, height: 2260 },
      { width: 2250, height: 1412 },
      { window: 2, primary: 1 },
    )!;
    expect(point.x).toBeCloseTo(1625, 0);
    expect(point.y).toBeCloseTo(750, 0);
  });

  it("uses physical pixels throughout elsewhere", async () => {
    vi.resetModules();
    vi.doMock("./platform", () => ({ IS_MAC: false }));
    const { pointerToPage } = await import("./nativePointer");
    const point = pointerToPage(
      { x: 700, y: 500 },
      { x: 100, y: 100 },
      { width: 2000, height: 1000 },
      { width: 1000, height: 500 },
      { window: 2, primary: 1 },
    )!;
    expect(point).toEqual({ x: 300, y: 200 });
  });
});

describe("overNativePage", () => {
  it("counts only the part of a page that no clipped panel covers", async () => {
    vi.resetModules();
    const { overNativePage } = await import("./nativePointer");
    const host = document.createElement("div");
    host.className = "browser-native-host";
    const panel = document.createElement("aside");
    panel.dataset.nativeBrowserOccluded = "true";
    panel.dataset.nativeBrowserEdge = "left";
    document.body.append(host, panel);
    host.getClientRects = () =>
      [new DOMRect(0, 0, 800, 600)] as unknown as DOMRectList;
    panel.getClientRects = () =>
      [new DOMRect(0, 0, 200, 600)] as unknown as DOMRectList;
    try {
      expect(overNativePage({ x: 100, y: 300 })).toBe(false);
      expect(overNativePage({ x: 500, y: 300 })).toBe(true);
      expect(overNativePage({ x: 900, y: 300 })).toBe(false);
    } finally {
      host.remove();
      panel.remove();
    }
  });
});

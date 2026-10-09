// @vitest-environment happy-dom
import { act, createElement, useRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useFloatingSidebarClip } from "./useFloatingSidebarClip";

function Fixture({ revealed }: { revealed: boolean }) {
  const sidebar = useRef<HTMLElement>(null);
  useFloatingSidebarClip(sidebar, revealed);
  return createElement(
    "div",
    { className: "personal-shell-body" },
    createElement("aside", { ref: sidebar }),
    createElement("main", { className: "personal-workspace-column" }),
  );
}

describe("floating sidebar window material", () => {
  let container: HTMLDivElement;
  let root: Root;
  let resize: () => void;
  let width: number;
  let zoom: number;
  let shift: number;
  const disconnect = vi.fn();
  const body = () =>
    container.querySelector<HTMLElement>(".personal-shell-body")!;
  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    width = 216;
    zoom = 1;
    shift = 0;
    disconnect.mockClear();
    vi.stubGlobal(
      "ResizeObserver",
      class {
        constructor(callback: () => void) {
          resize = callback;
        }
        observe() {}
        disconnect = disconnect;
      },
    );
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
      function (this: HTMLElement) {
        return this.tagName === "ASIDE"
          ? new DOMRect(100 + 5 * zoom + shift, 0, width * zoom, 600)
          : new DOMRect(100, 0, 1600 * zoom, 600);
      },
    );
    vi.stubGlobal("getComputedStyle", (element: HTMLElement) => ({
      transform: shift ? `matrix(1, 0, 0, 1, ${shift}, 0)` : "none",
      zoom: element.classList.contains("personal-shell-body")
        ? String(zoom)
        : "1",
    }));
    vi.stubGlobal(
      "DOMMatrixReadOnly",
      class {
        m41 = shift;
      },
    );
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });
  it("crops only while revealed and removes geometry and observers on close", async () => {
    await act(async () =>
      root.render(createElement(Fixture, { revealed: false })),
    );
    expect(body().dataset.floatingSidebarRevealed).toBeUndefined();
    await act(async () =>
      root.render(createElement(Fixture, { revealed: true })),
    );
    expect(body().dataset.floatingSidebarRevealed).toBe("true");
    expect(body().style.getPropertyValue("--floating-sidebar-right")).toBe(
      "221px",
    );
    width = 290;
    resize();
    expect(body().style.getPropertyValue("--floating-sidebar-right")).toBe(
      "295px",
    );
    await act(async () =>
      root.render(createElement(Fixture, { revealed: false })),
    );
    expect(body().dataset.floatingSidebarRevealed).toBeUndefined();
    expect(body().style.getPropertyValue("--floating-sidebar-right")).toBe("");
    expect(disconnect).toHaveBeenCalledOnce();
    width = 250;
    window.dispatchEvent(new Event("resize"));
    expect(body().style.getPropertyValue("--floating-sidebar-right")).toBe("");
  });
  it.each([0.8, 1, 1.25])(
    "matches native edge clipping during reveal at %s interface zoom",
    async (value) => {
      zoom = value;
      shift = -28 * zoom;
      await act(async () =>
        root.render(createElement(Fixture, { revealed: true })),
      );
      expect(
        parseFloat(body().style.getPropertyValue("--floating-sidebar-right")),
      ).toBeCloseTo(221);
      shift = 0;
      width = 240;
      window.dispatchEvent(new Event("resize"));
      expect(
        parseFloat(body().style.getPropertyValue("--floating-sidebar-right")),
      ).toBeCloseTo(245);
    },
  );
});

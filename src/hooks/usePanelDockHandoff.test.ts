// @vitest-environment happy-dom
import { act, createElement, useRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { usePanelDockHandoff } from "./usePanelDockHandoff";

function Fixture({ floating, open }: { floating: boolean; open: boolean }) {
  const panel = useRef<HTMLElement>(null);
  usePanelDockHandoff(panel, floating);
  return createElement(
    "div",
    { "data-open": String(open), "data-floating": String(floating) },
    createElement("aside", { ref: panel }),
  );
}

describe("pinning a peeked panel", () => {
  let container: HTMLDivElement;
  let root: Root;
  const animate = vi.fn();
  const render = (floating: boolean, open: boolean) =>
    act(async () => root.render(createElement(Fixture, { floating, open })));
  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.stubGlobal("matchMedia", () => ({ matches: false }));
    animate.mockClear();
    HTMLElement.prototype.animate = animate;
    // A floating card sits 5px in from the window; the dock is flush.
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
      function (this: HTMLElement) {
        return this.parentElement?.dataset.floating === "true"
          ? new DOMRect(5, 5, 216, 590)
          : new DOMRect(0, 0, 216, 600);
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

  it("docks from the floating card's place instead of jumping", async () => {
    await render(true, true);
    await render(false, true);
    expect(animate).toHaveBeenCalledOnce();
    expect(animate.mock.calls[0][0]).toEqual([
      { transform: "translate(5px, 5px)" },
      { transform: "none" },
    ]);
  });

  it("leaves pinning a hidden panel and unpinning to the layout", async () => {
    await render(true, false);
    await render(false, true);
    await render(true, false);
    expect(animate).not.toHaveBeenCalled();
  });

  it("respects reduced motion", async () => {
    vi.stubGlobal("matchMedia", () => ({ matches: true }));
    await render(true, true);
    await render(false, true);
    expect(animate).not.toHaveBeenCalled();
  });
});

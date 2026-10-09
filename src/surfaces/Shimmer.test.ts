// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { Shimmer } from "./Shimmer";

it("pauses only while offscreen or hidden and retains the same text on resume", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  let hidden = false;
  vi.spyOn(document, "hidden", "get").mockImplementation(() => hidden);
  let intersect!: (entries: { isIntersecting: boolean }[]) => void;
  const disconnect = vi.fn();
  const observe = vi.fn();
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      constructor(callback: typeof intersect) {
        intersect = callback;
      }
      observe = observe;
      disconnect = disconnect;
    },
  );
  const container = document.createElement("div");
  const root = createRoot(container);
  try {
    await act(async () =>
      root.render(createElement(Shimmer, { children: "Working…" })),
    );
    const element = container.querySelector<HTMLElement>(".shimmer-text")!;
    expect(observe).toHaveBeenCalledWith(element);
    expect(element.style.animationPlayState).toBe("paused");
    intersect([{ isIntersecting: true }]);
    expect(element.style.animationPlayState).toBe("running");
    // A visible window that lost focus still shows the shimmer moving.
    window.dispatchEvent(new Event("blur"));
    expect(element.style.animationPlayState).toBe("running");
    hidden = true;
    document.dispatchEvent(new Event("visibilitychange"));
    expect(element.style.animationPlayState).toBe("paused");
    hidden = false;
    document.dispatchEvent(new Event("visibilitychange"));
    expect(element.style.animationPlayState).toBe("running");
    intersect([{ isIntersecting: false }]);
    expect(element.style.animationPlayState).toBe("paused");
    expect(element.textContent).toBe("Working…");
  } finally {
    await act(async () => root.unmount());
    expect(disconnect).toHaveBeenCalledOnce();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  }
});

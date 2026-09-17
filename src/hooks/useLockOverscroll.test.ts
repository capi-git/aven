// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { it, expect, vi } from "vitest";
import { useLockOverscroll } from "./useLockOverscroll";
it("preserves mixed-axis and nested scrolling, contains the dominant edge, cleans replacement/unmount", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const root = createRoot(document.createElement("div"));
  let ref: (el: HTMLDivElement | null) => void = () => {};
  function Host() {
    ref = useLockOverscroll<HTMLDivElement>();
    return null;
  }
  await act(async () => root.render(createElement(Host)));
  const el = document.createElement("div");
  Object.defineProperties(el, {
    clientWidth: { value: 100 },
    scrollWidth: { value: 400 },
    clientHeight: { value: 100 },
    scrollHeight: { value: 400 },
  });
  document.body.append(el);
  el.scrollLeft = 200;
  ref(el);
  const wheel = (target: HTMLElement, x: number, y: number) => {
    const e = new WheelEvent("wheel", {
      deltaX: x,
      deltaY: y,
      bubbles: true,
      cancelable: true,
    });
    target.dispatchEvent(e);
    return e.defaultPrevented;
  };
  expect(wheel(el, 40, -1)).toBe(false);
  expect(wheel(el, 1, -40)).toBe(true);
  el.scrollLeft = 0;
  el.scrollTop = 100;
  expect(wheel(el, -1, 40)).toBe(false);
  const inner = document.createElement("div");
  inner.style.overflowY = "auto";
  inner.scrollTop = 30;
  Object.defineProperties(inner, {
    clientHeight: { value: 20 },
    scrollHeight: { value: 200 },
  });
  el.append(inner);
  el.scrollTop = 0;
  expect(wheel(inner, 0, -10)).toBe(false);
  ref(document.createElement("div"));
  expect(wheel(el, 0, -40)).toBe(false);
  ref(el);
  await act(async () => root.unmount());
  expect(wheel(el, 0, -40)).toBe(false);
  el.remove();
  vi.unstubAllGlobals();
});

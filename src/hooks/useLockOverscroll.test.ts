// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { it, expect, vi } from "vitest";
import {
  LOCK_OVERSCROLL_ATTRIBUTE,
  lockOverscroll,
  useLockOverscroll,
  useLockOverscrollWithin,
} from "./useLockOverscroll";
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

it("reads no nested styles for wheel events away from the container's edge", () => {
  const el = document.createElement("div");
  Object.defineProperties(el, {
    clientHeight: { value: 100 },
    scrollHeight: { value: 400 },
  });
  const inner = document.createElement("div");
  el.append(inner);
  document.body.append(el);
  el.scrollTop = 150;
  const styles = vi.spyOn(window, "getComputedStyle");
  const event = new WheelEvent("wheel", { deltaY: 40, cancelable: true });
  Object.defineProperty(event, "target", { value: inner });
  lockOverscroll(el, event);
  expect(event.defaultPrevented).toBe(false);
  expect(styles).not.toHaveBeenCalled();
  styles.mockRestore();
  el.remove();
});

it("contains marked scrollers from one host listener as they come and go", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const root = createRoot(document.createElement("div"));
  let hostRef: (el: HTMLDivElement | null) => void = () => {};
  function Host({ enabled }: { enabled: boolean }) {
    hostRef = useLockOverscrollWithin<HTMLDivElement>(enabled);
    return null;
  }
  await act(async () => root.render(createElement(Host, { enabled: true })));
  const host = document.createElement("div");
  document.body.append(host);
  const scroller = () => {
    const el = document.createElement("div");
    el.setAttribute(LOCK_OVERSCROLL_ATTRIBUTE, "");
    Object.defineProperties(el, {
      clientHeight: { value: 100 },
      scrollHeight: { value: 400 },
    });
    return el;
  };
  const wheel = (target: HTMLElement, y: number) => {
    const e = new WheelEvent("wheel", {
      deltaY: y,
      bubbles: true,
      cancelable: true,
    });
    target.dispatchEvent(e);
    return e.defaultPrevented;
  };
  const added = vi.spyOn(host, "addEventListener");
  const removed = vi.spyOn(host, "removeEventListener");
  await act(async () => hostRef(host));
  const first = scroller();
  host.append(first);
  first.scrollTop = 0;
  // At the top edge, upward input is contained; inside, it scrolls.
  expect(wheel(first, -40)).toBe(true);
  first.scrollTop = 100;
  expect(wheel(first, -40)).toBe(false);
  // A tree made again (another project) needs no listener of its own.
  first.remove();
  const second = scroller();
  host.append(second);
  second.scrollTop = 0;
  expect(wheel(second, -40)).toBe(true);
  const plain = document.createElement("div");
  host.append(plain);
  expect(wheel(plain, -40)).toBe(false);
  expect(added.mock.calls.filter(([type]) => type === "wheel")).toHaveLength(1);
  expect(removed).not.toHaveBeenCalled();
  await act(async () => root.render(createElement(Host, { enabled: false })));
  expect(wheel(second, -40)).toBe(false);
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

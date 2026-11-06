// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { FadeText, MiddleText } from "../chrome/FadeText";
import { useScrollEdges } from "./useSoftCut";

type Observed = { target: Element; callback: ResizeObserverCallback };
let observed: Observed[];
let root: Root;
let host: HTMLDivElement;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  observed = [];
  vi.stubGlobal(
    "ResizeObserver",
    class {
      constructor(private callback: ResizeObserverCallback) {}
      observe(target: Element) {
        observed.push({ target, callback: this.callback });
      }
      unobserve() {}
      disconnect() {}
    },
  );
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    queueMicrotask(() => callback(0));
    return 1;
  });
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

/** Reports `widths` for observed elements, as the browser would after layout. */
function resize(widths: Map<Element, number>) {
  for (const { target, callback } of observed) {
    const width = widths.get(target);
    if (width == null) continue;
    callback(
      [{ target, contentRect: { width } } as unknown as ResizeObserverEntry],
      {} as ResizeObserver,
    );
  }
}

it("fades a label's end only while its text runs past it", async () => {
  await act(async () =>
    root.render(
      createElement(FadeText, {
        className: "label",
        children: "A long chat title",
      }),
    ),
  );
  const label = host.querySelector(".fade-cut")!;
  const text = label.querySelector(".fade-cut-text")!;
  expect(label.textContent).toBe("A long chat title");
  resize(
    new Map([
      [label, 80],
      [text, 120],
    ]),
  );
  expect(label.hasAttribute("data-cut")).toBe(true);
  resize(new Map([[label, 200]]));
  expect(label.hasAttribute("data-cut")).toBe(false);
});

it("keeps both ends of a path that doesn't fit, with the whole in its tooltip", async () => {
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
    font: "",
    measureText: (value: string) => ({ width: Array.from(value).length * 7 }),
  } as unknown as CanvasRenderingContext2D);
  const path = "src/surfaces/very/deep/folder/UnifiedDiffView.tsx";
  await act(async () => root.render(createElement(MiddleText, { text: path })));
  const element = host.querySelector(".middle-cut")!;
  expect(element.textContent).toBe(path);
  await act(async () => resize(new Map([[element, 140]])));
  expect(element.textContent).toMatch(/^src\/.*…\S+\.tsx$/);
  expect(element.getAttribute("title")).toBe(path);
  await act(async () => resize(new Map([[element, 1000]])));
  expect(element.textContent).toBe(path);
  expect(element.hasAttribute("title")).toBe(false);
});

it("marks a scroll area's edges and shadow from where it has scrolled", async () => {
  function List() {
    const ref = useScrollEdges<HTMLDivElement>();
    return createElement("div", { ref, className: "list" });
  }
  await act(async () => root.render(createElement(List)));
  const list = host.querySelector<HTMLDivElement>(".list")!;
  const metrics = (scrollTop: number) => {
    Object.defineProperty(list, "scrollTop", {
      configurable: true,
      value: scrollTop,
    });
    Object.defineProperty(list, "scrollHeight", {
      configurable: true,
      value: 600,
    });
    Object.defineProperty(list, "clientHeight", {
      configurable: true,
      value: 300,
    });
  };
  metrics(0);
  await act(async () => {
    list.dispatchEvent(new Event("scroll"));
  });
  expect(list.style.getPropertyValue("--aven-edge-bottom")).toBe("1");
  expect(list.hasAttribute("data-edge-fade")).toBe(true);
  expect(list.hasAttribute("data-stuck")).toBe(false);
  metrics(4);
  await act(async () => {
    list.dispatchEvent(new Event("scroll"));
  });
  expect(list.style.getPropertyValue("--aven-stuck")).toBe("0.5");
  expect(list.hasAttribute("data-stuck")).toBe(true);
});

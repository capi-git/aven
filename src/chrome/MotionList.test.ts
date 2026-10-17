// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MOTION_ATTRIBUTE, MOTION_ROOT_ATTRIBUTE } from "../lib/motion";
import { MotionList } from "./MotionList";

const ROW = 30;

describe("rows that glide", () => {
  let root: Root;
  let container: HTMLDivElement;
  let measured: number;
  let animate: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    document.documentElement.setAttribute(MOTION_ROOT_ATTRIBUTE, "full");
    measured = 0;
    // Layout stand-in: rows stack in DOM order, 30px apart.
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
      function (this: HTMLElement) {
        measured += 1;
        const index = this.parentElement
          ? [...this.parentElement.children].indexOf(this)
          : 0;
        return new DOMRect(0, index * ROW, 200, ROW);
      },
    );
    vi.spyOn(HTMLElement.prototype, "getClientRects").mockImplementation(
      () => [new DOMRect(0, 0, 200, ROW)] as unknown as DOMRectList,
    );
    animate = vi.fn(() => ({
      cancel: vi.fn(),
      finished: Promise.resolve(),
    }));
    vi.spyOn(HTMLElement.prototype, "animate").mockImplementation(
      animate as unknown as HTMLElement["animate"],
    );
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    document.documentElement.removeAttribute(MOTION_ROOT_ATTRIBUTE);
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  async function render(keys: string[], state = "", active = "") {
    await act(async () =>
      root.render(
        createElement(
          MotionList,
          { motionKeys: keys, motionState: state },
          keys.map((key) =>
            createElement(
              "li",
              { key, "data-motion-key": key },
              createElement(
                "button",
                { type: "button", "aria-current": key === active || undefined },
                key,
              ),
            ),
          ),
        ),
      ),
    );
  }
  const order = () =>
    [...container.querySelectorAll("li")].map((row) => row.textContent);
  const row = (key: string) =>
    container.querySelector<HTMLElement>(`[data-motion-key="${key}"]`)!;
  const glideOf = (key: string) =>
    animate.mock.calls.find(
      (_call, index) => animate.mock.contexts[index] === row(key),
    )?.[0];

  it("keeps React's order and the focused row's focus when rows move", async () => {
    await render(["a", "b", "c"]);
    const focused = row("b").querySelector("button")!;
    focused.focus();
    await render(["c", "a", "b"]);
    expect(order()).toEqual(["c", "a", "b"]);
    expect(document.activeElement).toBe(focused);
    expect(container.querySelector("[inert], [aria-hidden]")).toBeNull();
  });

  it("draws moved rows where they were and glides them by transform", async () => {
    await render(["a", "b", "c"]);
    await render(["c", "a", "b"]);
    // c moved up two rows; a and b moved down one.
    expect(glideOf("c")).toEqual([
      { transform: `translate3d(0px, ${2 * ROW}px, 0)` },
      { transform: "none" },
    ]);
    expect(glideOf("a")?.[0]).toEqual({
      transform: `translate3d(0px, ${-ROW}px, 0)`,
    });
    expect(glideOf("b")?.[0]).toEqual({
      transform: `translate3d(0px, ${-ROW}px, 0)`,
    });
    const options = animate.mock.calls[0][1] as KeyframeAnimationOptions;
    expect(options.duration).toBe(160);
    expect(options.fill).toBeUndefined();
  });

  it("fades a new row in and drops a removed one at once", async () => {
    await render(["a", "b", "c"]);
    await render(["new", "a", "c"]);
    expect(row("new").getAttribute(MOTION_ATTRIBUTE)).toBe("fade");
    expect(container.querySelector('[data-motion-key="b"]')).toBeNull();
    expect(order()).toEqual(["new", "a", "c"]);
    // c closes the gap b left; a moved down under the new row.
    expect(glideOf("c")).toBeUndefined();
    expect(glideOf("a")?.[0]).toEqual({
      transform: `translate3d(0px, ${-ROW}px, 0)`,
    });
  });

  it("measures nothing when the rows are unchanged", async () => {
    await render(["a", "b", "c"], "", "a");
    measured = 0;
    await render(["a", "b", "c"], "", "b");
    expect(measured).toBe(0);
    expect(animate).not.toHaveBeenCalled();
  });

  it("measures again when a row's status changes", async () => {
    await render(["a", "b"], "b,");
    measured = 0;
    await render(["a", "b"], ",d");
    expect(measured).toBeGreaterThan(0);
  });

  it("lets a new list simply appear", async () => {
    await render(["a", "b", "c"]);
    await render(["x", "y", "z"]);
    expect(animate).not.toHaveBeenCalled();
    expect(container.querySelector(`[${MOTION_ATTRIBUTE}]`)).toBeNull();
  });

  it("moves nothing when motion is reduced", async () => {
    document.documentElement.setAttribute(MOTION_ROOT_ATTRIBUTE, "reduce");
    await render(["a", "b", "c"]);
    measured = 0;
    await render(["new", "c", "a", "b"]);
    expect(order()).toEqual(["new", "c", "a", "b"]);
    expect(measured).toBe(0);
    expect(animate).not.toHaveBeenCalled();
    expect(container.querySelector(`[${MOTION_ATTRIBUTE}]`)).toBeNull();
  });
});

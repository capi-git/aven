// @vitest-environment happy-dom
import { act, createElement, useRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MOTION_ATTRIBUTE, MOTION_ROOT_ATTRIBUTE } from "../lib/motion";
import { useMotionOnChange } from "./useMotionOnChange";

function Counter({ value }: { value: string | undefined }) {
  const ref = useRef<HTMLSpanElement>(null);
  useMotionOnChange(ref, value);
  return createElement("span", { ref }, value ?? "");
}

describe("a counter that rolls", () => {
  let root: Root;
  let container: HTMLDivElement;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    document.documentElement.setAttribute(MOTION_ROOT_ATTRIBUTE, "full");
    container = document.createElement("div");
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    document.documentElement.removeAttribute(MOTION_ROOT_ATTRIBUTE);
    vi.unstubAllGlobals();
  });

  async function render(value: string | undefined) {
    await act(async () => root.render(createElement(Counter, { value })));
  }
  const span = () => container.querySelector("span")!;

  it("shows its first value still, and rolls each new value in after it is in place", async () => {
    await render("Round 2 of 4");
    expect(span().hasAttribute(MOTION_ATTRIBUTE)).toBe(false);
    await render("Round 2 of 4");
    expect(span().hasAttribute(MOTION_ATTRIBUTE)).toBe(false);
    await render("Round 3 of 4");
    expect(span().textContent).toBe("Round 3 of 4");
    expect(span().getAttribute(MOTION_ATTRIBUTE)).toBe("roll");
  });

  it("does not roll a value that appears or goes away", async () => {
    await render(undefined);
    await render("1 of 3 done");
    expect(span().hasAttribute(MOTION_ATTRIBUTE)).toBe(false);
  });

  it("changes at once when motion is reduced", async () => {
    document.documentElement.setAttribute(MOTION_ROOT_ATTRIBUTE, "reduce");
    await render("1 of 3 done");
    await render("2 of 3 done");
    expect(span().textContent).toBe("2 of 3 done");
    expect(span().hasAttribute(MOTION_ATTRIBUTE)).toBe(false);
  });
});

// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { useNavigationIntent } from "./useNavigationIntent";

it("lets the next click, keystroke, request, or unmount cancel a delayed open", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const host = document.createElement("div");
  const root = createRoot(host);
  let begin!: ReturnType<typeof useNavigationIntent>;
  function Harness() {
    begin = useNavigationIntent();
    return null;
  }
  try {
    await act(async () => root.render(createElement(Harness)));
    for (const event of ["pointerdown", "keydown"]) {
      const pending = begin();
      expect(pending()).toBe(true);
      window.dispatchEvent(new Event(event));
      expect(pending()).toBe(false);
    }
    const older = begin();
    const newest = begin();
    expect(older()).toBe(false);
    expect(newest()).toBe(true);
    await act(async () => root.unmount());
    expect(newest()).toBe(false);
  } finally {
    vi.unstubAllGlobals();
    host.remove();
  }
});

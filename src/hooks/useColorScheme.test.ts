// @vitest-environment happy-dom
import { act, createElement, useLayoutEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { SCHEME_CHANGE_EVENT, type ColorScheme } from "../lib/appearance";
import { useColorScheme } from "./useColorScheme";

vi.mock("../lib/appearance", () => ({
  SCHEME_CHANGE_EVENT: "monocode:schemechange",
  isLightScheme: () =>
    document.documentElement.classList.contains("theme-light"),
}));
let root: Root;
let container: HTMLDivElement;
function Probe() {
  return createElement("output", null, useColorScheme());
}
function applyScheme(scheme: ColorScheme) {
  document.documentElement.classList.toggle("theme-light", scheme === "light");
  window.dispatchEvent(
    new CustomEvent(SCHEME_CHANGE_EVENT, { detail: scheme }),
  );
}
function LayoutActivation() {
  useLayoutEffect(() => applyScheme("light"), []);
  return createElement(Probe);
}
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  document.documentElement.className = "";
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

it("reads the already-applied workspace scheme when a settings view mounts later", () => {
  applyScheme("light");
  act(() => root.render(createElement(Probe)));
  expect(container.textContent).toBe("light");
});

it("catches workspace activation between render and the passive subscription", () => {
  act(() => root.render(createElement(LayoutActivation)));
  expect(container.textContent).toBe("light");
});

it("follows subsequent workspace scheme events", () => {
  act(() => root.render(createElement(Probe)));
  expect(container.textContent).toBe("dark");
  act(() => applyScheme("light"));
  expect(container.textContent).toBe("light");
  act(() => applyScheme("dark"));
  expect(container.textContent).toBe("dark");
});

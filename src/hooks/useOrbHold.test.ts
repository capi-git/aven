// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { holdOrbs, useOrbHold, type OrbHold } from "./useOrbHold";

let root: Root;
let host: HTMLDivElement;
let seen: OrbHold;

function Probe() {
  seen = useOrbHold();
  return null;
}

/** The observer reports after a microtask. */
const settle = () => act(async () => await Promise.resolve());

beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  document.documentElement.setAttribute("data-motion", "full");
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root.render(createElement(Probe)));
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  document.documentElement.removeAttribute("data-motion");
  vi.unstubAllGlobals();
});

it("holds every orb still with Aven's own Reduce motion on", async () => {
  expect(seen).toEqual({ all: false, resting: false, reduced: false });
  document.documentElement.setAttribute("data-motion", "reduce");
  await settle();
  expect(seen).toEqual({ all: true, resting: true, reduced: true });
  document.documentElement.setAttribute("data-motion", "full");
  await settle();
  expect(seen.all).toBe(false);
});

it("holds every orb while a split resizes, without marking the root", async () => {
  const before = document.documentElement.className;
  let release!: () => void;
  await act(async () => {
    release = holdOrbs();
  });
  expect(seen.all).toBe(true);
  expect(document.documentElement.className).toBe(before);
  await act(async () => {
    release();
    release();
  });
  expect(seen.all).toBe(false);
});

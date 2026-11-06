// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { RollingText } from "../chrome/RollingText";

let root: Root;
let host: HTMLDivElement;
let calls: { node: Element; frames: Keyframe[] }[];
const animate = Element.prototype.animate;
const getAnimations = Element.prototype.getAnimations;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  document.documentElement.setAttribute("data-motion", "full");
  calls = [];
  Element.prototype.animate = function (frames: Keyframe[]) {
    calls.push({ node: this, frames });
    return {
      finished: new Promise(() => {}),
      cancel() {},
    } as unknown as Animation;
  };
  Element.prototype.getAnimations = () => [];
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  document.documentElement.removeAttribute("data-motion");
  Element.prototype.animate = animate;
  Element.prototype.getAnimations = getAnimations;
  vi.unstubAllGlobals();
});

const show = (text: string, value?: number) =>
  act(async () => root.render(createElement(RollingText, { text, value })));
const label = () => host.querySelector(".rolling-text")!;
const glyphText = (selector: string) =>
  [...label().querySelectorAll(selector)].map((node) => node.textContent);

it("shows the text at once the first time", async () => {
  await show("68%", 68);
  expect(label().textContent).toBe("68%");
  expect(calls).toEqual([]);
});

it("rolls only the changed digit up as the number rises", async () => {
  await show("68%", 68);
  await show("69%", 69);
  expect(glyphText(".rolling-text-glyph:not(.rolling-text-leaving)")).toEqual([
    "6",
    "9",
    "%",
  ]);
  expect(glyphText(".rolling-text-leaving")).toEqual(["8"]);
  expect(
    label().querySelector(".rolling-text-leaving")!.getAttribute("aria-hidden"),
  ).toBe("true");
  const rolled = calls.map((call) => [
    call.node.textContent,
    call.frames[0].transform,
  ]);
  expect(rolled).toEqual([
    ["9", "translateY(100%)"],
    ["8", "none"],
  ]);
  expect(calls[1].frames[1].transform).toBe("translateY(-100%)");
  expect(label().hasAttribute("data-rolling")).toBe(true);
});

it("rolls down as the number falls", async () => {
  await show("69%", 69);
  await show("67%", 67);
  expect(calls[0].node.textContent).toBe("7");
  expect(calls[0].frames[0].transform).toBe("translateY(-100%)");
});

it("swaps the text without motion when Reduce motion is on", async () => {
  await show("68%", 68);
  document.documentElement.setAttribute("data-motion", "reduce");
  await show("70%", 70);
  expect(label().textContent).toBe("70%");
  expect(label().querySelector(".rolling-text-leaving")).toBeNull();
  expect(calls).toEqual([]);
});

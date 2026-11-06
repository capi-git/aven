// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { MOTION_ROOT_ATTRIBUTE } from "../lib/motion";
import { AgentMarkdown } from "./AgentMarkdown";

let root: Root;
let host: HTMLDivElement;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  document.documentElement.setAttribute(MOTION_ROOT_ATTRIBUTE, "full");
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  document.documentElement.removeAttribute(MOTION_ROOT_ATTRIBUTE);
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const show = (text: string, streaming = true, revealWords = true) =>
  act(async () =>
    root.render(createElement(AgentMarkdown, { text, streaming, revealWords })),
  );
const fading = () =>
  [...host.querySelectorAll<HTMLElement>("[data-reveal]")].map((word) => [
    word.textContent,
    word.style.getPropertyValue("--reveal-delay"),
  ]);

it("fades each new word in on its turn, 20 ms apart", async () => {
  await show("Here it is");
  expect(fading()).toEqual([
    ["Here", "0ms"],
    ["it", "20ms"],
    ["is", "40ms"],
  ]);
});

it("keeps a word's delay as more text arrives", async () => {
  await show("Here it");
  const before = fading();
  await show("Here it is, now");
  expect(fading().slice(0, 2)).toEqual(before);
  expect(fading().map(([word]) => word)).toEqual(["Here", "it", "is,", "now"]);
});

it("spreads a burst with a shorter gap, a frame's words as one", async () => {
  const words = Array.from({ length: 60 }, (_, index) => `w${index}`);
  await show(words.join(" "));
  const delays = fading().map(([, delay]) => Number.parseFloat(delay!));
  // 5.5 ms apart is about three words a frame, and none waits long.
  expect(delays.length).toBeGreaterThan(5);
  expect(delays.length).toBeLessThan(30);
  expect(Math.max(...delays)).toBeLessThanOrEqual(120);
  const text = fading()
    .map(([word]) => word)
    .join(" ");
  expect(text.split(" ")).toHaveLength(60);
});

it("splits only the block still being written", async () => {
  let now = 1000;
  vi.spyOn(performance, "now").mockImplementation(() => now);
  await show("First paragraph here.");
  now += 5000;
  await show("First paragraph here.\n\nSecond one");
  const blocks = [...host.querySelectorAll(".agent-markdown-block")];
  const first = blocks.find((block) => block.textContent?.includes("First"))!;
  const last = blocks.at(-1)!;
  // The finished paragraph is plain text again; the new one fades in.
  expect(first.querySelector("[data-reveal]")).toBeNull();
  expect(last.querySelector("[data-reveal]")).not.toBeNull();
});

it("fades inline code as one word and leaves code blocks alone", async () => {
  await show("Run `npm test` now");
  const code = host.querySelector("p code")!;
  expect(code.parentElement?.hasAttribute("data-reveal")).toBe(true);
  await show("Run `npm test` now\n\n```\nnpm test\n```");
  expect(host.querySelector("pre [data-reveal]")).toBeNull();
});

it("shows what was there at once when it turns on mid-reply", async () => {
  await show("Already here", true, false);
  await show("Already here", true, true);
  expect(fading()).toEqual([]);
  await show("Already here and more", true, true);
  expect(fading().map(([word]) => word)).toEqual(["and", "more"]);
});

it("draws plain words once the reply has finished and settled", async () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  await show("Done now");
  await show("Done now", false);
  await act(async () => {
    vi.advanceTimersByTime(1000);
  });
  expect(host.querySelector("[data-reveal]")).toBeNull();
  expect(host.textContent).toContain("Done now");
});

it("does nothing with Reduce motion on", async () => {
  document.documentElement.setAttribute(MOTION_ROOT_ATTRIBUTE, "reduce");
  await show("Here it is");
  expect(host.querySelector("[data-reveal]")).toBeNull();
});

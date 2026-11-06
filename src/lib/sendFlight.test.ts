// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { MOTION_ROOT_ATTRIBUTE } from "./motion";
import {
  landSentText,
  sameSentText,
  SEND_FLIGHT_MS,
  takeOffSentText,
} from "./sendFlight";

let animations: { node: Element; frames: Keyframe[]; finish: () => void }[];
const animate = Element.prototype.animate;

function box(left: number, top: number, width: number, height: number) {
  return () => new DOMRect(left, top, width, height);
}

beforeEach(() => {
  document.documentElement.setAttribute(MOTION_ROOT_ATTRIBUTE, "full");
  animations = [];
  Element.prototype.animate = function (frames: Keyframe[]) {
    let finish = () => {};
    const finished = new Promise<void>((resolve) => (finish = resolve));
    animations.push({ node: this, frames, finish: () => finish() });
    return { finished, cancel() {} } as unknown as Animation;
  };
});

afterEach(() => {
  Element.prototype.animate = animate;
  document.documentElement.removeAttribute(MOTION_ROOT_ATTRIBUTE);
  document.body.replaceChildren();
  vi.useRealTimers();
});

function setUp() {
  const shell = document.createElement("div");
  shell.className = "personal-shell";
  const field = document.createElement("div");
  field.textContent = "Make the sidebar smoother";
  field.getBoundingClientRect = box(100, 600, 500, 44);
  const bubble = document.createElement("div");
  const words = document.createElement("pre");
  words.textContent = "Make the sidebar smoother";
  words.getBoundingClientRect = box(316, 112, 260, 23);
  bubble.append(words);
  bubble.getBoundingClientRect = box(300, 102, 292, 43);
  shell.append(field, bubble);
  document.body.append(shell);
  return { field, bubble };
}

it("flies the sent words from the box into the new bubble", async () => {
  const { field, bubble } = setUp();
  takeOffSentText(field, "Make the sidebar smoother");
  expect(landSentText(bubble, "Make the sidebar smoother")).toBe(true);
  // Hidden where it lands until the copy arrives.
  expect(bubble.style.opacity).toBe("0");
  await Promise.resolve();
  const layer = document.querySelector(".personal-shell > .send-flight-layer")!;
  expect(layer.childElementCount).toBe(2);
  const [arrive, leave] = animations;
  // The bubble's copy starts where the box drew the words, and fades in.
  expect(arrive.frames[0]).toMatchObject({ opacity: 0 });
  expect(arrive.frames[0].transform).toMatch(/^translate\(-216px, 488px\)/);
  expect(arrive.frames.at(-1)).toMatchObject({ transform: "none", opacity: 1 });
  // The box's copy travels with it and fades out early.
  expect(leave.frames[0]).toMatchObject({ transform: "none", opacity: 1 });
  expect(leave.frames.at(-1)!.transform).toMatch(/^translate\(216px, -488px\)/);
  arrive.finish();
  leave.finish();
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(bubble.style.opacity).toBe("");
  expect(document.querySelector(".send-flight-layer")).toBeNull();
});

it("lets other messages rise as before", () => {
  const { field, bubble } = setUp();
  expect(landSentText(bubble, "Make the sidebar smoother")).toBe(false);
  takeOffSentText(field, "Something else entirely");
  expect(landSentText(bubble, "Make the sidebar smoother")).toBe(false);
  expect(bubble.style.opacity).toBe("");
});

it("does not fly a send whose message took too long", () => {
  vi.useFakeTimers({ toFake: ["performance"] });
  const { field, bubble } = setUp();
  takeOffSentText(field, "Make the sidebar smoother");
  vi.advanceTimersByTime(SEND_FLIGHT_MS * 2);
  expect(landSentText(bubble, "Make the sidebar smoother")).toBe(false);
});

it("does not fly with Reduce motion on", () => {
  document.documentElement.setAttribute(MOTION_ROOT_ATTRIBUTE, "reduce");
  const { field, bubble } = setUp();
  takeOffSentText(field, "Make the sidebar smoother");
  expect(landSentText(bubble, "Make the sidebar smoother")).toBe(false);
});

it("matches the words sent with the message shown", () => {
  expect(sameSentText("fix  the\nbug", "fix the bug")).toBe(true);
  expect(sameSentText("/review", "/review src/a.ts")).toBe(true);
  expect(sameSentText("", "")).toBe(false);
  expect(sameSentText("one", "two")).toBe(false);
});

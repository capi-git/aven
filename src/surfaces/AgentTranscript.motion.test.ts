// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Block } from "../lib/session";
import { MOTION_ATTRIBUTE, MOTION_ROOT_ATTRIBUTE } from "../lib/motion";

vi.mock("./AgentMarkdown", () => ({
  AgentMarkdown: ({ text }: { text: string }) =>
    createElement("div", null, text),
}));

import { AgentTranscript } from "./AgentTranscript";

let root: Root;
let container: HTMLDivElement;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  document.documentElement.setAttribute(MOTION_ROOT_ATTRIBUTE, "full");
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  document.documentElement.removeAttribute(MOTION_ROOT_ATTRIBUTE);
  vi.unstubAllGlobals();
});

const earlier: Block[] = [
  { id: "user-1", role: "user", text: "First question", durationMs: 2_000 },
  { id: "answer-1", role: "assistant", text: "First answer." },
];
const sent: Block = {
  id: "user-2",
  role: "user",
  text: "Send this now",
  startedAt: Date.now(),
};

async function render(blocks: Block[], busy = false, visible = true) {
  await act(async () => {
    root.render(
      createElement(AgentTranscript, {
        blocks,
        busy,
        visible,
        harness: "claude",
        model: "claude:opus-5.5",
      }),
    );
  });
}

const bubble = (text: string) =>
  [...container.querySelectorAll<HTMLElement>(".personal-user-bubble")].find(
    (element) => element.textContent?.includes(text),
  );
const response = (text: string) =>
  [
    ...container.querySelectorAll<HTMLElement>(".personal-transcript-response"),
  ].find((element) => element.textContent?.includes(text));

describe("sending a message", () => {
  it("opens a chat with everything in place", async () => {
    await render(earlier);
    expect(container.querySelector(`[${MOTION_ATTRIBUTE}]`)).toBeNull();
  });

  it("adds your message in the same render, rising in, and leaves earlier turns still", async () => {
    await render(earlier);
    await render([...earlier, sent], true);
    // The message is there at once; the rise only moves it into place.
    expect(bubble("Send this now")).toBeDefined();
    expect(bubble("Send this now")!.getAttribute(MOTION_ATTRIBUTE)).toBe(
      "rise",
    );
    expect(bubble("First question")!.hasAttribute(MOTION_ATTRIBUTE)).toBe(
      false,
    );
    expect(response("First answer.")!.hasAttribute(MOTION_ATTRIBUTE)).toBe(
      false,
    );
  });

  it("fades the reply in as it starts, once", async () => {
    await render(earlier);
    await render([...earlier, sent], true);
    const reply: Block = {
      id: "answer-2",
      role: "assistant",
      text: "Here",
      streaming: true,
    };
    await render([...earlier, sent, reply], true);
    const element = response("Here")!;
    expect(element.getAttribute(MOTION_ATTRIBUTE)).toBe("fade");
    element.dispatchEvent(new Event("animationend"));
    expect(element.hasAttribute(MOTION_ATTRIBUTE)).toBe(false);
    // Streaming more text does not start it again.
    await render([...earlier, sent, { ...reply, text: "Here it is" }], true);
    expect(response("Here it is")!.hasAttribute(MOTION_ATTRIBUTE)).toBe(false);
  });

  it("shows a turn that arrived while the tab was hidden in place", async () => {
    await render(earlier, false, true);
    await render(earlier, false, false);
    await render([...earlier, sent], true, false);
    await render([...earlier, sent], true, true);
    expect(bubble("Send this now")).toBeDefined();
    expect(bubble("Send this now")!.hasAttribute(MOTION_ATTRIBUTE)).toBe(false);
  });

  it("adds the message without motion when motion is reduced", async () => {
    document.documentElement.setAttribute(MOTION_ROOT_ATTRIBUTE, "reduce");
    await render(earlier);
    await render([...earlier, sent], true);
    expect(bubble("Send this now")).toBeDefined();
    expect(container.querySelector(`[${MOTION_ATTRIBUTE}]`)).toBeNull();
  });
});

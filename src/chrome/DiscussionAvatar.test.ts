// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { DiscussionParty } from "../lib/discussions";
import { discussionVoices } from "../lib/discussionVoices";
import { DiscussionAvatar } from "./DiscussionAvatar";

const A: DiscussionParty = {
  sessionId: "a",
  harness: "claude",
  model: "Opus",
  title: "Caching",
  cwd: "/work/site",
};
const B: DiscussionParty = {
  sessionId: "b",
  harness: "codex",
  model: "GPT-5",
  title: "Review",
  cwd: "/work/site",
  role: "skeptic",
};

let root: Root;
let host: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

it("marks the mascot of a chat brought in with a role, wherever it is drawn", async () => {
  // The discussion panel, its pills and the cards draw these same voices.
  const voices = discussionVoices({ a: A, b: B });
  await act(async () =>
    root.render(
      createElement("div", null, [
        createElement(DiscussionAvatar, { key: "a", voice: voices.a }),
        createElement(DiscussionAvatar, {
          key: "b",
          voice: voices.b,
          size: "large",
        }),
      ]),
    ),
  );
  const [a, b] = [...host.querySelectorAll<HTMLElement>(".discussion-avatar")];
  expect(a.querySelector(".discussion-avatar-role")).toBeNull();
  expect(a.title).toBe("Claude · Opened the topic");
  expect(b.dataset.role).toBe("skeptic");
  expect(b.querySelector(".discussion-avatar-role")?.textContent).toBe("S");
  expect(b.title).toBe("Codex · Skeptic · Joined the topic");
});

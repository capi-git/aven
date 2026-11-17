// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import {
  FORWARD_TO_CHAT_EVENT,
  forwardCard,
  requestForwardToChat,
  type ForwardRequest,
} from "./chatForward";
import { composeNoteMessage, noteCardMeta } from "./notes";

const from = {
  id: "src",
  title: "Login work",
  harness: "codex" as const,
  cwd: "/w/app",
};

describe("forwardCard", () => {
  it("carries the reply and names the chat it came from", () => {
    expect(forwardCard(from, "Line one\r\n\r\nLine two\n")).toEqual({
      id: "src",
      slug: "",
      title: "Login work",
      body: "Line one\n\nLine two",
      kind: "forward",
      harness: "codex",
      sourceCwd: "/w/app",
    });
    expect(forwardCard(from, "  ")).toBeNull();
  });

  it("keeps the kind and agent on the sent message's card", () => {
    const card = forwardCard(from, "x")!;
    expect(noteCardMeta(card)).toEqual({
      id: "src",
      slug: "",
      title: "Login work",
      sourceCwd: "/w/app",
      kind: "forward",
      harness: "codex",
    });
  });

  it("gives the agent the reply after what the user wrote", () => {
    const card = forwardCard(from, "Use JWT.")!;
    expect(composeNoteMessage(card, "Do this here")).toBe(
      'Do this here\n\n---\nForwarded from the chat "Login work":\n\n<forwarded>\nUse JWT.\n</forwarded>',
    );
    expect(composeNoteMessage(card, " ")).toMatch(
      /^Here is a reply from another chat\.\n/,
    );
  });
});

describe("requestForwardToChat", () => {
  it("asks the app to forward", () => {
    const seen: ForwardRequest[] = [];
    const listener = (event: Event) =>
      seen.push((event as CustomEvent<ForwardRequest>).detail);
    window.addEventListener(FORWARD_TO_CHAT_EVENT, listener);
    const card = forwardCard(from, "hi")!;
    requestForwardToChat({ card, cwd: "/w", toSessionId: "a" });
    window.removeEventListener(FORWARD_TO_CHAT_EVENT, listener);
    expect(seen).toEqual([{ card, cwd: "/w", toSessionId: "a" }]);
  });
});

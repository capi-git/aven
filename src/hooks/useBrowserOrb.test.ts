// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  BrowserOrbAction,
  BrowserOrbAnchor,
  BrowserOrbSnapshot,
} from "../lib/browserOrb";
import type { Block, Session } from "../lib/session";
import { BROWSER_ORB_TRACK_MS, useBrowserOrb } from "./useBrowserOrb";

const PAGE: BrowserOrbAnchor = {
  x: 300,
  y: 80,
  width: 900,
  height: 600,
  dpr: 2,
};

function block(role: Block["role"], text: string): Block {
  return { id: crypto.randomUUID(), role, text } as Block;
}

function chat(overrides: Partial<Session> = {}): Session {
  return {
    id: "chat-1",
    harness: "claude",
    model: "claude:sonnet",
    modelSettings: {},
    runtimeMode: "auto",
    title: "Fix hero layout",
    cwd: "/work/site",
    blocks: [block("user", "earlier"), block("assistant", "earlier answer")],
    ...overrides,
  } as Session;
}

describe("the Aven bubble's owner", () => {
  let root: Root;
  let container: HTMLDivElement;
  let anchor: BrowserOrbAnchor | null;
  let deliver: (action: BrowserOrbAction) => void;
  const set = vi.fn(async () => {});
  const close = vi.fn(async () => {});
  const native = {
    set,
    close,
    listen: vi.fn(
      async (_event: string, callback: (payload: never) => void) => {
        deliver = callback as unknown as typeof deliver;
        return () => {};
      },
    ),
  };
  const onSubmit = vi.fn();
  const onStop = vi.fn();
  const onOpenChat = vi.fn();
  const findAnchor = () => anchor;

  function Harness({
    session,
    enabled,
  }: {
    session: Session | undefined;
    enabled: boolean;
  }) {
    useBrowserOrb({
      enabled,
      session,
      onSubmit,
      onStop,
      onOpenChat,
      findAnchor,
      native,
    });
    return null;
  }

  function render(session: Session | undefined, enabled = true) {
    return act(async () =>
      root.render(createElement(Harness, { session, enabled })),
    );
  }

  const lastSet = () =>
    set.mock.calls.at(-1) as unknown as [
      BrowserOrbAnchor | null,
      BrowserOrbSnapshot,
    ];

  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    anchor = PAGE;
    set.mockClear();
    onSubmit.mockClear();
    onStop.mockClear();
    onOpenChat.mockClear();
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("floats over the visible page and hides when no page is showing", async () => {
    await render(chat());
    expect(lastSet()[0]).toEqual(PAGE);
    expect(lastSet()[1]).toEqual({
      chat: { title: "Fix hero layout", agent: "Claude Code" },
      busy: false,
      answer: null,
    });
    anchor = null;
    await act(() => vi.advanceTimersByTimeAsync(BROWSER_ORB_TRACK_MS));
    expect(lastSet()[0]).toBeNull();
  });

  it("does not resend when nothing moved", async () => {
    await render(chat());
    const calls = set.mock.calls.length;
    await act(() => vi.advanceTimersByTimeAsync(BROWSER_ORB_TRACK_MS * 4));
    expect(set.mock.calls.length).toBe(calls);
  });

  it("sends to the active chat and shows only the reply to that question", async () => {
    const session = chat();
    await render(session);
    await act(async () =>
      deliver({ action: "submit", text: "  why is it cramped?  " }),
    );
    expect(onSubmit).toHaveBeenCalledWith("chat-1", "why is it cramped?");
    // The earlier answer is not a reply to the bubble's question.
    expect(lastSet()[1].answer).toBeNull();

    const asked = [...session.blocks, block("user", "why is it cramped?")];
    await render({ ...session, busy: true, blocks: asked });
    expect(lastSet()[1].busy).toBe(true);
    expect(lastSet()[1].answer).toBeNull();

    await render({
      ...session,
      busy: false,
      blocks: [...asked, block("assistant", "The heading is fixed at 44px.")],
    });
    expect(lastSet()[1].answer).toMatchObject({
      text: "The heading is fixed at 44px.",
    });
  });

  it("ignores streamed chat updates that do not change what the bubble shows", async () => {
    const session = chat({ busy: true });
    await render(session);
    const calls = set.mock.calls.length;
    for (const word of ["The", "heading", "is", "fixed"])
      await render({
        ...session,
        blocks: [...session.blocks, block("assistant", word)],
      });
    expect(set.mock.calls.length).toBe(calls);
  });

  it("does not send while the chat is working, and routes stop and open", async () => {
    await render(chat({ busy: true }));
    await act(async () => deliver({ action: "submit", text: "hello" }));
    expect(onSubmit).not.toHaveBeenCalled();
    await act(async () => deliver({ action: "stop" }));
    expect(onStop).toHaveBeenCalledWith("chat-1");
    await act(async () => deliver({ action: "openChat" }));
    expect(onOpenChat).toHaveBeenCalledWith("chat-1");
  });

  it("says when there is no chat to send to", async () => {
    await render(undefined);
    expect(lastSet()[1].chat).toBeNull();
    await act(async () => deliver({ action: "submit", text: "hello" }));
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("hides the bubble when the setting is turned off", async () => {
    await render(chat());
    await render(chat(), false);
    expect(lastSet()[0]).toBeNull();
    set.mockClear();
    await act(() => vi.advanceTimersByTimeAsync(BROWSER_ORB_TRACK_MS * 2));
    expect(set).not.toHaveBeenCalled();
  });
});

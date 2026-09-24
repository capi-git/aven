// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  canDeferStreamCommit,
  createLiveSessionStore,
  isTranscriptOnlyChange,
  LiveSessionsContext,
  useLiveSession,
  type LiveSessionStore,
} from "./liveSessions";
import { newSession, type Block, type Session } from "./session";

const reply = (text: string): Block => ({
  id: crypto.randomUUID(),
  role: "assistant",
  text,
  streaming: true,
});

const withBlocks = (session: Session, blocks: Block[]): Session => ({
  ...session,
  blocks,
});

afterEach(() => vi.unstubAllGlobals());

describe("createLiveSessionStore", () => {
  it("notifies only subscribers of sessions whose objects changed", () => {
    const a = newSession("claude", "/tmp/a");
    const b = newSession("codex", "/tmp/b");
    const store = createLiveSessionStore([a, b]);
    const onA = vi.fn();
    const onB = vi.fn();
    store.subscribe(a.id, onA);
    const stopB = store.subscribe(b.id, onB);

    const streamed = withBlocks(a, [reply("Hello")]);
    store.set([streamed, b]);
    expect(store.session(a.id)).toBe(streamed);
    expect(onA).toHaveBeenCalledOnce();
    expect(onB).not.toHaveBeenCalled();

    store.set([streamed]);
    expect(onB).toHaveBeenCalledOnce();
    expect(store.session(b.id)).toBeUndefined();

    stopB();
    store.set([streamed, b]);
    expect(onB).toHaveBeenCalledOnce();
    expect(onA).toHaveBeenCalledOnce();
  });
});

describe("isTranscriptOnlyChange", () => {
  it("accepts streamed transcript text", () => {
    const session = withBlocks(newSession(), [reply("Hel")]);
    expect(
      isTranscriptOnlyChange(session, withBlocks(session, [reply("Hello")])),
    ).toBe(true);
  });

  it("rejects changes the workspace shows or acts on", () => {
    const session = withBlocks(newSession(), [reply("Hel")]);
    const blocks = [reply("Hello")];
    expect(
      isTranscriptOnlyChange(session, { ...session, blocks, busy: false }),
    ).toBe(false);
    expect(
      isTranscriptOnlyChange(session, { ...session, blocks, title: "Renamed" }),
    ).toBe(false);
    expect(isTranscriptOnlyChange(session, { ...session, busy: true })).toBe(
      false,
    );
    const approval = {
      ...reply("Run tests?"),
      approval: { requestId: "r1" },
    } as Block;
    expect(
      isTranscriptOnlyChange(session, withBlocks(session, [approval])),
    ).toBe(false);
  });
});

describe("canDeferStreamCommit", () => {
  it("defers transcript streaming shown only in this window", () => {
    const a = newSession("claude", "/tmp/a");
    const b = newSession("codex", "/tmp/b");
    const next = [withBlocks(a, [reply("Hi")]), b];
    expect(canDeferStreamCommit([a, b], next, new Set())).toBe(true);
    expect(canDeferStreamCommit([a, b], next, new Set([a.id]))).toBe(false);
    expect(canDeferStreamCommit([a, b], next, new Set([b.id]))).toBe(true);
  });

  it("commits when any session changes more than its transcript", () => {
    const a = newSession("claude", "/tmp/a");
    const b = newSession("codex", "/tmp/b");
    const next = [withBlocks(a, [reply("Hi")]), { ...b, busy: false }];
    expect(canDeferStreamCommit([a, b], next, new Set())).toBe(false);
    expect(canDeferStreamCommit([a, b], [a], new Set())).toBe(false);
  });
});

describe("useLiveSession", () => {
  async function render(
    store: LiveSessionStore | null,
    session: Session,
    live: boolean,
  ) {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    const seen: Session[] = [];
    function Pane({ value, shown }: { value: Session; shown: boolean }) {
      seen.push(useLiveSession(value, shown));
      return null;
    }
    const root = createRoot(document.createElement("div"));
    const draw = (value: Session, shown: boolean) =>
      act(async () =>
        root.render(
          createElement(
            LiveSessionsContext.Provider,
            { value: store },
            createElement(Pane, { value, shown }),
          ),
        ),
      );
    await draw(session, live);
    return { seen, draw, root };
  }

  it("follows the store while visible without a parent render", async () => {
    const session = newSession();
    const store = createLiveSessionStore([session]);
    const { seen, root } = await render(store, session, true);
    const streamed = withBlocks(session, [reply("Hello")]);
    await act(async () => store.set([streamed]));
    expect(seen.at(-1)).toBe(streamed);
    await act(async () => root.unmount());
  });

  it("keeps the committed session while hidden and catches up when shown", async () => {
    const session = newSession();
    const store = createLiveSessionStore([session]);
    const { seen, draw, root } = await render(store, session, false);
    const renders = seen.length;
    const streamed = withBlocks(session, [reply("Hello")]);
    await act(async () => store.set([streamed]));
    expect(seen.length).toBe(renders);
    expect(seen.at(-1)).toBe(session);
    await draw(session, true);
    expect(seen.at(-1)).toBe(streamed);
    await act(async () => root.unmount());
  });

  it("uses the prop outside a live store", async () => {
    const session = newSession();
    const { seen, root } = await render(null, session, true);
    expect(seen.at(-1)).toBe(session);
    await act(async () => root.unmount());
  });
});

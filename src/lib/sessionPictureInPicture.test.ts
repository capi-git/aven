// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { flushSync } from "react-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  nativeSessionPip,
  parseSessionPipEnvelope,
  validSessionPipAction,
  useSessionPictureInPicture,
  type SessionPipSharedProps,
} from "./sessionPictureInPicture";
import { readComposerDraft, updateComposerDraft } from "./composerDrafts";
import type { Session } from "./session";
import { flushWorkspaceDrafts } from "./workspaceDraftFlush";

const quit = vi.hoisted(() => vi.fn());
vi.mock("./appLifecycle", () => ({ handleQuitRequested: quit }));

const session = (id: string, patch: Partial<Session> = {}): Session => ({
  id,
  title: "Draft session",
  harness: "codex",
  model: "gpt-5",
  modelSettings: {},
  runtimeMode: "bypass",
  cwd: "/projects/demo",
  blocks: [],
  ...patch,
});
const shared = (): SessionPipSharedProps =>
  ({
    recents: [],
    hideProjectPicker: true,
    ...Object.fromEntries(
      [
        "onCwdChange",
        "onBranchChange",
        "onModelChange",
        "onModelSettingsChange",
        "onRuntimeModeChange",
        "onSubmit",
        "onStop",
        "onCompactContext",
        "onDeleteQueuedMessage",
        "onEditQueuedMessage",
        "onQueuedMessageEditingChange",
        "onSteerQueuedMessage",
        "onResumeQueue",
        "onApproval",
        "onQuestionReply",
        "onOpenFile",
        "onOpenUrl",
        "onOpenDiff",
        "onOpenPlan",
        "onBuildPlan",
        "onNewTerminal",
      ].map((name) => [name, vi.fn()]),
    ),
  }) as SessionPipSharedProps;

describe("session picture in picture owner", () => {
  let root: Root;
  let element: HTMLDivElement;
  let api: ReturnType<typeof useSessionPictureInPicture>;
  let sessions: Session[];
  let props: SessionPipSharedProps;
  let listeners: Map<string, (event: unknown) => void>;
  let id: string;
  let returnFocus: ((id: string) => void) | undefined;
  let returned: Parameters<typeof useSessionPictureInPicture>[3];
  let sequence = 0;
  function Harness() {
    api = useSessionPictureInPicture(sessions, props, returnFocus, returned);
    return null;
  }
  const render = () => act(async () => root.render(createElement(Harness)));
  const emit = (name: string, payload: unknown) =>
    act(async () => listeners.get(name)?.(payload));
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    id = `pip-owner-${++sequence}`;
    sessions = [session(id)];
    returnFocus = undefined;
    returned = undefined;
    props = shared();
    listeners = new Map();
    for (const name of ["open", "update", "close", "show"] as const)
      vi.spyOn(nativeSessionPip, name).mockResolvedValue(undefined as never);
    vi.spyOn(nativeSessionPip, "listen").mockImplementation(
      async (name, callback) => {
        listeners.set(name, callback as (event: unknown) => void);
        return () => {
          listeners.delete(name);
        };
      },
    );
    vi.spyOn(nativeSessionPip, "flushAll").mockResolvedValue([]);
    element = document.createElement("div");
    document.body.append(element);
    root = createRoot(element);
  });
  afterEach(() => {
    act(() => root.unmount());
    element.remove();
    vi.restoreAllMocks();
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("opens with draft and callback availability, coalesces only changed sessions, and keeps review locks current", async () => {
    updateComposerDraft(id, { text: "Keep me" });
    await render();
    await act(async () => api.open(id));
    expect(api.ids).toEqual([id]);
    expect(nativeSessionPip.open).toHaveBeenCalledWith(
      id,
      "Draft session",
      expect.objectContaining({
        draft: expect.objectContaining({ text: "Keep me" }),
        reviewUndoLocked: false,
      }),
    );
    vi.mocked(nativeSessionPip.update).mockClear();
    sessions = [...sessions];
    await render();
    await act(async () => vi.advanceTimersByTime(500));
    expect(nativeSessionPip.update).not.toHaveBeenCalled();
    sessions = [sessions[0], session("other", { busy: true })];
    await render();
    await act(async () => vi.advanceTimersByTime(50));
    expect(nativeSessionPip.update).toHaveBeenLastCalledWith(
      id,
      expect.objectContaining({ reviewUndoLocked: true }),
    );
    sessions = [{ ...sessions[0], title: "First" }, sessions[1]];
    await render();
    sessions = [{ ...sessions[0], title: "Last" }, sessions[1]];
    await render();
    await act(async () => vi.advanceTimersByTime(50));
    expect(nativeSessionPip.update).toHaveBeenCalledTimes(2);
    expect(nativeSessionPip.update).toHaveBeenLastCalledWith(
      id,
      expect.objectContaining({ session: sessions[0] }),
    );
  });

  it("retains the native window label through owner updates and subsequent group-open requests", async () => {
    vi.mocked(nativeSessionPip.open).mockResolvedValue("pip-session-retained");
    await render();
    let first: string | undefined;
    await act(async () => {
      first = await api.open(id);
    });
    expect(first).toBe("pip-session-retained");
    sessions = [{ ...sessions[0], title: "Updated original session" }];
    await render();
    await act(async () => vi.advanceTimersByTime(50));
    let reopened: string | undefined;
    await act(async () => {
      reopened = await api.open(id);
    });
    expect(reopened).toBe(first);
    expect(nativeSessionPip.open).toHaveBeenCalledOnce();
    expect(nativeSessionPip.show).toHaveBeenCalledExactlyOnceWith(id);
    expect(api.ids).toEqual([id]);
  });

  it("shares an in-flight open with a group request instead of returning an unavailable label", async () => {
    let finish!: (label: string) => void;
    vi.mocked(nativeSessionPip.open).mockImplementationOnce(
      () =>
        new Promise<string>((resolve) => {
          finish = resolve;
        }),
    );
    await render();
    let individual!: Promise<string | undefined>;
    let grouped!: Promise<string | undefined>;
    await act(async () => {
      individual = api.open(id);
      await Promise.resolve();
      grouped = api.open(id);
    });
    expect(nativeSessionPip.open).toHaveBeenCalledOnce();
    expect(nativeSessionPip.show).not.toHaveBeenCalled();
    let labels!: Array<string | undefined>;
    await act(async () => {
      finish("pip-session-shared-open");
      labels = await Promise.all([individual, grouped]);
    });
    expect(labels).toEqual([
      "pip-session-shared-open",
      "pip-session-shared-open",
    ]);
    expect(api.ids).toEqual([id]);
  });

  it("rejects wrong-session actions and uses latest owner callbacks, then restores draft before returning file UI", async () => {
    await render();
    await act(async () => api.open(id));
    await emit("session-pip-action", { id, action: "onStop", args: ["other"] });
    expect(props.onStop).not.toHaveBeenCalled();
    const latest = vi.fn();
    props = { ...props, onStop: latest };
    await render();
    await emit("session-pip-action", { id, action: "onStop", args: [id] });
    expect(latest).toHaveBeenCalledWith(id);
    const onOpenFile = vi.fn(() =>
      expect(readComposerDraft(id)?.text).toBe("Last input"),
    );
    props = { ...props, onOpenFile };
    await render();
    await emit("session-pip-action", {
      id,
      action: "onOpenFile",
      args: ["/projects/demo/a.ts"],
    });
    expect(nativeSessionPip.close).toHaveBeenCalledWith(id);
    expect(onOpenFile).not.toHaveBeenCalled();
    await emit("session-pip-closed", {
      id,
      draft: { text: "Last input", attachments: [], updatedAt: Date.now() },
    });
    expect(api.ids).toEqual([]);
    expect(onOpenFile).toHaveBeenCalledOnce();
  });

  it("opens PiP web links in the owner after restoring its draft", async () => {
    await render();
    await act(async () => api.open(id));
    await emit("session-pip-action", { id, action: "onOpenUrl", args: ["https://example.com/docs"] });
    expect(nativeSessionPip.close).toHaveBeenCalledWith(id);
    expect(props.onOpenUrl).not.toHaveBeenCalled();
    await emit("session-pip-closed", { id, draft: { text: "Saved draft", attachments: [], updatedAt: Date.now() } });
    expect(readComposerDraft(id)?.text).toBe("Saved draft");
    expect(props.onOpenUrl).toHaveBeenCalledWith("https://example.com/docs");
  });

  it("accepts a fast close while native open is still pending", async () => {
    let resolve!: () => void;
    vi.mocked(nativeSessionPip.open).mockImplementation(
      () =>
        new Promise<string>((done) => {
          resolve = () => done("pip-session-test");
        }),
    );
    await render();
    let pending!: Promise<string | undefined>;
    await act(async () => {
      pending = api.open(id);
      await Promise.resolve();
    });
    await emit("session-pip-closed", {
      id,
      draft: { text: "Fast return", attachments: [], updatedAt: Date.now() },
    });
    await act(async () => {
      resolve();
      await pending;
    });
    expect(api.ids).toEqual([]);
    expect(readComposerDraft(id)?.text).toBe("Fast return");
    expect(nativeSessionPip.update).not.toHaveBeenCalled();
  });

  it("restores live drafts and closes a child when its source session is removed", async () => {
    await render();
    await act(async () => api.open(id));
    await emit("session-pip-action", {
      id,
      action: "draft",
      args: [{ text: "Live draft", attachments: [], updatedAt: 10 }],
    });
    expect(readComposerDraft(id)?.text).toBe("Live draft");
    sessions = [];
    await render();
    await render();
    expect(nativeSessionPip.close).toHaveBeenCalledOnce();
  });

  it("awaits child draft acknowledgments before an owner snapshot and ignores unknown child results", async () => {
    await render();
    await act(async () => flushWorkspaceDrafts());
    expect(nativeSessionPip.flushAll).not.toHaveBeenCalled();
    await act(async () => api.open(id));
    const finalDraft = {
      text: "Last child keystroke",
      attachments: [],
      updatedAt: Date.now(),
    };
    vi.mocked(nativeSessionPip.flushAll).mockResolvedValue([
      { id, draft: finalDraft },
      { id: "not-owned", draft: finalDraft },
    ]);
    await act(async () => flushWorkspaceDrafts());
    expect(nativeSessionPip.flushAll).toHaveBeenCalledOnce();
    expect(readComposerDraft(id)).toEqual(finalDraft);
    expect(readComposerDraft("not-owned")).toBeUndefined();
  });

  it("activates the returned session before reading the fresh file callback", async () => {
    const oldOpen = props.onOpenFile;
    const newestOpen = vi.fn();
    returnFocus = vi.fn((returnedId) => {
      expect(returnedId).toBe(id);
      expect(readComposerDraft(id)?.text).toBe("Final draft");
      props = { ...props, onOpenFile: newestOpen };
      flushSync(() => root.render(createElement(Harness)));
      expect(api.ids).toEqual([]);
    });
    await render();
    await act(async () => api.open(id));
    await emit("session-pip-action", {
      id,
      action: "onOpenFile",
      args: ["relative.ts"],
    });
    await emit("session-pip-closed", {
      id,
      draft: { text: "Final draft", attachments: [], updatedAt: Date.now() },
    });
    expect(returnFocus).toHaveBeenCalledOnce();
    expect(oldOpen).not.toHaveBeenCalled();
    expect(newestOpen).toHaveBeenCalledWith("relative.ts");
  });

  it("restores and flushes the draft before acknowledging a grouped return, then defers focus and owner actions", async () => {
    const stored = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => stored.get(key) ?? null,
      setItem: (key: string, value: string) => stored.set(key, value),
    });
    const finalDraft = {
      text: "Exact last floating edit\nincluding the trailing newline.\n",
      attachments: [],
      updatedAt: Date.now(),
    };
    const events: string[] = [];
    const oldOpenDiff = props.onOpenDiff;
    const freshOpenDiff = vi.fn(() => events.push("open-diff"));
    let releaseReturn!: () => void;
    let draftFlush!: Promise<void>;
    returned = vi.fn((returnedId, focusAndRunActions, hasOwnerActions) => {
      expect(returnedId).toBe(id);
      expect(hasOwnerActions).toBe(true);
      expect(readComposerDraft(id)).toEqual(finalDraft);
      expect(
        JSON.parse(stored.get(`monocode.composerDraft.v1:${id}`)!),
      ).toEqual(finalDraft);
      // The closed child is already absent from the registry: an owner
      // snapshot started inside this acknowledgement must not flush it again.
      draftFlush = flushWorkspaceDrafts();
      releaseReturn = focusAndRunActions;
      events.push("acknowledged");
    });
    returnFocus = vi.fn((returnedId) => {
      expect(returnedId).toBe(id);
      expect(api.ids).toEqual([]);
      expect(readComposerDraft(id)).toEqual(finalDraft);
      events.push("focus-original-session");
      props = { ...props, onOpenDiff: freshOpenDiff };
      flushSync(() => root.render(createElement(Harness)));
    });
    await render();
    await act(async () => api.open(id));
    await emit("session-pip-action", {
      id,
      action: "onOpenDiff",
      args: ["changed.ts", { sessionId: id, cwd: "/projects/demo" }],
    });
    expect(nativeSessionPip.close).toHaveBeenCalledWith(id);
    await emit("session-pip-closed", { id, draft: finalDraft });
    await draftFlush;
    expect(returned).toHaveBeenCalledOnce();
    expect(api.ids).toEqual([]);
    expect(nativeSessionPip.flushAll).not.toHaveBeenCalled();
    expect(returnFocus).not.toHaveBeenCalled();
    expect(oldOpenDiff).not.toHaveBeenCalled();
    expect(freshOpenDiff).not.toHaveBeenCalled();
    expect(events).toEqual(["acknowledged"]);
    await act(async () => releaseReturn());
    expect(events).toEqual([
      "acknowledged",
      "focus-original-session",
      "open-diff",
    ]);
    expect(oldOpenDiff).not.toHaveBeenCalled();
    expect(freshOpenDiff).toHaveBeenCalledExactlyOnceWith("changed.ts", {
      sessionId: id,
      cwd: "/projects/demo",
    });
  });

  it("does not reactivate removed sessions or execute their pending actions", async () => {
    returnFocus = vi.fn();
    await render();
    await act(async () => api.open(id));
    await emit("session-pip-action", {
      id,
      action: "onOpenFile",
      args: ["relative.ts"],
    });
    sessions = [];
    await render();
    await emit("session-pip-action", { id, action: "onStop", args: [id] });
    await emit("session-pip-action", {
      id,
      action: "draft",
      args: [
        { text: "Final removed draft", attachments: [], updatedAt: Date.now() },
      ],
    });
    await emit("session-pip-closed", { id });
    expect(props.onOpenFile).not.toHaveBeenCalled();
    expect(props.onStop).not.toHaveBeenCalled();
    expect(returnFocus).not.toHaveBeenCalled();
    expect(readComposerDraft(id)?.text).toBe("Final removed draft");
  });
});

it("rejects unrelated session identities and malformed callback payloads", () => {
  const id = "session";
  expect(
    parseSessionPipEnvelope({
      id,
      state: { session: session("wrong"), recents: [] },
    }),
  ).toBeNull();
  expect(
    parseSessionPipEnvelope({
      id,
      state: { session: session(id), recents: [], actions: "wrong" },
    })?.state.actions,
  ).toBeUndefined();
  expect(
    validSessionPipAction(
      { id, action: "onPaneDragStart", args: [id] },
      new Set([id]),
    ),
  ).toBe(false);
  expect(
    validSessionPipAction(
      { id, action: "onOpenDiff", args: [null, { sessionId: "wrong" }] },
      new Set([id]),
    ),
  ).toBe(false);
  expect(
    validSessionPipAction(
      { id, action: "onOpenFile", args: ["/a"] },
      new Set(),
    ),
  ).toBe(false);
});


it("accepts only web destinations for PiP link actions", () => {
  const openIds = new Set(["a"]);
  expect(validSessionPipAction({ id: "a", action: "onOpenUrl", args: ["https://example.com"] }, openIds)).toBe(true);
  expect(validSessionPipAction({ id: "a", action: "onOpenUrl", args: ["file:///private"] }, openIds)).toBe(false);
  expect(validSessionPipAction({ id: "other", action: "onOpenUrl", args: ["https://example.com"] }, openIds)).toBe(false);
});

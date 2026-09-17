// @vitest-environment happy-dom
import { act, createElement, StrictMode, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SessionPictureInPicture } from "./SessionPictureInPicture";
import {
  nativeSessionPip,
  type SessionPaneProps,
  type SessionPipEnvelope,
} from "../lib/sessionPictureInPicture";
import { readComposerDraft, updateComposerDraft } from "../lib/composerDrafts";
import { canCompactHarnessContext } from "../lib/harness/registry";

const pane = vi.hoisted(() => ({
  render: vi.fn(),
  mount: vi.fn(),
  unmount: vi.fn(),
}));
vi.mock("./SessionPane", () => ({
  SessionPane: (props: SessionPaneProps) => {
    pane.render(props, readComposerDraft(props.session.id));
    useEffect(() => {
      pane.mount();
      return () => pane.unmount();
    }, []);
    return createElement(
      "div",
      { "data-session-pane": props.session.id },
      props.session.title,
    );
  },
}));

describe("dedicated session picture in picture view", () => {
  let root: Root;
  let element: HTMLDivElement;
  let value: SessionPipEnvelope;
  let listeners: Map<string, (payload: unknown) => void>;
  let cleanups: Array<ReturnType<typeof vi.fn>>;
  let sequence = 0;
  const latest = () => pane.render.mock.lastCall![0] as SessionPaneProps;
  const emit = (name: string, payload?: unknown) =>
    act(async () => listeners.get(name)?.(payload));
  const render = async (strict = false) =>
    act(async () =>
      root.render(
        strict
          ? createElement(
              StrictMode,
              null,
              createElement(SessionPictureInPicture),
            )
          : createElement(SessionPictureInPicture),
      ),
    );
  const button = (label: string) =>
    [...element.querySelectorAll("button")].find(
      (button) => button.textContent === label,
    )!;
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.clearAllMocks();
    value = {
      id: `pip-child-${++sequence}`,
      pinned: true,
      state: {
        session: {
          id: `pip-child-${sequence}`,
          harness: "codex",
          model: "gpt-5",
          modelSettings: {},
          runtimeMode: "bypass",
          cwd: "/projects/demo",
          title: "Live session",
          blocks: [],
        },
        recents: [],
        hideProjectPicker: true,
        draft: {
          text: "Before popout",
          attachments: [],
          updatedAt: Date.now() - 1000,
        },
        theme: {
          scheme: "dark",
          variables: { "--theme-background-color": "#000000" },
        },
      },
    };
    listeners = new Map();
    cleanups = [];
    vi.spyOn(nativeSessionPip, "listen").mockImplementation(
      async (name, callback) => {
        listeners.set(name, callback as (payload: unknown) => void);
        const cleanup = vi.fn(() => {
          if (listeners.get(name) === callback) listeners.delete(name);
        });
        cleanups.push(cleanup);
        return cleanup;
      },
    );
    vi.spyOn(nativeSessionPip, "getState").mockResolvedValue(value);
    for (const name of [
      "action",
      "draft",
      "returnSession",
      "setPinned",
    ] as const)
      vi.spyOn(nativeSessionPip, name).mockResolvedValue(undefined);
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
    document.documentElement.style.removeProperty("--theme-background-color");
    document.getElementById("boot-splash")?.remove();
  });

  it("keeps the startup cover until transferred custom theme and session content commit", async () => {
    const splash = document.createElement("div");
    splash.id = "boot-splash";
    document.body.append(splash);
    let resolve!: (state: SessionPipEnvelope) => void;
    vi.mocked(nativeSessionPip.getState).mockImplementation(
      () => new Promise((done) => (resolve = done)),
    );
    await render();
    await act(async () => vi.advanceTimersByTime(500));
    expect(splash.dataset.dismissed).toBeUndefined();
    expect(element.querySelector("[data-session-pane]")).toBeNull();
    await act(async () => resolve(value));
    expect(element.querySelector("[data-session-pane]")).not.toBeNull();
    expect(
      document.documentElement.style.getPropertyValue(
        "--theme-background-color",
      ),
    ).toBe("#000000");
    expect(splash.dataset.dismissed).toBe("1");
    await act(async () => vi.advanceTimersByTime(430));
    expect(splash.isConnected).toBe(false);
  });

  it("uncovers a session startup error when the initial state request fails", async () => {
    const splash = document.createElement("div");
    splash.id = "boot-splash";
    document.body.append(splash);
    vi.mocked(nativeSessionPip.getState).mockRejectedValue(
      new Error("Owner closed"),
    );
    await render();
    expect(element.textContent).toContain("Owner closed");
    await act(async () => vi.advanceTimersByTime(430));
    expect(splash.isConnected).toBe(false);
  });

  it("registers events before reading initial state, restores drafts before mounting and retains the pane during live updates", async () => {
    vi.mocked(nativeSessionPip.getState).mockImplementation(async () => {
      expect(listeners.has("session-pip-state")).toBe(true);
      expect(listeners.has("session-pip-return-requested")).toBe(true);
      expect(listeners.has("session-pip-flush-requested")).toBe(true);
      return value;
    });
    await render();
    expect(pane.render.mock.calls[0][1]?.text).toBe("Before popout");
    expect(canCompactHarnessContext("codex")).toBe(true);
    expect(latest()).toMatchObject({
      visible: true,
      focused: true,
      inSplit: false,
      hideProjectPicker: true,
    });
    const dom = element.querySelector("[data-session-pane]");
    const callbacks = latest().onSubmit;
    await emit("session-pip-state", {
      ...value,
      state: {
        ...value.state,
        session: { ...value.state.session, title: "Updated", busy: true },
      },
    });
    expect(element.querySelector("[data-session-pane]")).toBe(dom);
    expect(latest().onSubmit).toBe(callbacks);
    expect(pane.mount).toHaveBeenCalledOnce();
    expect(latest().session.busy).toBe(true);
    expect(
      document.documentElement.style.getPropertyValue(
        "--theme-background-color",
      ),
    ).toBe("#000000");
  });

  it("sends drafts within100ms even while typing continuously, with no idle polling", async () => {
    await render();
    updateComposerDraft(value.id, { text: "A" });
    await act(async () => vi.advanceTimersByTime(60));
    updateComposerDraft(value.id, { text: "AB" });
    await act(async () => vi.advanceTimersByTime(40));
    expect(nativeSessionPip.draft).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ text: "AB" }),
    );
    await act(async () => vi.advanceTimersByTime(1000));
    expect(nativeSessionPip.draft).toHaveBeenCalledOnce();
  });

  it.each(["button", "native"])(
    "returns the exact pending draft through %s close without waiting for debounce",
    async (kind) => {
      await render();
      updateComposerDraft(value.id, { text: "Very last keystroke" });
      if (kind === "button")
        await act(async () => button("Return to workspace").click());
      else await emit("session-pip-return-requested");
      expect(nativeSessionPip.returnSession).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({ text: "Very last keystroke" }),
      );
      await act(async () => vi.advanceTimersByTime(100));
      expect(nativeSessionPip.draft).not.toHaveBeenCalled();
    },
  );

  it("flushes exact draft on child Quit and owner flush request, preserving explicit clear", async () => {
    await render();
    updateComposerDraft(value.id, { text: "Quit draft" });
    await emit("session-pip-quit-requested");
    expect(nativeSessionPip.action).toHaveBeenLastCalledWith("quit", [
      expect.objectContaining({ text: "Quit draft" }),
    ]);
    updateComposerDraft(value.id, { text: "", attachments: [] });
    await emit("session-pip-flush-requested", { requestId: "flush-42" });
    expect(nativeSessionPip.draft).toHaveBeenLastCalledWith(
      expect.objectContaining({ text: "", attachments: [] }),
      "flush-42",
    );
  });

  it("forwards controlled actions, blocks busy compaction, preserves optional actions and toggles pinning", async () => {
    value.state.actions = ["onSubmit", "onStop", "onCompactContext"];
    await render();
    latest().onSubmit(value.id, "Send text", []);
    expect(nativeSessionPip.action).toHaveBeenLastCalledWith("onSubmit", [
      value.id,
      "Send text",
      [],
    ]);
    expect(latest().onSecondOpinion).toBeUndefined();
    expect(latest().onCompactContext(value.id)).toBe(true);
    await emit("session-pip-state", {
      ...value,
      state: {
        ...value.state,
        session: { ...value.state.session, busy: true },
      },
    });
    vi.mocked(nativeSessionPip.action).mockClear();
    expect(latest().onCompactContext(value.id)).toBe(false);
    latest().onFocus(value.id);
    expect(nativeSessionPip.action).not.toHaveBeenCalled();
    await act(async () => button("Keep on top").click());
    expect(nativeSessionPip.setPinned).toHaveBeenCalledWith(false);
    expect(button("Keep on top").getAttribute("aria-pressed")).toBe("false");
  });

  it("ignores stale reflected drafts while preserving a genuinely newer externally restored draft", async () => {
    await render();
    updateComposerDraft(value.id, { text: "Typing here" });
    const current = readComposerDraft(value.id)!;
    const initialDom = element.querySelector("[data-session-pane]");
    await emit("session-pip-state", value);
    expect(readComposerDraft(value.id)?.text).toBe("Typing here");
    expect(element.querySelector("[data-session-pane]")).toBe(initialDom);
    await emit("session-pip-state", {
      ...value,
      state: {
        ...value.state,
        draft: {
          ...current,
          text: "New external draft",
          updatedAt: current.updatedAt + 1,
        },
      },
    });
    expect(pane.render.mock.lastCall![1]?.text).toBe("New external draft");
    expect(element.querySelector("[data-session-pane]")).not.toBe(initialDom);
  });

  it("cleans up late async listeners across StrictMode setup and does not load a second session controller", async () => {
    await render(true);
    expect(nativeSessionPip.getState).toHaveBeenCalledOnce();
    expect(
      cleanups.filter((cleanup) => cleanup.mock.calls.length > 0),
    ).toHaveLength(5);
    expect(listeners.size).toBe(5);
    expect(element.querySelectorAll("[data-session-pane]")).toHaveLength(1);
    expect(element.querySelector(".personal-sidebar")).toBeNull();
  });
});

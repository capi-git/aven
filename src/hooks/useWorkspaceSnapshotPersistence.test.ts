// @vitest-environment happy-dom
import { act, createElement, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { newTab, type WorkspaceTab } from "../lib/layout";
import { newSession, type Session } from "../lib/session";
import {
  collectWorkspaceSnapshot,
  type WorkspaceSnapshot,
} from "../lib/workspaceSnapshot";
import { useWorkspaceSnapshotPersistence } from "./useWorkspaceSnapshotPersistence";

describe("workspace snapshot persistence during streaming and movement", () => {
  let container: HTMLDivElement;
  let root: Root;
  let session: Session;
  let tabs: WorkspaceTab[];
  let enabled: boolean;
  let save: ReturnType<
    typeof vi.fn<(snapshot: WorkspaceSnapshot) => Promise<void>>
  >;
  let schedule: ReturnType<typeof useWorkspaceSnapshotPersistence>;

  function Harness() {
    schedule = useWorkspaceSnapshotPersistence(enabled, save);
    useEffect(() => {
      schedule(
        collectWorkspaceSnapshot(tabs, [session], tabs[0].id, session.cwd),
      );
    }, [session, tabs, enabled]);
    return null;
  }
  const render = () => act(async () => root.render(createElement(Harness)));
  const advance = (ms: number) => act(async () => vi.advanceTimersByTime(ms));

  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    session = newSession("codex", "/projects/one");
    tabs = [newTab(session.id)];
    enabled = true;
    save = vi.fn().mockResolvedValue(undefined);
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("saves a moved layout at its original deadline despite token-only session renders", async () => {
    await render();
    await advance(250);
    save.mockClear();
    tabs = [...tabs, newTab(session.id)];
    await render();
    await advance(100);
    session = {
      ...session,
      blocks: [{ id: "stream", role: "assistant", text: "New token" }],
    };
    await render();
    await advance(149);
    expect(save).not.toHaveBeenCalled();
    await advance(1);
    expect(save).toHaveBeenCalledOnce();
    expect(save.mock.calls[0][0].tabs.map((tab) => tab.id)).toEqual(
      tabs.map((tab) => tab.id),
    );
    session = { ...session, blocks: [...session.blocks] };
    await render();
    await advance(500);
    expect(save).toHaveBeenCalledOnce();
  });

  it("keeps only the newest pending layout and serializes it behind an active save", async () => {
    let finish!: () => void;
    save.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    await render();
    await advance(250);
    tabs = [...tabs, newTab(session.id)];
    await render();
    await advance(100);
    tabs = [...tabs, newTab(session.id)];
    await render();
    await advance(250);
    expect(save).toHaveBeenCalledOnce();
    await act(async () => finish());
    expect(save).toHaveBeenCalledTimes(2);
    expect(save.mock.calls[1][0].tabs.map((tab) => tab.id)).toEqual(
      tabs.map((tab) => tab.id),
    );
  });

  it("uses the same writer for a new draft while a layout save is pending", async () => {
    await render();
    await advance(100);
    const latest = collectWorkspaceSnapshot(
      tabs,
      [session],
      tabs[0].id,
      session.cwd,
    );
    latest.sessions[0].draft = {
      text: "Keep this unsent draft",
      attachments: [],
    };
    await act(async () => schedule(latest, 0));
    await advance(0);
    await advance(250);
    expect(save).toHaveBeenCalledOnce();
    expect(save.mock.calls[0][0].sessions[0].draft?.text).toBe(
      "Keep this unsent draft",
    );
  });

  it("retries an unchanged snapshot on the next update after a failed save", async () => {
    save.mockRejectedValueOnce(new Error("Storage unavailable"));
    await render();
    await advance(250);
    session = { ...session, blocks: [] };
    await render();
    await advance(250);
    expect(save).toHaveBeenCalledTimes(2);
  });

  it.each(["disabled", "unmounted"])(
    "cancels pending writes when %s",
    async (reason) => {
      await render();
      await advance(100);
      if (reason === "disabled") {
        enabled = false;
        await render();
      } else await act(async () => root.render(null));
      await advance(500);
      expect(save).not.toHaveBeenCalled();
      expect(vi.getTimerCount()).toBe(0);
    },
  );
});

import { beforeEach, describe, expect, it, vi } from "vitest";
import { leaf, newFileTab, newTab, newTerminalFile } from "./layout";
import { newSession, type Session } from "./session";
import { collectWorkspaceSnapshot } from "./workspaceSnapshot";

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  loadWorkspaceSnapshot: vi.fn(),
  listInFlightSessions: vi.fn(),
  upsertSession: vi.fn(),
  saveWorkspaceSnapshot: vi.fn(),
  replaceInFlightSessions: vi.fn(),
  restoreSessionCheckout: vi.fn(),
  invoke: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
vi.mock("@tauri-apps/plugin-dialog", () => ({
  ask: vi.fn(),
  message: vi.fn(),
}));
vi.mock("./harness", () => ({
  bindHarnessSession: vi.fn(),
  isLiveHarness: vi.fn(),
  forgetHarnessSession: vi.fn(),
  killAllChildren: vi.fn(),
}));
vi.mock("./windowTransferBootstrap", () => ({
  loadWindowTransfer: vi.fn().mockResolvedValue(null),
}));
vi.mock("./fs", async (original) => ({
  ...(await original<typeof import("./fs")>()),
  restoreSessionCheckout: mocks.restoreSessionCheckout,
}));
vi.mock("./sessionStore", async (original) => ({
  ...(await original<typeof import("./sessionStore")>()),
  getSession: mocks.getSession,
  loadWorkspaceSnapshot: mocks.loadWorkspaceSnapshot,
  listInFlightSessions: mocks.listInFlightSessions,
  listSessionsByProject: vi.fn().mockResolvedValue([]),
  upsertSession: mocks.upsertSession,
  saveWorkspaceSnapshot: mocks.saveWorkspaceSnapshot,
  replaceInFlightSessions: mocks.replaceInFlightSessions,
}));

beforeEach(() => {
  vi.resetModules();
  vi.resetAllMocks();
  mocks.getSession.mockResolvedValue(null);
  mocks.loadWorkspaceSnapshot.mockResolvedValue(null);
  mocks.listInFlightSessions.mockResolvedValue([]);
  mocks.upsertSession.mockResolvedValue(null);
  mocks.saveWorkspaceSnapshot.mockResolvedValue(undefined);
  mocks.replaceInFlightSessions.mockResolvedValue(undefined);
  mocks.restoreSessionCheckout.mockImplementation(async (session) => session);
});

function savedWorkspace(sessions: Session[]) {
  const tabs = sessions.map((session) => newTab(session.id));
  const snapshot = collectWorkspaceSnapshot(
    tabs,
    sessions,
    tabs[0].id,
    sessions[0].cwd,
  );
  mocks.loadWorkspaceSnapshot.mockResolvedValue(snapshot);
  return snapshot;
}

describe("safe workspace restoration", () => {
  it("rejects an unread transcript before hydrating or writing any session", async () => {
    const first = newSession("codex", "/project");
    first.blocks = [{ id: "first-user", role: "user", text: "Saved work" }];
    const failed = newSession("claude", "/project");
    savedWorkspace([first, failed]);
    mocks.getSession.mockImplementation(async (id) => {
      if (id === first.id) return first;
      throw new Error("database is locked");
    });
    const { loadResumedWorkspace } = await import("./appLifecycle");

    await expect(loadResumedWorkspace()).rejects.toThrow(
      `couldn't read your saved conversation ${failed.id}`,
    );
    expect(mocks.restoreSessionCheckout).not.toHaveBeenCalled();
    expect(mocks.upsertSession).not.toHaveBeenCalled();
    expect(mocks.saveWorkspaceSnapshot).not.toHaveBeenCalled();
    expect(mocks.replaceInFlightSessions).not.toHaveBeenCalled();
  });

  it("allows a confirmed missing record to restore a blank tab", async () => {
    const blank = newSession("codex", "/project");
    savedWorkspace([blank]);
    const { loadResumedWorkspace } = await import("./appLifecycle");

    const restored = await loadResumedWorkspace();
    expect(restored?.sessions).toHaveLength(1);
    expect(restored?.sessions[0]).toMatchObject({ id: blank.id, blocks: [] });
    expect(mocks.upsertSession).not.toHaveBeenCalled();
  });

  it("retries failed boot and resume promises and retains the original transcript", async () => {
    const session = newSession("codex", "/project");
    session.blocks = [{ id: "saved-user", role: "user", text: "Keep this" }];
    savedWorkspace([session]);
    mocks.getSession
      .mockRejectedValueOnce(new Error("temporary read failure"))
      .mockResolvedValue(session);
    const { loadBootWorkspace } = await import("./appLifecycle");

    await expect(loadBootWorkspace()).rejects.toThrow("temporary read failure");
    const retried = await loadBootWorkspace();
    expect(retried.resumed?.sessions[0].blocks).toEqual(session.blocks);
    expect(mocks.getSession).toHaveBeenCalledTimes(2);
    // Nothing about it changed, so startup does not rewrite the transcript.
    expect(mocks.upsertSession).not.toHaveBeenCalled();
  });

  it("saves only restored sessions whose stored details changed", async () => {
    const unchanged = newSession("codex", "/project");
    unchanged.blocks = [{ id: "u", role: "user", text: "Untouched" }];
    const interrupted = newSession("claude", "/project");
    interrupted.blocks = [{ id: "i", role: "user", text: "Was running" }];
    const moved = newSession("codex", "/project");
    moved.blocks = [{ id: "m", role: "user", text: "On a branch" }];
    moved.branch = "feature";
    savedWorkspace([unchanged, interrupted, moved]);
    const records = new Map([unchanged, interrupted, moved].map((s) => [s.id, s]));
    mocks.getSession.mockImplementation(async (id: string) => records.get(id) ?? null);
    mocks.listInFlightSessions.mockResolvedValue([
      { sessionId: interrupted.id } as never,
    ]);
    // Restoring drops a checkout the session can no longer use.
    mocks.restoreSessionCheckout.mockImplementation(async (session: Session) =>
      session.id === moved.id ? { ...session, branch: undefined } : session,
    );
    const { loadResumedWorkspace } = await import("./appLifecycle");

    await loadResumedWorkspace();
    const saved = mocks.upsertSession.mock.calls.map(
      ([session]) => (session as Session).id,
    );
    expect(saved.sort()).toEqual([interrupted.id, moved.id].sort());
  });

  it.each([
    ["loadWorkspaceSnapshot", "workspace layout"],
    ["listInFlightSessions", "unfinished tasks"],
  ] as const)(
    "does not replace a failed %s read with an empty store",
    async (method, subject) => {
      mocks[method].mockRejectedValue(new Error("storage unavailable"));
      const { loadResumedWorkspace } = await import("./appLifecycle");

      await expect(loadResumedWorkspace()).rejects.toThrow(`saved ${subject}`);
      expect(mocks.getSession).not.toHaveBeenCalled();
      expect(mocks.upsertSession).not.toHaveBeenCalled();
      expect(mocks.saveWorkspaceSnapshot).not.toHaveBeenCalled();
    },
  );

  it("does not read transcripts for editor or terminal pane identities", async () => {
    const file = newFileTab("/project/readme.md", "/project");
    const terminal = newTerminalFile("/project");
    const editor = {
      ...newTab("editor-pane"),
      layout: leaf("editor-pane"),
      editorPanes: [{ id: "editor-pane", files: [file], activeFileId: file.id }],
    };
    const terminalTab = {
      ...newTab("terminal-pane"),
      layout: leaf("terminal-pane"),
      terminalPanes: [
        { id: "terminal-pane", files: [terminal], activeFileId: terminal.id },
      ],
    };
    mocks.loadWorkspaceSnapshot.mockResolvedValue(
      collectWorkspaceSnapshot([editor, terminalTab], [], editor.id, "/project"),
    );
    mocks.getSession.mockRejectedValue(new Error("not a transcript"));
    const { loadResumedWorkspace } = await import("./appLifecycle");

    const restored = await loadResumedWorkspace();
    expect(restored?.tabs).toHaveLength(2);
    expect(restored?.sessions).toEqual([]);
    expect(mocks.getSession).not.toHaveBeenCalled();
  });

  it("can quit a blocked startup without saving over the unread workspace", async () => {
    mocks.loadWorkspaceSnapshot.mockRejectedValue(
      new Error("database unavailable"),
    );
    const { handleQuitRequested } = await import("./appLifecycle");

    await handleQuitRequested();
    expect(mocks.invoke).toHaveBeenCalledWith("confirm_quit");
    expect(mocks.upsertSession).not.toHaveBeenCalled();
    expect(mocks.saveWorkspaceSnapshot).not.toHaveBeenCalled();
    expect(mocks.replaceInFlightSessions).not.toHaveBeenCalled();
  });
});

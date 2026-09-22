import { beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { ask } from "@tauri-apps/plugin-dialog";
import { forgetHarnessSession, killAllChildren } from "./harness";
import { newSession } from "./session";
import { newTab } from "./layout";
import {
  closeBusyWindow,
  persistQuitState,
  prepareUpdateRestart,
  setQuitWorkspace,
} from "./appLifecycle";
import { updateComposerDraft } from "./composerDrafts";
import { registerWorkspaceDraftFlusher } from "./workspaceDraftFlush";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@tauri-apps/plugin-dialog", () => ({
  ask: vi.fn().mockResolvedValue(true),
}));
vi.mock("./harness", () => ({
  bindHarnessSession: vi.fn(),
  isLiveHarness: vi.fn(),
  forgetHarnessSession: vi.fn().mockResolvedValue(undefined),
  killAllChildren: vi.fn().mockResolvedValue(undefined),
}));

describe("closing a busy window", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(ask).mockResolvedValue(true);
  });

  function workspace() {
    const session = newSession("cursor", "C:/test");
    session.busy = true;
    session.blocks = [{ id: "user", role: "user", text: "test" }];
    const tab = newTab(session.id);
    const release = setQuitWorkspace(
      () => [session],
      () => [tab],
      () => tab.id,
      () => session.cwd,
      () => [],
      vi.fn(),
    );
    return { session, release };
  }

  it("stops only its sessions and destroys only its window", async () => {
    const { session, release } = workspace();
    try {
      await closeBusyWindow();
      expect(ask).toHaveBeenCalled();
      expect(forgetHarnessSession).toHaveBeenCalledWith("cursor", session.id);
      expect(killAllChildren).not.toHaveBeenCalled();
      expect(invoke).toHaveBeenCalledWith("destroy_window");
      expect(
        vi
          .mocked(invoke)
          .mock.calls.some(([command]) => command === "confirm_quit"),
      ).toBe(false);
    } finally {
      release();
    }
  });

  it("leaves the window and sessions running when closing is cancelled", async () => {
    const { release } = workspace();
    vi.mocked(ask).mockResolvedValue(false);
    try {
      await closeBusyWindow();
      expect(forgetHarnessSession).not.toHaveBeenCalled();
      expect(killAllChildren).not.toHaveBeenCalled();
      expect(invoke).not.toHaveBeenCalled();
    } finally {
      release();
    }
  });
});

it("normal quit saves the latest unsent standalone draft without creating a sent transcript", async () => {
  vi.clearAllMocks();
  const session = newSession("cursor", "/app-data/projectless-workspaces/work");
  const tab = newTab(session.id);
  updateComposerDraft(session.id, { text: "Last keystroke before quitting" });
  await persistQuitState([session], [tab], tab.id, session.cwd);
  expect(invoke).toHaveBeenCalledWith("workspace_set_snapshot", {
    snapshot: expect.objectContaining({
      sessions: [
        expect.objectContaining({
          id: session.id,
          draft: expect.objectContaining({
            text: "Last keystroke before quitting",
          }),
        }),
      ],
    }),
  });
  expect(
    vi
      .mocked(invoke)
      .mock.calls.some(([command]) => command === "session_upsert"),
  ).toBe(false);
});

it("waits for the floating composer before collecting the quit snapshot", async () => {
  vi.clearAllMocks();
  const session = newSession("cursor", "/app-data/projectless-workspaces/work");
  const tab = newTab(session.id);
  let finishFlush!: () => void;
  const release = registerWorkspaceDraftFlusher(async () => {
    await new Promise<void>((resolve) => {
      finishFlush = resolve;
    });
    updateComposerDraft(session.id, {
      text: "Final floating-window keystroke",
    });
  });
  try {
    const saving = persistQuitState([session], [tab], tab.id, session.cwd);
    expect(invoke).not.toHaveBeenCalledWith(
      "workspace_set_snapshot",
      expect.anything(),
    );
    finishFlush();
    await saving;
    expect(invoke).toHaveBeenCalledWith("workspace_set_snapshot", {
      snapshot: expect.objectContaining({
        sessions: [
          expect.objectContaining({
            id: session.id,
            draft: expect.objectContaining({
              text: "Final floating-window keystroke",
            }),
          }),
        ],
      }),
    });
  } finally {
    release();
  }
});

it("collects the latest live workspace after detached return replaces its arrays", async () => {
  vi.clearAllMocks();
  const original = newSession("cursor", "/project/original");
  const originalTab = newTab(original.id);
  const returned = newSession("codex", "/project/returned");
  returned.blocks = [
    { id: "returned-user", role: "user", text: "Returned task" },
  ];
  const returnedTab = newTab(returned.id);
  let sessions = [original];
  let tabs = [originalTab];
  let activeId = originalTab.id;
  let cwd = original.cwd;
  const flushEvents = vi.fn();
  const releaseWorkspace = setQuitWorkspace(
    () => sessions,
    () => tabs,
    () => activeId,
    () => cwd,
    () => [],
    flushEvents,
  );
  let finishReturn!: () => void;
  const releaseFlusher = registerWorkspaceDraftFlusher(async () => {
    await new Promise<void>((resolve) => {
      finishReturn = resolve;
    });
    sessions = [returned];
    tabs = [returnedTab];
    activeId = returnedTab.id;
    cwd = returned.cwd;
    updateComposerDraft(returned.id, { text: "Last detached edit" });
  });
  try {
    const quitting = persistQuitState(sessions, tabs, activeId, cwd);
    expect(invoke).not.toHaveBeenCalled();
    finishReturn();
    await quitting;
    expect(flushEvents).toHaveBeenCalledOnce();
    expect(invoke).toHaveBeenCalledWith("workspace_set_snapshot", {
      snapshot: expect.objectContaining({
        activeTabId: returnedTab.id,
        projectCwd: returned.cwd,
        tabs: [expect.objectContaining({ id: returnedTab.id })],
        sessions: [
          expect.objectContaining({
            id: returned.id,
            draft: expect.objectContaining({ text: "Last detached edit" }),
          }),
        ],
      }),
    });
    expect(invoke).toHaveBeenCalledWith(
      "session_upsert",
      expect.objectContaining({
        session: expect.objectContaining({ id: returned.id }),
      }),
    );
  } finally {
    releaseFlusher();
    releaseWorkspace();
  }
});

it("keeps unload snapshots scoped to their arguments without waiting for return flushers", async () => {
  vi.clearAllMocks();
  const unloading = newSession("cursor", "/project/unloading");
  const unloadingTab = newTab(unloading.id);
  const other = newSession("codex", "/project/other");
  const otherTab = newTab(other.id);
  const flush = vi.fn().mockResolvedValue(undefined);
  const releaseFlusher = registerWorkspaceDraftFlusher(flush);
  const releaseWorkspace = setQuitWorkspace(
    () => [other],
    () => [otherTab],
    () => otherTab.id,
    () => other.cwd,
    () => [],
    vi.fn(),
  );
  try {
    await persistQuitState(
      [unloading],
      [unloadingTab],
      unloadingTab.id,
      unloading.cwd,
      "unload",
    );
    expect(flush).not.toHaveBeenCalled();
    expect(invoke).toHaveBeenCalledWith("workspace_set_snapshot", {
      snapshot: expect.objectContaining({
        activeTabId: unloadingTab.id,
        projectCwd: unloading.cwd,
        sessions: [expect.objectContaining({ id: unloading.id })],
      }),
    });
  } finally {
    releaseFlusher();
    releaseWorkspace();
  }
});

describe("preparing a safe update restart", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(invoke).mockResolvedValue(undefined);
  });
  function idleWorkspace() {
    const session = newSession("cursor", "/project");
    const tab = newTab(session.id);
    const flush = vi.fn();
    const release = setQuitWorkspace(
      () => [session],
      () => [tab],
      () => tab.id,
      () => session.cwd,
      () => [],
      flush,
    );
    return { session, release, flush };
  }
  it("refuses a still-running task without stopping it or acquiring a guard", async () => {
    const { session, release } = idleWorkspace();
    session.busy = true;
    try {
      await expect(prepareUpdateRestart()).rejects.toThrow("still working");
      expect(invoke).not.toHaveBeenCalled();
      expect(killAllChildren).not.toHaveBeenCalled();
      expect(session.busy).toBe(true);
    } finally {
      release();
    }
  });
  it("saves the latest draft before native final restart validation", async () => {
    const { session, release } = idleWorkspace();
    updateComposerDraft(session.id, { text: "Keep my update draft" });
    try {
      await prepareUpdateRestart();
      const calls = vi.mocked(invoke).mock.calls;
      const saved = calls.findIndex(
        ([command]) => command === "workspace_set_snapshot",
      );
      const guarded = calls.findIndex(
        ([command]) => command === "prepare_update_restart",
      );
      const browserClose = calls.findIndex(
        ([command]) => command === "finish_update_restart_preparation",
      );
      expect(guarded).toBeLessThan(saved);
      expect(saved).toBeLessThan(browserClose);
      expect(calls[saved]?.[1]).toMatchObject({
        snapshot: {
          sessions: [
            expect.objectContaining({
              draft: expect.objectContaining({ text: "Keep my update draft" }),
            }),
          ],
        },
      });
      expect(killAllChildren).not.toHaveBeenCalled();
    } finally {
      release();
    }
  });
  it("aborts on persistence failure instead of losing unsaved work", async () => {
    const { release } = idleWorkspace();
    vi.mocked(invoke).mockImplementation(async (command) => {
      if (command === "workspace_set_snapshot") throw new Error("disk full");
      return undefined;
    });
    try {
      await expect(prepareUpdateRestart()).rejects.toThrow("disk full");
      expect(invoke).toHaveBeenCalledWith("cancel_update_restart");
      expect(invoke).not.toHaveBeenCalledWith(
        "finish_update_restart_preparation",
      );
    } finally {
      release();
    }
  });
  it("releases the guard when native final restart validation rejects", async () => {
    const { release } = idleWorkspace();
    vi.mocked(invoke).mockImplementation(async (command) => {
      if (command === "finish_update_restart_preparation")
        throw new Error("Browser tabs are still open");
      return undefined;
    });
    try {
      await expect(prepareUpdateRestart()).rejects.toThrow(
        "Browser tabs are still open",
      );
      expect(invoke).toHaveBeenCalledWith("cancel_update_restart");
    } finally {
      release();
    }
  });
});

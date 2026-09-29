import { beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { ask, message } from "@tauri-apps/plugin-dialog";
import { forgetHarnessSession, killAllChildren } from "./harness";
import { newSession } from "./session";
import { newTab, newTerminalFile } from "./layout";
import {
  createProjectTerminal,
  type ProjectTerminalDock,
} from "./projectTerminal";
import {
  closeBusyWindow,
  handleQuitRequested,
  isAppQuitting,
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
  message: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("./harness", () => ({
  bindHarnessSession: vi.fn(),
  isLiveHarness: vi.fn(),
  forgetHarnessSession: vi.fn().mockResolvedValue(undefined),
  killAllChildren: vi.fn().mockResolvedValue(undefined),
}));

describe("explicit window close and quit", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(ask).mockResolvedValue(true);
    vi.mocked(message).mockResolvedValue(undefined);
    vi.mocked(invoke).mockResolvedValue(undefined);
  });

  function workspace(busy = true) {
    const session = newSession("cursor", "C:/test");
    session.busy = busy;
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

  it("keeps an idle window's failed draft available and closes only after a successful retry", async () => {
    const { release } = workspace(false);
    const flush = vi.fn().mockRejectedValue(new Error("Last note edit could not be saved"));
    const releaseFlusher = registerWorkspaceDraftFlusher(flush);
    try {
      await closeBusyWindow();
      expect(ask).not.toHaveBeenCalled();
      expect(message).toHaveBeenCalledWith(
        expect.stringContaining("Last note edit could not be saved"),
        { title: "Could not close window", kind: "error" },
      );
      expect(isAppQuitting()).toBe(false);
      expect(forgetHarnessSession).not.toHaveBeenCalled();
      expect(invoke).not.toHaveBeenCalledWith("destroy_window");

      flush.mockResolvedValue(undefined);
      await closeBusyWindow();
      expect(flush).toHaveBeenCalledTimes(2);
      expect(invoke).toHaveBeenCalledWith("destroy_window");
      expect(invoke).not.toHaveBeenCalledWith("confirm_quit");
    } finally {
      releaseFlusher();
      release();
    }
  });

  it.each([
    "session_upsert",
    "workspace_set_snapshot",
    "session_set_in_flight",
  ])("keeps an idle window open when explicit close cannot write %s", async (failedCommand) => {
    const { release } = workspace(false);
    vi.mocked(invoke).mockImplementation(async (command) => {
      if (command === failedCommand) throw new Error("Disk is full");
      return undefined;
    });
    try {
      await closeBusyWindow();
      expect(ask).not.toHaveBeenCalled();
      expect(message).toHaveBeenCalledWith(
        expect.stringContaining("Disk is full"),
        { title: "Could not close window", kind: "error" },
      );
      expect(isAppQuitting()).toBe(false);
      expect(invoke).not.toHaveBeenCalledWith("destroy_window");
      expect(forgetHarnessSession).not.toHaveBeenCalled();

      vi.mocked(invoke).mockResolvedValue(undefined);
      await closeBusyWindow();
      expect(invoke).toHaveBeenCalledWith("destroy_window");
    } finally {
      release();
    }
  });

  it.each(["quit", "close"])("shows a save failure and allows retrying %s", async (action) => {
    const { release } = workspace();
    const flush = vi.fn().mockRejectedValue(new Error("Notes could not be saved"));
    const releaseFlusher = registerWorkspaceDraftFlusher(flush);
    const close = action === "quit" ? handleQuitRequested : closeBusyWindow;
    try {
      await close();
      expect(message).toHaveBeenCalledWith(
        expect.stringContaining("Notes could not be saved"),
        expect.objectContaining({ kind: "error" }),
      );
      expect(isAppQuitting()).toBe(false);
      expect(forgetHarnessSession).not.toHaveBeenCalled();
      expect(invoke).not.toHaveBeenCalledWith("confirm_quit");
      expect(invoke).not.toHaveBeenCalledWith("destroy_window");

      flush.mockResolvedValue(undefined);
      await close();
      expect(invoke).toHaveBeenCalledWith(
        action === "quit" ? "confirm_quit" : "destroy_window",
      );
    } finally {
      releaseFlusher();
      release();
    }
  });

  it.each([
    "session_upsert",
    "workspace_set_snapshot",
    "session_set_in_flight",
  ])("keeps Aven open when explicit quit cannot write %s", async (failedCommand) => {
    const { release } = workspace();
    vi.mocked(invoke).mockImplementation(async (command) => {
      if (command === failedCommand) throw new Error("Saved data is unavailable");
      return undefined;
    });
    try {
      await handleQuitRequested();
      expect(message).toHaveBeenCalledWith(
        expect.stringContaining("Saved data is unavailable"),
        expect.objectContaining({ title: "Could not quit Aven", kind: "error" }),
      );
      expect(isAppQuitting()).toBe(false);
      expect(invoke).not.toHaveBeenCalledWith("confirm_quit");
      expect(forgetHarnessSession).not.toHaveBeenCalled();

      vi.mocked(invoke).mockResolvedValue(undefined);
      await handleQuitRequested();
      expect(invoke).toHaveBeenCalledWith("confirm_quit");
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

it("keeps actual renderer unload best effort when storage writes fail", async () => {
  vi.clearAllMocks();
  const session = newSession("cursor", "/project/unloading");
  session.blocks = [{ id: "user", role: "user", text: "Saved task" }];
  session.busy = true;
  const tab = newTab(session.id);
  vi.mocked(invoke).mockRejectedValue(new Error("Storage unavailable"));
  try {
    await expect(
      persistQuitState([session], [tab], tab.id, session.cwd, "unload"),
    ).resolves.toBeUndefined();
    expect(message).not.toHaveBeenCalled();
    expect(invoke).toHaveBeenCalledWith(
      "session_set_in_flight",
      expect.anything(),
    );
  } finally {
    vi.mocked(invoke).mockResolvedValue(undefined);
  }
});

describe("preparing a safe update restart", () => {
  const preparation = (openTerminals = 0) => ({
    browserStates: [],
    openTerminals,
  });
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(ask).mockResolvedValue(true);
    vi.mocked(invoke).mockImplementation(async (command) =>
      command === "prepare_update_restart" ? preparation() : undefined,
    );
  });
  function idleWorkspace(
    saveBrowserState = vi.fn(),
    projectTerminals: ProjectTerminalDock[] = [],
  ) {
    const session = newSession("cursor", "/project");
    const tab = newTab(session.id);
    const flush = vi.fn();
    const release = setQuitWorkspace(
      () => [session],
      () => [tab],
      () => tab.id,
      () => session.cwd,
      () => projectTerminals,
      flush,
      saveBrowserState,
    );
    return { session, release, flush, saveBrowserState };
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
      expect(ask).not.toHaveBeenCalled();
      expect(invoke).toHaveBeenCalledWith("finish_update_restart_preparation", {
        closeTerminals: false,
      });
    } finally {
      release();
    }
  });
  it("strictly saves browser tabs after native metadata is captured and before native close", async () => {
    const order: string[] = [];
    const saveBrowserState = vi.fn(() => {
      order.push("browser-save");
    });
    const { release } = idleWorkspace(saveBrowserState);
    vi.mocked(invoke).mockImplementation(async (command) => {
      order.push(command);
      return command === "prepare_update_restart" ? preparation() : undefined;
    });
    try {
      await prepareUpdateRestart();
      expect(saveBrowserState).toHaveBeenCalledOnce();
      expect(order.indexOf("prepare_update_restart")).toBeLessThan(
        order.indexOf("browser-save"),
      );
      expect(order.indexOf("browser-save")).toBeLessThan(
        order.indexOf("finish_update_restart_preparation"),
      );
    } finally {
      release();
    }
  });
  it("cancels before closing pages when browser persistence fails", async () => {
    const { release } = idleWorkspace(
      vi.fn(() => {
        throw new Error("browser storage full");
      }),
    );
    try {
      await expect(prepareUpdateRestart()).rejects.toThrow(
        "browser storage full",
      );
      expect(invoke).toHaveBeenCalledWith("cancel_update_restart");
      expect(invoke).not.toHaveBeenCalledWith(
        "finish_update_restart_preparation",
        expect.anything(),
      );
    } finally {
      release();
    }
  });
  it("aborts on persistence failure instead of losing unsaved work", async () => {
    const { release } = idleWorkspace();
    vi.mocked(invoke).mockImplementation(async (command) => {
      if (command === "workspace_set_snapshot") throw new Error("disk full");
      return command === "prepare_update_restart" ? preparation() : undefined;
    });
    try {
      await expect(prepareUpdateRestart()).rejects.toThrow("disk full");
      expect(invoke).toHaveBeenCalledWith("cancel_update_restart");
      expect(invoke).not.toHaveBeenCalledWith(
        "finish_update_restart_preparation",
        expect.anything(),
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
      return command === "prepare_update_restart" ? preparation() : undefined;
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
  it("asks before saving and grants terminal shutdown only after confirmation", async () => {
    const first = newTerminalFile("/project/server");
    const second = newTerminalFile("/other/client");
    const docks = [
      createProjectTerminal("/project", first),
      createProjectTerminal("/other", second),
    ];
    const { release } = idleWorkspace(vi.fn(), docks);
    vi.mocked(invoke).mockImplementation(async (command) =>
      command === "prepare_update_restart" ? preparation(2) : undefined,
    );
    let confirm!: (answer: boolean) => void;
    vi.mocked(ask).mockImplementationOnce(
      () =>
        new Promise<boolean>((resolve) => {
          confirm = resolve;
        }),
    );
    try {
      const preparing = prepareUpdateRestart();
      await vi.waitFor(() => expect(ask).toHaveBeenCalledOnce());
      expect(ask).toHaveBeenCalledWith(
        expect.stringContaining("your 2 open terminals"),
        expect.objectContaining({ cancelLabel: "Keep working" }),
      );
      expect(invoke).not.toHaveBeenCalledWith(
        "workspace_set_snapshot",
        expect.anything(),
      );
      expect(invoke).not.toHaveBeenCalledWith(
        "finish_update_restart_preparation",
        expect.anything(),
      );
      confirm(true);
      await expect(preparing).resolves.toBe(true);
      expect(invoke).toHaveBeenCalledWith("workspace_set_snapshot", {
        snapshot: expect.objectContaining({ projectTerminals: docks }),
      });
      const calls = vi.mocked(invoke).mock.calls;
      expect(
        calls.findIndex(([command]) => command === "workspace_set_snapshot"),
      ).toBeLessThan(
        calls.findIndex(
          ([command]) => command === "finish_update_restart_preparation",
        ),
      );
      expect(invoke).toHaveBeenCalledWith("finish_update_restart_preparation", {
        closeTerminals: true,
      });
      expect(
        vi
          .mocked(invoke)
          .mock.calls.some(([command]) => command.startsWith("pty_kill")),
      ).toBe(false);
    } finally {
      release();
    }
  });
  it("cancels without saving or stopping terminals and asks again on retry", async () => {
    const { release } = idleWorkspace();
    vi.mocked(invoke).mockImplementation(async (command) =>
      command === "prepare_update_restart" ? preparation(1) : undefined,
    );
    vi.mocked(ask).mockResolvedValue(false);
    try {
      await expect(prepareUpdateRestart()).resolves.toBe(false);
      expect(invoke).toHaveBeenCalledWith("cancel_update_restart");
      expect(invoke).not.toHaveBeenCalledWith(
        "workspace_set_snapshot",
        expect.anything(),
      );
      expect(invoke).not.toHaveBeenCalledWith(
        "finish_update_restart_preparation",
        expect.anything(),
      );
      expect(
        vi
          .mocked(invoke)
          .mock.calls.some(([command]) => command.startsWith("pty_kill")),
      ).toBe(false);
      await expect(prepareUpdateRestart()).resolves.toBe(false);
      expect(ask).toHaveBeenCalledTimes(2);
    } finally {
      release();
    }
  });
  it("still refuses work started while the terminal confirmation was open", async () => {
    const { session, release } = idleWorkspace();
    vi.mocked(invoke).mockImplementation(async (command) =>
      command === "prepare_update_restart" ? preparation(1) : undefined,
    );
    vi.mocked(ask).mockImplementationOnce(async () => {
      session.busy = true;
      return true;
    });
    try {
      await expect(prepareUpdateRestart()).rejects.toThrow("workspace changed");
      expect(invoke).toHaveBeenCalledWith("cancel_update_restart");
      expect(invoke).not.toHaveBeenCalledWith(
        "finish_update_restart_preparation",
        expect.anything(),
      );
      expect(killAllChildren).not.toHaveBeenCalled();
    } finally {
      release();
    }
  });
});

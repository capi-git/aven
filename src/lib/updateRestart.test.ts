import { beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { ask } from "@tauri-apps/plugin-dialog";
import { killAllChildren } from "./harness";
import { newSession, type Session } from "./session";
import { newFileTab, newTab, type WorkspaceTab } from "./layout";
import { setQuitWorkspace } from "./appLifecycle";
import { updateComposerDraft } from "./composerDrafts";
import { registerWorkspaceDraftFlusher } from "./workspaceDraftFlush";
import {
  assessUpdateRestart,
  prepareUpdateRestart,
  reportWorkspaceActivity,
  saveWindowForUpdate,
  stopUpdateRestartWork,
  watchUpdateRestartWork,
} from "./updateRestart";

const events = vi.hoisted(() => ({
  app: new Map<string, (event: { payload: unknown }) => void>(),
  webview: new Map<string, (event: { payload: unknown }) => void>(),
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(
    async (name: string, handler: (event: { payload: unknown }) => void) => {
      events.app.set(name, handler);
      return () => events.app.delete(name);
    },
  ),
}));
vi.mock("@tauri-apps/api/webview", () => ({
  getCurrentWebview: () => ({
    listen: async (
      name: string,
      handler: (event: { payload: unknown }) => void,
    ) => {
      events.webview.set(name, handler);
      return () => events.webview.delete(name);
    },
  }),
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

type Terminal = { id: string; command: string | null };

function nativeRestart(
  terminals: Terminal[] = [],
  activity: { windows: unknown[]; terminals: Terminal[] } = {
    windows: [],
    terminals: [],
  },
) {
  vi.mocked(invoke).mockImplementation(async (command) => {
    if (command === "prepare_update_restart")
      return { browserStates: [], terminals };
    if (command === "update_restart_activity") return activity;
    return undefined;
  });
}

const commands = () => vi.mocked(invoke).mock.calls.map(([command]) => command);

function workspace(
  options: {
    sessions?: Session[];
    tabs?: WorkspaceTab[];
    dirty?: Set<string>;
    saveBrowserState?: () => void;
  } = {},
) {
  const session = newSession("cursor", "/work/Aven");
  session.title = "Fix login";
  session.blocks = [{ id: "user", role: "user", text: "test" }];
  let sessions = options.sessions ?? [session];
  const tabs = options.tabs ?? [newTab(sessions[0]!.id)];
  const stopSessions = vi.fn((ids: string[]) => {
    sessions = sessions.map((entry) =>
      ids.includes(entry.id)
        ? { ...entry, busy: false, queueStatus: "paused" as const }
        : entry,
    );
    reportWorkspaceActivity();
  });
  const release = setQuitWorkspace(
    () => sessions,
    () => tabs,
    () => tabs[0]!.id,
    () => "/work/Aven",
    () => [],
    vi.fn(),
    options.saveBrowserState ?? vi.fn(),
    { dirtyFileIds: () => options.dirty ?? new Set(), stopSessions },
  );
  return {
    session: sessions[0]!,
    sessions: () => sessions,
    setSessions: (next: Session[]) => {
      sessions = next;
    },
    stopSessions,
    release,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  events.app.clear();
  events.webview.clear();
  nativeRestart();
});

describe("work a restart would interrupt", () => {
  it("names this window's agents, queues and unsaved files", async () => {
    const working = newSession("cursor", "/work/Aven");
    working.title = "Fix login";
    working.busy = true;
    const asking = newSession("cursor", "/work/Cadence");
    asking.title = "Review PR";
    asking.pendingQuestion = { requestId: 1, questions: [] };
    const queued = newSession("cursor", "/work/Aven");
    queued.title = "Docs";
    queued.queuedMessages = [{ id: "m", text: "next", attachments: [] }];
    const paused = newSession("cursor", "/work/Aven");
    paused.queuedMessages = [{ id: "m", text: "later", attachments: [] }];
    paused.queueStatus = "paused";
    const worker = newSession("cursor", "/work/Aven");
    worker.busy = true;
    worker.orchestrationLeadId = working.id;
    const file = newFileTab("/work/Aven/src/App.tsx", "/work/Aven");
    const tab = newTab(working.id);
    tab.editorPanes = [{ id: "pane", files: [file], activeFileId: file.id }];
    const { release } = workspace({
      sessions: [working, asking, queued, paused, worker],
      tabs: [tab],
      dirty: new Set([file.id, "closed-file"]),
    });
    nativeRestart([], {
      windows: [
        {
          label: "window-2",
          activity: {
            agents: [
              { id: "x", title: "Deploy", project: "Site", state: "working" },
            ],
            files: [],
          },
        },
      ],
      terminals: [{ id: "term", command: "npm" }],
    });
    try {
      expect(await assessUpdateRestart()).toEqual({
        agents: [
          {
            id: working.id,
            title: "Fix login",
            project: "Aven",
            state: "working",
          },
          {
            id: asking.id,
            title: "Review PR",
            project: "Cadence",
            state: "waiting",
          },
          { id: queued.id, title: "Docs", project: "Aven", state: "queued" },
          { id: "x", title: "Deploy", project: "Site", state: "working" },
        ],
        terminals: [{ id: "term", command: "npm" }],
        files: [{ id: file.id, name: "App.tsx", project: "Aven" }],
      });
    } finally {
      release();
    }
  });

  it("reports only changes to other windows and to a waiting restart", async () => {
    const { session, sessions, setSessions, release } = workspace();
    const changed = vi.fn();
    const stop = watchUpdateRestartWork(changed, (id) => id === "server");
    try {
      reportWorkspaceActivity();
      reportWorkspaceActivity();
      await vi.waitFor(() =>
        expect(commands()).toContain("update_report_activity"),
      );
      expect(
        commands().filter((command) => command === "update_report_activity"),
      ).toHaveLength(1);
      await vi.waitFor(() => expect(changed).toHaveBeenCalledTimes(1));
      setSessions(sessions().map((entry) => ({ ...entry, busy: true })));
      reportWorkspaceActivity();
      await vi.waitFor(() => expect(changed).toHaveBeenCalledTimes(2));
      expect(vi.mocked(invoke)).toHaveBeenLastCalledWith(
        "update_report_activity",
        {
          activity: {
            agents: [expect.objectContaining({ id: session.id })],
            files: [],
          },
        },
      );
    } finally {
      stop();
      setSessions(sessions().map((entry) => ({ ...entry, busy: false })));
      reportWorkspaceActivity();
      release();
    }
  });

  it("listens to terminals it waits for and to other windows, without polling", async () => {
    vi.useFakeTimers();
    const changed = vi.fn();
    const stop = watchUpdateRestartWork(changed, (id) => id === "server");
    try {
      await vi.waitFor(() => expect(events.app.size).toBe(3));
      events.app.get("pty-data")!({ payload: { id: "other", data: "x" } });
      await vi.advanceTimersByTimeAsync(5000);
      expect(changed).not.toHaveBeenCalled();
      // Output from a watched terminal may mean its command just finished;
      // a burst of output is checked once.
      events.app.get("pty-data")!({ payload: { id: "server", data: "x" } });
      events.app.get("pty-data")!({ payload: { id: "server", data: "y" } });
      await vi.advanceTimersByTimeAsync(999);
      expect(changed).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1);
      expect(changed).toHaveBeenCalledTimes(1);
      events.app.get("pty-exit")!({ payload: { id: "server", code: 0 } });
      events.app.get("update-activity-changed")!({ payload: null });
      await vi.advanceTimersByTimeAsync(0);
      expect(changed).toHaveBeenCalledTimes(2);
    } finally {
      stop();
      vi.useRealTimers();
    }
    expect(events.app.size).toBe(0);
  });

  it("stops this window's running agents and waits for them to settle", async () => {
    const working = newSession("cursor", "/work/Aven");
    working.busy = true;
    const idle = newSession("cursor", "/work/Aven");
    const { stopSessions, sessions, release } = workspace({
      sessions: [working, idle],
    });
    try {
      await stopUpdateRestartWork(1000);
      expect(stopSessions).toHaveBeenCalledWith([working.id]);
      expect(sessions().every((session) => !session.busy)).toBe(true);
    } finally {
      release();
    }
  });
});

describe("preparing a restart", () => {
  it("does not reserve the restart while this window's agent is still working", async () => {
    const { session, release } = workspace();
    session.busy = true;
    try {
      await expect(prepareUpdateRestart()).resolves.toBe(false);
      expect(commands()).not.toContain("prepare_update_restart");
      expect(killAllChildren).not.toHaveBeenCalled();
      expect(session.busy).toBe(true);
    } finally {
      release();
    }
  });

  it("brings detached tabs back before reserving, then saves the latest draft", async () => {
    const { session, release } = workspace();
    const order: string[] = [];
    const releaseFlusher = registerWorkspaceDraftFlusher(async () => {
      order.push("return-windows");
    });
    vi.mocked(invoke).mockImplementation(async (command) => {
      order.push(command);
      return command === "prepare_update_restart"
        ? { browserStates: [], terminals: [] }
        : undefined;
    });
    updateComposerDraft(session.id, { text: "Keep my update draft" });
    try {
      await expect(prepareUpdateRestart()).resolves.toBe(true);
      expect(order.indexOf("return-windows")).toBeLessThan(
        order.indexOf("prepare_update_restart"),
      );
      expect(order.indexOf("prepare_update_restart")).toBeLessThan(
        order.indexOf("workspace_set_snapshot"),
      );
      expect(order.indexOf("workspace_set_snapshot")).toBeLessThan(
        order.indexOf("finish_update_restart_preparation"),
      );
      const saved = vi
        .mocked(invoke)
        .mock.calls.find(([command]) => command === "workspace_set_snapshot");
      expect(saved?.[1]).toMatchObject({
        snapshot: {
          sessions: [
            expect.objectContaining({
              draft: expect.objectContaining({ text: "Keep my update draft" }),
            }),
          ],
        },
      });
      expect(invoke).toHaveBeenCalledWith("prepare_update_restart", {
        stopWork: false,
      });
    } finally {
      releaseFlusher();
      release();
    }
  });

  it("closes idle terminals without asking", async () => {
    const { release } = workspace();
    nativeRestart([
      { id: "shell-1", command: null },
      { id: "shell-2", command: null },
    ]);
    try {
      await expect(prepareUpdateRestart()).resolves.toBe(true);
      expect(ask).not.toHaveBeenCalled();
      expect(invoke).toHaveBeenCalledWith("finish_update_restart_preparation", {
        closeTerminals: true,
      });
      expect(commands().some((command) => command.startsWith("pty_kill"))).toBe(
        false,
      );
    } finally {
      release();
    }
  });

  it("steps back when a terminal command started, unless the person chose to stop it", async () => {
    const { release } = workspace();
    nativeRestart([{ id: "server", command: "npm" }]);
    try {
      await expect(prepareUpdateRestart()).resolves.toBe(false);
      expect(invoke).toHaveBeenCalledWith("cancel_update_restart");
      expect(commands()).not.toContain("workspace_set_snapshot");
      expect(commands()).not.toContain("finish_update_restart_preparation");
      vi.mocked(invoke).mockClear();
      await expect(prepareUpdateRestart({ stopWork: true })).resolves.toBe(
        true,
      );
      expect(invoke).toHaveBeenCalledWith("prepare_update_restart", {
        stopWork: true,
      });
      expect(invoke).toHaveBeenCalledWith("finish_update_restart_preparation", {
        closeTerminals: true,
      });
    } finally {
      release();
    }
  });

  it("steps back when an agent starts while the workspace saves", async () => {
    const { session, release } = workspace();
    vi.mocked(invoke).mockImplementation(async (command) => {
      if (command === "workspace_set_snapshot") session.busy = true;
      return command === "prepare_update_restart"
        ? { browserStates: [], terminals: [] }
        : undefined;
    });
    try {
      await expect(prepareUpdateRestart()).resolves.toBe(false);
      expect(invoke).toHaveBeenCalledWith("cancel_update_restart");
      expect(commands()).not.toContain("finish_update_restart_preparation");
    } finally {
      release();
    }
  });

  it("tells the person which native work it is waiting for", async () => {
    const { release } = workspace();
    const waiting = vi.fn();
    vi.mocked(invoke).mockImplementation(async (command) => {
      if (command === "prepare_update_restart") {
        events.webview.get("update-restart-waiting")!({
          payload: ["updating Claude Code"],
        });
        return { browserStates: [], terminals: [] };
      }
      return undefined;
    });
    try {
      await prepareUpdateRestart({ onWaiting: waiting });
      expect(waiting).toHaveBeenCalledWith(["updating Claude Code"]);
      expect(events.webview.has("update-restart-waiting")).toBe(false);
    } finally {
      release();
    }
  });

  it("saves browser tabs after native metadata is captured and before pages close", async () => {
    const order: string[] = [];
    const { release } = workspace({
      saveBrowserState: () => {
        order.push("browser-save");
      },
    });
    vi.mocked(invoke).mockImplementation(async (command) => {
      order.push(command);
      return command === "prepare_update_restart"
        ? { browserStates: [], terminals: [] }
        : undefined;
    });
    try {
      await prepareUpdateRestart();
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

  it("cancels before closing pages when saving fails", async () => {
    for (const failure of ["browser", "snapshot", "final-check"]) {
      vi.mocked(invoke).mockClear();
      const { release } = workspace({
        saveBrowserState: () => {
          if (failure === "browser") throw new Error("browser storage full");
        },
      });
      vi.mocked(invoke).mockImplementation(async (command) => {
        if (failure === "snapshot" && command === "workspace_set_snapshot")
          throw new Error("disk full");
        if (
          failure === "final-check" &&
          command === "finish_update_restart_preparation"
        )
          throw new Error("Browser tabs are still open");
        return command === "prepare_update_restart"
          ? { browserStates: [], terminals: [] }
          : undefined;
      });
      try {
        await expect(prepareUpdateRestart()).rejects.toThrow();
        expect(invoke).toHaveBeenCalledWith("cancel_update_restart");
        if (failure !== "final-check")
          expect(commands()).not.toContain("finish_update_restart_preparation");
      } finally {
        release();
      }
    }
  });
});

describe("another window restarting to update", () => {
  it("saves this window's conversations and lets the restart close it", async () => {
    const { session, release } = workspace();
    try {
      await saveWindowForUpdate(false);
      expect(invoke).toHaveBeenCalledWith(
        "session_upsert",
        expect.objectContaining({
          session: expect.objectContaining({ id: session.id }),
        }),
      );
      expect(commands().at(-1)).toBe("update_restart_window_saved");
    } finally {
      release();
    }
  });

  it("refuses when work started since the person decided", async () => {
    const { session, release } = workspace();
    session.busy = true;
    try {
      await saveWindowForUpdate(false);
      expect(commands()).toEqual(["update_restart_window_refused"]);
      expect(vi.mocked(invoke).mock.calls[0]![1]).toEqual({
        reason: expect.stringContaining("Work started in another Aven window"),
      });
    } finally {
      release();
    }
  });

  it("saves running agents as interrupted when the person chose to stop them", async () => {
    const { session, release } = workspace();
    session.busy = true;
    try {
      await saveWindowForUpdate(true);
      const saved = vi
        .mocked(invoke)
        .mock.calls.find(([command]) => command === "session_upsert");
      expect(JSON.stringify(saved?.[1])).toContain(
        "Turn interrupted when Aven quit.",
      );
      expect(commands().at(-1)).toBe("update_restart_window_saved");
    } finally {
      release();
    }
  });

  it("refuses with the reason when saving fails", async () => {
    const { release } = workspace();
    vi.mocked(invoke).mockImplementation(async (command) => {
      if (command === "session_upsert") throw new Error("disk full");
      return undefined;
    });
    try {
      await saveWindowForUpdate(false);
      expect(commands()).not.toContain("update_restart_window_saved");
      expect(invoke).toHaveBeenCalledWith("update_restart_window_refused", {
        reason: expect.stringContaining("disk full"),
      });
    } finally {
      release();
    }
  });
});

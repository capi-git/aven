import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  loadNotificationsEnabled,
  NOTIFICATIONS_DEFAULT,
  notificationText,
  saveNotificationsEnabled,
  shouldNotify,
  publishSessionActivity,
  pendingSessionActivityEvents,
  saveNotificationPreferences,
  loadNotificationPreferences,
  setWindowFocused,
  probeNotificationPermission,
} from "./notifications";
import { newSession, type Session } from "./session";

import { invoke } from "@tauri-apps/api/core";
import { getActivitySnapshot } from "./activity";
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn().mockResolvedValue("granted"),
}));
vi.mock("./sounds", () => ({ loadSoundsEnabled: () => true }));

const KEY = "monocode.notifications";

function chat(patch: Partial<Session> = {}): Session {
  const session = newSession("claude", "/tmp/a");
  session.title = "claude · Fix the sidebar";
  session.blocks = [{ id: "u1", role: "user", text: "hello" }];
  return { ...session, ...patch, blocks: patch.blocks ?? session.blocks };
}

describe("notifications setting", () => {
  beforeEach(mockLocalStorage);
  afterEach(() => localStorage.removeItem(KEY));

  it("is off until the user opts in", () => {
    expect(NOTIFICATIONS_DEFAULT).toBe(false);
    expect(loadNotificationsEnabled()).toBe(false);
  });

  it("round-trips", () => {
    saveNotificationsEnabled(true);
    expect(loadNotificationsEnabled()).toBe(true);
    saveNotificationsEnabled(false);
    expect(loadNotificationsEnabled()).toBe(false);
  });
});

describe("shouldNotify", () => {
  it("stays quiet while the session is on screen in a focused window", () => {
    expect(
      shouldNotify({
        enabled: true,
        permission: "granted",
        windowFocused: true,
        sessionVisible: true,
      }),
    ).toBe(false);
  });

  it("fires for a session that is not on screen even when focused", () => {
    expect(
      shouldNotify({
        enabled: true,
        permission: "granted",
        windowFocused: true,
        sessionVisible: false,
      }),
    ).toBe(true);
  });

  it("respects the toggle and the OS decision", () => {
    expect(
      shouldNotify({
        enabled: false,
        permission: "granted",
        windowFocused: false,
        sessionVisible: true,
      }),
    ).toBe(false);
    expect(
      shouldNotify({
        enabled: true,
        permission: "denied",
        windowFocused: false,
        sessionVisible: true,
      }),
    ).toBe(false);
    expect(
      shouldNotify({
        enabled: true,
        permission: "unsupported",
        windowFocused: false,
        sessionVisible: true,
      }),
    ).toBe(false);
  });

  it("fires when unfocused and allowed, or still undecided", () => {
    expect(
      shouldNotify({
        enabled: true,
        permission: "granted",
        windowFocused: false,
        sessionVisible: true,
      }),
    ).toBe(true);
    expect(
      shouldNotify({
        enabled: true,
        permission: "prompt",
        windowFocused: false,
        sessionVisible: true,
      }),
    ).toBe(true);
  });
});

describe("notificationText", () => {
  it("leads with the app, then the session title, then the reply", () => {
    const session = chat({
      blocks: [
        { id: "u1", role: "user", text: "hello" },
        {
          id: "a1",
          role: "assistant",
          text: "\n\nDone. Sidebar\nfixed.\n\nDetails below.",
        },
      ],
    });
    expect(notificationText(session, "finished")).toEqual({
      title: "Aven",
      subtitle: "Fix the sidebar",
      body: "Done. Sidebar fixed.",
    });
  });

  it("falls back to a generic body without a reply", () => {
    expect(notificationText(chat(), "finished").body).toBe(
      "Claude Code finished",
    );
  });

  it("does not reuse an earlier turn's reply when the current turn has no reply", () => {
    const session = chat({
      blocks: [
        { id: "old", role: "assistant", text: "Earlier success" },
        { id: "new", role: "user", text: "New task" },
      ],
    });
    expect(notificationText(session, "completed").body).toBe(
      "Claude Code finished",
    );
  });

  it("clips long bodies", () => {
    const session = chat({
      blocks: [{ id: "a1", role: "assistant", text: "x".repeat(400) }],
    });
    const body = notificationText(session, "finished").body;
    expect(body.length).toBe(240);
    expect(body.endsWith("…")).toBe(true);
  });

  it("names the pending approval", () => {
    const session = chat({
      blocks: [
        {
          id: "p1",
          role: "approval",
          text: "Run npm test",
          tool: { title: "Run npm test" },
          approval: { requestId: 1 },
        },
      ],
    });
    expect(notificationText(session, "needsInput")).toEqual({
      title: "Aven",
      subtitle: "Fix the sidebar",
      body: "Approve: Run npm test",
    });
  });

  it("prefers the question prompt over an approval", () => {
    const session = chat({
      pendingQuestion: {
        requestId: 2,
        questions: [
          {
            id: "q",
            prompt: "Which database?",
            multiSelect: false,
            allowCustom: false,
            options: [],
          },
        ],
      },
    });
    expect(notificationText(session, "needsInput")).toEqual({
      title: "Aven",
      subtitle: "Fix the sidebar",
      body: "Which database?",
    });
  });
});

function mockLocalStorage() {
  const data = new Map<string, string>();
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (key: string) => data.get(key) ?? null,
      setItem: (key: string, value: string) => {
        data.set(key, value);
      },
      removeItem: (key: string) => {
        data.delete(key);
      },
    },
  });
}

describe("Activity delivery policy", () => {
  beforeEach(() => {
    mockLocalStorage();
    vi.mocked(invoke).mockReset().mockResolvedValue("granted");
    setWindowFocused(false);
    getActivitySnapshot();
  });
  it("records unread outcomes while OS notifications are off without requesting permission", async () => {
    const result = await publishSessionActivity(
      chat(),
      { id: "turn-completed", outcome: "completed" },
      false,
    );
    expect(result).toEqual({ added: true, bannerSent: false, playSound: true });
    expect(getActivitySnapshot()[0]).toMatchObject({
      outcome: "completed",
      readAt: null,
    });
    expect(invoke).not.toHaveBeenCalled();
  });
  it("retains all five outcomes in quiet mode without banners or sounds", async () => {
    saveNotificationsEnabled(true);
    saveNotificationPreferences({ quiet: true });
    for (const outcome of [
      "completed",
      "failed",
      "stopped",
      "approval",
      "question",
    ] as const) {
      expect(
        await publishSessionActivity(chat(), { id: outcome, outcome }, false),
      ).toEqual({ added: true, bannerSent: false, playSound: false });
    }
    expect(getActivitySnapshot()).toHaveLength(5);
    expect(invoke).not.toHaveBeenCalled();
  });
  it("keeps failures and stops distinct from successful replies and never uses the success cue", async () => {
    const session = chat({
      blocks: [{ id: "a", role: "assistant", text: "Old successful reply" }],
    });
    await publishSessionActivity(
      session,
      { id: "failure", outcome: "failed", summary: "Connection lost" },
      false,
    );
    const result = await publishSessionActivity(
      session,
      { id: "stop", outcome: "stopped" },
      false,
    );
    expect(result.playSound).toBe(false);
    expect(getActivitySnapshot().map((entry) => entry.summary)).not.toContain(
      "Old successful reply",
    );
    expect(
      getActivitySnapshot().find((entry) => entry.id === "failure")?.summary,
    ).toBe("Connection lost");
  });
  it("notifies once per exact event and honors sound preferences", async () => {
    saveNotificationsEnabled(true);
    saveNotificationPreferences({ sound: false });
    await probeNotificationPermission();
    vi.mocked(invoke).mockClear();
    const session = chat();
    expect(
      (
        await publishSessionActivity(
          session,
          { id: "one", outcome: "completed" },
          false,
        )
      ).bannerSent,
    ).toBe(true);
    expect(
      (
        await publishSessionActivity(
          session,
          { id: "one", outcome: "completed" },
          false,
        )
      ).added,
    ).toBe(false);
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(invoke).toHaveBeenCalledWith(
      "show_notification",
      expect.objectContaining({ sound: false, sessionId: session.id }),
    );
  });
  it("treats a focused detached transcript as visible even when its owner is background", async () => {
    saveNotificationsEnabled(true);
    setWindowFocused(false);
    const result = await publishSessionActivity(
      chat(),
      { id: "detached", outcome: "completed" },
      true,
      true,
    );
    expect(result.bannerSent).toBe(false);
    expect(getActivitySnapshot()[0].readAt).not.toBeNull();
    expect(invoke).not.toHaveBeenCalled();
  });

  it("does not mark a hidden task read; a genuinely visible focused task is read", async () => {
    setWindowFocused(true);
    await publishSessionActivity(
      chat(),
      { id: "covered", outcome: "completed" },
      false,
    );
    await publishSessionActivity(
      chat(),
      { id: "visible", outcome: "completed" },
      true,
    );
    expect(
      getActivitySnapshot().find((entry) => entry.id === "covered")?.readAt,
    ).toBeNull();
    expect(
      getActivitySnapshot().find((entry) => entry.id === "visible")?.readAt,
    ).not.toBeNull();
  });
  it("retains history when dispatch fails and category toggles suppress interruption only", async () => {
    saveNotificationsEnabled(true);
    await probeNotificationPermission();
    vi.mocked(invoke).mockRejectedValue(new Error("native unavailable"));
    expect(
      (
        await publishSessionActivity(
          chat(),
          { id: "dispatch", outcome: "completed" },
          false,
        )
      ).bannerSent,
    ).toBe(false);
    saveNotificationPreferences({ failures: false });
    vi.mocked(invoke).mockClear();
    await publishSessionActivity(
      chat(),
      { id: "failed", outcome: "failed" },
      false,
    );
    expect(getActivitySnapshot()).toHaveLength(2);
    expect(invoke).not.toHaveBeenCalled();
    expect(loadNotificationPreferences()).toMatchObject({
      failures: false,
      finished: true,
    });
  });
  it("uses separate request identities for consecutive approvals and reused IDs in another turn", () => {
    const session = chat({
      id: "task",
      blocks: [
        { id: "u1", role: "user", text: "Do it" },
        {
          id: "a1",
          role: "approval",
          text: "Read file",
          approval: { requestId: 1 },
        },
        {
          id: "a2",
          role: "approval",
          text: "Run tests",
          approval: { requestId: 2 },
        },
      ],
    });
    session.blocks[0].startedAt = 100;
    const events = pendingSessionActivityEvents(session);
    const steered = {
      ...session,
      blocks: [
        ...session.blocks,
        { id: "steer", role: "user" as const, text: "Also this" },
      ],
    };
    expect(
      pendingSessionActivityEvents(steered).map((event) => event.id),
    ).toEqual(events.map((event) => event.id));
    expect(new Set(events.map((event) => event.id)).size).toBe(2);
    expect(events.map((event) => event.summary)).toEqual([
      "Approve: Read file",
      "Approve: Run tests",
    ]);
    const next = {
      ...session,
      blocks: [
        { id: "u2", role: "user" as const, text: "Again" },
        session.blocks[1],
      ],
    };
    expect(pendingSessionActivityEvents(next)[0].id).not.toBe(events[0].id);
  });
});

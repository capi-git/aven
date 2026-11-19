import { beforeEach, describe, expect, it, vi } from "vitest";

const sound = vi.hoisted(() => ({ enabled: true }));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn().mockResolvedValue("granted"),
}));
vi.mock("./sounds", async (original) => ({
  ...(await original<typeof import("./sounds")>()),
  loadSoundsEnabled: () => sound.enabled,
}));

import { invoke } from "@tauri-apps/api/core";
import { getActivitySnapshot } from "./activity";
import {
  probeNotificationPermission,
  publishSessionActivity,
  saveNotificationPreferences,
  saveNotificationsEnabled,
  setWindowFocused,
  type SessionActivityEvent,
} from "./notifications";
import { newSession, type Session } from "./session";
import { saveAlertSounds } from "./sounds";

function chat(): Session {
  const session = newSession("claude", "/tmp/a");
  session.title = "claude · Fix the sidebar";
  session.blocks = [{ id: "u1", role: "user", text: "hello" }];
  return session;
}

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

const approval = (id = "approval-1"): SessionActivityEvent => ({
  id,
  outcome: "approval",
  summary: "Approve: rm -rf build",
});

beforeEach(() => {
  mockLocalStorage();
  sound.enabled = true;
  vi.mocked(invoke).mockReset().mockResolvedValue("granted");
  setWindowFocused(false);
  getActivitySnapshot();
});

describe("needs-you sound", () => {
  it("sounds for an approval or a question while you are elsewhere", async () => {
    const session = chat();
    // Another app is in front.
    expect(
      (await publishSessionActivity(session, approval(), true, false)).sound,
    ).toBe("needsYou");
    // Aven is in front, showing another chat.
    expect(
      (
        await publishSessionActivity(
          session,
          { id: "question-1", outcome: "question" },
          false,
          true,
        )
      ).sound,
    ).toBe("needsYou");
  });

  it("stays silent for a request already on screen", async () => {
    const result = await publishSessionActivity(chat(), approval(), true, true);
    expect(result).toMatchObject({ added: true, sound: null });
  });

  it("sounds once per request, never for a repeat or a replay", async () => {
    const session = chat();
    expect(
      (await publishSessionActivity(session, approval(), false, false)).sound,
    ).toBe("needsYou");
    expect(
      await publishSessionActivity(session, approval(), false, false),
    ).toEqual({ added: false, bannerSent: false, sound: null });
    expect(
      (await publishSessionActivity(session, approval("approval-2"), false))
        .sound,
    ).toBe("needsYou");
  });

  it("follows Quiet mode, the Needs you switch, the Sounds switch and None", async () => {
    const session = chat();
    saveNotificationPreferences({ quiet: true });
    expect(
      (await publishSessionActivity(session, approval("a"), false)).sound,
    ).toBeNull();
    saveNotificationPreferences({ quiet: false, needsInput: false });
    expect(
      (await publishSessionActivity(session, approval("b"), false)).sound,
    ).toBeNull();
    saveNotificationPreferences({ needsInput: true });
    sound.enabled = false;
    expect(
      (await publishSessionActivity(session, approval("c"), false)).sound,
    ).toBeNull();
    sound.enabled = true;
    saveAlertSounds({ needsYou: "none" });
    expect(
      (await publishSessionActivity(session, approval("d"), false)).sound,
    ).toBeNull();
  });

  it("treats a team waiting on you as needing you", async () => {
    const result = await publishSessionActivity(
      chat(),
      {
        id: "team-paused",
        outcome: "failed",
        team: { id: "t", kind: "race", need: true },
      },
      false,
    );
    expect(result.sound).toBe("needsYou");
  });

  it("keeps the finished cue on screen and gives failures their own sound", async () => {
    const session = chat();
    expect(
      (
        await publishSessionActivity(
          session,
          { id: "done", outcome: "completed" },
          true,
          true,
        )
      ).sound,
    ).toBe("finished");
    saveAlertSounds({ failed: "error" });
    expect(
      (
        await publishSessionActivity(
          session,
          { id: "broke", outcome: "failed" },
          false,
        )
      ).sound,
    ).toBe("failed");
  });

  it("silences the banner while Aven plays the chosen sound", async () => {
    saveNotificationsEnabled(true);
    await probeNotificationPermission();
    vi.mocked(invoke).mockClear();
    const session = chat();
    const result = await publishSessionActivity(session, approval(), false);
    expect(result).toEqual({
      added: true,
      bannerSent: true,
      sound: "needsYou",
    });
    expect(invoke).toHaveBeenCalledWith(
      "show_notification",
      expect.objectContaining({ sessionId: session.id, sound: false }),
    );
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  play: vi.fn(),
  open: vi.fn(),
  invoke: vi.fn(),
}));

vi.mock("cuelume", () => ({
  play: (...args: unknown[]) => mocks.play(...args),
  setEnabled: vi.fn(),
  setVolume: vi.fn(),
}));
vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: (...args: unknown[]) => mocks.open(...args),
}));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => mocks.invoke(...args),
  convertFileSrc: (path: string) => `asset://localhost${path}`,
}));

import {
  ALERT_SOUND_MAX_MS,
  ALERT_SOUNDS_KEY,
  alertSoundFor,
  chooseAlertSoundFile,
  DEFAULT_ALERT_SOUNDS,
  loadAlertSounds,
  playAlertSound,
  saveAlertSounds,
  saveSoundsEnabled,
} from "./sounds";

class FakeAudio {
  static made: FakeAudio[] = [];
  volume = 1;
  paused = true;
  constructor(public src: string) {
    FakeAudio.made.push(this);
  }
  play() {
    this.paused = false;
    return Promise.resolve();
  }
  pause() {
    this.paused = true;
  }
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

beforeEach(() => {
  mockLocalStorage();
  mocks.play.mockReset();
  mocks.open.mockReset();
  mocks.invoke.mockReset();
  FakeAudio.made = [];
  vi.stubGlobal("Audio", FakeAudio);
});

describe("alert sounds per event", () => {
  it("keeps today's finished cue, gives needs you a chime and keeps failures quiet", () => {
    expect(loadAlertSounds()).toEqual(DEFAULT_ALERT_SOUNDS);
    expect(DEFAULT_ALERT_SOUNDS).toMatchObject({
      needsYou: "chime",
      finished: "success",
      failed: "none",
    });
  });

  it("keeps alerts silent for someone who switched the old Sound alert off", () => {
    localStorage.setItem(
      "monocode.notification-preferences.v1",
      JSON.stringify({ sound: false }),
    );
    expect(loadAlertSounds()).toMatchObject({
      needsYou: "none",
      finished: "none",
      failed: "none",
    });
    // A choice made later wins over the old switch.
    saveAlertSounds({ failed: "error" });
    expect(loadAlertSounds()).toMatchObject({
      needsYou: "none",
      failed: "error",
    });
  });

  it("stores each event's sound under an aven. key and ignores unknown values", () => {
    saveAlertSounds({ needsYou: "droplet" });
    expect(JSON.parse(localStorage.getItem(ALERT_SOUNDS_KEY)!)).toMatchObject({
      needsYou: "droplet",
      finished: "success",
    });
    localStorage.setItem(
      ALERT_SOUNDS_KEY,
      JSON.stringify({ needsYou: "siren", finished: "ready" }),
    );
    expect(loadAlertSounds()).toMatchObject({
      needsYou: "chime",
      finished: "ready",
    });
  });

  it("plays each event's own cue", () => {
    saveAlertSounds({ needsYou: "droplet", failed: "error" });
    playAlertSound("needsYou");
    playAlertSound("finished");
    playAlertSound("failed");
    expect(mocks.play.mock.calls.map(([name]) => name)).toEqual([
      "droplet",
      "success",
      "error",
    ]);
  });

  it("follows the Sounds switch and None", () => {
    saveAlertSounds({ finished: "none" });
    playAlertSound("finished");
    saveSoundsEnabled(false);
    playAlertSound("needsYou");
    expect(mocks.play).not.toHaveBeenCalled();
  });

  it("treats a chosen file that is missing as silent", () => {
    saveAlertSounds({ needsYou: "file" });
    expect(alertSoundFor("needsYou")).toBe("none");
    playAlertSound("needsYou");
    expect(mocks.play).not.toHaveBeenCalled();
    expect(FakeAudio.made).toHaveLength(0);
  });

  it("plays a custom file from Aven's copy and stops it after five seconds", () => {
    vi.useFakeTimers();
    try {
      saveAlertSounds({
        finished: "file",
        files: {
          finished: { name: "Ping", path: "/data/sounds/finished-1.wav" },
        },
      });
      playAlertSound("finished");
      const [audio] = FakeAudio.made;
      expect(audio.src).toBe("asset://localhost/data/sounds/finished-1.wav");
      expect(audio.volume).toBeLessThan(1);
      expect(audio.paused).toBe(false);
      vi.advanceTimersByTime(ALERT_SOUND_MAX_MS);
      expect(audio.paused).toBe(true);
      expect(mocks.play).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("copies a chosen file into the app and names it after the original", async () => {
    mocks.open.mockResolvedValue("/Users/me/Sounds/Soft Ping.m4a");
    mocks.invoke.mockResolvedValue("/data/sounds/needsYou-9.m4a");
    await expect(chooseAlertSoundFile("needsYou")).resolves.toEqual({
      name: "Soft Ping",
      path: "/data/sounds/needsYou-9.m4a",
    });
    expect(mocks.open).toHaveBeenCalledWith(
      expect.objectContaining({
        filters: [
          expect.objectContaining({
            extensions: expect.arrayContaining([
              "aiff",
              "wav",
              "mp3",
              "m4a",
              "caf",
            ]),
          }),
        ],
      }),
    );
    expect(mocks.invoke).toHaveBeenCalledWith("save_alert_sound", {
      event: "needsYou",
      sourcePath: "/Users/me/Sounds/Soft Ping.m4a",
    });
  });

  it("does nothing when the file dialog is cancelled", async () => {
    mocks.open.mockResolvedValue(null);
    await expect(chooseAlertSoundFile("failed")).resolves.toBeNull();
    expect(mocks.invoke).not.toHaveBeenCalled();
  });
});

// @vitest-environment happy-dom
import { act, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  playChoice: vi.fn(),
  choose: vi.fn(),
}));
vi.mock("../lib/sounds", async (original) => ({
  ...(await original<typeof import("../lib/sounds")>()),
  playCue: vi.fn(),
  playAlertSoundChoice: (...args: unknown[]) => mocks.playChoice(...args),
  chooseAlertSoundFile: (...args: unknown[]) => mocks.choose(...args),
}));

import { DEFAULT_NOTIFICATION_PREFERENCES } from "../lib/notifications";
import { loadAlertSounds, saveAlertSounds } from "../lib/sounds";
import { AlertSoundRows } from "./AlertSoundRows";

let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.clearAllMocks();
  const data = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
    removeItem: (key: string) => void data.delete(key),
  });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

async function render(
  patch: Partial<typeof DEFAULT_NOTIFICATION_PREFERENCES> = {},
  soundsEnabled = true,
  onPreference = vi.fn(),
) {
  await act(async () =>
    root.render(
      h(AlertSoundRows, {
        preferences: { ...DEFAULT_NOTIFICATION_PREFERENCES, ...patch },
        onPreference,
        soundsEnabled,
      }),
    ),
  );
  return onPreference;
}

const byLabel = (label: string) =>
  container.querySelector<HTMLElement>(`[aria-label="${label}"]`);

async function pick(select: string, option: string) {
  await act(async () => byLabel(select)!.click());
  const match = [
    ...document.querySelectorAll<HTMLElement>('[role="option"]'),
  ].find((item) => item.textContent?.includes(option));
  await act(async () => match!.click());
}

describe("alert sound rows", () => {
  it("shows one row per alert with its switch, sound and preview together", async () => {
    await render();
    const labels = [...container.querySelectorAll(".settings-row-label")].map(
      (label) => label.textContent,
    );
    expect(labels).toEqual(["Needs you", "Finished", "Failed"]);
    expect(byLabel("Needs you sound")).not.toBeNull();
    expect(byLabel("Play Needs you sound")).not.toBeNull();
    // Failed is quiet by default, so there is nothing to preview.
    expect(byLabel("Failed sound")).not.toBeNull();
    expect(byLabel("Play Failed sound")).toBeNull();
  });

  it("hides the sound while an alert is off or Sounds is off", async () => {
    await render({ needsInput: false });
    expect(byLabel("Needs you sound")).toBeNull();
    expect(byLabel("Finished sound")).not.toBeNull();
    await render({}, false);
    expect(container.querySelectorAll('[role="combobox"]')).toHaveLength(0);
    expect(container.querySelectorAll('[role="switch"]')).toHaveLength(3);
  });

  it("keeps the old per-event switches", async () => {
    const onPreference = await render();
    await act(async () => byLabel("Failed")!.click());
    expect(onPreference).toHaveBeenCalledWith("failures", false);
  });

  it("saves and previews a built-in sound", async () => {
    await render();
    await pick("Failed sound", "Knock");
    expect(loadAlertSounds().failed).toBe("error");
    expect(mocks.playChoice).toHaveBeenCalledWith("error", undefined);
    await act(async () => byLabel("Play Failed sound")!.click());
    expect(mocks.playChoice).toHaveBeenLastCalledWith("error", undefined);
  });

  it("copies a chosen file and lists it by name", async () => {
    const file = { name: "Soft Ping", path: "/data/sounds/needsYou-1.wav" };
    mocks.choose.mockResolvedValue(file);
    await render();
    await pick("Needs you sound", "Choose file…");
    expect(mocks.choose).toHaveBeenCalledWith("needsYou");
    expect(loadAlertSounds()).toMatchObject({
      needsYou: "file",
      files: { needsYou: file },
    });
    expect(byLabel("Needs you sound")!.textContent).toContain("Soft Ping");
  });

  it("says why a file was refused and keeps the earlier sound", async () => {
    saveAlertSounds({ finished: "ready" });
    mocks.choose.mockRejectedValue("Choose a sound under 1 MB.");
    await render();
    await pick("Finished sound", "Choose file…");
    expect(container.textContent).toContain("Choose a sound under 1 MB.");
    expect(loadAlertSounds().finished).toBe("ready");
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { getVersion, getIdentifier, check, message, ask, relaunch } = vi.hoisted(
  () => ({
    getVersion: vi.fn(),
    getIdentifier: vi.fn(),
    check: vi.fn(),
    message: vi.fn(),
    ask: vi.fn(),
    relaunch: vi.fn(),
  }),
);

vi.mock("@tauri-apps/api/app", () => ({ getVersion, getIdentifier }));
vi.mock("@tauri-apps/plugin-updater", () => ({ check }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ ask, message }));
vi.mock("@tauri-apps/plugin-process", () => ({ relaunch }));
vi.mock("./appLifecycle", () => ({ prepareUpdateRestart: vi.fn() }));
vi.mock("./sounds", () => ({ announceUpdateAvailable: vi.fn() }));
// Missing release configuration must never pretend the build is current.

import { runUpdateFlow } from "./updater";

describe("updater", () => {
  beforeEach(() => {
    getIdentifier.mockResolvedValue("com.capi.monocode.personal");
  });
  afterEach(() => {
    vi.resetAllMocks();
  });

  it("keeps automatic checks quiet when updater endpoints are missing", async () => {
    getVersion.mockResolvedValue("0.1.23");
    check.mockRejectedValue(
      new Error("Updater does not have any endpoints set"),
    );

    await expect(runUpdateFlow(false)).resolves.toEqual({
      phase: "idle",
      currentVersion: "0.1.23",
    });
    expect(message).not.toHaveBeenCalled();
  });

  it("points manual checks without updater endpoints to GitHub releases", async () => {
    getVersion.mockResolvedValue("0.1.23");
    check.mockRejectedValue(
      new Error("Updater does not have any endpoints set"),
    );

    await expect(runUpdateFlow(true)).resolves.toEqual({
      phase: "idle",
      currentVersion: "0.1.23",
    });
    expect(message).toHaveBeenCalledWith(
      expect.stringContaining("https://github.com/capi-git/aven/releases"),
      { title: "Aven" },
    );
  });

  it("still reports real updater failures", async () => {
    getVersion.mockResolvedValue("0.1.23");
    check.mockRejectedValue(new Error("network failed"));

    await expect(runUpdateFlow(true)).resolves.toMatchObject({
      phase: "error",
      error: "network failed",
    });
    expect(message).toHaveBeenCalledOnce();
  });
});

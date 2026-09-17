import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  announce: vi.fn(),
  check: vi.fn(),
  downloadAndInstall: vi.fn(),
  getVersion: vi.fn(),
  message: vi.fn(),
  relaunch: vi.fn(),
  remember: vi.fn(),
  personalBuild: false,
}));

vi.mock("@tauri-apps/api/app", () => ({ getVersion: mocks.getVersion }));
vi.mock("@tauri-apps/plugin-dialog", () => ({
  ask: vi.fn(),
  message: mocks.message,
}));
vi.mock("@tauri-apps/plugin-process", () => ({ relaunch: mocks.relaunch }));
vi.mock("@tauri-apps/plugin-updater", () => ({ check: mocks.check }));
vi.mock("./sounds", () => ({ announceUpdateAvailable: mocks.announce }));
vi.mock("./updateNotice", () => ({ rememberInstalledUpdate: mocks.remember }));
vi.mock("./personalBuild", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./personalBuild")>()),
  get IS_PERSONAL_BUILD() {
    return mocks.personalBuild;
  },
}));

beforeEach(() => {
  vi.clearAllMocks();
  vi.resetModules();
  mocks.personalBuild = false;
  mocks.getVersion.mockResolvedValue("0.1.22");
  mocks.relaunch.mockResolvedValue(undefined);
  mocks.message.mockResolvedValue(undefined);
});

describe("personal build update guard", () => {
  it("explicitly identifies this fork as a personal build", async () => {
    const actual =
      await vi.importActual<typeof import("./personalBuild")>(
        "./personalBuild",
      );
    expect(actual.IS_PERSONAL_BUILD).toBe(true);
  });

  it("does not probe the upstream feed or show automatic-check dialogs", async () => {
    mocks.personalBuild = true;
    const updater = await import("./updater");
    expect(await updater.probeForUpdate()).toBeNull();
    const progress = vi.fn();
    expect(await updater.runUpdateFlow(false, progress)).toEqual({
      phase: "idle",
      currentVersion: "0.1.22",
    });
    expect(progress).toHaveBeenCalledExactlyOnceWith({
      phase: "idle",
      currentVersion: "0.1.22",
    });
    expect(mocks.check).not.toHaveBeenCalled();
    expect(mocks.announce).not.toHaveBeenCalled();
    expect(mocks.message).not.toHaveBeenCalled();
  });

  it("explains manual personal updates without offering an upstream installation", async () => {
    mocks.personalBuild = true;
    const updater = await import("./updater");
    await updater.runUpdateFlow(true);
    expect(mocks.message).toHaveBeenCalledWith(
      expect.stringContaining(
        "https://github.com/capi-git/aven/releases",
      ),
      { title: "Aven" },
    );
    expect(mocks.check).not.toHaveBeenCalled();
    expect(mocks.downloadAndInstall).not.toHaveBeenCalled();
    expect(mocks.relaunch).not.toHaveBeenCalled();
  });

  it("discards an already pending upstream update before installation", async () => {
    const updater = await updaterWithPendingUpdate();
    mocks.personalBuild = true;
    expect((await updater.installPendingUpdate()).phase).toBe("idle");
    expect(mocks.downloadAndInstall).not.toHaveBeenCalled();
    expect(mocks.remember).not.toHaveBeenCalled();
    expect(mocks.relaunch).not.toHaveBeenCalled();
    // The handle was cleared, so it cannot reappear after the guard runs.
    mocks.personalBuild = false;
    expect((await updater.installPendingUpdate()).phase).toBe("idle");
    expect(mocks.downloadAndInstall).not.toHaveBeenCalled();
  });
});

async function updaterWithPendingUpdate() {
  const update = {
    version: "0.1.23",
    downloadAndInstall: mocks.downloadAndInstall,
  };
  mocks.check.mockResolvedValue(update);
  const updater = await import("./updater");
  await updater.probeForUpdate();
  return updater;
}

describe("installPendingUpdate", () => {
  it("records a successful installation before relaunching", async () => {
    mocks.downloadAndInstall.mockResolvedValue(undefined);
    const updater = await updaterWithPendingUpdate();

    await updater.installPendingUpdate();

    expect(mocks.remember).toHaveBeenCalledWith("0.1.23");
    expect(mocks.relaunch).toHaveBeenCalledOnce();
    expect(mocks.remember.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.relaunch.mock.invocationCallOrder[0]!,
    );
  });

  it("does not record or relaunch after installation fails", async () => {
    mocks.downloadAndInstall.mockRejectedValue(new Error("install failed"));
    const updater = await updaterWithPendingUpdate();

    const result = await updater.installPendingUpdate();

    expect(result.phase).toBe("error");
    expect(mocks.remember).not.toHaveBeenCalled();
    expect(mocks.relaunch).not.toHaveBeenCalled();
  });

  it("does not record when no update is pending", async () => {
    const updater = await import("./updater");

    expect((await updater.installPendingUpdate()).phase).toBe("idle");
    expect(mocks.remember).not.toHaveBeenCalled();
    expect(mocks.relaunch).not.toHaveBeenCalled();
  });
});

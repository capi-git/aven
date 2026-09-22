// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  announce: vi.fn(),
  check: vi.fn(),
  download: vi.fn(),
  install: vi.fn(),
  getVersion: vi.fn(),
  message: vi.fn(),
  invoke: vi.fn(),
  prepare: vi.fn(),
  remember: vi.fn(),
  lockInput: vi.fn(),
  releaseInput: vi.fn(),
}));
vi.mock("@tauri-apps/api/app", () => ({ getVersion: mocks.getVersion }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ message: mocks.message }));
vi.mock("@tauri-apps/plugin-updater", () => ({ check: mocks.check }));
vi.mock("./updateInputLock", () => ({ lockUpdateInput: mocks.lockInput }));
vi.mock("./appLifecycle", () => ({ prepareUpdateRestart: mocks.prepare }));
vi.mock("./sounds", () => ({ announceUpdateAvailable: mocks.announce }));
vi.mock("./updateNotice", () => ({ rememberInstalledUpdate: mocks.remember }));

beforeEach(() => {
  vi.resetAllMocks();
  vi.resetModules();
  mocks.getVersion.mockResolvedValue("0.1.79");
  mocks.message.mockResolvedValue(undefined);
  mocks.invoke.mockResolvedValue(undefined);
  mocks.download.mockResolvedValue(undefined);
  mocks.install.mockResolvedValue(undefined);
  mocks.prepare.mockResolvedValue(undefined);
  mocks.lockInput.mockReturnValue(mocks.releaseInput);
});
afterEach(() => vi.useRealTimers());
function offer() {
  mocks.check.mockResolvedValue({
    version: "0.1.80",
    download: mocks.download,
    install: mocks.install,
    close: vi.fn().mockResolvedValue(undefined),
  });
}
async function ready() {
  offer();
  const updater = await import("./updater");
  await updater.runUpdateFlow(false);
  return updater;
}

describe("automatic signed update staging", () => {
  it("downloads an available update without installing or restarting", async () => {
    const updater = await ready();
    expect(updater.getUpdaterSnapshot()).toMatchObject({
      phase: "ready",
      availableVersion: "0.1.80",
    });
    expect(mocks.download).toHaveBeenCalledOnce();
    expect(mocks.install).not.toHaveBeenCalled();
    expect(mocks.prepare).not.toHaveBeenCalled();
    expect(mocks.invoke).not.toHaveBeenCalled();
    expect(mocks.lockInput).not.toHaveBeenCalled();
    expect(mocks.message).not.toHaveBeenCalled();
  });
  it("shares concurrent checks and download progress between subscribers", async () => {
    offer();
    let finish!: () => void;
    mocks.download.mockImplementation(async (progress) => {
      progress({ event: "Started", data: { contentLength: 100 } });
      progress({ event: "Progress", data: { chunkLength: 40 } });
      await new Promise<void>((resolve) => {
        finish = resolve;
      });
    });
    const updater = await import("./updater");
    const listener = vi.fn();
    const unsubscribe = updater.subscribeUpdater(listener);
    const first = updater.runUpdateFlow(false);
    const second = updater.runUpdateFlow(false);
    await vi.waitFor(() => expect(mocks.download).toHaveBeenCalledOnce());
    expect(updater.getUpdaterSnapshot()).toMatchObject({
      phase: "downloading",
      progress: 40,
    });
    expect(mocks.check).toHaveBeenCalledOnce();
    finish();
    await Promise.all([first, second]);
    expect(listener).toHaveBeenCalled();
    unsubscribe();
  });
  it("does not trust Finished progress when signature verification fails", async () => {
    offer();
    mocks.download.mockImplementation(async (progress) => {
      progress({ event: "Finished" });
      throw new Error("signature verification failed");
    });
    const updater = await import("./updater");
    const result = await updater.runUpdateFlow(false);
    expect(result).toMatchObject({
      phase: "error",
      error: "signature verification failed",
    });
    await updater.installPendingUpdate();
    expect(mocks.install).not.toHaveBeenCalled();
    expect(mocks.announce).not.toHaveBeenCalled();
    expect(mocks.message).not.toHaveBeenCalled();
  });
  it("retries a failed background download and only then offers restart", async () => {
    offer();
    mocks.download.mockRejectedValueOnce(new Error("offline"));
    const updater = await import("./updater");
    expect((await updater.runUpdateFlow(false)).phase).toBe("error");
    expect((await updater.runUpdateFlow(false)).phase).toBe("ready");
    expect(mocks.download).toHaveBeenCalledTimes(2);
    expect(mocks.check).toHaveBeenCalledTimes(2);
    expect(mocks.install).not.toHaveBeenCalled();
  });
  it("preserves a staged update without downloading it repeatedly", async () => {
    const updater = await ready();
    await updater.runUpdateFlow(false);
    expect(mocks.check).toHaveBeenCalledOnce();
    expect(mocks.download).toHaveBeenCalledOnce();
  });
});

describe("explicit restart", () => {
  it("persists and acquires the native guard before install, then safely relaunches", async () => {
    const updater = await ready();
    await updater.installPendingUpdate();
    expect(mocks.lockInput.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.prepare.mock.invocationCallOrder[0]!,
    );
    expect(mocks.releaseInput).not.toHaveBeenCalled();
    expect(mocks.prepare.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.install.mock.invocationCallOrder[0]!,
    );
    expect(mocks.install.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.remember.mock.invocationCallOrder[0]!,
    );
    expect(mocks.remember).toHaveBeenCalledWith("0.1.80");
    expect(mocks.invoke).toHaveBeenCalledWith("relaunch_after_update");
  });
  it("does not install or interrupt tasks when preparation rejects busy work", async () => {
    const updater = await ready();
    mocks.prepare.mockRejectedValue(new Error("Your tasks are still working"));
    expect((await updater.installPendingUpdate()).phase).toBe("ready");
    expect(mocks.install).not.toHaveBeenCalled();
    expect(mocks.remember).not.toHaveBeenCalled();
    expect(mocks.invoke).toHaveBeenCalledWith("cancel_update_restart");
    expect(mocks.releaseInput).toHaveBeenCalledOnce();
    expect(mocks.invoke).not.toHaveBeenCalledWith("relaunch_after_update");
  });
  it("releases the guard on install failure and keeps the staged update retryable", async () => {
    const updater = await ready();
    mocks.install.mockRejectedValueOnce(new Error("disk full"));
    expect((await updater.installPendingUpdate()).phase).toBe("ready");
    expect(mocks.invoke).toHaveBeenCalledWith("cancel_update_restart");
    expect(mocks.releaseInput).toHaveBeenCalledOnce();
    expect(mocks.remember).not.toHaveBeenCalled();
    await updater.installPendingUpdate();
    expect(mocks.install).toHaveBeenCalledTimes(2);
    expect(mocks.download).toHaveBeenCalledOnce();
  });
  it("retries a failed relaunch without reinstalling the consumed archive", async () => {
    const updater = await ready();
    mocks.invoke.mockImplementationOnce(async () => {
      throw new Error("restart failed");
    });
    expect((await updater.installPendingUpdate()).phase).toBe("ready");
    await updater.installPendingUpdate();
    expect(mocks.install).toHaveBeenCalledOnce();
    expect(mocks.remember).toHaveBeenCalledOnce();
    expect(
      mocks.invoke.mock.calls.filter(
        ([command]) => command === "relaunch_after_update",
      ),
    ).toHaveLength(2);
  });

  it("coalesces duplicate restart clicks and foreground checks during installation", async () => {
    const updater = await ready();
    let finish!: () => void;
    mocks.prepare.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    const first = updater.installPendingUpdate();
    const second = updater.installPendingUpdate();
    const check = updater.runUpdateFlow(false);
    await vi.waitFor(() => expect(mocks.prepare).toHaveBeenCalledOnce());
    finish();
    await Promise.all([first, second, check]);
    expect(mocks.install).toHaveBeenCalledOnce();
    expect(mocks.invoke).toHaveBeenCalledExactlyOnceWith(
      "relaunch_after_update",
    );
  });
});

describe("automatic check scheduling", () => {
  it("checks at startup, throttles focus, retries online, checks periodically and cleans up", async () => {
    vi.useFakeTimers();
    mocks.check.mockResolvedValue(null);
    const updater = await import("./updater");
    const stop = updater.startAutomaticUpdates(window);
    await vi.advanceTimersByTimeAsync(0);
    expect(mocks.check).toHaveBeenCalledTimes(1);
    window.dispatchEvent(new Event("focus"));
    await vi.advanceTimersByTimeAsync(0);
    expect(mocks.check).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(updater.UPDATE_FOCUS_THROTTLE_MS);
    window.dispatchEvent(new Event("online"));
    await vi.advanceTimersByTimeAsync(0);
    expect(mocks.check).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(updater.UPDATE_CHECK_INTERVAL_MS);
    expect(mocks.check).toHaveBeenCalledTimes(3);
    stop();
    await vi.advanceTimersByTimeAsync(updater.UPDATE_CHECK_INTERVAL_MS);
    window.dispatchEvent(new Event("focus"));
    await vi.advanceTimersByTimeAsync(0);
    expect(mocks.check).toHaveBeenCalledTimes(3);
  });
});

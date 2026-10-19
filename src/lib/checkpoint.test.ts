import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const native = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: native.invoke }));

beforeEach(() => {
  vi.resetModules();
  native.invoke.mockReset();
  vi.stubGlobal("window", new EventTarget());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("the checkpoint a message starts from", () => {
  it("asks for it with the native time limit and remembers when the message went ahead without one", async () => {
    const api = await import("./checkpoint");
    native.invoke.mockResolvedValueOnce(false);
    await api.beginSessionTurn("s1", "/repo");
    expect(native.invoke).toHaveBeenCalledWith("session_checkpoint_ensure", {
      sessionId: "s1",
      cwd: "/repo",
      beforeTurn: true,
    });
    expect(api.sessionCheckpointMissed("s1")).toBe(true);
    expect(api.sessionCheckpointMissed("s2")).toBe(false);

    native.invoke.mockResolvedValueOnce(true);
    await api.beginSessionTurn("s1", "/repo");
    expect(api.sessionCheckpointMissed("s1")).toBe(false);
  });

  it("does not wait behind the chat's other queued checkpoint work", async () => {
    const api = await import("./checkpoint");
    native.invoke.mockImplementation(async (command: string) =>
      command === "session_checkpoint_status" ? new Promise(() => {}) : true,
    );
    void api.sessionCheckpointStatus("s1", "/repo");
    await expect(api.beginSessionTurn("s1", "/repo")).resolves.toBeUndefined();
    expect(api.sessionCheckpointMissed("s1")).toBe(false);
  });

  it("tells the review bar to look again", async () => {
    const api = await import("./checkpoint");
    native.invoke.mockResolvedValue(false);
    const heard = vi.fn();
    const stop = api.subscribeReviewChanged(heard);
    await api.beginSessionTurn("s1", "/repo");
    stop();
    expect(heard).toHaveBeenCalledWith("s1");
  });

  it("takes no checkpoint outside a project", async () => {
    const api = await import("./checkpoint");
    await api.beginSessionTurn("s1", "~");
    expect(native.invoke).not.toHaveBeenCalled();
  });
});

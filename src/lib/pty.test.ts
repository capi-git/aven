import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  decodePtyChunk,
  killAllPtys,
  killPty,
  queueTerminalCommand,
  spawnPty,
  trimReplay,
  writePty,
} from "./pty";

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn() }));

const KB = 1024;

describe("decodePtyChunk", () => {
  it("decodes a valid base64 payload", () => {
    // "hi" in base64
    const chunk = decodePtyChunk("aGk=");
    expect(chunk).not.toBeNull();
    expect(Array.from(chunk!)).toEqual([104, 105]);
  });

  it("returns null instead of throwing on a malformed payload", () => {
    expect(() => decodePtyChunk("not valid base64!!!")).not.toThrow();
    expect(decodePtyChunk("not valid base64!!!")).toBeNull();
  });
});

describe("trimReplay", () => {
  it("keeps a small buffer whole", () => {
    const sizes = [KB, KB, KB];
    expect(trimReplay(sizes, 3 * KB)).toEqual({ drop: 0, bytes: 3 * KB });
  });

  it("drops oldest chunks once the byte budget is exceeded", () => {
    // Ten 32KB chunks is 320KB, over the 256KB budget.
    const sizes = Array(10).fill(32 * KB);
    const { drop, bytes } = trimReplay(sizes, 320 * KB);
    expect(drop).toBe(2);
    expect(bytes).toBe(256 * KB);
  });

  it("bounds a flood of tiny chunks by count", () => {
    const sizes = Array(250).fill(4);
    const { drop } = trimReplay(sizes, 1000);
    expect(sizes.length - drop).toBe(200);
  });

  it("keeps the newest chunk even when it alone exceeds the budget", () => {
    const sizes = [KB, 512 * KB];
    const { drop, bytes } = trimReplay(sizes, 513 * KB);
    expect(drop).toBe(1);
    expect(bytes).toBe(512 * KB);
  });

  it("never drops the only chunk", () => {
    const sizes = [512 * KB];
    expect(trimReplay(sizes, 512 * KB)).toEqual({ drop: 0, bytes: 512 * KB });
  });
});

describe("queued terminal commands", () => {
  beforeEach(async () => {
    invoke.mockReset();
    invoke.mockResolvedValue(undefined);
    await killAllPtys();
    invoke.mockClear();
  });

  function holdNextSpawn() {
    let ready!: () => void;
    invoke.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          ready = resolve;
        }),
    );
    return () => ready();
  }

  const writes = () =>
    invoke.mock.calls.filter(([command]) => command === "pty_write");

  it("writes exactly once after spawn succeeds and never replays on a later spawn", async () => {
    queueTerminalCommand("run", "npm run build\nnpm test");
    expect(invoke).not.toHaveBeenCalled();
    const ready = holdNextSpawn();
    const pending = spawnPty("run", "/repo", 80, 24);
    expect(invoke).toHaveBeenCalledWith("pty_spawn", {
      id: "run",
      cwd: "/repo",
      cols: 80,
      rows: 24,
      reuseExisting: true,
    });
    expect(writes()).toHaveLength(0);
    ready();
    await pending;
    expect(writes()).toEqual([
      ["pty_write", { id: "run", data: "npm run build\rnpm test\r" }],
    ]);
    await spawnPty("run", "/repo", 80, 24);
    expect(writes()).toHaveLength(1);
  });

  it("attaches a transferred terminal in another window without starting a second shell or replaying its run command", async () => {
    const running = new Set<string>();
    let shellStarts = 0;
    invoke.mockImplementation(
      async (
        command: string,
        args: { id: string; reuseExisting?: boolean },
      ) => {
        if (command !== "pty_spawn") return;
        if (args.reuseExisting && running.has(args.id)) return;
        running.add(args.id);
        shellStarts++;
      },
    );
    queueTerminalCommand("transferred", "npm run dev");
    await spawnPty("transferred", "/repo", 80, 24);
    expect(shellStarts).toBe(1);
    expect(writes()).toEqual([
      ["pty_write", { id: "transferred", data: "npm run dev\r" }],
    ]);

    // A detached WK shell has its own JS module state but shares the native PTY host.
    vi.resetModules();
    const detachedWindowPty = await import("./pty");
    await detachedWindowPty.spawnPty("transferred", "/repo", 120, 35);
    await spawnPty("transferred", "/repo", 100, 30);
    expect(shellStarts).toBe(1);
    expect(writes()).toHaveLength(1);
    expect(invoke).toHaveBeenCalledWith("pty_spawn", {
      id: "transferred",
      cwd: "/repo",
      cols: 120,
      rows: 35,
      reuseExisting: true,
    });
    expect(invoke.mock.calls.some(([command]) => command === "pty_kill")).toBe(
      false,
    );
  });

  it("cancels a queued command when its terminal is killed during spawn", async () => {
    queueTerminalCommand("cancel", "npm test");
    const ready = holdNextSpawn();
    const pending = spawnPty("cancel", "/repo", 80, 24);
    await killPty("cancel");
    ready();
    await pending;
    await spawnPty("cancel", "/repo", 80, 24);
    expect(writes()).toHaveLength(0);
  });

  it("clears commands for pending and not-yet-spawned terminals on killAll", async () => {
    queueTerminalCommand("pending", "npm test");
    queueTerminalCommand("later", "npm run build");
    const ready = holdNextSpawn();
    const pending = spawnPty("pending", "/repo", 80, 24);
    await killAllPtys();
    ready();
    await pending;
    await spawnPty("later", "/repo", 80, 24);
    expect(writes()).toHaveLength(0);
  });

  it("discards a command after spawn fails", async () => {
    queueTerminalCommand("failed", "npm test");
    invoke.mockRejectedValueOnce(new Error("spawn failed"));
    await expect(spawnPty("failed", "/repo", 80, 24)).rejects.toThrow(
      "spawn failed",
    );
    await spawnPty("failed", "/repo", 80, 24);
    expect(writes()).toHaveLength(0);
  });

  it("does not replay a command if writing it to the spawned PTY fails", async () => {
    queueTerminalCommand("write-failed", "npm test");
    invoke
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("write failed"));
    await expect(spawnPty("write-failed", "/repo", 80, 24)).rejects.toThrow(
      "write failed",
    );
    await spawnPty("write-failed", "/repo", 80, 24);
    expect(writes()).toHaveLength(1);
  });

  it("rejects empty or NUL-containing commands before touching a PTY", () => {
    expect(() => queueTerminalCommand("invalid", " \n ")).toThrow(
      "valid command",
    );
    expect(() => queueTerminalCommand("invalid", "npm\0test")).toThrow(
      "valid command",
    );
    expect(invoke).not.toHaveBeenCalled();
  });
});

describe("terminal input ordering", () => {
  beforeEach(async () => {
    invoke.mockReset();
    invoke.mockResolvedValue(undefined);
    await killAllPtys();
    invoke.mockClear();
  });

  function holdWrite() {
    let resolve!: () => void;
    let reject!: (error: Error) => void;
    invoke.mockImplementationOnce(
      () =>
        new Promise<void>((ok, fail) => {
          resolve = ok;
          reject = fail;
        }),
    );
    return {
      resolve: () => resolve(),
      reject: () => reject(new Error("broken pipe")),
    };
  }

  it("preserves input order while allowing another terminal to write", async () => {
    const held = holdWrite();
    const first = writePty("one", "first");
    const second = writePty("one", "second");
    await vi.waitFor(() => expect(invoke).toHaveBeenCalledTimes(1));
    await writePty("two", "independent");
    expect(invoke.mock.calls).toEqual([
      ["pty_write", { id: "one", data: "first" }],
      ["pty_write", { id: "two", data: "independent" }],
    ]);
    held.resolve();
    await Promise.all([first, second]);
    expect(invoke).toHaveBeenLastCalledWith("pty_write", {
      id: "one",
      data: "second",
    });
  });

  it("reports a failed write without poisoning later input", async () => {
    const held = holdWrite();
    const first = writePty("one", "first");
    const failure = expect(first).rejects.toThrow("broken pipe");
    const second = writePty("one", "second");
    await vi.waitFor(() => expect(invoke).toHaveBeenCalledTimes(1));
    held.reject();
    await failure;
    await second;
    expect(invoke).toHaveBeenLastCalledWith("pty_write", {
      id: "one",
      data: "second",
    });
  });

  it.each(["one", "all"])(
    "drops queued bytes after closing %s terminal(s)",
    async (scope) => {
      const held = holdWrite();
      const first = writePty("one", "first");
      const queued = writePty("one", "stale");
      const cancelled = expect(queued).rejects.toThrow("closed");
      await vi.waitFor(() => expect(invoke).toHaveBeenCalledTimes(1));
      if (scope === "all") await killAllPtys();
      else await killPty("one");
      await writePty("one", "new generation");
      held.resolve();
      await first;
      await cancelled;
      expect(
        invoke.mock.calls.filter(([command]) => command === "pty_write"),
      ).toEqual([
        ["pty_write", { id: "one", data: "first" }],
        ["pty_write", { id: "one", data: "new generation" }],
      ]);
    },
  );
});

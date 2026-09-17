import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { HarnessAdapter } from "./harness/registry";

const native = vi.hoisted(() => ({
  invoke: vi.fn(),
  listen: vi.fn(),
  grants: new Map<string, string[]>(),
}));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: native.invoke,
  isTauri: () => true,
}));
vi.mock("@tauri-apps/api/webview", () => ({
  getCurrentWebview: () => ({ listen: native.listen }),
}));

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

const binding = {
  executablePath: "/Applications/CoveCode.app/Contents/MacOS/monocode",
  socketPath: "/private/test-only.sock",
};
let dispose: (() => void) | undefined;

beforeEach(() => {
  vi.resetModules();
  native.grants.clear();
  native.listen.mockReset().mockResolvedValue(() => {});
  native.invoke
    .mockReset()
    .mockImplementation(
      async (
        command: string,
        args: { sessionId: string; browserIds?: string[] },
      ) => {
        if (command === "browser_agent_bind") {
          native.grants.set(args.sessionId, args.browserIds ?? []);
          return binding;
        }
        if (command === "browser_agent_revoke")
          native.grants.delete(args.sessionId);
        return undefined;
      },
    );
});

afterEach(async () => {
  dispose?.();
  dispose = undefined;
  // Drain app-host cleanup before replacing the mocked IPC for the next test.
  for (let index = 0; index < 12; index += 1) await Promise.resolve();
});

function adapter(overrides: Partial<HarnessAdapter>): HarnessAdapter {
  return {
    id: "claude",
    live: true,
    async sendTurn() {},
    async steerTurn() {},
    async cancelTurn() {},
    respondApproval() {},
    async stopSession() {},
    async forgetSession() {},
    bindSession() {},
    ...overrides,
  };
}

describe("agent browser lifecycle ordering", () => {
  it("late cleanup of an old adapter cannot revoke a newer binding for the same session", async () => {
    const api = await import("./agentBrowser");
    const registry = await import("./harness/registry");
    const oldChild = deferred();
    const forgetSession = vi.fn(() => oldChild.promise);
    registry.registerHarness(adapter({ forgetSession }));
    dispose = api.installAgentBrowserHost({
      surfaces: () => ["page"],
      open: vi.fn(),
    });
    api.registerAgentBrowserPage("page", "native-page");
    const context = { sessionId: "same-session", cwd: "/project" };
    await api.prepareAgentBrowserPrompt("First turn", context);

    let oldCleanupFinished = false;
    const forgetting = registry
      .forgetHarnessSession("claude", context.sessionId)
      .then(() => {
        oldCleanupFinished = true;
      });
    try {
      const next = await api.prepareAgentBrowserPrompt(
        "Next provider turn",
        context,
      );
      expect(next).toContain("--supermono-browser");
      expect(forgetSession).toHaveBeenCalledWith(context.sessionId);
      expect(oldCleanupFinished).toBe(false);
      expect(native.grants.get(context.sessionId)).toEqual(["native-page"]);
      const revocationsBeforeOldChildEnds = native.invoke.mock.calls.filter(
        ([command]) => command === "browser_agent_revoke",
      ).length;

      oldChild.resolve();
      await forgetting;
      expect(native.grants.get(context.sessionId)).toEqual(["native-page"]);
      expect(
        native.invoke.mock.calls.filter(
          ([command]) => command === "browser_agent_revoke",
        ),
      ).toHaveLength(revocationsBeforeOldChildEnds);
      await api.refreshAgentBrowserScopes();
      expect(native.grants.get(context.sessionId)).toEqual(["native-page"]);
    } finally {
      oldChild.resolve();
      await forgetting;
    }
  });

  it("a replacement bind waits for an in-flight native revoke before granting the session again", async () => {
    const api = await import("./agentBrowser");
    const revokeStarted = deferred();
    const finishRevoke = deferred();
    const operations: string[] = [];
    native.invoke.mockImplementation(
      async (
        command: string,
        args: { sessionId: string; browserIds?: string[] },
      ) => {
        if (command === "browser_agent_bind") {
          operations.push("bind");
          native.grants.set(args.sessionId, args.browserIds ?? []);
          return binding;
        }
        if (command === "browser_agent_revoke") {
          operations.push("revoke started");
          revokeStarted.resolve();
          await finishRevoke.promise;
          native.grants.delete(args.sessionId);
          operations.push("revoke finished");
        }
        return undefined;
      },
    );
    dispose = api.installAgentBrowserHost({
      surfaces: () => [],
      open: vi.fn(),
    });
    const context = { sessionId: "reused-session", cwd: "/project" };
    await api.prepareAgentBrowserPrompt("First", context);
    const forgetting = api.forgetAgentBrowser(context.sessionId);
    await revokeStarted.promise;
    let rebound = false;
    const replacement = api
      .prepareAgentBrowserPrompt("Replacement", context)
      .then((text) => {
        rebound = true;
        return text;
      });
    try {
      for (let index = 0; index < 12; index += 1) await Promise.resolve();
      expect(rebound).toBe(false);
      expect(operations).toEqual(["bind", "revoke started"]);
      finishRevoke.resolve();
      await forgetting;
      expect(await replacement).toContain("--supermono-browser");
      expect(operations).toEqual([
        "bind",
        "revoke started",
        "revoke finished",
        "bind",
      ]);
      expect(native.grants.has(context.sessionId)).toBe(true);
    } finally {
      finishRevoke.resolve();
      await Promise.all([forgetting, replacement]);
    }
  });
});

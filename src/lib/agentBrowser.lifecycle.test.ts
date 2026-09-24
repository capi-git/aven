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
  executablePath: "/Applications/Aven.app/Contents/MacOS/aven",
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
  it("wakes only visited pages in the task's scope and waits for their replacement native page", async () => {
    const api = await import("./agentBrowser");
    const wakeStarted = deferred();
    const finishWake = deferred();
    dispose = api.installAgentBrowserHost({
      surfaces: () => ["sleeping", "never-viewed"],
      open: vi.fn(),
    });
    const ownWake = vi.fn(async () => {
      wakeStarted.resolve();
      await finishWake.promise;
    });
    const otherWake = vi.fn();
    api.registerAgentBrowserWake("sleeping", ownWake);
    api.registerAgentBrowserWake("other-workspace", otherWake);
    api.registerAgentBrowserPage("other-workspace", "native-other");
    const context = { sessionId: "wake-session", cwd: "/project" };
    let prepared = false;
    const preparation = api
      .prepareAgentBrowserPrompt("Inspect my page", context)
      .then((prompt) => {
        prepared = true;
        return prompt;
      });
    await wakeStarted.promise;
    expect(ownWake).toHaveBeenCalledOnce();
    expect(otherWake).not.toHaveBeenCalled();
    expect(prepared).toBe(false);
    expect(api.isAgentBrowserPageProtected("sleeping")).toBe(true);
    expect(api.isAgentBrowserPageProtected("other-workspace")).toBe(false);
    finishWake.resolve();
    for (let index = 0; index < 12; index += 1) await Promise.resolve();
    expect(prepared).toBe(false);
    expect(native.grants.get(context.sessionId) ?? []).toEqual([]);
    api.registerAgentBrowserPage("sleeping", "replacement-native");
    expect(await preparation).toContain("--aven-browser");
    expect(native.grants.get(context.sessionId)).toEqual([
      "replacement-native",
    ]);
    expect(otherWake).not.toHaveBeenCalled();
    expect(api.isAgentBrowserPageProtected("sleeping")).toBe(false);
  });

  it("keeps pages protected until every overlapping prompt has acquired its native grant", async () => {
    const api = await import("./agentBrowser");
    const startedA = deferred();
    const startedB = deferred();
    const finishedA = deferred();
    const finishedB = deferred();
    const invoke = native.invoke.getMockImplementation()!;
    native.invoke.mockImplementation(
      async (command: string, args: { sessionId: string }) => {
        if (command === "browser_agent_bind") {
          const isA = args.sessionId === "session-a";
          (isA ? startedA : startedB).resolve();
          await (isA ? finishedA : finishedB).promise;
        }
        return invoke(command, args);
      },
    );
    dispose = api.installAgentBrowserHost({
      surfaces: () => ["page"],
      open: vi.fn(),
    });
    api.registerAgentBrowserPage("page", "native-page");
    for (let index = 0; index < 12; index += 1) await Promise.resolve();
    const preparationA = api.prepareAgentBrowserPrompt("First", {
      sessionId: "session-a",
      cwd: "/project",
    });
    await startedA.promise;
    const preparationB = api.prepareAgentBrowserPrompt("Second", {
      sessionId: "session-b",
      cwd: "/project",
    });
    await startedB.promise;
    expect(api.isAgentBrowserPageProtected("page")).toBe(true);
    finishedA.resolve();
    expect(await preparationA).toContain("--aven-browser");
    expect(api.isAgentBrowserPageProtected("page")).toBe(true);
    finishedB.resolve();
    expect(await preparationB).toContain("--aven-browser");
    expect(api.isAgentBrowserPageProtected("page")).toBe(false);
    expect(native.grants.get("session-a")).toEqual(["native-page"]);
    expect(native.grants.get("session-b")).toEqual(["native-page"]);
  });

  it("scope refreshes leave sleeping pages asleep until the next prompt", async () => {
    const api = await import("./agentBrowser");
    dispose = api.installAgentBrowserHost({
      surfaces: () => ["page"],
      open: vi.fn(),
    });
    const unregisterPage = api.registerAgentBrowserPage("page", "native-page");
    const wake = vi.fn(() => {
      api.registerAgentBrowserPage("page", "new-native-page");
    });
    const context = { sessionId: "sleep-session", cwd: "/project" };
    await api.prepareAgentBrowserPrompt("First turn", context);
    unregisterPage();
    api.registerAgentBrowserWake("page", wake);
    await api.refreshAgentBrowserScopes();
    expect(wake).not.toHaveBeenCalled();
    expect(native.grants.get(context.sessionId)).toEqual([]);
    await api.prepareAgentBrowserPrompt("Continue", context);
    expect(wake).toHaveBeenCalledOnce();
    expect(native.grants.get(context.sessionId)).toEqual(["new-native-page"]);
  });

  it("an old pane's wake cleanup cannot unregister its replacement", async () => {
    const api = await import("./agentBrowser");
    dispose = api.installAgentBrowserHost({
      surfaces: () => ["page"],
      open: vi.fn(),
    });
    const oldWake = vi.fn();
    const removeOld = api.registerAgentBrowserWake("page", oldWake);
    const nextWake = vi.fn(() => {
      api.registerAgentBrowserPage("page", "replacement-native");
    });
    api.registerAgentBrowserWake("page", nextWake);
    removeOld();
    await api.prepareAgentBrowserPrompt("Inspect", {
      sessionId: "replacement-pane-session",
      cwd: "/project",
    });
    expect(oldWake).not.toHaveBeenCalled();
    expect(nextWake).toHaveBeenCalledOnce();
  });

  it("a task revoked during wake cannot reacquire browser access", async () => {
    const api = await import("./agentBrowser");
    const started = deferred();
    const finished = deferred();
    dispose = api.installAgentBrowserHost({
      surfaces: () => ["page"],
      open: vi.fn(),
    });
    api.registerAgentBrowserWake("page", async () => {
      started.resolve();
      await finished.promise;
      api.registerAgentBrowserPage("page", "new-native-page");
    });
    const context = { sessionId: "revoked-session", cwd: "/project" };
    const preparation = api.prepareAgentBrowserPrompt("Inspect", context);
    await started.promise;
    await api.forgetAgentBrowser(context.sessionId);
    finished.resolve();
    expect(await preparation).toContain("unavailable for this turn");
    expect(native.grants.has(context.sessionId)).toBe(false);
  });

  it("a failed wake does not advertise working browser access", async () => {
    const api = await import("./agentBrowser");
    dispose = api.installAgentBrowserHost({
      surfaces: () => ["page"],
      open: vi.fn(),
    });
    api.registerAgentBrowserWake("page", async () => {
      throw new Error("Native close could not be confirmed");
    });
    expect(
      await api.prepareAgentBrowserPrompt("Inspect", {
        sessionId: "failed-wake-session",
        cwd: "/project",
      }),
    ).toContain("unavailable for this turn");
    expect(native.grants.has("failed-wake-session")).toBe(false);
    expect(api.isAgentBrowserPageProtected("page")).toBe(false);
  });

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
      expect(next).toContain("--aven-browser");
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
      expect(await replacement).toContain("--aven-browser");
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

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  modelsFor,
  resetHarnessModelOverlays,
  setHarnessModels,
} from "../models";
import type { HarnessId } from "../session";
import {
  HARNESS_IDLE_PARK_MS,
  HARNESS_CATALOG_TTL_MS,
  HARNESS_CATALOG_RETRY_MS,
  canCompactHarnessContext,
  compactHarnessContext,
  isLiveHarness,
  listHarnesses,
  refreshHarnessCatalogs,
  registerHarness,
  resetHarnessIdlePark,
  sendHarnessTurn,
  type HarnessAdapter,
} from "./registry";
import type { SendTurnInput, SteerTurnInput } from "./types";
import { registerBuiltinHarnesses } from "./register";

const control = vi.hoisted(() => ({
  isTauri: vi.fn(() => false),
  invoke: vi.fn(async () => undefined),
}));
vi.mock("@tauri-apps/api/core", () => ({
  isTauri: control.isTauri,
  invoke: control.invoke,
}));
beforeEach(() => {
  control.isTauri.mockReturnValue(false);
  control.invoke.mockReset().mockResolvedValue(undefined);
});

function stub(
  id: "cursor" | "codex" | "claude" | "pi",
  extra: Partial<HarnessAdapter> = {},
): HarnessAdapter {
  return {
    id,
    live: true,
    async sendTurn(_input: SendTurnInput) {},
    async steerTurn(_input: SteerTurnInput) {},
    async cancelTurn() {},
    respondApproval() {},
    async stopSession() {},
    async forgetSession() {},
    bindSession() {},
    ...extra,
  };
}

describe("harness registry", () => {
  afterEach(() => {
    resetHarnessModelOverlays();
    resetHarnessIdlePark();
    vi.useRealTimers();
  });

  it("authorizes a native turn before dispatch and releases its grant after completion", async () => {
    control.isTauri.mockReturnValue(true);
    const order: string[] = [];
    control.invoke.mockImplementation(async (command) => {
      order.push(command);
    });
    const sendTurn = vi.fn(async () => {
      order.push("send");
    });
    registerHarness(stub("codex", { sendTurn }));
    await sendHarnessTurn({
      harness: "codex",
      sessionId: "lead",
      cwd: "/repo",
      model: "codex:test",
      runtimeMode: "supervised",
      text: "Work",
      onEvent: () => {},
    });
    expect(order).toEqual([
      "control_authorize_turn",
      "send",
      "control_turn_finished",
    ]);
    expect(control.invoke).toHaveBeenNthCalledWith(
      1,
      "control_authorize_turn",
      { sessionId: "lead", cwd: "/repo" },
    );
    expect(control.invoke).toHaveBeenNthCalledWith(2, "control_turn_finished", {
      sessionId: "lead",
    });
  });

  it("does not start a provider when native control authorization rejects the turn", async () => {
    control.isTauri.mockReturnValue(true);
    control.invoke.mockRejectedValueOnce(new Error("Checkout is reserved"));
    const sendTurn = vi.fn(async () => {});
    registerHarness(stub("codex", { sendTurn }));
    await expect(
      sendHarnessTurn({
        harness: "codex",
        sessionId: "other",
        cwd: "/repo",
        model: "codex:test",
        runtimeMode: "supervised",
        text: "Work",
        onEvent: () => {},
      }),
    ).rejects.toThrow("Checkout is reserved");
    expect(sendTurn).not.toHaveBeenCalled();
    expect(control.invoke).toHaveBeenCalledTimes(1);
  });

  it("releases native turn authorization when the provider fails", async () => {
    control.isTauri.mockReturnValue(true);
    registerHarness(
      stub("codex", {
        sendTurn: async () => {
          throw new Error("Provider failed");
        },
      }),
    );
    await expect(
      sendHarnessTurn({
        harness: "codex",
        sessionId: "lead",
        cwd: "/repo",
        model: "codex:test",
        runtimeMode: "supervised",
        text: "Work",
        onEvent: () => {},
      }),
    ).rejects.toThrow("Provider failed");
    expect(control.invoke).toHaveBeenLastCalledWith("control_turn_finished", {
      sessionId: "lead",
    });
  });

  it("tracks live adapters", () => {
    registerHarness(stub("cursor"));
    registerHarness(stub("codex"));
    registerHarness(stub("claude"));
    expect(isLiveHarness("cursor")).toBe(true);
    expect(isLiveHarness("codex")).toBe(true);
    expect(isLiveHarness("claude")).toBe(true);
    expect(
      listHarnesses()
        .map((a) => a.id)
        .filter((id) => id === "claude" || id === "codex" || id === "cursor")
        .sort(),
    ).toEqual(["claude", "codex", "cursor"]);
  });

  it("advertises and dispatches compaction only when an adapter supports it", async () => {
    const compactContext = vi.fn(async () => undefined);
    registerHarness(stub("codex", { compactContext }));
    registerHarness(stub("claude"));

    expect(canCompactHarnessContext("codex")).toBe(true);
    expect(canCompactHarnessContext("claude")).toBe(false);

    await compactHarnessContext({
      harness: "codex",
      sessionId: "compact-1",
      cwd: "/tmp",
      model: "codex:gpt-5.4",
      runtimeMode: "supervised",
      onEvent: () => undefined,
    });

    expect(compactContext).toHaveBeenCalledOnce();
    await expect(
      compactHarnessContext({
        harness: "claude",
        sessionId: "compact-2",
        cwd: "/tmp",
        model: "claude:sonnet",
        runtimeMode: "supervised",
        onEvent: () => undefined,
      }),
    ).rejects.toThrow("does not support manual compaction");
  });

  it("exposes the native compaction support matrix", () => {
    registerBuiltinHarnesses();
    const ids: HarnessId[] = [
      "claude",
      "codex",
      "cursor",
      "grok",
      "opencode",
      "pi",
      "omp",
      "fx",
    ];

    expect(
      Object.fromEntries(ids.map((id) => [id, canCompactHarnessContext(id)])),
    ).toEqual({
      claude: true,
      codex: true,
      cursor: false,
      grok: true,
      opencode: true,
      pi: true,
      omp: true,
      fx: false,
    });
  });

  it("refreshes only the requested catalogs", async () => {
    const pi = vi.fn(async () => undefined);
    const claude = vi.fn(async () => undefined);
    registerHarness(stub("pi", { refreshCatalog: pi }));
    registerHarness(stub("claude", { refreshCatalog: claude }));

    await refreshHarnessCatalogs(["claude"]);

    expect(claude).toHaveBeenCalledOnce();
    expect(pi).not.toHaveBeenCalled();
  });

  it("does not spawn a catalog probe twice after a live list lands", async () => {
    const pi = vi.fn(async () => {
      setHarnessModels("pi", [
        {
          id: "pi:opus",
          harness: "pi",
          name: "Opus",
          nativeId: "anthropic/opus",
        },
      ]);
    });
    registerHarness(stub("pi", { refreshCatalog: pi }));

    await refreshHarnessCatalogs(["pi"]);
    await refreshHarnessCatalogs(["pi"]);

    expect(pi).toHaveBeenCalledOnce();
  });

  it("skips catalog refresh when no harness is in use", async () => {
    const pi = vi.fn(async () => undefined);
    registerHarness(stub("pi", { refreshCatalog: pi }));
    await refreshHarnessCatalogs([]);
    expect(pi).not.toHaveBeenCalled();
  });

  it("discovers models released while the app stays open after the catalog TTL", async () => {
    vi.useFakeTimers();
    const claude = vi.fn(async () => {
      setHarnessModels("claude", [
        {
          id: `claude:release-${claude.mock.calls.length}`,
          harness: "claude",
          name: "Live release",
        },
      ]);
    });
    registerHarness(stub("claude", { refreshCatalog: claude }));
    await refreshHarnessCatalogs(["claude"]);
    await vi.advanceTimersByTimeAsync(HARNESS_CATALOG_TTL_MS - 1);
    await refreshHarnessCatalogs(["claude"]);
    expect(claude).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(1);
    await refreshHarnessCatalogs(["claude"]);
    expect(claude).toHaveBeenCalledTimes(2);
    expect(modelsFor("claude")[0].id).toBe("claude:release-2");
  });

  it("shares one in-flight request between startup, focus and manual refresh", async () => {
    let finish!: () => void;
    const claude = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finish = () => {
            setHarnessModels("claude", [
              {
                id: "claude:new",
                harness: "claude",
                name: "New",
              },
            ]);
            resolve();
          };
        }),
    );
    registerHarness(stub("claude", { refreshCatalog: claude }));
    const startup = refreshHarnessCatalogs(["claude"]);
    const focus = refreshHarnessCatalogs(["claude"]);
    const manual = refreshHarnessCatalogs(["claude"], { force: true });
    await Promise.resolve();
    expect(claude).toHaveBeenCalledOnce();
    finish();
    await Promise.all([startup, focus, manual]);
    expect(modelsFor("claude")[0].id).toBe("claude:new");
  });

  it("keeps a loaded catalog after failure and retries without repeated probes on every focus", async () => {
    vi.useFakeTimers();
    const previous = [
      {
        id: "claude:previous",
        harness: "claude" as const,
        name: "Previous",
      },
    ];
    const claude = vi.fn(async () => {
      if (claude.mock.calls.length === 1) setHarnessModels("claude", previous);
      else if (claude.mock.calls.length === 2) throw new Error("Offline");
      else
        setHarnessModels("claude", [
          {
            id: "claude:next",
            harness: "claude",
            name: "Next",
          },
        ]);
    });
    registerHarness(stub("claude", { refreshCatalog: claude }));
    await refreshHarnessCatalogs(["claude"]);
    await vi.advanceTimersByTimeAsync(HARNESS_CATALOG_TTL_MS);
    await refreshHarnessCatalogs(["claude"]);
    expect(modelsFor("claude")).toBe(previous);
    await refreshHarnessCatalogs(["claude"]);
    await vi.advanceTimersByTimeAsync(HARNESS_CATALOG_RETRY_MS - 1);
    await refreshHarnessCatalogs(["claude"]);
    expect(claude).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    await refreshHarnessCatalogs(["claude"]);
    expect(claude).toHaveBeenCalledTimes(3);
    expect(modelsFor("claude")[0].id).toBe("claude:next");
  });

  it("retries a swallowed discovery failure and lets manual refresh bypass its backoff", async () => {
    const claude = vi.fn(async () => undefined);
    registerHarness(stub("claude", { refreshCatalog: claude }));
    await refreshHarnessCatalogs(["claude"]);
    await refreshHarnessCatalogs(["claude"]);
    expect(claude).toHaveBeenCalledOnce();
    await expect(
      refreshHarnessCatalogs(["claude"], { force: true }),
    ).rejects.toThrow("did not return a model list");
    expect(claude).toHaveBeenCalledTimes(2);
  });

  it("surfaces a shared failure to the manual caller while background callers settle quietly", async () => {
    const claude = vi.fn(async () => {
      throw new Error("Provider unavailable");
    });
    registerHarness(stub("claude", { refreshCatalog: claude }));
    const background = refreshHarnessCatalogs(["claude"]);
    const manual = refreshHarnessCatalogs(["claude"], { force: true });
    await expect(manual).rejects.toThrow("Provider unavailable");
    await expect(background).resolves.toBeUndefined();
    expect(claude).toHaveBeenCalledOnce();
  });

  it("explicitly refreshes only the requested loaded catalog and keeps automatic suppression", async () => {
    const previous = [
      { id: "claude:previous", harness: "claude" as const, name: "Previous" },
    ];
    const next = [
      { id: "claude:new", harness: "claude" as const, name: "New" },
    ];
    setHarnessModels("claude", previous);
    const claude = vi.fn(async () => setHarnessModels("claude", next));
    const pi = vi.fn(async () => undefined);
    registerHarness(stub("claude", { refreshCatalog: claude }));
    registerHarness(stub("pi", { refreshCatalog: pi }));

    await refreshHarnessCatalogs(["claude"]);
    expect(claude).not.toHaveBeenCalled();
    await refreshHarnessCatalogs(["claude"], { force: true });
    expect(modelsFor("claude")).toBe(next);
    await refreshHarnessCatalogs(["claude"]);
    expect(claude).toHaveBeenCalledOnce();
    expect(pi).not.toHaveBeenCalled();
  });

  it("reports explicit refresh failure and retains the existing catalog", async () => {
    const previous = [
      { id: "claude:previous", harness: "claude" as const, name: "Previous" },
    ];
    setHarnessModels("claude", previous);
    registerHarness(
      stub("claude", {
        refreshCatalog: async () => {
          throw new Error("Provider unavailable");
        },
      }),
    );
    await expect(
      refreshHarnessCatalogs(["claude"], { force: true }),
    ).rejects.toThrow("Provider unavailable");
    expect(modelsFor("claude")).toBe(previous);
  });

  it("reports loaders that swallow failure without publishing a catalog", async () => {
    const previous = [
      { id: "claude:previous", harness: "claude" as const, name: "Previous" },
    ];
    setHarnessModels("claude", previous);
    registerHarness(stub("claude", { refreshCatalog: async () => undefined }));
    await expect(
      refreshHarnessCatalogs(["claude"], { force: true }),
    ).rejects.toThrow("did not return a model list");
    expect(modelsFor("claude")).toBe(previous);
  });

  it("does not mistake a different provider's publication for refresh success", async () => {
    registerHarness(
      stub("claude", {
        refreshCatalog: async () => {
          setHarnessModels("pi", [
            { id: "pi:other", harness: "pi", name: "Other" },
          ]);
        },
      }),
    );
    await expect(
      refreshHarnessCatalogs(["claude"], { force: true }),
    ).rejects.toThrow("did not return a model list");
  });

  it("accepts a freshly published identical list and rejects unsupported explicit refresh", async () => {
    const model = {
      id: "claude:current",
      harness: "claude" as const,
      name: "Current",
    };
    setHarnessModels("claude", [model]);
    registerHarness(
      stub("claude", {
        refreshCatalog: async () => setHarnessModels("claude", [model]),
      }),
    );
    await expect(
      refreshHarnessCatalogs(["claude"], { force: true }),
    ).resolves.toBeUndefined();
    registerHarness(stub("claude"));
    await expect(
      refreshHarnessCatalogs(["claude"], { force: true }),
    ).rejects.toThrow("does not support model refresh");
  });

  it("parks a live child a few minutes after the turn settles", async () => {
    vi.useFakeTimers();
    const stopSession = vi.fn(async () => undefined);
    registerHarness(stub("cursor", { stopSession }));

    await sendHarnessTurn({
      harness: "cursor",
      sessionId: "s1",
      cwd: "/tmp",
      model: "cursor:composer-2.5",
      text: "hi",
      runtimeMode: "supervised",
      onEvent: () => undefined,
    });

    expect(stopSession).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(HARNESS_IDLE_PARK_MS - 1);
    expect(stopSession).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(stopSession).toHaveBeenCalledWith("s1");
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { modelsFor, resetHarnessModelOverlays, setHarnessModels } from "../models";

const child = vi.hoisted(() => ({
  onLine: undefined as ((line: string) => void) | undefined,
  spawn: vi.fn(),
  exec: vi.fn(),
  kill: vi.fn(),
  rows: [] as unknown[],
}));

vi.mock("../fs", () => ({ homeDir: async () => "/home/test" }));
vi.mock("./child", () => ({
  resolveClaudeBinary: async () => ({ path: "/fake/claude" }),
  execChild: child.exec,
  spawnChild: child.spawn,
  killChild: child.kill,
  unwatchChild: () => { child.onLine = undefined; },
  watchChild: (_id: string, onLine: (line: string) => void) => {
    child.onLine = onLine;
  },
  writeChild: async (_id: string, line: string) => {
    const message = JSON.parse(line);
    child.onLine?.(JSON.stringify({
      type: "control_response",
      response: {
        subtype: "success",
        request_id: message.request_id,
        response: message.request.subtype === "list_models" ? { models: child.rows } : {},
      },
    }));
  },
}));

import { refreshClaudeCatalog } from "./claudeCatalog";

beforeEach(() => {
  resetHarnessModelOverlays();
  child.spawn.mockReset().mockResolvedValue(undefined);
  child.exec.mockReset().mockResolvedValue("2.1.267 (Claude Code)");
  child.kill.mockReset().mockResolvedValue(undefined);
  child.rows = [];
  child.onLine = undefined;
  vi.spyOn(console, "debug").mockImplementation(() => {});
});

afterEach(() => {
  resetHarnessModelOverlays();
  vi.restoreAllMocks();
});

describe("Claude catalog discovery", () => {
  it("uses the version-gated fallback when initial live discovery fails", async () => {
    child.spawn.mockRejectedValueOnce(new Error("CLI unavailable"));
    await refreshClaudeCatalog();
    expect(child.exec).toHaveBeenCalledWith("/fake/claude", ["--version"], "/home/test");
    expect(modelsFor("claude").some((model) => model.nativeId === "claude-opus-5")).toBe(true);
    expect(modelsFor("claude").some((model) => model.nativeId === "claude-opus-5-5")).toBe(false);
  });

  it.each(["error", "empty"])(
    "preserves a previous live catalog after %s discovery and permits a successful retry",
    async (failure) => {
      const previous = [{
        id: "claude:private-model",
        harness: "claude" as const,
        name: "Organization model",
        nativeId: "custom-deployment",
      }];
      setHarnessModels("claude", previous);
      if (failure === "error") child.spawn.mockRejectedValueOnce(new Error("Temporary failure"));
      await refreshClaudeCatalog();
      expect(modelsFor("claude")).toBe(previous);
      expect(child.exec).not.toHaveBeenCalled();

      child.rows = [{
        value: "opus[1m]",
        resolvedModel: "claude-opus-5-5[1m]",
        displayName: "Opus (1M context)",
        supportsEffort: true,
        supportedEffortLevels: ["low", "medium", "high", "xhigh", "max"],
      }];
      await refreshClaudeCatalog();
      expect(modelsFor("claude")).not.toBe(previous);
      expect(modelsFor("claude")[0]).toMatchObject({
        name: "Opus 5.5",
        nativeId: "opus[1m]",
        contextWindow: 1_000_000,
      });
      expect(child.spawn).toHaveBeenCalledTimes(2);
      expect(child.kill).toHaveBeenCalledTimes(2);
      expect(child.exec).not.toHaveBeenCalled();
    },
  );
});

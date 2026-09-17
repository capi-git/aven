import { describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { prepareSessionPipViewMetadata } from "./sessionPipViewMetadata";
import {
  canCompactHarnessContext,
  getHarness,
  isLiveHarness,
  refreshHarnessCatalogs,
} from "./harness/registry";
import { findModel, getModelSnapshot } from "./models";
import { HARNESSES } from "./session";
import type { NativeCommand } from "./harness/nativeCommands";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
  convertFileSrc: vi.fn(),
}));

describe("floating session view metadata", () => {
  it("registers capabilities without native calls and disables child catalog probes", async () => {
    prepareSessionPipViewMetadata({});
    expect(HARNESSES.every(isLiveHarness)).toBe(true);
    expect(canCompactHarnessContext("codex")).toBe(true);
    expect(canCompactHarnessContext("cursor")).toBe(false);
    await refreshHarnessCatalogs(HARNESSES);
    expect(invoke).not.toHaveBeenCalled();
    expect(
      HARNESSES.every((harness) => getHarness(harness)?.refreshCatalog == null),
    ).toBe(true);
  });

  it("applies the owner's model settings once per catalog revision", () => {
    const catalog = [
      {
        id: "codex:owner-model",
        harness: "codex" as const,
        name: "Owner model",
        settings: [
          {
            id: "effort",
            label: "Reasoning",
            kind: "select" as const,
            value: "high",
            options: [{ value: "high", label: "High" }],
          },
        ],
      },
    ];
    prepareSessionPipViewMetadata({ catalog, catalogVersion: 1 });
    expect(findModel("codex:owner-model")?.settings).toEqual(
      catalog[0].settings,
    );
    const version = getModelSnapshot();
    prepareSessionPipViewMetadata({ catalog, catalogVersion: 1 });
    expect(getModelSnapshot()).toBe(version);
    expect(invoke).not.toHaveBeenCalled();
  });

  it("mirrors native slash suggestions without starting Pi or OMP command probes", async () => {
    const commands: NativeCommand[] = [
      { name: "help", description: "Help", invocation: "help", source: "omp" },
    ];
    prepareSessionPipViewMetadata({ nativeCommands: commands });
    const provider = getHarness("omp")!.commands!;
    expect(provider.rawSlashCommands).toBe(true);
    const receive = vi.fn();
    const cleanup = provider.subscribe!(
      { cwd: "/project", sessionId: "s" },
      receive,
    );
    expect(receive).toHaveBeenCalledWith(commands);
    expect(
      await provider.discover({ cwd: "/project", sessionId: "s" }),
    ).toEqual(commands);
    expect(
      await getHarness("pi")!.commands!.discover({ cwd: "/project" }),
    ).toEqual([]);
    prepareSessionPipViewMetadata({ nativeCommands: [] });
    expect(receive).toHaveBeenLastCalledWith([]);
    cleanup();
    expect(invoke).not.toHaveBeenCalled();
  });
});

import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
vi.mock("./harness/availability", () => ({
  isHarnessAvailable: vi.fn((id: string) => id === "codex" || id === "claude"),
  probeHarnessAvailability: vi.fn(async () => {}),
}));
vi.mock("./harness/registry", () => ({
  refreshHarnessCatalogs: vi.fn(async () => {}),
}));
import {
  discoverOrchestrationSettings,
  orchestrationWorkerChoices,
} from "./orchestrationCatalog";
import {
  isHarnessAvailable,
  probeHarnessAvailability,
} from "./harness/availability";
import { refreshHarnessCatalogs } from "./harness/registry";
import {
  resetHarnessModelOverlays,
  setHarnessModels,
  savePickerProviderVisible,
  savePickerModelVisible,
} from "./models";

beforeEach(() => {
  const values = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  resetHarnessModelOverlays();
  vi.clearAllMocks();
  vi.mocked(isHarnessAvailable).mockImplementation(
    (id) => id === "codex" || id === "claude",
  );
});

describe("automatic orchestration catalog", () => {
  it("discovers every installed harness and reads its refreshed models without a user-selected pool", async () => {
    vi.mocked(refreshHarnessCatalogs).mockImplementationOnce(async () => {
      setHarnessModels("codex", [
        { id: "codex:live", harness: "codex", name: "Live Codex" },
      ]);
    });
    const settings = await discoverOrchestrationSettings();
    expect(probeHarnessAvailability).toHaveBeenCalledOnce();
    expect(refreshHarnessCatalogs).toHaveBeenCalledWith(["claude", "codex"]);
    expect(settings.choices).toContainEqual({
      harness: "codex",
      model: "codex:live",
      name: "Live Codex",
    });
    expect(settings.choices.some((choice) => choice.harness === "claude")).toBe(
      true,
    );
    expect(settings.choices.some((choice) => choice.harness === "cursor")).toBe(
      false,
    );
    expect(settings.maxWorkers).toBe(2);
  });
  it("does not truncate catalogs at the former manual-selection limit", async () => {
    setHarnessModels(
      "codex",
      Array.from({ length: 80 }, (_, i) => ({
        id: `codex:${i}`,
        harness: "codex",
        name: `Model ${i}`,
      })),
    );
    const settings = await discoverOrchestrationSettings();
    expect(
      settings.choices.filter((choice) => choice.harness === "codex"),
    ).toHaveLength(80);
  });
  it("never refreshes or offers providers disabled in CoveCode settings", async () => {
    setHarnessModels("codex", [
      { id: "codex:enabled", harness: "codex", name: "Enabled" },
    ]);
    savePickerProviderVisible("claude", false);
    const settings = await discoverOrchestrationSettings();
    expect(refreshHarnessCatalogs).toHaveBeenCalledExactlyOnceWith(["codex"]);
    expect(settings.choices.every((choice) => choice.harness === "codex")).toBe(
      true,
    );
    expect(
      orchestrationWorkerChoices().map((choice) => choice.harness),
    ).toEqual(["codex"]);
  });

  it("rechecks disabled individual models and provider visibility before worker dispatch", async () => {
    setHarnessModels("codex", [
      { id: "codex:shown", harness: "codex", name: "Shown" },
      { id: "codex:hidden", harness: "codex", name: "Hidden" },
    ]);
    savePickerModelVisible("codex:hidden", false);
    const settings = await discoverOrchestrationSettings();
    expect(
      settings.choices
        .filter((choice) => choice.harness === "codex")
        .map((choice) => choice.model),
    ).toEqual(["codex:shown"]);
    savePickerProviderVisible("codex", false);
    expect(
      orchestrationWorkerChoices().some((choice) => choice.harness === "codex"),
    ).toBe(false);
    savePickerProviderVisible("claude", false);
    await expect(discoverOrchestrationSettings()).rejects.toThrow(
      "No worker models are available",
    );
  });

  it("fails planning clearly when no harness is available", async () => {
    vi.mocked(isHarnessAvailable).mockReturnValue(false);
    await expect(discoverOrchestrationSettings()).rejects.toThrow(
      "No worker models are available",
    );
  });
});

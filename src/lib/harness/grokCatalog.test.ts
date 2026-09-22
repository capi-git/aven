import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  modelsFor,
  resetHarnessModelOverlays,
  setHarnessModels,
  type AgentModel,
} from "../models";
import { refreshGrokCatalog } from "./grokCatalog";
import { fallbackGrokModels } from "./grokProtocol";
import { refreshHarnessCatalogs, registerHarness } from "./registry";

const mocks = vi.hoisted(() => ({
  request: vi.fn(),
  exec: vi.fn(),
}));

vi.mock("../fs", () => ({ homeDir: async () => "/home/test" }));
vi.mock("./child", () => ({
  resolveGrokBinary: async () => ({ path: "/fake/grok" }),
  spawnChild: async () => undefined,
  killChild: async () => undefined,
  unwatchChild: () => undefined,
  watchChild: () => undefined,
  execChild: mocks.exec,
}));
vi.mock("./acp", () => ({
  AcpClient: class {
    request = mocks.request;
    close() {}
    pushLine() {}
    async respond() {}
  },
}));

beforeEach(() => {
  resetHarnessModelOverlays();
  mocks.request.mockReset().mockRejectedValue(new Error("ACP unavailable"));
  mocks.exec.mockReset().mockRejectedValue(new Error("CLI unavailable"));
  vi.spyOn(console, "debug").mockImplementation(() => {});
  registerHarness({
    id: "grok",
    live: true,
    async sendTurn() {},
    async steerTurn() {},
    async cancelTurn() {},
    respondApproval() {},
    async stopSession() {},
    async forgetSession() {},
    bindSession() {},
    refreshCatalog: refreshGrokCatalog,
  });
});

afterEach(() => {
  resetHarnessModelOverlays();
  vi.restoreAllMocks();
});

const discovered: AgentModel[] = [
  {
    id: "grok:account-model",
    harness: "grok",
    name: "Account model",
    nativeId: "account-model",
  },
];

describe("Grok catalog refresh", () => {
  it("retains the built-in fallback for first discovery when both probes fail", async () => {
    await refreshGrokCatalog();
    expect(modelsFor("grok")).toEqual(fallbackGrokModels());
  });

  it.each(["discovered", "initial fallback"])(
    "keeps the %s catalog and reports explicit refresh failure when both probes fail",
    async (source) => {
      const previous =
        source === "discovered" ? discovered : fallbackGrokModels();
      setHarnessModels("grok", previous);
      await expect(
        refreshHarnessCatalogs(["grok"], { force: true }),
      ).rejects.toThrow("did not return a model list");
      expect(modelsFor("grok")).toBe(previous);
    },
  );

  it("accepts real CLI discovery after ACP failure", async () => {
    setHarnessModels("grok", discovered);
    mocks.exec.mockResolvedValueOnce("Available models:\n  * new-grok-model\n");
    await refreshHarnessCatalogs(["grok"], { force: true });
    expect(modelsFor("grok").map((model) => model.nativeId)).toEqual([
      "new-grok-model",
    ]);
    expect(mocks.exec).toHaveBeenCalledWith(
      "/fake/grok",
      ["models"],
      "/home/test",
    );
  });

  it("replaces an existing catalog with real ACP models without running the CLI fallback", async () => {
    setHarnessModels("grok", discovered);
    mocks.request.mockResolvedValueOnce({
      availableModels: [{ modelId: "new-grok-model", name: "New model" }],
    });
    await refreshHarnessCatalogs(["grok"], { force: true });
    expect(modelsFor("grok").map((model) => model.nativeId)).toEqual([
      "new-grok-model",
    ]);
    expect(mocks.exec).not.toHaveBeenCalled();
  });
});

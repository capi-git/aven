import { describe, expect, it } from "vitest";
import {
  HARNESS_IDS,
  harnessDescriptor,
  pickHarnessDefaultModel,
} from "./descriptors";
import {
  HARNESSES,
  HARNESS_TITLE,
  harnessSupportsAttachments,
} from "../session";
import {
  DEFAULT_MODEL_ID,
  defaultModelId,
  setHarnessModels,
  resetHarnessModelOverlays,
} from "../models";

describe("harness descriptors", () => {
  it("provides every provider's facts in the existing order before registration", () => {
    expect(HARNESS_IDS).toEqual([
      "claude",
      "codex",
      "cursor",
      "grok",
      "opencode",
      "pi",
      "omp",
      "fx",
    ]);
    expect(HARNESSES).toBe(HARNESS_IDS);
    expect(HARNESS_TITLE).toEqual({
      claude: "Claude Code",
      codex: "Codex",
      cursor: "Cursor",
      grok: "Grok Build",
      opencode: "OpenCode",
      pi: "Pi",
      omp: "omp",
      fx: "fx",
    });
    expect(DEFAULT_MODEL_ID).toEqual({
      claude: "claude:sonnet-5",
      codex: "",
      cursor: "cursor:composer-2.5",
      grok: "grok:grok-4.6",
      opencode: "opencode:glm-5",
      pi: "pi:default",
      omp: "omp:default",
      fx: "fx:zai/glm-5.2-fast",
    });
    for (const id of HARNESS_IDS) {
      const descriptor = harnessDescriptor(id);
      expect(descriptor.title).toBeTruthy();
      expect(descriptor.cli.name).toBeTruthy();
      expect(descriptor.cli.resolve).toMatch(/^resolve.+Binary$/);
      expect(descriptor.setup.description).toBeTruthy();
      expect(descriptor.icon.key).toBe(id);
      expect(pickHarnessDefaultModel(id, [])).toBe(DEFAULT_MODEL_ID[id]);
    }
  });

  it("preserves provider capability gating", () => {
    expect(
      HARNESS_IDS.filter((id) => harnessDescriptor(id).supportsAccessMode),
    ).toEqual(HARNESS_IDS.filter((id) => id !== "fx"));
    expect(HARNESS_IDS.filter(harnessSupportsAttachments)).toEqual(
      HARNESS_IDS.filter((id) => id !== "fx"),
    );
    expect(
      HARNESS_IDS.filter((id) => harnessDescriptor(id).automaticCatalog),
    ).toEqual(["claude", "codex"]);
    expect(
      HARNESS_IDS.filter((id) => harnessDescriptor(id).automaticToolUpdates),
    ).toEqual(["claude", "codex"]);
    expect(
      HARNESS_IDS.filter((id) => harnessDescriptor(id).connections),
    ).toEqual(["claude", "codex"]);
    expect(HARNESS_IDS.filter((id) => harnessDescriptor(id).usage)).toEqual([
      "claude",
      "codex",
    ]);
    expect(
      HARNESS_IDS.filter((id) => harnessDescriptor(id).setup.guided),
    ).toEqual(["claude", "codex"]);
    expect(
      HARNESS_IDS.filter((id) => harnessDescriptor(id).setup.supportsTest),
    ).toEqual(["claude"]);
    expect(
      HARNESS_IDS.filter((id) => harnessDescriptor(id).icon.monochrome),
    ).toEqual(["cursor", "grok", "opencode", "pi", "fx"]);
    expect(harnessDescriptor("claude").connections?.supportsScope).toBe(true);
    expect(harnessDescriptor("codex").connections?.supportsScope).toBe(false);
    expect(harnessDescriptor("opencode").hiddenModelSettings).toEqual([
      "agent",
    ]);
  });

  it("prefers Claude's Sonnet generation, then alias, then bundled id", () => {
    const unrelated = { id: "first", nativeId: "unrelated" };
    const bundled = { id: "claude:sonnet-5" };
    const alias = { id: "alias", nativeId: "sonnet" };
    const versioned = { id: "versioned", nativeId: "claude-sonnet-5" };
    expect(
      pickHarnessDefaultModel("claude", [unrelated, bundled, alias, versioned]),
    ).toBe("versioned");
    expect(pickHarnessDefaultModel("claude", [unrelated, bundled, alias])).toBe(
      "alias",
    );
    expect(pickHarnessDefaultModel("claude", [unrelated, bundled])).toBe(
      bundled.id,
    );
    expect(pickHarnessDefaultModel("claude", [unrelated])).toBe("first");
  });

  it("prefers Cursor Composer, then the first default or auto in catalog order", () => {
    const first = { id: "first" };
    const fallbackId = { id: "cursor:composer-2.5" };
    const auto = { id: "auto", nativeId: "auto" };
    const configured = { id: "configured", nativeId: "default" };
    const composer = { id: "composer", nativeId: "composer-2.5" };
    expect(
      pickHarnessDefaultModel("cursor", [first, auto, configured, composer]),
    ).toBe("composer");
    expect(pickHarnessDefaultModel("cursor", [first, auto, configured])).toBe(
      "auto",
    );
    expect(pickHarnessDefaultModel("cursor", [first, configured, auto])).toBe(
      "configured",
    );
    expect(pickHarnessDefaultModel("cursor", [first, fallbackId])).toBe(
      "first",
    );
  });

  it("uses Codex's first catalog model and its empty pre-catalog default", () => {
    expect(
      pickHarnessDefaultModel("codex", [{ id: "first" }, { id: "" }]),
    ).toBe("first");
    expect(pickHarnessDefaultModel("codex", [])).toBe("");
  });

  it("prefers Grok's native model, then its bundled id", () => {
    expect(
      pickHarnessDefaultModel("grok", [
        { id: "first" },
        { id: DEFAULT_MODEL_ID.grok },
        { id: "native", nativeId: "grok-4.6" },
      ]),
    ).toBe("native");
    expect(
      pickHarnessDefaultModel("grok", [
        { id: "first" },
        { id: DEFAULT_MODEL_ID.grok },
      ]),
    ).toBe(DEFAULT_MODEL_ID.grok);
  });

  it("preserves fx's priority order independently of catalog order", () => {
    const nativeIds = [
      "zai/glm-5.2-fast",
      "zai/glm-5.2",
      "zai/glm-4.7-flash",
      "zai/glm-4.7",
      "openai/gpt-5.2",
    ];
    const models = nativeIds.map((nativeId, index) => ({
      id: `choice-${index}`,
      nativeId,
    }));
    for (let index = 0; index < models.length; index += 1)
      expect(pickHarnessDefaultModel("fx", models.slice(index).reverse())).toBe(
        models[index]!.id,
      );
    expect(
      pickHarnessDefaultModel("fx", [
        { id: "first" },
        { id: DEFAULT_MODEL_ID.fx },
      ]),
    ).toBe(DEFAULT_MODEL_ID.fx);
  });

  it("prefers bundled defaults for OpenCode, Pi and omp, then catalog order", () => {
    for (const id of ["opencode", "pi", "omp"] as const) {
      expect(
        pickHarnessDefaultModel(id, [
          { id: "first" },
          { id: DEFAULT_MODEL_ID[id] },
        ]),
      ).toBe(DEFAULT_MODEL_ID[id]);
      expect(pickHarnessDefaultModel(id, [{ id: "first" }])).toBe("first");
    }
  });

  it("uses the same descriptor policy when publishing live catalogs", () => {
    try {
      setHarnessModels("cursor", [
        { id: "cursor:first", harness: "cursor", name: "First" },
        {
          id: "cursor:auto",
          harness: "cursor",
          name: "Auto",
          nativeId: "auto",
        },
      ]);
      expect(defaultModelId("cursor")).toBe("cursor:auto");
    } finally {
      resetHarnessModelOverlays();
    }
  });
});

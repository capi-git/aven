import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { HarnessId } from "./session";
import {
  CLAUDE_OPUS_5_5_MODEL,
  coerceModelPickerTab,
  defaultModelSettings,
  defaultModelId,
  findModel,
  findPickerModel,
  nativeModelId,
  resolveModel,
  isPickerModelVisible,
  loadHiddenPickerModels,
  pickerModelsFor,
  loadFavoriteModels,
  saveFavoriteModels,
  savePickerModelVisible,
  showAllPickerModels,
  subscribePickerVisibility,
  getPickerVisibilitySnapshot,
  defaultSessionChoice,
  hasLiveCatalog,
  isPickerProviderVisible,
  loadDefaultModels,
  loadHiddenPickerProviders,
  loadLastModelChoice,
  loadLastModelSettings,
  mergeModelSettings,
  modelPickerTabs,
  preferredModelId,
  preferredModelSettings,
  resetHarnessModelOverlays,
  saveDefaultModel,
  saveLastModelChoice,
  saveLastModelSettings,
  savePickerProviderVisible,
  setHarnessModels,
  showProviderInModelPicker,
  stepModelPickerTab,
  type AgentModel,
} from "./models";

const opus: AgentModel = {
  id: "claude:opus-5",
  harness: "claude",
  name: "Opus 5",
  settings: [
    {
      id: "effort",
      label: "Reasoning",
      kind: "select",
      value: "high",
      options: [
        { value: "high", label: "High" },
        { value: "xhigh", label: "Extra High" },
        { value: "max", label: "Max" },
      ],
    },
    {
      id: "fast",
      label: "Fast",
      kind: "toggle",
      value: "false",
      options: [
        { value: "true", label: "On" },
        { value: "false", label: "Off" },
      ],
    },
  ],
};

const haiku: AgentModel = {
  id: "claude:haiku-4.5",
  harness: "claude",
  name: "Haiku 4.5",
  settings: [
    {
      id: "thinking",
      label: "Thinking",
      kind: "toggle",
      value: "false",
      options: [
        { value: "true", label: "On" },
        { value: "false", label: "Off" },
      ],
    },
  ],
};

function mockLocalStorage() {
  const data = new Map<string, string>();
  const storage = {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => {
      data.set(key, value);
    },
    removeItem: (key: string) => {
      data.delete(key);
    },
    clear: () => {
      data.clear();
    },
    key: (index: number) => [...data.keys()][index] ?? null,
    get length() {
      return data.size;
    },
  };
  Object.defineProperty(globalThis, "localStorage", {
    value: storage,
    configurable: true,
  });
}

describe("model settings memory", () => {
  beforeEach(() => {
    mockLocalStorage();
  });

  afterEach(() => {
    mockLocalStorage();
  });

  it("keeps valid current values when merging onto a model", () => {
    expect(mergeModelSettings(opus, { effort: "xhigh", fast: "true" })).toEqual(
      { effort: "xhigh", fast: "true" },
    );
  });

  it("starts Opus 5.5 at medium without changing saved effort or fast choices", () => {
    expect(defaultModelSettings(CLAUDE_OPUS_5_5_MODEL)).toEqual({
      effort: "medium", fast: "false",
    });
    expect(preferredModelSettings(CLAUDE_OPUS_5_5_MODEL)).toEqual({
      effort: "medium", fast: "false",
    });
    saveLastModelSettings({ effort: "xhigh", fast: "true", context: "200k", thinking: "false" });
    expect(preferredModelSettings(CLAUDE_OPUS_5_5_MODEL)).toEqual({
      effort: "xhigh", fast: "true",
    });
    expect(loadLastModelSettings()).toEqual({
      effort: "xhigh", fast: "true", context: "200k", thinking: "false",
    });
    expect(preferredModelSettings(opus)).toEqual({ effort: "xhigh", fast: "true" });
  });

  it("drops values the new model does not support", () => {
    expect(
      mergeModelSettings(haiku, { effort: "xhigh", fast: "true" }),
    ).toEqual({ thinking: "false" });
  });

  it("maps extra-high onto Claude's xhigh", () => {
    expect(mergeModelSettings(opus, { effort: "extra-high" })).toEqual({
      effort: "xhigh",
      fast: "false",
    });
  });

  it("remembers extra-high and fast across models that support them", () => {
    saveLastModelSettings({ effort: "xhigh", fast: "true" });
    expect(preferredModelSettings(opus)).toEqual({
      effort: "xhigh",
      fast: "true",
    });
    expect(preferredModelSettings(haiku)).toEqual({ thinking: "false" });
  });

  it("merges newly saved settings into previously stored ones", () => {
    saveLastModelSettings({ effort: "xhigh", fast: "true" });
    saveLastModelSettings({ thinking: "true" });
    expect(loadLastModelSettings()).toEqual({
      effort: "xhigh",
      fast: "true",
      thinking: "true",
    });
  });

  it("applies stored preferences over a session's current values", () => {
    saveLastModelSettings({ effort: "xhigh", fast: "true" });
    expect(
      preferredModelSettings(opus, { effort: "high", fast: "false" }),
    ).toEqual({
      effort: "xhigh",
      fast: "true",
    });
  });

  it("fill mode keeps stored preferences when the session still has defaults", () => {
    saveLastModelSettings({ effort: "xhigh", fast: "true" });
    saveLastModelSettings({ effort: "high", fast: "false" }, "fill");
    expect(loadLastModelSettings()).toEqual({
      effort: "xhigh",
      fast: "true",
    });
  });

  it("fill mode records session values that have not been stored yet", () => {
    saveLastModelSettings({ effort: "xhigh" }, "fill");
    expect(loadLastModelSettings()).toEqual({ effort: "xhigh" });
  });

  it("uses the current session when nothing has been stored yet", () => {
    expect(
      preferredModelSettings(opus, { effort: "xhigh", fast: "true" }),
    ).toEqual({ effort: "xhigh", fast: "true" });
  });
});

describe("provider defaults", () => {
  beforeEach(() => {
    mockLocalStorage();
  });

  afterEach(() => {
    mockLocalStorage();
  });

  it("remembers a model per provider without changing the default provider", () => {
    saveLastModelChoice("cursor", "cursor:grok-4.6");
    saveDefaultModel("claude", "claude:opus-5");
    saveDefaultModel("opencode", "opencode:glm-5");
    expect(loadLastModelChoice()).toEqual({
      harness: "cursor",
      model: "cursor:grok-4.6",
    });
    expect(loadDefaultModels()).toEqual({
      cursor: "cursor:grok-4.6",
      claude: "claude:opus-5",
      opencode: "opencode:glm-5",
    });
    expect(preferredModelId("claude")).toBe("claude:opus-5");
    expect(preferredModelId("cursor")).toBe("cursor:grok-4.6");
  });

  it("falls back to lastModel for the default provider when no map exists", () => {
    localStorage.setItem(
      "monocode.lastModel",
      JSON.stringify({ harness: "cursor", model: "cursor:grok-4.6" }),
    );
    expect(preferredModelId("cursor")).toBe("cursor:grok-4.6");
    expect(preferredModelId("claude")).toBe(defaultModelId("claude"));
  });

  it("uses the saved default provider and its model for new sessions", () => {
    saveLastModelChoice("claude", "claude:opus-5");
    expect(defaultSessionChoice()).toEqual({
      harness: "claude",
      model: "claude:opus-5",
    });
  });

  it("keeps catalog defaults when nothing is saved", () => {
    expect(defaultSessionChoice()).toEqual({
      harness: "cursor",
      model: defaultModelId("cursor"),
    });
  });
});

describe("model picker tabs", () => {
  const available = (id: HarnessId) =>
    id === "claude" || id === "fx" || id === "cursor";

  it("starts with favorites then installed providers", () => {
    expect(modelPickerTabs(available)).toEqual([
      "favorites",
      "claude",
      "cursor",
      "fx",
    ]);
  });

  it("wraps left and right across favorites and providers", () => {
    expect(stepModelPickerTab("favorites", 1, available)).toBe("claude");
    expect(stepModelPickerTab("claude", 1, available)).toBe("cursor");
    expect(stepModelPickerTab("fx", 1, available)).toBe("favorites");
    expect(stepModelPickerTab("favorites", -1, available)).toBe("fx");
  });

  it("treats an unavailable current tab as the start of the list", () => {
    expect(stepModelPickerTab("pi", 1, available)).toBe("claude");
  });

  it("falls back to favorites when the current tab is hidden", () => {
    expect(coerceModelPickerTab("pi", available)).toBe("favorites");
    expect(coerceModelPickerTab("cursor", available)).toBe("cursor");
    expect(coerceModelPickerTab("favorites", available)).toBe("favorites");
  });
});

describe("picker provider visibility", () => {
  beforeEach(mockLocalStorage);
  afterEach(mockLocalStorage);

  it("shows every provider until the user hides one", () => {
    expect(loadHiddenPickerProviders()).toEqual([]);
    expect(isPickerProviderVisible("pi")).toBe(true);
    savePickerProviderVisible("pi", false);
    savePickerProviderVisible("omp", false);
    expect(isPickerProviderVisible("pi")).toBe(false);
    expect(isPickerProviderVisible("omp")).toBe(false);
    expect(isPickerProviderVisible("claude")).toBe(true);
    expect(loadHiddenPickerProviders()).toEqual(["pi", "omp"]);
    savePickerProviderVisible("pi", true);
    expect(isPickerProviderVisible("pi")).toBe(true);
    expect(loadHiddenPickerProviders()).toEqual(["omp"]);
  });

  it("omits hidden providers even before an install probe", () => {
    savePickerProviderVisible("fx", false);
    expect(showProviderInModelPicker("fx", true, false)).toBe(false);
    expect(showProviderInModelPicker("claude", true, false)).toBe(true);
  });

  it("omits uninstalled providers after the probe, keeps them before", () => {
    expect(showProviderInModelPicker("pi", false, false)).toBe(true);
    expect(showProviderInModelPicker("pi", false, true)).toBe(false);
    expect(showProviderInModelPicker("pi", true, true)).toBe(true);
  });
});

describe("individual model visibility", () => {
  beforeEach(mockLocalStorage);
  afterEach(() => {
    resetHarnessModelOverlays();
    mockLocalStorage();
  });

  it("hides a model from choices while preserving its existing session identity and favorites", () => {
    saveFavoriteModels([opus.id, haiku.id]);
    expect(savePickerModelVisible(opus.id, false)).toBe(true);
    expect(loadHiddenPickerModels()).toEqual([opus.id]);
    expect(pickerModelsFor("claude").map((model) => model.id)).not.toContain(
      opus.id,
    );
    expect(isPickerModelVisible(findModel(opus.id)!)).toBe(false);
    expect(resolveModel("claude", opus.id).id).toBe(opus.id);
    expect(loadFavoriteModels()).toEqual([opus.id, haiku.id]);
    savePickerModelVisible(opus.id, true);
    expect(isPickerModelVisible(findModel(opus.id)!)).toBe(true);
  });

  it("ignores hidden saved defaults and last-used models without erasing those preferences", () => {
    saveLastModelChoice("claude", opus.id);
    savePickerModelVisible(opus.id, false);
    expect(preferredModelId("claude")).toBe(defaultModelId("claude"));
    expect(defaultSessionChoice().model).not.toBe(opus.id);
    expect(loadLastModelChoice()?.model).toBe(opus.id);
    savePickerModelVisible(opus.id, true);
    expect(defaultSessionChoice().model).toBe(opus.id);
  });

  it("uses an enabled provider when the last-used provider is hidden", () => {
    saveLastModelChoice("claude", opus.id);
    savePickerProviderVisible("claude", false);
    const next = defaultSessionChoice();
    expect(next.harness).not.toBe("claude");
    expect(isPickerProviderVisible(next.harness)).toBe(true);
    expect(resolveModel("claude", opus.id).id).toBe(opus.id);
  });

  it("falls back to a visible model when the catalog default is hidden", () => {
    savePickerModelVisible(defaultModelId("claude"), false);
    expect(preferredModelId("claude")).toBe(pickerModelsFor("claude")[0].id);
  });

  it("preserves a saved live model before its provider catalog has loaded", () => {
    saveLastModelChoice("codex", "codex:live-model");
    expect(defaultSessionChoice()).toEqual({
      harness: "codex",
      model: "codex:live-model",
    });
  });

  it("keeps one model enabled per provider", () => {
    setHarnessModels("claude", [opus, haiku]);
    expect(savePickerModelVisible(opus.id, false)).toBe(true);
    expect(savePickerModelVisible(haiku.id, false)).toBe(false);
    expect(pickerModelsFor("claude")).toEqual([haiku]);
  });

  it("retains individual choices while their provider is disabled, and Show all resets just that provider", () => {
    savePickerModelVisible(opus.id, false);
    savePickerModelVisible("cursor:gpt-5.4", false);
    savePickerProviderVisible("claude", false);
    savePickerProviderVisible("claude", true);
    expect(isPickerModelVisible(findModel(opus.id)!)).toBe(false);
    showAllPickerModels("claude");
    expect(loadHiddenPickerModels()).toEqual(["cursor:gpt-5.4"]);
  });

  it("validates persisted preferences and retains unknown model ids for future catalogs", () => {
    localStorage.setItem(
      "monocode.hiddenPickerModels",
      JSON.stringify([opus.id, null, 5, "", opus.id, "codex:future"]),
    );
    expect(loadHiddenPickerModels()).toEqual([opus.id, "codex:future"]);
    localStorage.setItem("monocode.hiddenPickerModels", "bad json");
    expect(loadHiddenPickerModels()).toEqual([]);
  });

  it("notifies mounted pickers when individual visibility changes", () => {
    let notified = 0;
    const unsubscribe = subscribePickerVisibility(() => {
      notified += 1;
    });
    const previous = getPickerVisibilitySnapshot();
    savePickerModelVisible(opus.id, false);
    expect(notified).toBe(1);
    expect(getPickerVisibilitySnapshot()).toBeGreaterThan(previous);
    unsubscribe();
    showAllPickerModels("claude");
    expect(notified).toBe(1);
  });
});

describe("picker preferences across catalog aliases", () => {
  const sonnetId = "claude:sonnet-5";
  const liveSonnet: AgentModel = {
    id: "claude:sonnet",
    harness: "claude",
    name: "Sonnet 5",
    nativeId: "sonnet",
    pickerAliases: [sonnetId],
    pickerPreferenceId: sonnetId,
  };
  const liveHaiku: AgentModel = {
    id: "claude:haiku",
    harness: "claude",
    name: "Haiku 4.5",
    nativeId: "haiku",
    pickerAliases: ["claude:haiku-4-5", "claude:haiku-4.5"],
    pickerPreferenceId: "claude:haiku-4.5",
  };
  beforeEach(mockLocalStorage);
  afterEach(() => {
    resetHarnessModelOverlays();
    mockLocalStorage();
  });

  it("retains Opus 5.5 preferences across live aliases and exact fallback IDs", () => {
    const exactId = CLAUDE_OPUS_5_5_MODEL.id;
    const live = {
      ...CLAUDE_OPUS_5_5_MODEL,
      id: "claude:opus",
      nativeId: "opus[1m]",
      pickerPreferenceId: exactId,
      pickerAliases: ["claude:opus-5-5", exactId],
    };
    expect(nativeModelId(exactId)).toBe("claude-opus-5-5");
    saveDefaultModel("claude", "claude:opus-5");
    setHarnessModels("claude", [live, liveHaiku]);
    expect(loadDefaultModels().claude).toBe("claude:opus-5");
    saveFavoriteModels([live.id]);
    saveDefaultModel("claude", live.id);
    expect(loadFavoriteModels()).toEqual([exactId]);
    expect(loadDefaultModels().claude).toBe(exactId);
    expect(preferredModelId("claude")).toBe(live.id);
    expect(nativeModelId(live)).toBe("opus[1m]");
    expect(nativeModelId(exactId)).toBe("claude-opus-5-5");
    expect(nativeModelId("claude:opus-5-5")).toBe("claude-opus-5-5");
    expect(resolveModel("claude", exactId)).toBe(live);
    expect(resolveModel("claude", "claude:opus-5-5")).toBe(live);
    resetHarnessModelOverlays();
    expect(preferredModelId("claude")).toBe(exactId);
    expect(nativeModelId(preferredModelId("claude"))).toBe("claude-opus-5-5");
    expect(findPickerModel(loadFavoriteModels()[0])).toBe(CLAUDE_OPUS_5_5_MODEL);
  });

  it("honors an existing fallback hide when a live alias catalog replaces it", () => {
    savePickerModelVisible(sonnetId, false);
    saveLastModelChoice("claude", liveSonnet.id);
    setHarnessModels("claude", [liveSonnet, liveHaiku]);
    expect(pickerModelsFor("claude")).toEqual([liveHaiku]);
    expect(preferredModelId("claude")).toBe(liveHaiku.id);
    expect(findPickerModel(sonnetId)).toBe(liveSonnet);
    expect(resolveModel("claude", liveSonnet.id).id).toBe(liveSonnet.id);
    expect(nativeModelId(liveSonnet)).toBe("sonnet");
    expect(loadHiddenPickerModels()).toEqual([sonnetId]);
  });

  it("persists the resolved identity when hiding a live model so the restart fallback stays hidden", () => {
    setHarnessModels("claude", [liveSonnet, liveHaiku]);
    saveLastModelChoice("claude", liveSonnet.id);
    savePickerModelVisible(liveSonnet.id, false);
    expect(loadHiddenPickerModels()).toEqual([sonnetId]);
    resetHarnessModelOverlays();
    expect(
      pickerModelsFor("claude").some((model) => model.id === sonnetId),
    ).toBe(false);
    expect(defaultSessionChoice().model).not.toBe(liveSonnet.id);
    expect(defaultSessionChoice().model).not.toBe(sonnetId);
  });

  it("does not let an absent saved alias resolve to a hidden fallback before discovery", () => {
    saveLastModelChoice("claude", liveSonnet.id);
    localStorage.setItem(
      "monocode.hiddenPickerModels",
      JSON.stringify([sonnetId]),
    );
    expect(defaultSessionChoice().model).not.toBe(liveSonnet.id);
    expect(defaultSessionChoice().model).not.toBe(sonnetId);
  });

  it("reenabling a live alias clears the old hidden fallback preference", () => {
    savePickerModelVisible(sonnetId, false);
    setHarnessModels("claude", [liveSonnet, liveHaiku]);
    savePickerModelVisible(liveSonnet.id, true);
    expect(loadHiddenPickerModels()).toEqual([]);
    expect(isPickerModelVisible(liveSonnet)).toBe(true);
    resetHarnessModelOverlays();
    expect(isPickerModelVisible(findModel(sonnetId)!)).toBe(true);
  });

  it("resolves saved favorites through explicit aliases and filters them across both catalogs", () => {
    saveFavoriteModels([sonnetId, "claude:haiku-4.5"]);
    setHarnessModels("claude", [liveSonnet, liveHaiku]);
    const favorites = () =>
      loadFavoriteModels()
        .map(findPickerModel)
        .filter((model) => model && isPickerModelVisible(model));
    expect(favorites()).toEqual([liveSonnet, liveHaiku]);
    savePickerModelVisible(liveSonnet.id, false);
    expect(favorites()).toEqual([liveHaiku]);
    resetHarnessModelOverlays();
    expect(favorites().map((model) => model!.id)).toEqual(["claude:haiku-4.5"]);
  });

  it("keeps a fallback Show choice restored when the live catalog returns after restart", () => {
    setHarnessModels("claude", [liveSonnet, liveHaiku]);
    saveDefaultModel("claude", liveSonnet.id);
    saveFavoriteModels([liveSonnet.id, liveHaiku.id]);
    expect(loadDefaultModels().claude).toBe(sonnetId);
    expect(loadFavoriteModels()).toEqual([sonnetId, "claude:haiku-4.5"]);
    savePickerModelVisible(liveSonnet.id, false);
    resetHarnessModelOverlays();
    expect(isPickerModelVisible(findModel(sonnetId)!)).toBe(false);
    expect(preferredModelId("claude")).not.toBe(sonnetId);
    savePickerModelVisible(sonnetId, true);
    expect(loadHiddenPickerModels()).toEqual([]);
    expect(preferredModelId("claude")).toBe(sonnetId);
    expect(
      loadFavoriteModels()
        .map(findPickerModel)
        .map((model) => model?.id),
    ).toEqual([sonnetId, "claude:haiku-4.5"]);
    setHarnessModels("claude", [liveSonnet, liveHaiku]);
    expect(isPickerModelVisible(liveSonnet)).toBe(true);
    expect(preferredModelId("claude")).toBe(liveSonnet.id);
    expect(loadFavoriteModels().map(findPickerModel)).toEqual([
      liveSonnet,
      liveHaiku,
    ]);
    expect(nativeModelId(liveSonnet)).toBe("sonnet");
  });

  it("does not guess that a hidden resolved model includes another generation", () => {
    savePickerModelVisible(sonnetId, false);
    const newer = {
      ...liveSonnet,
      name: "Sonnet 6",
      pickerAliases: ["claude:sonnet-6"],
      pickerPreferenceId: "claude:sonnet-6",
    };
    setHarnessModels("claude", [newer, liveHaiku]);
    expect(isPickerModelVisible(newer)).toBe(true);
  });
});

describe("live catalog overlays", () => {
  afterEach(() => {
    resetHarnessModelOverlays();
  });

  it("is empty until a CLI catalog replaces the fallback list", () => {
    expect(hasLiveCatalog("pi")).toBe(false);
    setHarnessModels("pi", [
      {
        id: "pi:opus",
        harness: "pi",
        name: "Opus",
        nativeId: "anthropic/opus",
      },
    ]);
    expect(hasLiveCatalog("pi")).toBe(true);
    expect(hasLiveCatalog("omp")).toBe(false);
  });
});

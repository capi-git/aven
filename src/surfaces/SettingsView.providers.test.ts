// @vitest-environment happy-dom
import { act, createElement, Fragment } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SettingsView } from "./SettingsView";
import { ModelPicker } from "../chrome/ModelPicker";
import { BuildTargetButton } from "../chrome/SecondOpinionButton";
import { refreshHarnessCatalogs } from "../lib/harness/registry";
import { loadProviderToolAutoUpdates } from "../lib/providerToolUpdates";
import {
  defaultSessionChoice,
  loadHiddenPickerModels,
  loadHiddenPickerProviders,
  resetHarnessModelOverlays,
  saveFavoriteModels,
  saveLastModelChoice,
  savePickerModelVisible,
  setHarnessModels,
} from "../lib/models";

vi.mock("../lib/platform", async (original) => ({
  ...(await original<typeof import("../lib/platform")>()),
  IS_MAC: true,
}));
vi.mock("@tauri-apps/api/core", async (original) => ({
  ...(await original<typeof import("@tauri-apps/api/core")>()),
  invoke: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@tauri-apps/api/webview", () => ({
  getCurrentWebview: () => ({ setZoom: vi.fn().mockResolvedValue(undefined) }),
}));
vi.mock("../lib/harness/availability", () => ({
  getHarnessAvailabilitySnapshot: () => 0,
  hasProbedHarnessAvailability: () => true,
  isHarnessAvailable: (id: string) => id === "codex" || id === "claude",
  harnessUnavailableHint: () => "CLI not installed",
  probeHarnessAvailability: vi.fn().mockResolvedValue(undefined),
  subscribeHarnessAvailability: () => () => {},
}));
vi.mock("../lib/harness/registry", () => ({
  refreshHarnessCatalogs: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../lib/sounds", async (original) => ({
  ...(await original<typeof import("../lib/sounds")>()),
  playCue: vi.fn(),
}));

function Settings() {
  return createElement(SettingsView, {
    section: "providers",
    cwd: "~",
    sessions: [],
    besideRail: true,
    onClose: () => {},
    onOpenSession: () => {},
    onArchiveSession: () => {},
    onDeleteSession: () => {},
    onOpenWhatsNew: () => {},
  });
}

const opus = "claude:opus-5";
const sonnet = "claude:sonnet-5";

describe("provider and model controls", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.mocked(refreshHarnessCatalogs).mockReset().mockResolvedValue(undefined);
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    const storage = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
      removeItem: (key: string) => storage.delete(key),
      clear: () => storage.clear(),
    });
    setHarnessModels("claude", [
      { id: opus, harness: "claude", name: "Opus 5" },
      { id: sonnet, harness: "claude", name: "Sonnet 5" },
    ]);
    setHarnessModels("codex", [
      { id: "codex:test", harness: "codex", name: "Codex Test" },
    ]);
    saveLastModelChoice("claude", opus);
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    localStorage.clear();
    resetHarnessModelOverlays();
    vi.unstubAllGlobals();
  });

  function control(label: string) {
    const result = document.querySelector<HTMLButtonElement>(
      `button[aria-label="${label}"]`,
    );
    expect(result, label).not.toBeNull();
    return result!;
  }

  async function expandModels() {
    const details = container.querySelector<HTMLDetailsElement>(
      '[aria-label="Claude Code choices"] details',
    )!;
    await act(async () => {
      details.open = true;
      details.dispatchEvent(new Event("toggle"));
    });
  }

  async function click(label: string) {
    await act(async () => control(label).click());
  }

  it("lets the user turn automatic provider tool updates off without changing their model", async () => {
    await act(async () => root.render(createElement(Settings)));
    const toggle = control("Keep provider tools up to date");
    expect(toggle.getAttribute("aria-checked")).toBe("true");
    await click("Keep provider tools up to date");
    expect(loadProviderToolAutoUpdates()).toBe(false);
    expect(toggle.getAttribute("aria-checked")).toBe("false");
    expect(defaultSessionChoice()).toEqual({ harness: "claude", model: opus });
  });

  it("refreshes a loaded provider explicitly, shows pending state, and exposes new models without changing preferences", async () => {
    savePickerModelVisible(sonnet, false);
    await act(async () => root.render(createElement(Settings)));
    await expandModels();
    let finish!: () => void;
    vi.mocked(refreshHarnessCatalogs)
      .mockClear()
      .mockImplementationOnce(async () => {
        await new Promise<void>((resolve) => {
          finish = resolve;
        });
        setHarnessModels("claude", [
          { id: opus, harness: "claude", name: "Opus 5" },
          { id: sonnet, harness: "claude", name: "Sonnet 5" },
          { id: "claude:future", harness: "claude", name: "New Claude model" },
        ]);
      });
    await click("Refresh Claude Code models");
    expect(control("Refresh Claude Code models").disabled).toBe(true);
    expect(container.querySelector('[role="status"]')?.textContent).toContain(
      "Checking",
    );
    await click("Refresh Claude Code models");
    expect(refreshHarnessCatalogs).toHaveBeenCalledExactlyOnceWith(["claude"], {
      force: true,
    });
    await act(async () => {
      finish();
    });
    expect(control("Refresh Claude Code models").disabled).toBe(false);
    expect(container.querySelector('[role="status"]')?.textContent).toBe(
      "Models refreshed.",
    );
    expect(control("Show New Claude model in Claude Code")).not.toBeNull();
    expect(loadHiddenPickerModels()).toEqual([sonnet]);
    expect(defaultSessionChoice().model).toBe(opus);
  });

  it("shows refresh failures and allows a successful retry", async () => {
    await act(async () => root.render(createElement(Settings)));
    vi.mocked(refreshHarnessCatalogs).mockRejectedValueOnce(
      new Error("Provider unavailable"),
    );
    await click("Refresh Claude Code models");
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      "Provider unavailable",
    );
    expect(control("Refresh Claude Code models").disabled).toBe(false);
    expect(defaultSessionChoice().model).toBe(opus);
    await click("Refresh Claude Code models");
    expect(container.querySelector('[role="alert"]')).toBeNull();
    expect(container.querySelector('[role="status"]')?.textContent).toBe(
      "Models refreshed.",
    );
  });

  it("can refresh an installed hidden provider without enabling it and omits unavailable providers", async () => {
    await act(async () => root.render(createElement(Settings)));
    await click("Show Claude Code in the model picker");
    await click("Refresh Claude Code models");
    expect(loadHiddenPickerProviders()).toContain("claude");
    expect(refreshHarnessCatalogs).toHaveBeenCalledWith(["claude"], {
      force: true,
    });
    expect(
      container.querySelector('[aria-label="Refresh Pi models"]'),
    ).toBeNull();
  });

  it("persists switches, updates the default to another installed provider, and keeps its last provider usable", async () => {
    await act(async () => root.render(createElement(Settings)));
    await click("Show Claude Code in the model picker");
    expect(loadHiddenPickerProviders()).toContain("claude");
    expect(defaultSessionChoice()).toEqual({
      harness: "codex",
      model: "codex:test",
    });
    expect(control("Show Codex in the model picker").disabled).toBe(true);
    await act(async () => root.unmount());
    root = createRoot(container);
    await act(async () => root.render(createElement(Settings)));
    expect(
      control("Show Claude Code in the model picker").getAttribute(
        "aria-checked",
      ),
    ).toBe("false");
    await click("Show Claude Code in the model picker");
    expect(loadHiddenPickerProviders()).not.toContain("claude");
    expect(control("Show Codex in the model picker").disabled).toBe(false);
  });

  it("hides individual models in defaults and favorites while the existing session stays on that model", async () => {
    saveFavoriteModels([opus, sonnet]);
    const onChange = vi.fn();
    await act(async () =>
      root.render(
        createElement(
          Fragment,
          null,
          createElement(Settings),
          createElement(ModelPicker, {
            harness: "claude",
            model: opus,
            onChange,
          }),
        ),
      ),
    );
    await expandModels();
    await click("Show Opus 5 in Claude Code");
    expect(loadHiddenPickerModels()).toEqual([opus]);
    expect(defaultSessionChoice().model).toBe(sonnet);
    const defaults = control("Claude Code default model");
    expect(defaults.getAttribute("role")).toBe("combobox");
    await act(async () => defaults.click());
    const defaultChoices = document.querySelector(
      '[role="listbox"][aria-label="Claude Code default model"]',
    )!;
    expect(
      [...defaultChoices.querySelectorAll('[role="option"]')].map(
        (option) => option.textContent,
      ),
    ).toEqual(["Sonnet 5"]);
    await act(async () =>
      defaults.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Escape",
          bubbles: true,
          cancelable: true,
        }),
      ),
    );
    expect(control("Show Sonnet 5 in Claude Code").disabled).toBe(true);
    await click("Claude Code Opus 5");
    const choices = document.querySelector(
      '[role="listbox"][aria-label="Models"]',
    )!;
    expect(choices.textContent).toContain("Sonnet 5");
    expect(choices.textContent).not.toContain("Opus 5");
    expect(onChange).not.toHaveBeenCalled();
    expect(control("Claude Code Opus 5")).not.toBeNull();
    await click("Claude Code");
    expect(
      document.querySelector('[role="listbox"]')!.textContent,
    ).not.toContain("Opus 5");
  });

  it("restores individual model choices on Show all without enabling their provider", async () => {
    await act(async () => root.render(createElement(Settings)));
    await expandModels();
    await click("Show Opus 5 in Claude Code");
    await click("Show Claude Code in the model picker");
    const section = document.querySelector(
      '[aria-label="Claude Code choices"]',
    )!;
    const showAll = Array.from(section.querySelectorAll("button")).find(
      (button) => button.textContent === "Show all",
    )!;
    await act(async () => showAll.click());
    expect(loadHiddenPickerModels()).toEqual([]);
    expect(loadHiddenPickerProviders()).toContain("claude");
  });

  it("syncs a visibility change from another window into mounted Settings", async () => {
    await act(async () => root.render(createElement(Settings)));
    await expandModels();
    await act(async () => {
      localStorage.setItem(
        "monocode.hiddenPickerModels",
        JSON.stringify([opus]),
      );
      window.dispatchEvent(
        new StorageEvent("storage", { key: "monocode.hiddenPickerModels" }),
      );
    });
    expect(
      control("Show Opus 5 in Claude Code").getAttribute("aria-checked"),
    ).toBe("false");
  });

  it("a build action uses an enabled model when the existing session model was hidden", async () => {
    savePickerModelVisible(opus, false);
    const onPick = vi.fn();
    await act(async () =>
      root.render(
        createElement(BuildTargetButton, {
          from: "claude",
          model: opus,
          onPick,
        }),
      ),
    );
    await click("Build with another model");
    const provider = Array.from(
      document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'),
    ).find((button) => button.textContent === "Claude Code")!;
    await act(async () => provider.click());
    expect(onPick).toHaveBeenCalledWith("claude", sonnet);
  });
  it("keeps legacy hidden models off in Settings and Favorites when live aliases load, and can restore them", async () => {
    const liveSonnet = {
      id: "claude:sonnet",
      harness: "claude" as const,
      name: "Sonnet 5",
      nativeId: "sonnet",
      pickerAliases: [sonnet],
      pickerPreferenceId: sonnet,
    };
    const liveOpus = {
      id: "claude:opus",
      harness: "claude" as const,
      name: "Opus 5",
      nativeId: "opus",
      pickerAliases: [opus],
      pickerPreferenceId: opus,
    };
    // Exact persisted preference observed in the native QA window.
    localStorage.setItem(
      "monocode.hiddenPickerModels",
      JSON.stringify([sonnet]),
    );
    saveFavoriteModels([sonnet, opus]);
    saveLastModelChoice("claude", liveSonnet.id);
    setHarnessModels("claude", [liveSonnet, liveOpus]);
    const onChange = vi.fn();
    await act(async () =>
      root.render(
        createElement(
          Fragment,
          null,
          createElement(Settings),
          createElement(ModelPicker, {
            harness: "claude",
            model: liveSonnet.id,
            onChange,
          }),
        ),
      ),
    );
    await expandModels();
    expect(
      control("Show Sonnet 5 in Claude Code").getAttribute("aria-checked"),
    ).toBe("false");
    expect(defaultSessionChoice().model).toBe(liveOpus.id);
    await click("Claude Code Sonnet 5");
    expect(
      document.querySelector('[role="listbox"]')!.textContent,
    ).not.toContain("Sonnet 5");
    expect(document.querySelector('[role="listbox"]')!.textContent).toContain(
      "Opus 5",
    );
    await click("Claude Code Sonnet 5");
    await click("Show Sonnet 5 in Claude Code");
    expect(loadHiddenPickerModels()).toEqual([]);
    await click("Claude Code Sonnet 5");
    expect(document.querySelector('[role="listbox"]')!.textContent).toContain(
      "Sonnet 5",
    );
    expect(onChange).not.toHaveBeenCalled();
  });
});

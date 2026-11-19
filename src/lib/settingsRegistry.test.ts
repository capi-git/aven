// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SETTINGS } from "./settingDefinitions";
import {
  loadSettingsSection,
  saveAutosave,
  saveSettingsSection,
} from "./settings";

beforeEach(() => {
  const values = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: vi.fn((key: string) => values.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => values.set(key, value)),
    removeItem: vi.fn((key: string) => values.delete(key)),
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("settings registry storage", () => {
  it.each([
    ["composerRunner", "monocode.composerRunner", false, false],
    ["notesEnabled", "monocode.notesEnabled", true, false],
    ["liveAgentsEnabled", "monocode.liveAgentsEnabled", true, false],
    ["gridArcadeEnabled", "monocode.gridArcadeEnabled", false, false],
    ["browserMemorySaver", "aven.browserMemorySaver", true, true],
    ["browserLowMemory", "aven.browserLowMemory", false, false],
    ["autosave", "aven.fileEditorAutosave", false, false],
    ["claudeHooks", "monocode.claudeHooks", true, false],
  ] as const)(
    "preserves %s values and fallbacks",
    (name, key, fallback, invalid) => {
      const setting = SETTINGS[name];
      expect(setting.load()).toBe(fallback);
      expect(setting.getServerSnapshot()).toBe(fallback);
      for (const [raw, expected] of [
        ["1", true],
        ["true", true],
        ["0", false],
        ["false", false],
        ["invalid", invalid],
        ["", invalid],
      ] as const) {
        localStorage.setItem(key, raw);
        expect(setting.load(), raw).toBe(expected);
      }
      setting.save(true);
      expect(localStorage.getItem(key)).toBe("1");
      setting.save(false);
      expect(localStorage.getItem(key)).toBe("0");
    },
  );

  it("preserves section and enum fallback rules, including invalid saves", () => {
    localStorage.setItem("monocode.settingsSection", "invalid");
    expect(loadSettingsSection()).toBe("general");
    saveSettingsSection("browser");
    expect(localStorage.getItem("monocode.settingsSection")).toBe("browser");
    localStorage.setItem("monocode.followUpBehavior", "invalid");
    expect(SETTINGS.followUpBehavior.load()).toBe("queue");
    SETTINGS.followUpBehavior.save("steer");
    expect(localStorage.getItem("monocode.followUpBehavior")).toBe("steer");
    SETTINGS.followUpBehavior.save("invalid" as "queue");
    expect(localStorage.getItem("monocode.followUpBehavior")).toBe("invalid");
    expect(SETTINGS.followUpBehavior.load()).toBe("queue");
    SETTINGS.diffViewer.save("unified");
    expect(localStorage.getItem("monocode.diffViewer")).toBe("unified");
    SETTINGS.diffViewer.save("invalid" as "editor");
    expect(localStorage.getItem("monocode.diffViewer")).toBe("editor");
  });

  it("preserves the autosave save result when storage fails", () => {
    vi.spyOn(localStorage, "setItem").mockImplementation(() => {
      throw new Error("quota");
    });
    expect(saveAutosave(true)).toBe(false);
    vi.spyOn(localStorage, "getItem").mockImplementation(() => {
      throw new Error("private mode");
    });
    for (const setting of Object.values(SETTINGS)) {
      if ("load" in setting) {
        expect(setting.load()).toBe(setting.defaultValue);
        expect(() => setting.save(setting.defaultValue as never)).not.toThrow();
      }
    }
  });

  it("loads defaults and permits saves and subscriptions without a window", () => {
    vi.stubGlobal("window", undefined);
    vi.stubGlobal("localStorage", undefined);
    for (const setting of Object.values(SETTINGS)) {
      if ("load" in setting) {
        expect(setting.load()).toBe(setting.defaultValue);
        expect(() => setting.save(setting.defaultValue as never)).not.toThrow();
        expect(() => setting.subscribe(() => {})()).not.toThrow();
      }
    }
    expect(loadSettingsSection()).toBe("general");
    expect(() => saveSettingsSection("appearance")).not.toThrow();
  });
});

describe("settings registry notifications", () => {
  it.each([
    ["composerRunner", "monocode:composer-runner-change", true, false],
    ["notesEnabled", "monocode:notes-enabled-change", true, false],
    ["liveAgentsEnabled", "monocode:live-agents-enabled-change", true, false],
    ["gridArcadeEnabled", "monocode:grid-arcade-enabled-change", true, false],
    ["diffViewer", "monocode:diff-viewer-change", true, false],
    ["followUpBehavior", "monocode:follow-up-behavior-change", false, true],
    ["browserMemorySaver", "aven:browser-memory-saver-change", false, true],
    ["browserLowMemory", "aven:browser-low-memory-change", false, true],
    ["autosave", "aven:file-editor-autosave-change", false, true],
  ] as const)(
    "preserves %s events and cross-window subscriptions",
    (name, eventName, detail, crossWindow) => {
      const setting = SETTINGS[name];
      const observed: Event[] = [];
      const observe = (event: Event) => observed.push(event);
      window.addEventListener(eventName, observe);
      const onChange = vi.fn();
      const unsubscribe = setting.subscribe(onChange);
      try {
        setting.save(setting.defaultValue as never);
        expect(observed).toHaveLength(1);
        expect(observed[0] instanceof CustomEvent).toBe(detail);
        if (detail)
          expect((observed[0] as CustomEvent).detail).toBe(
            setting.defaultValue,
          );
        expect(onChange).toHaveBeenCalledTimes(1);
        window.dispatchEvent(new StorageEvent("storage", { key: "unrelated" }));
        expect(onChange).toHaveBeenCalledTimes(1);
        window.dispatchEvent(new StorageEvent("storage", { key: setting.key }));
        window.dispatchEvent(new StorageEvent("storage", { key: null }));
        expect(onChange).toHaveBeenCalledTimes(crossWindow ? 3 : 1);
        unsubscribe();
        onChange.mockClear();
        setting.save(setting.defaultValue as never);
        window.dispatchEvent(new StorageEvent("storage", { key: setting.key }));
        expect(onChange).not.toHaveBeenCalled();
      } finally {
        unsubscribe();
        window.removeEventListener(eventName, observe);
      }
    },
  );

  it("notifies after failed writes but leaves Claude hooks silent", () => {
    vi.spyOn(localStorage, "setItem").mockImplementation(() => {
      throw new Error("quota");
    });
    const onChange = vi.fn();
    const unsubscribe = SETTINGS.notesEnabled.subscribe(onChange);
    SETTINGS.notesEnabled.save(false);
    expect(onChange).toHaveBeenCalledOnce();
    unsubscribe();
    const dispatch = vi.spyOn(window, "dispatchEvent");
    SETTINGS.claudeHooks.save(false);
    expect(dispatch).not.toHaveBeenCalled();
  });
});

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  COMPOSER_RUNNER_DEFAULT,
  BROWSER_MEMORY_SAVER_DEFAULT,
  DIFF_VIEWER_DEFAULT,
  FOLLOW_UP_BEHAVIOR_DEFAULT,
  filterKeybindings,
  formatKeybindingContext,
  GRID_ARCADE_ENABLED_DEFAULT,
  KEYBINDINGS,
  LIVE_AGENTS_ENABLED_DEFAULT,
  loadComposerRunner,
  loadDiffViewer,
  loadFollowUpBehavior,
  loadGridArcadeEnabled,
  loadLiveAgentsEnabled,
  loadNotesEnabled,
  loadBrowserMemorySaver,
  NOTES_ENABLED_DEFAULT,
  saveComposerRunner,
  saveDiffViewer,
  saveFollowUpBehavior,
  saveGridArcadeEnabled,
  saveLiveAgentsEnabled,
  saveNotesEnabled,
  saveBrowserMemorySaver,
} from "./settings";

const KEY = "monocode.composerRunner";
const NOTES_KEY = "monocode.notesEnabled";
const LIVE_AGENTS_KEY = "monocode.liveAgentsEnabled";
const GRID_ARCADE_KEY = "monocode.gridArcadeEnabled";
const DIFF_VIEWER_KEY = "monocode.diffViewer";
const FOLLOW_UP_BEHAVIOR_KEY = "monocode.followUpBehavior";
const BROWSER_MEMORY_SAVER_KEY = "aven.browserMemorySaver";

describe("browser memory saver setting", () => {
  beforeEach(mockLocalStorage);

  it("defaults to enabled for existing and new installations", () => {
    expect(BROWSER_MEMORY_SAVER_DEFAULT).toBe(true);
    expect(loadBrowserMemorySaver()).toBe(true);
  });

  it("retains an explicit opt-out and allows re-enabling it", () => {
    saveBrowserMemorySaver(false);
    expect(localStorage.getItem(BROWSER_MEMORY_SAVER_KEY)).toBe("0");
    expect(loadBrowserMemorySaver()).toBe(false);
    saveBrowserMemorySaver(true);
    expect(localStorage.getItem(BROWSER_MEMORY_SAVER_KEY)).toBe("1");
    expect(loadBrowserMemorySaver()).toBe(true);
  });

  it.each([
    ["false", false], ["true", true], ["invalid", true], ["", true],
  ])("reads %s without silently disabling the default", (stored, expected) => {
    localStorage.setItem(BROWSER_MEMORY_SAVER_KEY, stored);
    expect(loadBrowserMemorySaver()).toBe(expected);
  });
});

describe("follow-up behavior setting", () => {
  beforeEach(mockLocalStorage);
  afterEach(() => {
    localStorage.removeItem(FOLLOW_UP_BEHAVIOR_KEY);
  });

  it("defaults to queue so a follow-up cannot interrupt the active turn", () => {
    expect(FOLLOW_UP_BEHAVIOR_DEFAULT).toBe("queue");
    expect(loadFollowUpBehavior()).toBe("queue");
  });

  it("persists queue behavior", () => {
    saveFollowUpBehavior("queue");
    expect(loadFollowUpBehavior()).toBe("queue");
  });

  it("ignores unknown stored values", () => {
    localStorage.setItem(FOLLOW_UP_BEHAVIOR_KEY, "interrupt");
    expect(loadFollowUpBehavior()).toBe("queue");
  });

  it("retains an explicitly selected steer preference", () => {
    saveFollowUpBehavior("steer");
    expect(loadFollowUpBehavior()).toBe("steer");
  });
});

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

describe("composer runner setting", () => {
  beforeEach(mockLocalStorage);
  afterEach(() => {
    localStorage.removeItem(KEY);
  });

  it("defaults to off for the lightweight personal shell", () => {
    expect(COMPOSER_RUNNER_DEFAULT).toBe(false);
    expect(loadComposerRunner()).toBe(false);
  });

  it("persists an off switch", () => {
    saveComposerRunner(false);
    expect(localStorage.getItem(KEY)).toBe("0");
    expect(loadComposerRunner()).toBe(false);
    saveComposerRunner(true);
    expect(loadComposerRunner()).toBe(true);
  });
});

describe("notes enabled setting", () => {
  beforeEach(mockLocalStorage);
  afterEach(() => {
    localStorage.removeItem(NOTES_KEY);
  });

  it("defaults to on", () => {
    expect(NOTES_ENABLED_DEFAULT).toBe(true);
    expect(loadNotesEnabled()).toBe(true);
  });

  it("persists an off switch", () => {
    saveNotesEnabled(false);
    expect(localStorage.getItem(NOTES_KEY)).toBe("0");
    expect(loadNotesEnabled()).toBe(false);
    saveNotesEnabled(true);
    expect(loadNotesEnabled()).toBe(true);
  });
});

describe("live agents enabled setting", () => {
  beforeEach(mockLocalStorage);
  afterEach(() => {
    localStorage.removeItem(LIVE_AGENTS_KEY);
  });

  it("defaults to on", () => {
    expect(LIVE_AGENTS_ENABLED_DEFAULT).toBe(true);
    expect(loadLiveAgentsEnabled()).toBe(true);
  });

  it("persists an off switch", () => {
    saveLiveAgentsEnabled(false);
    expect(localStorage.getItem(LIVE_AGENTS_KEY)).toBe("0");
    expect(loadLiveAgentsEnabled()).toBe(false);
    saveLiveAgentsEnabled(true);
    expect(loadLiveAgentsEnabled()).toBe(true);
  });
});

describe("grid arcade enabled setting", () => {
  beforeEach(mockLocalStorage);
  afterEach(() => {
    localStorage.removeItem(GRID_ARCADE_KEY);
  });

  it("defaults to off to keep the empty workspace quiet", () => {
    expect(GRID_ARCADE_ENABLED_DEFAULT).toBe(false);
    expect(loadGridArcadeEnabled()).toBe(false);
  });

  it("persists an off switch", () => {
    saveGridArcadeEnabled(false);
    expect(localStorage.getItem(GRID_ARCADE_KEY)).toBe("0");
    expect(loadGridArcadeEnabled()).toBe(false);
    saveGridArcadeEnabled(true);
    expect(loadGridArcadeEnabled()).toBe(true);
  });
});

describe("workspace navigation keybindings", () => {
  it("labels every built-in shortcut context and searches both visible and raw contexts", () => {
    const contexts = [...new Set(KEYBINDINGS.map((row) => row.when))];
    expect(contexts.map(formatKeybindingContext)).toEqual([
      "Always",
      "In a conversation, with other views closed",
      "In the workspace, outside text fields or in an empty composer",
      "Outside the editor",
      "In the editor",
    ]);
    expect(
      filterKeybindings(KEYBINDINGS, "emptyComposer").map((row) => row.when),
    ).toEqual(Array(4).fill("!overlay && (!textFocus || emptyComposer)"));
    expect(
      filterKeybindings(KEYBINDINGS, "conversation").map((row) => row.command),
    ).toEqual(["Session: Archive"]);
    expect(
      filterKeybindings(KEYBINDINGS, "empty composer").map((row) => row.when),
    ).toEqual(Array(4).fill("!overlay && (!textFocus || emptyComposer)"));
    expect(formatKeybindingContext("Custom context")).toBe("Custom context");
  });

  it("documents session and project cycling in the shortcut list", () => {
    const rows = KEYBINDINGS.filter((row) =>
      /^(Session|Project): (Previous|Next)$/.test(row.command),
    );
    expect(rows.map((row) => row.command)).toEqual([
      "Session: Previous",
      "Session: Next",
      "Project: Previous",
      "Project: Next",
    ]);
    expect(
      rows.every(
        (row) => row.when === "!overlay && (!textFocus || emptyComposer)",
      ),
    ).toBe(true);
  });
});

describe("diff viewer setting", () => {
  beforeEach(mockLocalStorage);
  afterEach(() => {
    localStorage.removeItem(DIFF_VIEWER_KEY);
  });

  it("defaults to the editor layout", () => {
    expect(DIFF_VIEWER_DEFAULT).toBe("editor");
    expect(loadDiffViewer()).toBe("editor");
  });

  it("persists the unified layout", () => {
    saveDiffViewer("unified");
    expect(localStorage.getItem(DIFF_VIEWER_KEY)).toBe("unified");
    expect(loadDiffViewer()).toBe("unified");
    saveDiffViewer("editor");
    expect(loadDiffViewer()).toBe("editor");
  });

  it("ignores unknown stored values", () => {
    localStorage.setItem(DIFF_VIEWER_KEY, "split");
    expect(loadDiffViewer()).toBe("editor");
  });
});

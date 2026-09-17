import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { newTab } from "./layout";
import { newDefaultSession, newSession, newSplitSession } from "./session";
import { sanitizeSessionForPersist } from "./sessionStore";
import {
  collectWorkspaceSnapshot,
  hydrateWorkspaceSnapshot,
} from "./workspaceSnapshot";
import {
  DEFAULT_RUNTIME_MODE_KEY,
  RUNTIME_MODES,
  loadDefaultRuntimeMode,
  saveDefaultRuntimeMode,
} from "./runtimeMode";

beforeEach(() => {
  const data = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => data.set(key, value),
  });
});

afterEach(() => vi.unstubAllGlobals());

describe("saved task access", () => {
  it("keeps supervised until the user explicitly selects another default", () => {
    expect(loadDefaultRuntimeMode()).toBe("supervised");
    expect(newDefaultSession("/repo").runtimeMode).toBe("supervised");
    // Restoring a Full access task is not a preference change.
    newSession("codex", "/repo", undefined, "full-access");
    expect(loadDefaultRuntimeMode()).toBe("supervised");
  });

  it.each(RUNTIME_MODES)(
    "remembers %s across independently created tasks",
    (mode) => {
      saveDefaultRuntimeMode(mode);
      expect(localStorage.getItem(DEFAULT_RUNTIME_MODE_KEY)).toBe(mode);
      expect(newDefaultSession("/repo").runtimeMode).toBe(mode);
      expect(newSession("claude", "/other-repo").runtimeMode).toBe(mode);
      expect(newSession("codex", "/repo").runtimeMode).toBe(mode);
    },
  );

  it("uses the saved choice for a blank split beside an older task", () => {
    saveDefaultRuntimeMode("full-access");
    const source = newSession("claude", "/repo", undefined, "supervised");
    const split = newSplitSession(source, "/fallback");
    expect(split).toMatchObject({
      cwd: "/repo",
      runtimeMode: "full-access",
      blocks: [],
    });
    expect(split.id).not.toBe(source.id);
    expect(source.runtimeMode).toBe("supervised");

    saveDefaultRuntimeMode("auto-accept-edits");
    expect(newSplitSession(source).runtimeMode).toBe("auto-accept-edits");
    expect(newSplitSession(undefined, "/fallback")).toMatchObject({
      cwd: "/fallback",
      runtimeMode: "auto-accept-edits",
    });
  });

  it("does not inherit broader access into a blank split without a saved choice", () => {
    const source = newSession("codex", "/repo", undefined, "full-access");
    expect(newSplitSession(source).runtimeMode).toBe("supervised");
    expect(loadDefaultRuntimeMode()).toBe("supervised");
  });

  it("preserves an explicit handoff's access over the new-task default", () => {
    saveDefaultRuntimeMode("full-access");
    const source = newSession("claude", "/repo", undefined, "supervised");
    const handoff = newSession(
      "codex",
      source.cwd,
      undefined,
      source.runtimeMode,
    );
    expect(handoff.runtimeMode).toBe("supervised");
    expect(newDefaultSession("/repo").runtimeMode).toBe("full-access");
  });

  it("restores a task's saved mode even after the new-task default changes", () => {
    saveDefaultRuntimeMode("full-access");
    const source = newSession("codex", "/repo");
    source.providerSessionId = "provider-thread";
    const tab = newTab(source.id);
    const snapshot = collectWorkspaceSnapshot(
      [tab],
      [source],
      tab.id,
      source.cwd,
    );
    expect(sanitizeSessionForPersist(source).runtimeMode).toBe("full-access");
    saveDefaultRuntimeMode("supervised");
    const restored = hydrateWorkspaceSnapshot(snapshot, new Map());
    expect(restored?.sessions[0]).toMatchObject({
      id: source.id,
      runtimeMode: "full-access",
      providerSessionId: "provider-thread",
    });
    expect(newDefaultSession("/repo").runtimeMode).toBe("supervised");
  });

  it("ignores an invalid saved preference rather than inferring broader access", () => {
    localStorage.setItem(DEFAULT_RUNTIME_MODE_KEY, "yolo");
    expect(loadDefaultRuntimeMode()).toBe("supervised");
    localStorage.setItem(DEFAULT_RUNTIME_MODE_KEY, '"full-access"');
    expect(loadDefaultRuntimeMode()).toBe("supervised");
  });

  it("still starts tasks if preference storage is unavailable", () => {
    vi.stubGlobal("localStorage", {
      getItem: () => {
        throw new Error("unavailable");
      },
      setItem: () => {
        throw new Error("unavailable");
      },
    });
    expect(() => saveDefaultRuntimeMode("full-access")).not.toThrow();
    expect(newDefaultSession("/repo").runtimeMode).toBe("supervised");
    expect(
      newSession("codex", "/repo", undefined, "full-access").runtimeMode,
    ).toBe("full-access");
  });
});

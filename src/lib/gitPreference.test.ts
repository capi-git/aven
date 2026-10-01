// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  GIT_FINISH_BEHAVIOR_DEFAULT,
  agentGitInstructions,
  loadGitFinishBehavior,
  saveGitFinishBehavior,
  subscribeGitFinishBehavior,
} from "./gitPreference";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
  isTauri: () => false,
}));

describe("git finish preference", () => {
  beforeEach(() => {
    const values = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
      clear: () => values.clear(),
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  it("defaults to the project's own instructions and adds no guidance", () => {
    expect(loadGitFinishBehavior()).toBe(GIT_FINISH_BEHAVIOR_DEFAULT);
    expect(agentGitInstructions()).toBeNull();
    localStorage.setItem("aven.gitFinishBehavior", "sometimes");
    expect(loadGitFinishBehavior()).toBe("project");
  });

  it("stores a choice, notifies listeners, and forgets the default", () => {
    const changed = vi.fn();
    const stop = subscribeGitFinishBehavior(changed);
    saveGitFinishBehavior("leave");
    expect(localStorage.getItem("aven.gitFinishBehavior")).toBe("leave");
    expect(loadGitFinishBehavior()).toBe("leave");
    saveGitFinishBehavior("project");
    expect(localStorage.getItem("aven.gitFinishBehavior")).toBeNull();
    expect(changed).toHaveBeenCalledTimes(2);
    stop();
    saveGitFinishBehavior("pr");
    expect(changed).toHaveBeenCalledTimes(2);
  });

  it("tells agents exactly how far to go and that the preference outranks project rules", () => {
    const leave = agentGitInstructions("leave")!;
    expect(leave).toContain("Do not commit, push, or open a pull request");
    const commit = agentGitInstructions("commit")!;
    expect(commit).toContain("commit your work");
    expect(commit).toContain("Do not push or open a pull request");
    const pr = agentGitInstructions("pr")!;
    expect(pr).toContain("open a pull request");
    for (const text of [leave, commit, pr]) {
      expect(text.startsWith("<aven-git>")).toBe(true);
      expect(text).toContain("takes precedence over project instructions");
      expect(text).toContain(
        "An explicit request in this conversation still wins",
      );
    }
  });

  it("adds the preference to every agent turn", async () => {
    const { prepareAgentBrowserPrompt } = await import("./agentBrowser");
    const context = { sessionId: "s1", cwd: "/repo" } as Parameters<
      typeof prepareAgentBrowserPrompt
    >[1];
    expect(await prepareAgentBrowserPrompt("Fix it", context)).toBe("Fix it");
    saveGitFinishBehavior("leave");
    expect(await prepareAgentBrowserPrompt("Fix it", context)).toBe(
      `${agentGitInstructions("leave")}\n\nFix it`,
    );
  });
});

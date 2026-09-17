import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  ACTIVITY_LIMIT,
  ACTIVITY_STORAGE_KEY,
  clearActivityHistory,
  getActivitySnapshot,
  markActivityRead,
  markAllActivityRead,
  markSessionActivityRead,
  recordActivity,
  reconcileSessionActivityInputs,
  subscribeActivity,
  type ActivityInput,
} from "./activity";

const row = (
  id: string,
  patch: Partial<ActivityInput> = {},
): ActivityInput => ({
  id,
  sessionId: "session",
  outcome: "completed",
  title: "Fix tabs",
  summary: "Tabs fixed",
  cwd: "/tmp/project",
  harness: "codex",
  model: "codex:test",
  createdAt: 100,
  ...patch,
});
beforeEach(() => {
  const storage = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key),
  });
  getActivitySnapshot();
});
describe("durable Activity", () => {
  it("deduplicates exact events without losing read state, while retaining different turns", () => {
    expect(recordActivity(row("turn1")).added).toBe(true);
    markActivityRead("turn1");
    expect(recordActivity(row("turn1", { summary: "repeat" })).added).toBe(
      false,
    );
    expect(recordActivity(row("turn2")).added).toBe(true);
    expect(getActivitySnapshot()).toHaveLength(2);
    expect(
      getActivitySnapshot().find((entry) => entry.id === "turn1")?.readAt,
    ).not.toBeNull();
    expect(
      getActivitySnapshot().find((entry) => entry.id === "turn1")?.summary,
    ).toBe("Tabs fixed");
  });
  it("reloads local outcomes, unread and resolved state in a fresh module", async () => {
    recordActivity(row("approval", { outcome: "approval" }));
    recordActivity(row("failure", { outcome: "failed" }));
    reconcileSessionActivityInputs("session", []);
    markActivityRead("approval");
    vi.resetModules();
    const fresh = await import("./activity");
    expect(fresh.getActivitySnapshot()).toEqual(getActivitySnapshot());
    expect(
      fresh.getActivitySnapshot().find((entry) => entry.id === "failure")
        ?.readAt,
    ).toBeNull();
  });
  it("resolves only obsolete inputs from the specified session without marking them read", () => {
    recordActivity(row("old", { outcome: "approval" }));
    recordActivity(row("current", { outcome: "question" }));
    recordActivity(row("other", { outcome: "question", sessionId: "other" }));
    reconcileSessionActivityInputs("session", ["current"]);
    const entries = getActivitySnapshot();
    expect(
      entries.find((entry) => entry.id === "old")?.resolvedAt,
    ).not.toBeNull();
    expect(entries.find((entry) => entry.id === "old")?.readAt).toBeNull();
    expect(
      entries.find((entry) => entry.id === "current")?.resolvedAt,
    ).toBeNull();
    expect(
      entries.find((entry) => entry.id === "other")?.resolvedAt,
    ).toBeNull();
  });
  it("marks only displayed session events up to the presentation cutoff", () => {
    recordActivity(row("old"));
    recordActivity(row("new", { createdAt: 300 }));
    recordActivity(row("other", { sessionId: "other" }));
    markSessionActivityRead("session", 200);
    expect(
      getActivitySnapshot()
        .filter((entry) => entry.readAt !== null)
        .map((entry) => entry.id),
    ).toEqual(["old"]);
    markAllActivityRead();
    expect(getActivitySnapshot().every((entry) => entry.readAt !== null)).toBe(
      true,
    );
  });
  it("clears finished history while preserving input requests and dedupe across restart", async () => {
    recordActivity(row("done"));
    recordActivity(row("input", { outcome: "question" }));
    clearActivityHistory({ keepPending: true });
    expect(getActivitySnapshot().map((entry) => entry.id)).toEqual(["input"]);
    vi.resetModules();
    const fresh = await import("./activity");
    expect(fresh.recordActivity(row("done")).added).toBe(false);
    expect(fresh.getActivitySnapshot()).toHaveLength(1);
  });
  it("bounds newest-first history and stored text without storing transcript blocks", () => {
    for (let i = 0; i < ACTIVITY_LIMIT + 10; i++)
      recordActivity(
        row(String(i), { createdAt: i, summary: "x".repeat(1000) }),
      );
    const entries = getActivitySnapshot();
    expect(entries).toHaveLength(ACTIVITY_LIMIT);
    expect(entries[0].id).toBe(String(ACTIVITY_LIMIT + 9));
    expect(entries[0].summary).toHaveLength(240);
    expect(
      JSON.parse(localStorage.getItem(ACTIVITY_STORAGE_KEY)!).entries[0].blocks,
    ).toBeUndefined();
  });
  it("ignores corrupt, unknown and malformed stored rows", () => {
    localStorage.setItem(
      ACTIVITY_STORAGE_KEY,
      JSON.stringify({
        version: 1,
        entries: [
          { ...row("bad"), createdAt: "yesterday" },
          { ...row("bad-provider"), harness: "unknown" },
        ],
      }),
    );
    expect(getActivitySnapshot()).toEqual([]);
    localStorage.setItem(ACTIVITY_STORAGE_KEY, "{corrupt");
    expect(getActivitySnapshot()).toEqual([]);
    expect(recordActivity(row("recovered")).added).toBe(true);
  });
  it("keeps a stable snapshot and avoids subscribers on no-op mutations", () => {
    recordActivity(row("once"));
    const first = getActivitySnapshot();
    const listener = vi.fn();
    const stop = subscribeActivity(listener);
    expect(getActivitySnapshot()).toBe(first);
    recordActivity(row("once"));
    reconcileSessionActivityInputs("session", []);
    expect(listener).not.toHaveBeenCalled();
    markActivityRead("once");
    expect(listener).toHaveBeenCalledTimes(1);
    stop();
  });
  it("remains usable if storage writes fail", () => {
    vi.spyOn(localStorage, "setItem").mockImplementation(() => {
      throw new Error("quota");
    });
    recordActivity(row("memory"));
    expect(getActivitySnapshot().map((entry) => entry.id)).toEqual(["memory"]);
  });
});

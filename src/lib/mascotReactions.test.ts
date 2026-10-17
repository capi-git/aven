// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  getActivitySnapshot,
  recordActivity,
  markActivityRead,
  type ActivityEntry,
  type ActivityInput,
} from "./activity";
import { STREAK_STORAGE_KEY, dayKey } from "./activityStreak";
import {
  REACTION_CLAIM_GRACE_MS,
  REACTION_CLAIMS_KEY,
  REACTION_FRESH_MS,
  claimReaction,
  mascotReactionFor,
  newTurnEnds,
  reactionKindFor,
  subscribeMascotReactions,
} from "./mascotReactions";
import { projectKey } from "./paths";
import { useMascotReaction } from "../hooks/useMascotReaction";

const APP = "/projects/app";
const NOW = new Date(2026, 9, 15, 10, 0).getTime();
let storage: Map<string, string>;
let focused: boolean;
let visibility: DocumentVisibilityState;
const stops: (() => void)[] = [];

function turn(id: string, patch: Partial<ActivityInput> = {}): ActivityInput {
  return {
    id,
    sessionId: "s1",
    outcome: "completed",
    title: "Fix tabs",
    summary: "Tabs fixed",
    cwd: APP,
    harness: "codex",
    model: "gpt-5",
    createdAt: Date.now(),
    ...patch,
  };
}

function entry(id: string, patch: Partial<ActivityEntry> = {}): ActivityEntry {
  return {
    ...turn(id),
    createdAt: NOW,
    readAt: null,
    resolvedAt: null,
    ...patch,
  } as ActivityEntry;
}

/** Subscribe like a mounted mark; returns how often it was told to re-read. */
function watch() {
  const calls = { count: 0 };
  stops.push(subscribeMascotReactions(() => (calls.count += 1)));
  return calls;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  storage = new Map();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key),
  });
  focused = true;
  visibility = "visible";
  vi.spyOn(document, "hasFocus").mockImplementation(() => focused);
  vi.spyOn(document, "visibilityState", "get").mockImplementation(
    () => visibility,
  );
  getActivitySnapshot();
});

afterEach(() => {
  for (const stop of stops.splice(0)) stop();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("which turn ends react", () => {
  it("maps outcomes to reactions and leaves requests alone", () => {
    expect(reactionKindFor("completed")).toBe("cheer");
    expect(reactionKindFor("failed")).toBe("slump");
    expect(reactionKindFor("stopped")).toBe("shrug");
    expect(reactionKindFor("approval")).toBeNull();
    expect(reactionKindFor("question")).toBeNull();
  });

  it("finds only new, fresh turn ends and forgets entries the ledger dropped", () => {
    const known = new Set(["old"]);
    const ledger = [
      entry("old"),
      entry("ask", { outcome: "approval" }),
      entry("stale", { createdAt: NOW - REACTION_FRESH_MS - 1 }),
      entry("late", { createdAt: NOW - 1000 }),
      entry("new"),
    ];
    expect(newTurnEnds(ledger, known, NOW).map((row) => row.id)).toEqual([
      "late",
      "new",
    ]);
    expect(newTurnEnds(ledger, known, NOW)).toEqual([]);
    expect(newTurnEnds([entry("new")], known, NOW)).toEqual([]);
    expect([...known]).toEqual(["new"]);
  });

  it("never slumps at a team waiting on you", () => {
    const known = new Set<string>();
    const ledger = [
      entry("paused", {
        outcome: "failed",
        team: { id: "discuss:d1", kind: "discuss", need: true },
      }),
      entry("broke", { outcome: "failed" }),
    ];
    expect(newTurnEnds(ledger, known, NOW).map((row) => row.id)).toEqual([
      "broke",
    ]);
  });

  it("claims a turn end once across windows and reloads", () => {
    expect(claimReaction("t1", NOW)).toBe(true);
    expect(claimReaction("t1", NOW + 5)).toBe(false);
    expect(claimReaction("t2", NOW)).toBe(true);
    expect(JSON.parse(storage.get(REACTION_CLAIMS_KEY)!)).toHaveLength(2);
  });
});

describe("playing reactions", () => {
  it("plays once when a turn ends, then clears", () => {
    const calls = watch();
    recordActivity(turn("t1"));
    const reaction = mascotReactionFor(projectKey(APP));
    expect(reaction).toMatchObject({
      id: "t1",
      kind: "cheer",
      sessionId: "s1",
    });
    expect(calls.count).toBe(1);
    // Later ledger writes (read state) never replay it.
    markActivityRead("t1");
    expect(calls.count).toBe(1);
    vi.advanceTimersByTime(1200);
    expect(mascotReactionFor(projectKey(APP))).toBeNull();
    expect(calls.count).toBe(2);
    markActivityRead("t1");
    expect(mascotReactionFor(projectKey(APP))).toBeNull();
  });

  it("slumps on failure and shrugs on stop, ignoring approvals", () => {
    watch();
    recordActivity(turn("ask", { outcome: "approval" }));
    expect(mascotReactionFor(projectKey(APP))).toBeNull();
    recordActivity(turn("fail", { outcome: "failed" }));
    expect(mascotReactionFor(projectKey(APP))?.kind).toBe("slump");
    recordActivity(turn("stop", { outcome: "stopped", cwd: "/projects/b" }));
    expect(mascotReactionFor(projectKey("/projects/b"))?.kind).toBe("shrug");
  });

  it("does not replay history when a window starts watching or reloads", async () => {
    recordActivity(turn("before"));
    watch();
    expect(mascotReactionFor(projectKey(APP))).toBeNull();

    recordActivity(turn("t1"));
    expect(mascotReactionFor(projectKey(APP))?.id).toBe("t1");
    for (const stop of stops.splice(0)) stop();

    // A reload: fresh modules see the same ledger, still fresh, and the claims.
    vi.resetModules();
    const fresh = await import("./mascotReactions");
    const ledger = await import("./activity");
    stops.push(fresh.subscribeMascotReactions(() => {}));
    expect(fresh.mascotReactionFor(projectKey(APP))).toBeNull();
    vi.advanceTimersByTime(REACTION_CLAIM_GRACE_MS);
    expect(fresh.mascotReactionFor(projectKey(APP))).toBeNull();
    // The next turn end after the reload plays as usual.
    ledger.recordActivity(turn("t2"));
    expect(fresh.mascotReactionFor(projectKey(APP))?.id).toBe("t2");
  });

  it("leaves a turn end another window already played", () => {
    watch();
    claimReaction("t1");
    recordActivity(turn("t1"));
    expect(mascotReactionFor(projectKey(APP))).toBeNull();
  });

  it("lets the focused window go first and plays late when no one else does", () => {
    focused = false;
    watch();
    recordActivity(turn("t1"));
    expect(mascotReactionFor(projectKey(APP))).toBeNull();
    vi.advanceTimersByTime(REACTION_CLAIM_GRACE_MS);
    expect(mascotReactionFor(projectKey(APP))?.id).toBe("t1");

    recordActivity(turn("t2"));
    // The focused window claims during the grace period.
    claimReaction("t2");
    vi.advanceTimersByTime(REACTION_CLAIM_GRACE_MS);
    expect(mascotReactionFor(projectKey(APP))?.id).toBe("t1");
  });

  it("plays nothing in a hidden window", () => {
    visibility = "hidden";
    watch();
    recordActivity(turn("t1"));
    vi.advanceTimersByTime(REACTION_CLAIM_GRACE_MS);
    expect(mascotReactionFor(projectKey(APP))).toBeNull();
    expect(storage.has(REACTION_CLAIMS_KEY)).toBe(false);
  });

  it("stops watching when nothing on screen can react", () => {
    watch();
    for (const stop of stops.splice(0)) stop();
    recordActivity(turn("t1"));
    expect(mascotReactionFor(projectKey(APP))).toBeNull();
    expect(storage.has(REACTION_CLAIMS_KEY)).toBe(false);
  });

  it("remembers the day of a completed turn for the streak", () => {
    watch();
    recordActivity(turn("t1"));
    recordActivity(turn("t2", { outcome: "failed" }));
    expect(JSON.parse(storage.get(STREAK_STORAGE_KEY)!).days).toEqual([
      dayKey(NOW),
    ]);
  });

  it("re-renders a mark only when its project's reaction starts or ends", async () => {
    const seen: (string | null)[] = [];
    function Mark({ path }: { path: string }) {
      const reaction = useMascotReaction(projectKey(path));
      seen.push(reaction?.kind ?? null);
      return null;
    }
    const container = document.createElement("div");
    const root = createRoot(container);
    await act(async () =>
      root.render(
        createElement("div", null, [
          createElement(Mark, { key: "a", path: APP }),
        ]),
      ),
    );
    await act(async () => void recordActivity(turn("other", { cwd: "/x" })));
    expect(seen).toEqual([null]);
    await act(async () => void recordActivity(turn("t1")));
    expect(seen).toEqual([null, "cheer"]);
    await act(async () => void vi.advanceTimersByTime(1200));
    expect(seen).toEqual([null, "cheer", null]);
    await act(async () => root.unmount());
  });
});

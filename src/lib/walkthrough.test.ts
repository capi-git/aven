// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SMOKE_SEED } from "./devSmoke";
import { loadGettingStarted, shouldShowGettingStarted } from "./gettingStarted";
import { PROVIDER_SETUP_KEY, saveProviderSetup } from "./providerSetup";
import {
  WALKTHROUGH_KEY,
  loadWalkthrough,
  saveWalkthrough,
  shouldOfferWalkthrough,
  subscribeWalkthrough,
  walkthroughReducer,
  type WalkthroughState,
} from "./walkthrough";

let values: Map<string, string>;

beforeEach(() => {
  values = new Map();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, String(value)),
    removeItem: (key: string) => values.delete(key),
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const fresh: WalkthroughState = {
  started: false,
  ended: false,
  step: "welcome",
  done: [],
};

describe("walkthrough steps", () => {
  it("goes Welcome, Agents, Project, Tour, ticking each finished step", () => {
    let state = walkthroughReducer(fresh, { type: "start" });
    expect(state).toEqual({ ...fresh, started: true });
    state = walkthroughReducer(state, { type: "next" });
    expect(state).toMatchObject({ step: "agents", done: ["welcome"] });
    state = walkthroughReducer(state, { type: "next" });
    expect(state).toMatchObject({
      step: "project",
      done: ["welcome", "agents"],
    });
    state = walkthroughReducer(state, { type: "next" });
    expect(state).toMatchObject({
      step: "tour",
      done: ["welcome", "agents", "project"],
      ended: false,
    });
    state = walkthroughReducer(state, { type: "next" });
    expect(state).toMatchObject({
      ended: true,
      done: ["welcome", "agents", "project", "tour"],
    });
  });

  it("goes back a step without forgetting what was done, never before Welcome", () => {
    const project: WalkthroughState = {
      started: true,
      ended: false,
      step: "project",
      done: ["welcome", "agents"],
    };
    const agents = walkthroughReducer(project, { type: "back" });
    expect(agents).toMatchObject({
      step: "agents",
      done: ["welcome", "agents"],
    });
    const welcome = walkthroughReducer(agents, { type: "back" });
    expect(welcome.step).toBe("welcome");
    expect(walkthroughReducer(welcome, { type: "back" })).toBe(welcome);
  });

  it("skips the Project step without ticking it", () => {
    const project: WalkthroughState = {
      started: true,
      ended: false,
      step: "project",
      done: ["welcome", "agents"],
    };
    expect(walkthroughReducer(project, { type: "skipStep" })).toMatchObject({
      step: "tour",
      done: ["welcome", "agents"],
      ended: false,
    });
  });

  it("ends for good on Skip setup from any step, and stays ended", () => {
    for (const step of ["welcome", "agents", "project", "tour"] as const) {
      const ended = walkthroughReducer(
        { ...fresh, started: true, step },
        { type: "skip" },
      );
      expect(ended.ended, step).toBe(true);
      expect(walkthroughReducer(ended, { type: "next" })).toBe(ended);
      expect(walkthroughReducer(ended, { type: "back" })).toBe(ended);
    }
  });

  it("finishes from the tour with every step ticked", () => {
    expect(
      walkthroughReducer(
        {
          started: true,
          ended: false,
          step: "tour",
          done: ["welcome", "agents", "project"],
        },
        { type: "finish" },
      ),
    ).toEqual({
      started: true,
      ended: true,
      step: "tour",
      done: ["welcome", "agents", "project", "tour"],
    });
  });
});

describe("walkthrough storage", () => {
  it("saves where it is so a restart resumes there", () => {
    const listener = vi.fn();
    const stop = subscribeWalkthrough(listener);
    try {
      expect(
        saveWalkthrough({
          started: true,
          ended: false,
          step: "project",
          done: ["agents", "welcome"],
        }),
      ).toBe(true);
      expect(listener).toHaveBeenCalledTimes(1);
      expect(loadWalkthrough()).toEqual({
        started: true,
        ended: false,
        step: "project",
        done: ["welcome", "agents"],
      });
      expect(shouldOfferWalkthrough(true)).toBe(true);
    } finally {
      stop();
    }
  });

  it("reads damaged or unknown saved values as a fresh walkthrough", () => {
    for (const raw of [
      "{",
      "[]",
      "null",
      JSON.stringify({ step: "elsewhere", done: ["nope", 3], ended: "yes" }),
    ]) {
      values.set(WALKTHROUGH_KEY, raw);
      expect(loadWalkthrough(), raw).toEqual(fresh);
    }
  });

  it("works without storage", () => {
    vi.stubGlobal("localStorage", {
      getItem: () => {
        throw new Error("private mode");
      },
      setItem: () => {
        throw new Error("quota");
      },
    });
    expect(loadWalkthrough()).toEqual(fresh);
    expect(saveWalkthrough({ ...fresh, started: true })).toBe(false);
  });
});

describe("who sees the walkthrough", () => {
  it("a fresh install with no existing work does", () => {
    expect(shouldOfferWalkthrough(false)).toBe(true);
    // Asking stores nothing.
    expect(values.size).toBe(0);
  });

  it("an existing user who updates does not, nor sees Getting started", () => {
    // Existing work, or provider setup finished on an earlier version.
    expect(shouldOfferWalkthrough(true)).toBe(false);
    saveProviderSetup({ selected: ["claude"], finished: true });
    expect(shouldOfferWalkthrough(false)).toBe(false);
    expect(shouldShowGettingStarted(loadGettingStarted())).toBe(false);
  });

  it("nobody sees it again once it ended", () => {
    saveWalkthrough({ ...fresh, started: true, ended: true });
    expect(shouldOfferWalkthrough(false)).toBe(false);
    expect(shouldOfferWalkthrough(true)).toBe(false);
  });

  it("the automated checks never see it or the Getting started card", () => {
    // The real-app check and the speed test start from this seed.
    for (const [key, value] of Object.entries(SMOKE_SEED))
      values.set(key, value);
    expect(values.has(PROVIDER_SETUP_KEY)).toBe(true);
    expect(shouldOfferWalkthrough(false)).toBe(false);
    expect(loadWalkthrough().ended).toBe(true);
    expect(shouldShowGettingStarted(loadGettingStarted())).toBe(false);
  });
});

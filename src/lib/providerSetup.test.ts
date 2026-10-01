// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HARNESSES } from "./session";
import {
  loadProviderSetup,
  PROVIDER_SETUP_KEY,
  saveProviderSetup,
  shouldOfferProviderSetup,
  subscribeProviderSetup,
  type ProviderSetupState,
} from "./providerSetup";

beforeEach(() => {
  const values = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("provider setup choices", () => {
  it("starts with no selected providers and does not save implicit choices", () => {
    expect(loadProviderSetup()).toEqual({ selected: [], finished: false });
    expect(localStorage.getItem(PROVIDER_SETUP_KEY)).toBeNull();
    // A caller can offer setup without detecting or installing any provider.
    expect(shouldOfferProviderSetup(false)).toBe(true);
    expect(localStorage.getItem(PROVIDER_SETUP_KEY)).toBeNull();
  });

  it("resumes only the user's choices in their chosen order", () => {
    saveProviderSetup({ selected: ["codex", "claude"], finished: false });
    expect(loadProviderSetup()).toEqual({
      selected: ["codex", "claude"],
      finished: false,
    });
    expect(shouldOfferProviderSetup(false)).toBe(true);
    // Mutating a loaded selection cannot change the saved choices.
    loadProviderSetup().selected.push("cursor");
    expect(loadProviderSetup().selected).toEqual(["codex", "claude"]);
  });

  it("validates saved choices against live provider IDs and removes duplicates", () => {
    localStorage.setItem(
      PROVIDER_SETUP_KEY,
      JSON.stringify({
        selected: ["codex", "__proto__", null, "claude", "codex", ...HARNESSES],
        finished: false,
      }),
    );
    expect(loadProviderSetup().selected).toEqual([
      "codex",
      "claude",
      ...HARNESSES.filter((harness) => harness !== "codex" && harness !== "claude"),
    ]);
  });

  it.each([
    "{broken",
    "null",
    "[]",
    "7",
    '"codex"',
    '{"selected":"codex","finished":"true"}',
  ])("recovers from corrupted storage %s without selecting a provider", (raw) => {
    localStorage.setItem(PROVIDER_SETUP_KEY, raw);
    expect(loadProviderSetup()).toEqual({ selected: [], finished: false });
    // Reading never rewrites damaged storage or other preferences.
    expect(localStorage.getItem(PROVIDER_SETUP_KEY)).toBe(raw);
  });

  it("saves only choices and deferral, never credentials or readiness", () => {
    localStorage.setItem("monocode.recentProjects", "existing work");
    const state = {
      selected: ["claude", "unrecognized", "claude", "pi"],
      finished: true,
      token: "private credential",
      readiness: { claude: "ready" },
      version: "cached version",
    } as unknown as ProviderSetupState;
    expect(saveProviderSetup(state)).toBe(true);
    expect(JSON.parse(localStorage.getItem(PROVIDER_SETUP_KEY)!)).toEqual({
      selected: ["claude", "pi"],
      finished: true,
    });
    expect(localStorage.getItem("monocode.recentProjects")).toBe("existing work");
  });

  it("keeps setup deferred on later launches while retaining choices for Settings", () => {
    saveProviderSetup({ selected: ["cursor"], finished: true });
    expect(shouldOfferProviderSetup(false)).toBe(false);
    // Reopening Settings reads the same selection irrespective of deferral.
    expect(loadProviderSetup()).toEqual({ selected: ["cursor"], finished: true });
    saveProviderSetup({ selected: ["cursor", "opencode"], finished: true });
    expect(loadProviderSetup().selected).toEqual(["cursor", "opencode"]);
    expect(shouldOfferProviderSetup(false)).toBe(false);
  });

  it("does not interrupt an existing user's workspace on upgrade", () => {
    expect(shouldOfferProviderSetup(true)).toBe(false);
    saveProviderSetup({ selected: ["codex"], finished: false });
    expect(shouldOfferProviderSetup(true)).toBe(false);
  });

  it("allows deferring setup with no providers chosen", () => {
    saveProviderSetup({ selected: [], finished: true });
    expect(loadProviderSetup()).toEqual({ selected: [], finished: true });
    expect(shouldOfferProviderSetup(false)).toBe(false);
  });
});

describe("provider setup persistence notifications", () => {
  it("notifies saves and storage changes, and stops after unsubscribe", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeProviderSetup(listener);
    try {
      saveProviderSetup({ selected: ["codex"], finished: false });
      expect(listener).toHaveBeenCalledTimes(1);
      window.dispatchEvent(new StorageEvent("storage", { key: "other setting" }));
      expect(listener).toHaveBeenCalledTimes(1);
      window.dispatchEvent(new StorageEvent("storage", { key: PROVIDER_SETUP_KEY }));
      window.dispatchEvent(new StorageEvent("storage", { key: null }));
      expect(listener).toHaveBeenCalledTimes(3);
      unsubscribe();
      saveProviderSetup({ selected: [], finished: true });
      window.dispatchEvent(new StorageEvent("storage", { key: PROVIDER_SETUP_KEY }));
      expect(listener).toHaveBeenCalledTimes(3);
    } finally {
      unsubscribe();
    }
  });

  it("reports a failed save without announcing choices that were not persisted", () => {
    saveProviderSetup({ selected: ["claude"], finished: false });
    const listener = vi.fn();
    const unsubscribe = subscribeProviderSetup(listener);
    vi.spyOn(localStorage, "setItem").mockImplementation(() => {
      throw new Error("Storage unavailable");
    });
    try {
      expect(saveProviderSetup({ selected: ["codex"], finished: true })).toBe(false);
      expect(listener).not.toHaveBeenCalled();
      expect(loadProviderSetup()).toEqual({ selected: ["claude"], finished: false });
    } finally {
      unsubscribe();
    }
  });

  it("tolerates unavailable storage without blocking the app", () => {
    vi.spyOn(localStorage, "getItem").mockImplementation(() => {
      throw new Error("Storage unavailable");
    });
    expect(loadProviderSetup()).toEqual({ selected: [], finished: false });
    expect(shouldOfferProviderSetup(true)).toBe(false);
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setAvosReadAccess } from "./crewActions";
import {
  avosMayRead,
  getCrew,
  readCrew,
  resetCrewsCache,
  updateCrew,
} from "./crews";
import { memoryStorage } from "./devSmoke";

const PATH = "/Users/me/aven-site";

beforeEach(() => {
  vi.stubGlobal("localStorage", memoryStorage());
  resetCrewsCache();
});
afterEach(() => {
  vi.unstubAllGlobals();
  resetCrewsCache();
});

describe("whether Avos may read the project", () => {
  it("waits for your answer on a new Avos, and keeps an Avos that already ran", () => {
    expect(avosMayRead(undefined)).toBe(false);
    expect(avosMayRead({ on: false })).toBe(false);
    expect(avosMayRead({ on: false, readAccess: "allowed" })).toBe(true);
    // One that ran before Aven asked: you had already let it.
    expect(avosMayRead({ on: false, onAt: 1 })).toBe(true);
    expect(avosMayRead({ on: true })).toBe(true);
    // Your no wins over everything.
    expect(avosMayRead({ on: true, onAt: 1, readAccess: "declined" })).toBe(
      false,
    );
  });

  it("keeps your answer, and nothing else, when read back", () => {
    expect(readCrew({ path: PATH, readAccess: "allowed" })?.readAccess).toBe(
      "allowed",
    );
    expect(readCrew({ path: PATH, readAccess: "declined" })?.readAccess).toBe(
      "declined",
    );
    expect(readCrew({ path: PATH, readAccess: "yes" })?.readAccess).toBe(
      undefined,
    );
  });

  it("turns Avos off when you take it back", async () => {
    updateCrew(PATH, (crew) => ({ ...crew, on: true, onAt: 1 }));
    await setAvosReadAccess(PATH, false);
    expect(getCrew(PATH)).toMatchObject({ on: false, readAccess: "declined" });
    await setAvosReadAccess(PATH, true);
    expect(getCrew(PATH)?.readAccess).toBe("allowed");
    // Allowing doesn't wake it by itself.
    expect(getCrew(PATH)?.on).toBe(false);
  });
});

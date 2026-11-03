import { afterEach, describe, expect, it } from "vitest";
import {
  FOREIGN_STORE_WHY,
  clearSaveProblem,
  dismissSaveProblem,
  reportSaveProblem,
  resetSaveProblems,
  saveFailureWhy,
  saveProblem,
  subscribeSaveProblems,
} from "./saveProblems";

afterEach(resetSaveProblems);

describe("one notice for changes that can't be saved", () => {
  it("shows the latest failing store, once per cause, until it saves again", () => {
    const heard: (string | null)[] = [];
    const stop = subscribeSaveProblems(() =>
      heard.push(saveProblem()?.key ?? null),
    );
    reportSaveProblem("a", "your teams", "Aven's storage is full.", 1);
    reportSaveProblem("a", "your teams", "Aven's storage is full.", 2);
    expect(saveProblem()).toEqual({
      key: "a",
      what: "your teams",
      why: "Aven's storage is full.",
      at: 1,
    });
    reportSaveProblem("b", "your project bots", FOREIGN_STORE_WHY, 3);
    expect(saveProblem()?.key).toBe("b");
    // The shown store saves again: the other failing store's notice shows.
    clearSaveProblem("b");
    expect(saveProblem()?.key).toBe("a");
    clearSaveProblem("a");
    clearSaveProblem("a");
    expect(saveProblem()).toBeNull();
    expect(heard).toEqual(["a", "b", "a", null]);
    stop();
  });

  it("stays dismissed until a store fails for a new reason", () => {
    reportSaveProblem("a", "your teams", "Aven's storage is full.");
    dismissSaveProblem();
    expect(saveProblem()).toBeNull();
    reportSaveProblem("a", "your teams", "Aven's storage is full.");
    expect(saveProblem()).toBeNull();
    reportSaveProblem("a", "your teams", "Aven's storage isn't available.");
    expect(saveProblem()?.why).toBe("Aven's storage isn't available.");
  });

  it("says why in a sentence", () => {
    const full = new DOMException("quota", "QuotaExceededError");
    expect(saveFailureWhy(full)).toBe("Aven's storage is full.");
    expect(saveFailureWhy(new Error("x"))).toBe(
      "Aven's storage isn't available.",
    );
  });
});

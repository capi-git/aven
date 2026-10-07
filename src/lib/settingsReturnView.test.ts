import { describe, expect, it } from "vitest";
import {
  captureSettingsReturnView,
  resolveSettingsReturnView,
} from "./settingsReturnView";

describe("settings return view", () => {
  it("remembers the utility that Settings replaced", () => {
    const closed = {
      search: false,
      inbox: false,
      automations: false,
      notes: false,
    };
    expect(captureSettingsReturnView(closed)).toBeNull();
    expect(captureSettingsReturnView({ ...closed, search: true })).toBe(
      "search",
    );
    expect(captureSettingsReturnView({ ...closed, inbox: true })).toBe("inbox");
    expect(captureSettingsReturnView({ ...closed, automations: true })).toBe(
      "automations",
    );
    expect(captureSettingsReturnView({ ...closed, notes: true })).toBe("notes");
  });

  it("returns to Notes only while Notes is still enabled", () => {
    expect(resolveSettingsReturnView("notes", true)).toBe("notes");
    expect(resolveSettingsReturnView("notes", false)).toBeNull();
    expect(resolveSettingsReturnView("search", false)).toBe("search");
    expect(resolveSettingsReturnView("inbox", false)).toBe("inbox");
    expect(resolveSettingsReturnView("automations", false)).toBe("automations");
    expect(resolveSettingsReturnView(null, true)).toBeNull();
  });
});

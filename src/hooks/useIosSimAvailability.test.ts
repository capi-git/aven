import { describe, expect, it } from "vitest";
import { iosSimAvailability } from "./useIosSimAvailability";

describe("iPhone pane availability", () => {
  it("shows nothing on Windows or for projects without an Xcode project", () => {
    expect(iosSimAvailability(false, true, true)).toBe("none");
    expect(iosSimAvailability(false, true, false)).toBe("none");
    expect(iosSimAvailability(true, false, true)).toBe("none");
  });

  it("offers the pane with Xcode, and only a hint without it", () => {
    expect(iosSimAvailability(true, true, true)).toBe("ready");
    expect(iosSimAvailability(true, true, false)).toBe("needs-xcode");
  });
});

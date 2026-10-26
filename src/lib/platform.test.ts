import { afterEach, describe, expect, it, vi } from "vitest";

async function platformFor(platform: string) {
  vi.resetModules();
  vi.stubGlobal("navigator", { platform });
  return import("./platform");
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("platform", () => {
  it("reads Windows only from a platform that starts with Win", async () => {
    expect((await platformFor("Win32")).IS_WIN).toBe(true);
    // "Darwin" contains "win"; a Mac or a test DOM reporting it is not Windows.
    expect((await platformFor("X11; Darwin arm64")).IS_WIN).toBe(false);
    expect((await platformFor("MacIntel")).IS_WIN).toBe(false);
    expect((await platformFor("MacIntel")).IS_MAC).toBe(true);
  });
});

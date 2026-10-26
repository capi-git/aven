import { afterEach, expect, it, vi } from "vitest";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

async function platformFor(name: string) {
  vi.stubGlobal("navigator", { platform: name });
  vi.resetModules();
  return import("./platform");
}

it.each([
  ["MacIntel", { mac: true, win: false }],
  // A test browser on a Mac: "Darwin" must not read as Windows.
  ["X11; Darwin arm64", { mac: false, win: false }],
  ["Win32", { mac: false, win: true }],
  ["Linux x86_64", { mac: false, win: false }],
])("tells %s apart", async (name, expected) => {
  const platform = await platformFor(name);
  expect({ mac: platform.IS_MAC, win: platform.IS_WIN }).toEqual(expected);
});

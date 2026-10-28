import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ invoke: vi.fn(), tauri: true }));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: mocks.invoke,
  isTauri: () => mocks.tauri,
}));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn() }));
vi.mock("@tauri-apps/api/window", () => ({ getCurrentWindow: vi.fn() }));
vi.mock("./platform", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./platform")>()),
  IS_MAC: true,
}));

import {
  appendLogs,
  basicPoint,
  clearIosSimProject,
  deviceMenuGroups,
  isDeviceStarting,
  isRunActive,
  loadIosSimChoice,
  PANE_LOG_LINES,
  pickDevice,
  pickScheme,
  saveIosSimChoice,
  statusTone,
  type IosSimDevice,
} from "./iosSimulator";

function mockLocalStorage() {
  const data = new Map<string, string>();
  Object.defineProperty(globalThis, "localStorage", {
    value: {
      getItem: (key: string) => data.get(key) ?? null,
      setItem: (key: string, value: string) => void data.set(key, value),
      removeItem: (key: string) => void data.delete(key),
    },
    configurable: true,
  });
  return data;
}

const device = (
  udid: string,
  name: string,
  runtime = "iOS 27.0",
  booted = false,
): IosSimDevice => ({
  udid,
  name,
  runtime,
  booted,
  family: name.startsWith("iPad") ? "ipad" : "iphone",
  state: booted ? "Booted" : "Shutdown",
});

const PHONE = device("AAAA", "iPhone 18 Pro", "iOS 27.0", true);
const MAX = device("BBBB", "iPhone 18 Pro Max");
const PAD = device("CCCC", "iPad Air 13-inch (M4)");
const OLD = device("DDDD", "iPhone 17", "iOS 26.2");

describe("iPhone pane choices", () => {
  beforeEach(() => {
    mockLocalStorage();
    mocks.invoke.mockReset().mockResolvedValue(undefined);
    mocks.tauri = true;
  });

  it("keeps the remembered device while it exists, else the suggestion", () => {
    const all = [PHONE, MAX, PAD];
    expect(pickDevice(all, "bbbb", "AAAA")).toBe(MAX);
    expect(pickDevice(all, "gone", "CCCC")).toBe(PAD);
    expect(pickDevice([], "AAAA", "AAAA")).toBeNull();
  });

  it("never opens on a device nobody chose: no suggestion means no device", () => {
    // Aven suggested nothing (no simulator to show): the person picks.
    expect(pickDevice([PHONE, MAX, PAD], undefined, null)).toBeNull();
    expect(pickDevice([PHONE], "gone", null)).toBeNull();
  });

  it("keeps the remembered scheme while the project has it", () => {
    expect(pickScheme(["App", "Widgets"], "Widgets")).toBe("Widgets");
    expect(pickScheme(["App", "Widgets"], "Removed")).toBe("App");
    expect(pickScheme([], "App")).toBeNull();
  });

  it("remembers choices per project under an aven key and forgets them with the project", async () => {
    saveIosSimChoice("/work/pom/", { udid: "AAAA", scheme: "Pom" });
    saveIosSimChoice("/work/pom", { container: "/work/pom/Pom.xcworkspace" });
    expect(loadIosSimChoice("/work/pom")).toEqual({
      udid: "AAAA",
      scheme: "Pom",
      container: "/work/pom/Pom.xcworkspace",
    });
    expect(loadIosSimChoice("/work/other")).toEqual({});
    expect(localStorage.getItem("aven.iosSimulator.v1")).toContain("/work/pom");
    await clearIosSimProject("/work/pom");
    expect(loadIosSimChoice("/work/pom")).toEqual({});
    expect(mocks.invoke).toHaveBeenCalledWith("ios_sim_forget_project", {
      project: "/work/pom",
    });
  });

  it("ignores damaged saved choices", () => {
    localStorage.setItem(
      "aven.iosSimulator.v1",
      JSON.stringify({ "/p": { udid: 4, scheme: "S" }, "/q": "x" }),
    );
    expect(loadIosSimChoice("/p")).toEqual({ scheme: "S" });
    expect(loadIosSimChoice("/q")).toEqual({});
    localStorage.setItem("aven.iosSimulator.v1", "{not json");
    expect(loadIosSimChoice("/p")).toEqual({});
  });

  it("groups the picker's devices by runtime in order", () => {
    expect(
      deviceMenuGroups([PHONE, MAX, PAD, OLD]).map((group) => [
        group.runtime,
        group.devices.map((d) => d.name),
      ]),
    ).toEqual([
      [
        "iOS 27.0",
        ["iPhone 18 Pro", "iPhone 18 Pro Max", "iPad Air 13-inch (M4)"],
      ],
      ["iOS 26.2", ["iPhone 17"]],
    ]);
  });
});

describe("iPhone pane status", () => {
  it("turns Run into Stop while building or running", () => {
    for (const phase of [
      "building",
      "installing",
      "launching",
      "running",
    ] as const)
      expect(isRunActive(phase)).toBe(true);
    for (const phase of [
      "idle",
      "booting",
      "preparing",
      "failed",
      "stopped",
    ] as const)
      expect(isRunActive(phase)).toBe(false);
    // A Run whose build is done and that waits for its device is still the
    // Run: Stop, not Run (which would start another build).
    expect(isRunActive("waiting")).toBe(true);
    expect(isDeviceStarting("preparing")).toBe(true);
    expect(isDeviceStarting("waiting")).toBe(true);
    expect(isDeviceStarting("building")).toBe(false);
  });

  it("colours the strip's dot by phase", () => {
    expect(statusTone("running")).toBe("running");
    expect(statusTone("failed")).toBe("failed");
    expect(statusTone("building")).toBe("busy");
    expect(statusTone("stopped")).toBe("idle");
  });

  it("keeps the newest console lines", () => {
    const many = Array.from({ length: PANE_LOG_LINES + 5 }, (_, i) => `${i}`);
    const kept = appendLogs(["old"], many);
    expect(kept).toHaveLength(PANE_LOG_LINES);
    expect(kept.at(-1)).toBe(`${PANE_LOG_LINES + 4}`);
    expect(appendLogs(["a"], ["b"])).toEqual(["a", "b"]);
  });
});

describe("basic mode clicks", () => {
  // A 1206 × 2622 px screenshot drawn aspect-fit in a 600 × 600 box.
  const image = { width: 1206, height: 2622 };
  const box = { width: 600, height: 600 };
  const fit = 600 / 2622;
  const left = (600 - 1206 * fit) / 2;

  it("maps a click through the letterbox to fractions of the screen", () => {
    const centre = basicPoint(box, image, 300, 300)!;
    expect(centre.fx).toBeCloseTo(0.5);
    expect(centre.fy).toBeCloseTo(0.5);
    const corner = basicPoint(box, image, left, 0)!;
    expect(corner.fx).toBeCloseTo(0);
    expect(corner.fy).toBeCloseTo(0);
    // An @2x iPad's picture maps the same way: no scale is assumed.
    const pad = basicPoint(
      { width: 1032, height: 1376 },
      { width: 2064, height: 2752 },
      516,
      344,
    )!;
    expect(pad.fx).toBeCloseTo(0.5);
    expect(pad.fy).toBeCloseTo(0.25);
  });

  it("ignores clicks in the letterbox and empty pictures", () => {
    expect(basicPoint(box, image, left - 2, 300)).toBeNull();
    expect(basicPoint(box, { width: 0, height: 0 }, 1, 1)).toBeNull();
    expect(basicPoint({ width: 0, height: 0 }, image, 1, 1)).toBeNull();
  });
});

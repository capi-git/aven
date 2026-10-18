// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { projectKey } from "./paths";
import { projectMascot } from "./projectMascots";
import {
  hasProjectAppearance,
  projectAppearance,
  projectAppearanceRevision,
  projectLabelRecords,
  subscribeProjectAppearance,
} from "./projectAppearance";
import {
  TAB_GROUP_COLORS,
  clearTabGroupSettings,
  notifyTabGroupLogosChanged,
  saveTabGroupColor,
  saveTabGroupCustomColor,
  saveTabGroupLabel,
  saveTabGroupLogo,
  saveTabGroupMascot,
  tabGroupColor,
} from "./tabGroups";

vi.mock("@tauri-apps/api/core", () => ({
  convertFileSrc: (path: string) => `asset://localhost${path}`,
  invoke: vi.fn(),
}));

const APP = "/Users/me/Developer/app";
const SITE = "/Users/me/Developer/site";
let data: Map<string, string>;

beforeEach(() => {
  data = new Map();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => data.set(key, value),
    removeItem: (key: string) => data.delete(key),
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/** What another window's write looks like here: storage changes, then an event. */
function writeFromAnotherWindow(key: string, value: Record<string, string>) {
  data.set(key, JSON.stringify(value));
  window.dispatchEvent(new StorageEvent("storage", { key }));
}

describe("projectAppearance", () => {
  it("falls back to the folder name, its hashed colour and its hashed mascot", () => {
    const look = projectAppearance(APP);
    expect(look).toMatchObject({
      key: projectKey(APP),
      label: "app",
      customLabel: null,
      color: tabGroupColor("app"),
      colorIndex: null,
      customColor: null,
      logoPath: null,
      logoSrc: null,
      mascot: projectMascot("app").name,
      mascotOverride: null,
    });
    expect(TAB_GROUP_COLORS[look.automaticColorIndex]).toBe(look.color);
  });

  it("resolves saved name, palette colour, custom colour, mascot and logo", () => {
    const key = projectKey(APP);
    saveTabGroupLabel(key, "  Aven  ");
    saveTabGroupColor(key, 4);
    saveTabGroupMascot(key, "whale");
    saveTabGroupLogo(key, "/logos/app.png");
    notifyTabGroupLogosChanged();
    let look = projectAppearance(APP);
    expect(look).toMatchObject({
      label: "Aven",
      customLabel: "Aven",
      color: TAB_GROUP_COLORS[4],
      colorIndex: 4,
      mascot: "whale",
      mascotOverride: "whale",
      logoPath: "/logos/app.png",
    });
    expect(look.logoSrc).toMatch(
      /^asset:\/\/localhost\/logos\/app\.png\?v=\d+$/,
    );

    saveTabGroupCustomColor(key, "#AABBCC");
    look = projectAppearance(APP);
    expect(look.color).toBe("#aabbcc");
    expect(look.customColor).toBe("#aabbcc");
    expect(look.colorIndex).toBeNull();

    clearTabGroupSettings(key);
    expect(projectAppearance(APP)).toMatchObject({
      label: "app",
      color: tabGroupColor("app"),
      mascotOverride: null,
      logoPath: null,
    });
  });

  it("shows a pick saved under an old sprite's name as its critter", () => {
    const key = projectKey(APP);
    saveTabGroupMascot(key, "ghost");
    expect(projectAppearance(APP)).toMatchObject({
      mascot: "jelly",
      mascotOverride: "jelly",
    });
    // The saved name itself is left as it was.
    expect(JSON.stringify([...data.values()])).toContain("ghost");
    saveTabGroupMascot(key, "nope");
    expect(projectAppearance(APP).mascot).toBe(projectMascot("app").name);
  });

  it("returns the same object until that project's appearance changes", () => {
    const app = projectAppearance(APP);
    const site = projectAppearance(SITE);
    expect(projectAppearance(APP)).toBe(app);

    saveTabGroupColor(projectKey(SITE), 2);
    expect(projectAppearance(APP)).toBe(app);
    expect(projectAppearance(SITE)).not.toBe(site);
    expect(projectAppearance(SITE).color).toBe(TAB_GROUP_COLORS[2]);
  });

  it("notifies subscribers for every change in this window", () => {
    const listener = vi.fn();
    const stop = subscribeProjectAppearance(listener);
    try {
      saveTabGroupColor(projectKey(APP), 3);
      saveTabGroupMascot(projectKey(APP), "robot");
      saveTabGroupLabel(projectKey(APP), "Renamed");
      notifyTabGroupLogosChanged();
      expect(listener).toHaveBeenCalledTimes(4);
    } finally {
      stop();
    }
  });

  it("follows writes from other windows, including the floating sidebar", () => {
    const listener = vi.fn();
    const stop = subscribeProjectAppearance(listener);
    try {
      const before = projectAppearance(APP);
      writeFromAnotherWindow("monocode:tab-group:colors", {
        [projectKey(APP)]: "5",
      });
      expect(listener).toHaveBeenCalledOnce();
      expect(projectAppearance(APP).color).toBe(TAB_GROUP_COLORS[5]);
      expect(projectAppearance(APP)).not.toBe(before);

      writeFromAnotherWindow("monocode:tab-group:labels", {
        [projectKey(APP)]: "From the overlay",
      });
      expect(projectAppearance(APP).label).toBe("From the overlay");

      // Unrelated keys cost nothing.
      const revision = projectAppearanceRevision();
      window.dispatchEvent(
        new StorageEvent("storage", { key: "monocode.recentProjects" }),
      );
      expect(projectAppearanceRevision()).toBe(revision);
    } finally {
      stop();
    }
  });

  it("reloads a logo replaced in another window even when its file path is the same", () => {
    const stop = subscribeProjectAppearance(() => {});
    try {
      writeFromAnotherWindow("monocode:tab-group:logos", {
        [projectKey(APP)]: "/logos/app.png",
      });
      const first = projectAppearance(APP).logoSrc;
      writeFromAnotherWindow("monocode:tab-group:logos", {
        [projectKey(APP)]: "/logos/app.png",
      });
      const second = projectAppearance(APP).logoSrc;
      expect(first).toMatch(/app\.png\?v=/);
      expect(second).not.toBe(first);
    } finally {
      stop();
    }
  });

  it("shares one label record whose identity changes only with the labels", () => {
    const stop = subscribeProjectAppearance(() => {});
    try {
      const labels = projectLabelRecords();
      saveTabGroupColor(projectKey(APP), 1);
      expect(projectLabelRecords()).toBe(labels);
      saveTabGroupLabel(projectKey(APP), "Named");
      expect(projectLabelRecords()).not.toBe(labels);
      expect(projectLabelRecords()[projectKey(APP)]).toBe("Named");
    } finally {
      stop();
    }
  });

  it("gives home and missing folders no identity", () => {
    expect(hasProjectAppearance(APP)).toBe(true);
    expect(hasProjectAppearance("~")).toBe(false);
    expect(hasProjectAppearance("")).toBe(false);
    expect(hasProjectAppearance(undefined)).toBe(false);
  });
});

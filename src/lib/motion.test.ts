// @vitest-environment happy-dom
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  applyMotionPreference,
  initMotionPreference,
  MOTION_ATTRIBUTE,
  MOTION_EASE,
  MOTION_MS,
  MOTION_ROOT_ATTRIBUTE,
  motionReduced,
  playMotion,
} from "./motion";
import { SETTINGS } from "./settingDefinitions";

const motionCss = readFileSync("src/motion.css", "utf8");

function block(selector: string): string {
  const at = motionCss.indexOf(`${selector} {`);
  if (at < 0) throw new Error(`Missing rule ${selector}`);
  return motionCss.slice(at, motionCss.indexOf("}", at));
}

function declarations(css: string): Map<string, string> {
  return new Map(
    [...css.matchAll(/(--aven-[a-z-]+):\s*([^;]+);/g)].map(
      ([, name, value]) => [name, value.trim().replace(/\s+/g, " ")],
    ),
  );
}

let systemReduces = false;
let mediaListeners: (() => void)[] = [];

beforeEach(() => {
  systemReduces = false;
  mediaListeners = [];
  const storage = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key),
  });
  vi.spyOn(window, "matchMedia").mockImplementation(
    (query: string) =>
      ({
        media: query,
        get matches() {
          return query.includes("reduced-motion") && systemReduces;
        },
        addEventListener: (_: string, listener: () => void) =>
          mediaListeners.push(listener),
        removeEventListener: (_: string, listener: () => void) => {
          mediaListeners = mediaListeners.filter((item) => item !== listener);
        },
      }) as unknown as MediaQueryList,
  );
  document.documentElement.removeAttribute(MOTION_ROOT_ATTRIBUTE);
});

afterEach(() => {
  document.documentElement.removeAttribute(MOTION_ROOT_ATTRIBUTE);
  document.body.replaceChildren();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("motion tokens", () => {
  it("keeps the script copies equal to the CSS variables", () => {
    const tokens = declarations(block(":root"));
    for (const [name, ms] of Object.entries(MOTION_MS))
      expect(tokens.get(`--aven-motion-${name}`)).toBe(`${ms}ms`);
    for (const [name, curve] of Object.entries(MOTION_EASE))
      expect(tokens.get(`--aven-ease-${name}`)).toBe(curve);
  });

  it("keeps every duration short", () => {
    for (const ms of Object.values(MOTION_MS)) {
      expect(ms).toBeGreaterThanOrEqual(90);
      expect(ms).toBeLessThanOrEqual(160);
    }
  });

  it("zeroes every duration and the press when motion is reduced, by Aven or the system", () => {
    const durations = [...declarations(block(":root")).keys()].filter((name) =>
      name.startsWith("--aven-motion-"),
    );
    expect(durations.length).toBeGreaterThan(0);
    const media = motionCss.slice(
      motionCss.indexOf("@media (prefers-reduced-motion: reduce)"),
    );
    for (const reduced of [
      declarations(block(':root[data-motion="reduce"]')),
      declarations(media.slice(0, media.indexOf("}"))),
    ]) {
      for (const name of durations) expect(reduced.get(name)).toBe("0ms");
      expect(reduced.get("--aven-press-scale")).toBe("1");
    }
  });

  it("times every animation in motion.css by a token, animates only transform and opacity, and never loops", () => {
    const animations = [...motionCss.matchAll(/animation:\s*([^;]+);/g)].map(
      ([, value]) => value.replace(/\s+/g, " "),
    );
    expect(animations.length).toBeGreaterThan(5);
    for (const animation of animations) {
      expect(animation).toMatch(/var\(--aven-motion-[a-z]+\)/);
      expect(animation).not.toMatch(/infinite|\d+ms|\d+s\b/);
    }
    const keyframes = [
      ...motionCss.matchAll(/@keyframes [a-z-]+ \{([\s\S]*?)\n\}/g),
    ].map(([, body]) => body);
    expect(keyframes.length).toBeGreaterThan(5);
    for (const body of keyframes)
      for (const [, property] of body.matchAll(/^\s*([a-z-]+):/gm))
        expect(["opacity", "transform"]).toContain(property);
    const rules = motionCss.replace(/\/\*[\s\S]*?\*\//g, "");
    expect(rules).not.toMatch(/will-change|transition/);
  });

  it("adds no universal rules and names no descendants of [hidden]", () => {
    const selectors = motionCss
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .match(/[^{}]+(?=\{)/g)!
      .map((selector) => selector.trim());
    for (const selector of selectors) {
      expect(selector).not.toMatch(/(^|[\s>+~,(])\*/);
      expect(selector).not.toMatch(/\[hidden\][^,]*\s/);
    }
  });

  it("is the only stylesheet that uses the motion attribute", () => {
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) walk(path);
        else if (path.endsWith(".css")) files.push(path);
      }
    };
    walk("src");
    const users = files.filter((file) =>
      readFileSync(file, "utf8").includes(MOTION_ATTRIBUTE),
    );
    expect(users).toEqual([join("src", "motion.css")]);
  });
});

describe("meters", () => {
  it("glide the bottom bar's usage fill by transform, not width", () => {
    const css = readFileSync("src/chrome/FooterUsage.css", "utf8");
    expect(css).toContain(
      "transition: transform var(--aven-motion-base) var(--aven-ease-out);",
    );
    expect(css).not.toMatch(/transition:\s*width/);
  });
});

describe("pressed buttons", () => {
  it("press at once on the shared button classes, by scale and without a transition", () => {
    const press = motionCss.slice(
      motionCss.indexOf("/* A press shows at once"),
    );
    const selectors = press.slice(press.indexOf("*/") + 2, press.indexOf("{"));
    for (const shared of [
      ".aven-press",
      ".settings-button",
      ".team-card-button",
      ".discussion-float-control",
      ".toolbar-panel-icon-button",
    ])
      expect(selectors).toContain(`${shared}:active`);
    expect(press).toContain("scale: var(--aven-press-scale);");
    // One rule for each: the old per-control press transforms are gone.
    for (const file of [
      "src/surfaces/SettingsControls.css",
      "src/surfaces/WorkspaceHome.css",
    ])
      expect(readFileSync(file, "utf8")).not.toMatch(
        /:active:not\(:disabled\) \{\s*transform: scale/,
      );
  });
});

describe("reduced motion", () => {
  it("follows the system's setting", () => {
    const stop = initMotionPreference();
    expect(document.documentElement.getAttribute(MOTION_ROOT_ATTRIBUTE)).toBe(
      "full",
    );
    expect(motionReduced()).toBe(false);

    systemReduces = true;
    for (const listener of mediaListeners) listener();
    expect(document.documentElement.getAttribute(MOTION_ROOT_ATTRIBUTE)).toBe(
      "reduce",
    );
    expect(motionReduced()).toBe(true);
    stop();
    expect(mediaListeners).toHaveLength(0);
  });

  it("follows Aven's own setting, saved here or in another window", () => {
    const stop = initMotionPreference();
    SETTINGS.reduceMotion.save(true);
    expect(motionReduced()).toBe(true);
    SETTINGS.reduceMotion.save(false);
    expect(motionReduced()).toBe(false);

    localStorage.setItem("aven.reduceMotion", "1");
    window.dispatchEvent(
      new StorageEvent("storage", { key: "aven.reduceMotion" }),
    );
    expect(document.documentElement.getAttribute(MOTION_ROOT_ATTRIBUTE)).toBe(
      "reduce",
    );
    stop();
  });

  it("asks the system before the root is marked", () => {
    expect(motionReduced()).toBe(false);
    systemReduces = true;
    expect(motionReduced()).toBe(true);
  });

  it("starts nothing while motion is reduced", () => {
    SETTINGS.reduceMotion.save(true);
    applyMotionPreference();
    const element = document.createElement("div");
    expect(playMotion(element, "rise")).toBe(false);
    expect(element.hasAttribute(MOTION_ATTRIBUTE)).toBe(false);
  });
});

describe("one-shot motion", () => {
  beforeEach(() => applyMotionPreference());

  it("marks the element at once and clears the mark when its animation ends", () => {
    const element = document.createElement("div");
    document.body.append(element);
    expect(playMotion(element, "rise")).toBe(true);
    expect(element.getAttribute(MOTION_ATTRIBUTE)).toBe("rise");

    // A child's animation ending is not this one's.
    const child = document.createElement("span");
    element.append(child);
    child.dispatchEvent(new Event("animationend", { bubbles: true }));
    expect(element.getAttribute(MOTION_ATTRIBUTE)).toBe("rise");

    element.dispatchEvent(new Event("animationend"));
    expect(element.hasAttribute(MOTION_ATTRIBUTE)).toBe(false);
  });

  it("sets no timer, so an idle window has nothing to wake it", () => {
    vi.useFakeTimers();
    const element = document.createElement("div");
    playMotion(element, "fade");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("lets a newer animation replace an older one without the older clearing it", () => {
    const element = document.createElement("div");
    playMotion(element, "fade");
    playMotion(element, "roll");
    expect(element.getAttribute(MOTION_ATTRIBUTE)).toBe("roll");
    element.dispatchEvent(new Event("animationcancel"));
    expect(element.hasAttribute(MOTION_ATTRIBUTE)).toBe(false);
  });

  it("does nothing without an element", () => {
    expect(playMotion(null, "fade")).toBe(false);
  });
});

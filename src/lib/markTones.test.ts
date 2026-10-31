// @vitest-environment happy-dom
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { appearanceSigil } from "./dotSigils";
import {
  MARK_TONES,
  appearanceTone,
  markTone,
  markToneColor,
  nearestToneIndex,
  saveProjectTone,
} from "./markTones";
import { projectKey } from "./paths";
import { projectAppearance, projectToneAt } from "./projectAppearance";
import {
  TAB_GROUP_COLORS,
  saveTabGroupColor,
  saveTabGroupCustomColor,
  saveTabGroupMascot,
  tabGroupColor,
} from "./tabGroups";

vi.mock("@tauri-apps/api/core", () => ({
  convertFileSrc: (path: string) => `asset://localhost${path}`,
  invoke: vi.fn(),
}));

const APP = "/Users/me/Developer/app";
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

describe("mark colours", () => {
  it("offers Grey and eight colours, in the order colours were saved in", () => {
    expect(MARK_TONES.map((item) => item.label)).toEqual([
      "Grey",
      "Blue",
      "Red",
      "Yellow",
      "Green",
      "Pink",
      "Purple",
      "Teal",
      "Orange",
    ]);
    // One mark colour for each colour a project could pick before marks.
    expect(MARK_TONES).toHaveLength(TAB_GROUP_COLORS.length);
  });

  it("shows a colour saved before marks", () => {
    saveTabGroupColor(projectKey(APP), 4);
    expect(projectToneAt(APP)).toBe("green");
    saveTabGroupColor(projectKey(APP), 6);
    expect(projectToneAt(APP)).toBe("purple");
  });

  it("reads a custom colour saved before marks as the nearest mark colour", () => {
    saveTabGroupCustomColor(projectKey(APP), "#2f80ed");
    expect(projectToneAt(APP)).toBe("blue");
    saveTabGroupCustomColor(projectKey(APP), "#e0457b");
    expect(projectToneAt(APP)).toBe("pink");
    // Washed out, near black or near white: Grey.
    expect(MARK_TONES[nearestToneIndex("#8a8d91")].tone).toBe("grey");
    expect(MARK_TONES[nearestToneIndex("#050505")].tone).toBe("grey");
    expect(MARK_TONES[nearestToneIndex("#fbfbfb")].tone).toBe("grey");
  });

  it("gives a project that never picked one its own colour from its name", () => {
    const automatic = (TAB_GROUP_COLORS as readonly string[]).indexOf(
      tabGroupColor("app"),
    );
    expect(automatic).toBeGreaterThan(0);
    expect(projectToneAt(APP)).toBe(MARK_TONES[automatic].tone);
    expect(projectToneAt(APP)).not.toBe("grey");
  });

  it("keeps a project picked as Grey plain", () => {
    saveTabGroupColor(projectKey(APP), 0);
    expect(projectToneAt(APP)).toBe("grey");
    expect(appearanceTone(projectAppearance(APP))).toBe("grey");
  });

  it("is Grey for a personal mark with no colour picked", () => {
    expect(markTone({ colorIndex: null })).toBe("grey");
    expect(markTone({ colorIndex: 7 })).toBe("teal");
    expect(markTone({ colorIndex: 99 })).toBe("grey");
  });

  it("saves a picked colour where colours were kept, keeping the mark's shape", () => {
    const before = projectAppearance(APP);
    const sigil = appearanceSigil(before);
    saveProjectTone(before, 2);
    const after = projectAppearance(APP);
    expect(after.colorIndex).toBe(2);
    expect(appearanceTone(after)).toBe("red");
    // An unpicked mark follows its colour; picking a colour keeps its shape.
    expect(appearanceSigil(after).key).toBe(sigil.key);
    expect(after.mascotOverride).not.toBeNull();
    expect(
      JSON.parse(data.get("monocode:tab-group:colors") ?? "{}"),
    ).toMatchObject({ [projectKey(APP)]: "2" });
  });

  it("leaves a picked mark alone when the colour changes", () => {
    saveTabGroupMascot(projectKey(APP), "snail");
    const picked = appearanceSigil(projectAppearance(APP)).key;
    saveProjectTone(projectAppearance(APP), 0);
    expect(projectAppearance(APP).mascotOverride).toBe("snail");
    expect(appearanceSigil(projectAppearance(APP)).key).toBe(picked);
    expect(projectToneAt(APP)).toBe("grey");
  });

  it("draws each colour from a theme token, Grey from the text colour", () => {
    expect(markToneColor("grey")).toBe(
      "color-mix(in srgb, var(--color-content) 55%, transparent)",
    );
    for (const { tone } of MARK_TONES.slice(1))
      expect(markToneColor(tone)).toBe(`var(--aven-mark-${tone})`);
  });
});

describe("mark colour tokens", () => {
  const strip = (text: string) => text.replace(/\/\*[\s\S]*?\*\//g, "");
  const index = strip(readFileSync("src/index.css", "utf8"));
  const dotMark = strip(readFileSync("src/chrome/DotMark.css", "utf8"));
  const block = (selector: string) => {
    const at = index.indexOf(`\n${selector} {`);
    expect(at).toBeGreaterThanOrEqual(0);
    return index.slice(at, index.indexOf("\n}", at));
  };

  it("defines every colour for dark and for light", () => {
    for (const selector of [":root", "html.theme-light"]) {
      const body = block(selector);
      for (const { tone } of MARK_TONES.slice(1)) {
        expect(body).toMatch(new RegExp(`--aven-mark-${tone}: hsl\\(`));
        expect(body).toMatch(new RegExp(`--aven-mark-${tone}-peak: hsl\\(`));
      }
    }
  });

  it("colours marks only through those tokens, never a literal", () => {
    for (const { tone } of MARK_TONES.slice(1))
      expect(dotMark).toMatch(
        new RegExp(
          `\\.dot-mark\\[data-tone="${tone}"\\]\\s*\\{\\s*--dot-mark-tint: var\\(--aven-mark-${tone}\\);\\s*--dot-mark-peak: var\\(--aven-mark-${tone}-peak\\);`,
        ),
      );
    expect(dotMark).not.toMatch(/#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(/i);
  });
});

// @vitest-environment happy-dom
import { readFileSync } from "node:fs";
import { act, createElement, useLayoutEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import {
  afterPopupGlass,
  POPUP_GLASS_CLASS,
  popupGlassOpacity,
  usePopupGlass,
} from "./popupGlass";
import type { UsagePanelSnapshot } from "./usagePanel";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

type Theme = UsagePanelSnapshot["theme"];
const glass: Theme = {
  mode: "dark",
  accent: "#57b5ff",
  background: "#0f0f0f",
  text: "#ffffff",
  glass: true,
  opacity: 0.52,
};
const opaque: Theme = { ...glass, glass: false, opacity: undefined };

let host: HTMLDivElement;
let root: Root;
const shown: string[] = [];

function Popup({ theme, open }: { theme?: Theme; open: string }) {
  usePopupGlass(theme, open);
  // As in the popup windows: show (`ready`) after the glass effect ran.
  useLayoutEffect(() => afterPopupGlass(() => shown.push(open)), [open]);
  return createElement("div", {
    className: "toolbar-panel",
    style: { borderRadius: "12px" },
  });
}

async function render(theme: Theme | undefined, open: string) {
  await act(async () => root.render(createElement(Popup, { theme, open })));
}

const translucent = () =>
  document.documentElement.classList.contains(POPUP_GLASS_CLASS);

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.mocked(invoke).mockReset();
  vi.mocked(invoke).mockImplementation(
    async (_command, args) =>
      (args as { frame: unknown } | undefined)?.frame != null,
  );
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
    x: 0,
    y: 0,
    width: 360,
    height: 300,
  } as DOMRect);
  shown.length = 0;
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  // Leave the shared native state opaque for the next test.
  await render(opaque, "cleanup");
  await act(async () => root.unmount());
  host.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("popup glass decision", () => {
  it("frosts only dark glass snapshots below full opacity", () => {
    expect(popupGlassOpacity(glass)).toBe(0.52);
    expect(popupGlassOpacity(undefined)).toBeNull();
    // Owners that predate glass hints send none and stay opaque.
    expect(
      popupGlassOpacity({ mode: "dark", accent: "#fff", background: "#000" }),
    ).toBeNull();
    expect(popupGlassOpacity(opaque)).toBeNull();
    expect(popupGlassOpacity({ ...glass, mode: "light" })).toBeNull();
    expect(popupGlassOpacity({ ...glass, opacity: 1 })).toBeNull();
    expect(popupGlassOpacity({ ...glass, opacity: Number.NaN })).toBeNull();
  });
});

describe("popup glass window", () => {
  it("places native frost behind the measured panel before the popup is shown, then tints it", async () => {
    let finish!: (applied: boolean) => void;
    vi.mocked(invoke).mockImplementationOnce(
      () => new Promise((done) => (finish = done)),
    );
    await render(glass, "open-1");
    expect(invoke).toHaveBeenCalledExactlyOnceWith("popup_glass_set", {
      frame: {
        x: 0,
        y: 0,
        width: 360,
        height: 300,
        radius: 12,
        viewportWidth: window.innerWidth,
        viewportHeight: window.innerHeight,
      },
    });
    // Neither shown nor translucent until the frost is in place.
    expect(shown).toEqual([]);
    expect(translucent()).toBe(false);
    await act(async () => finish(true));
    expect(shown).toEqual(["open-1"]);
    expect(translucent()).toBe(true);
    expect(
      document.documentElement.style.getPropertyValue("--popup-glass-opacity"),
    ).toBe("52%");
  });

  it("turns opaque before removing the frost when glass is turned off", async () => {
    await render(glass, "open-1");
    expect(translucent()).toBe(true);
    let finish!: () => void;
    vi.mocked(invoke).mockImplementationOnce(
      () => new Promise((done) => (finish = () => done(false))),
    );
    await render({ ...glass, mode: "light", glass: false }, "open-2");
    expect(translucent()).toBe(false);
    expect(
      document.documentElement.style.getPropertyValue("--popup-glass-opacity"),
    ).toBe("");
    expect(invoke).toHaveBeenLastCalledWith("popup_glass_set", {
      frame: null,
    });
    await act(async () => finish());
    expect(shown).toEqual(["open-1", "open-2"]);
    // Opaque popups that never had frost make no native request.
    vi.mocked(invoke).mockClear();
    await render(opaque, "open-3");
    expect(invoke).not.toHaveBeenCalled();
    expect(shown.at(-1)).toBe("open-3");
  });

  it("stays opaque when the native material is unavailable", async () => {
    vi.mocked(invoke).mockRejectedValueOnce(new Error("no glass"));
    await render(glass, "open-1");
    expect(translucent()).toBe(false);
    expect(shown).toEqual(["open-1"]);
    vi.mocked(invoke).mockResolvedValueOnce(false);
    await render(glass, "open-2");
    expect(translucent()).toBe(false);
  });

  it("re-measures for each presentation and removes the tint on unmount", async () => {
    await render(glass, "open-1");
    await render(glass, "open-2");
    expect(
      vi.mocked(invoke).mock.calls.filter(([, args]) => args?.frame),
    ).toHaveLength(2);
    await act(async () => root.render(null));
    expect(translucent()).toBe(false);
  });

  it("tints with the workspace background at the workspace opacity, opaque for accessibility", () => {
    const css = readFileSync("src/chrome/ToolbarPanel.css", "utf8");
    expect(css).toMatch(
      /html\.popup-glass \.toolbar-panel \{\s*background: color-mix\(\s*in srgb,\s*var\(--toolbar-panel-bg\) var\(--popup-glass-opacity, 100%\),\s*transparent\s*\);/,
    );
    expect(css).toMatch(
      /@media \(prefers-reduced-transparency: reduce\), \(prefers-contrast: more\) \{\s*html\.popup-glass \.toolbar-panel \{\s*background: var\(--toolbar-panel-bg\);/,
    );
  });
});

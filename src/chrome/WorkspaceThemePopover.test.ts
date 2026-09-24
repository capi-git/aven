// @vitest-environment happy-dom
import { act, createElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WorkspaceThemePopover } from "./WorkspaceThemePopover";

const themeApi = vi.hoisted(() => ({
  theme: {
    hue: 240,
    saturation: 8,
    preference: "dark" as "dark" | "light" | "system",
    opacity: 0.15,
    blur: 0,
    bodyGlass: true,
  },
  save: vi.fn(),
  reset: vi.fn(),
  preset: vi.fn(),
  color: vi.fn(),
}));
vi.mock("../lib/platform", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/platform")>()),
  HAS_NATIVE_GLASS: true,
}));
vi.mock("../lib/workspaceThemes", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/workspaceThemes")>()),
  useWorkspaceTheme: () => themeApi.theme,
  saveWorkspaceTheme: themeApi.save,
  resetWorkspaceTheme: themeApi.reset,
  applyWorkspaceThemePreset: themeApi.preset,
  saveWorkspaceColor: themeApi.color,
}));

let root: Root;
let container: HTMLDivElement;
let anchor: HTMLButtonElement;
let outside: HTMLInputElement;
let editedProfile = { id: "work", name: "Work" };
const dismissed = vi.fn();
function Harness() {
  const [open, setOpen] = useState(true);
  return open
    ? createElement(WorkspaceThemePopover, {
        profileId: editedProfile.id,
        profileName: editedProfile.name,
        anchor,
        onDismiss: () => {
          dismissed();
          setOpen(false);
        },
      })
    : null;
}
beforeEach(() => {
  vi.clearAllMocks();
  themeApi.theme.preference = "dark";
  editedProfile = { id: "work", name: "Work" };
  const stored = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => stored.get(key) ?? null,
    setItem: (key: string, value: string) => stored.set(key, value),
  });
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  anchor = document.createElement("button");
  anchor.textContent = "Work appearance";
  outside = document.createElement("input");
  document.body.append(anchor, outside, container);
  vi.spyOn(anchor, "getBoundingClientRect").mockReturnValue(
    new DOMRect(20, 100, 150, 24),
  );
  root = createRoot(container);
  anchor.focus();
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  anchor.remove();
  outside.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
async function render() {
  await act(async () => root.render(createElement(Harness)));
}
function dialog() {
  return document.querySelector<HTMLElement>(
    '[role="dialog"][aria-label^="Customize "]',
  );
}
function control(label: string) {
  return document.querySelector<HTMLButtonElement>(`[aria-label="${label}"]`)!;
}

describe("workspace appearance dismissal", () => {
  it("focuses the dialog and closes through its explicit button, restoring the anchor", async () => {
    await render();
    expect(document.activeElement).toBe(dialog());
    const portalFrame = dialog()!.parentElement!;
    expect(portalFrame.querySelector(".popover-backdrop")).toBeNull();
    await act(async () => control("Close appearance").click());
    expect(dialog()).toBeNull();
    expect(portalFrame.isConnected).toBe(false);
    expect(dismissed).toHaveBeenCalledOnce();
    expect(document.activeElement).toBe(anchor);
  });

  it("handles Escape from a slider before application shortcuts and restores focus", async () => {
    await render();
    const slider = dialog()!.querySelector<HTMLInputElement>(
      'input[type="range"]',
    )!;
    slider.focus();
    const applicationKey = vi.fn();
    document.addEventListener("keydown", applicationKey);
    try {
      await act(async () =>
        slider.dispatchEvent(
          new KeyboardEvent("keydown", {
            key: "Escape",
            bubbles: true,
            cancelable: true,
          }),
        ),
      );
      expect(applicationKey).not.toHaveBeenCalled();
      expect(dialog()).toBeNull();
      expect(dismissed).toHaveBeenCalledOnce();
      expect(document.activeElement).toBe(anchor);
    } finally {
      document.removeEventListener("keydown", applicationKey);
    }
  });

  it("ignores inside and anchor clicks, and dismisses outside without stealing focus", async () => {
    await render();
    for (const target of [dialog()!, anchor]) {
      await act(async () =>
        target.dispatchEvent(
          new PointerEvent("pointerdown", { bubbles: true }),
        ),
      );
    }
    expect(dismissed).not.toHaveBeenCalled();
    outside.focus();
    await act(async () =>
      outside.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true })),
    );
    expect(dialog()).toBeNull();
    expect(dismissed).toHaveBeenCalledOnce();
    expect(document.activeElement).toBe(outside);
  });

  it("keeps preset choices available and saves them only to this workspace", async () => {
    await render();
    await act(async () => control("Ocean palette").click());
    expect(themeApi.preset).toHaveBeenCalledExactlyOnceWith(
      "work",
      expect.objectContaining({ name: "Ocean" }),
      "dark",
    );
    expect(themeApi.save).not.toHaveBeenCalled();
    expect(themeApi.reset).not.toHaveBeenCalled();
    expect(dismissed).not.toHaveBeenCalled();
    expect(dialog()).not.toBeNull();
  });

  it("offers all presets and makes Black opaque in dark mode", async () => {
    themeApi.theme.preference = "light";
    await render();
    expect(
      dialog()!.querySelectorAll('button[aria-label$=" palette"]'),
    ).toHaveLength(20);
    await act(async () => control("Black palette").click());
    expect(themeApi.save).toHaveBeenCalledExactlyOnceWith("work", {
      preference: "dark",
      opacity: 1,
      blur: 0,
      bodyGlass: true,
    });
    expect(themeApi.preset).toHaveBeenCalledExactlyOnceWith(
      "work",
      expect.objectContaining({
        name: "Black",
        colors: expect.objectContaining({
          dark: expect.objectContaining({ background: "#000000" }),
        }),
      }),
      "dark",
    );
  });

  it("saves near-clear opacity, blur, and workspace glass through the shared theme API", async () => {
    await render();
    const opacity =
      dialog()!.querySelector<HTMLInputElement>('[id$="-opacity"]')!;
    const blur = dialog()!.querySelector<HTMLInputElement>('[id$="-blur"]')!;
    expect(opacity.min).toBe("5");
    expect(opacity.value).toBe("15");
    expect(blur.min).toBe("0");
    const setValue = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )!.set!;
    for (const [input, value] of [
      [opacity, "5"],
      [blur, "32"],
    ] as const) {
      await act(async () => {
        setValue.call(input, value);
        input.dispatchEvent(new Event("input", { bubbles: true }));
      });
    }
    await act(async () =>
      dialog()!.querySelector<HTMLInputElement>('[type="checkbox"]')!.click(),
    );
    expect(themeApi.save.mock.calls).toEqual([
      ["work", { opacity: 0.05 }],
      ["work", { blur: 32 }],
      ["work", { bodyGlass: false }],
    ]);
    expect(dismissed).not.toHaveBeenCalled();
  });

  it("disables glass in the resolved light scheme without rewriting its saved values", async () => {
    themeApi.theme.preference = "light";
    await render();
    expect(dialog()!.querySelector("fieldset")!.disabled).toBe(true);
    expect(dialog()!.textContent).toContain(
      "Glass settings are saved for dark mode.",
    );
    expect(
      dialog()!.querySelector<HTMLInputElement>('[id$="-opacity"]')!.value,
    ).toBe("15");
    expect(themeApi.save).not.toHaveBeenCalled();
    expect(control("Close appearance").disabled).toBe(false);
    expect(control("Ocean palette").disabled).toBe(false);
  });

  it("edits dark Personal glass while the active Work window uses light mode", async () => {
    localStorage.setItem("monocode.colorScheme", "light");
    editedProfile = { id: "personal", name: "Personal" };
    themeApi.theme.preference = "dark";
    await render();
    expect(dialog()!.getAttribute("aria-label")).toBe("Customize Personal");
    expect(dialog()!.querySelector("fieldset")!.disabled).toBe(false);
    await act(async () =>
      dialog()!.querySelector<HTMLInputElement>('[type="checkbox"]')!.click(),
    );
    expect(themeApi.save).toHaveBeenCalledExactlyOnceWith("personal", {
      bodyGlass: false,
    });
  });

  it("follows OS changes for an inactive System profile independently of the active window", async () => {
    localStorage.setItem("monocode.colorScheme", "light");
    editedProfile = { id: "personal", name: "Personal" };
    themeApi.theme.preference = "system";
    let systemLight = false;
    const query = new EventTarget() as MediaQueryList;
    Object.defineProperty(query, "matches", { get: () => systemLight });
    vi.spyOn(window, "matchMedia").mockReturnValue(query);
    await render();
    expect(dialog()!.querySelector("fieldset")!.disabled).toBe(false);
    await act(async () => {
      systemLight = true;
      query.dispatchEvent(new Event("change"));
    });
    expect(dialog()!.querySelector("fieldset")!.disabled).toBe(true);
    await act(async () => {
      systemLight = false;
      query.dispatchEvent(new Event("change"));
    });
    expect(dialog()!.querySelector("fieldset")!.disabled).toBe(false);
    expect(themeApi.save).not.toHaveBeenCalled();
  });
});

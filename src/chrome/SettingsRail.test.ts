// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SETTINGS_SECTIONS } from "../lib/settings";
import { SettingsNav } from "./SettingsRail";

describe("settings navigation", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  it.each([false, true])(
    "offers accessible section buttons with embedded=%s",
    async (embedded) => {
      const onSelect = vi.fn();
      await act(async () =>
        root.render(
          createElement(SettingsNav, {
            section: "appearance",
            onSelect,
            onClose: vi.fn(),
            embedded,
          }),
        ),
      );

      const navigation = container.querySelector("nav")!;
      expect(navigation.getAttribute("aria-label")).toBe("Settings sections");
      const buttons = [
        ...navigation.querySelectorAll<HTMLButtonElement>("button"),
      ];
      expect(
        buttons.map((button) => button.getAttribute("aria-label")),
      ).toEqual(SETTINGS_SECTIONS.map(({ label }) => label));
      expect(
        buttons.every(
          (button) => button.type === "button" && button.tabIndex === 0,
        ),
      ).toBe(true);
      expect(navigation.querySelectorAll('[aria-current="page"]')).toHaveLength(
        1,
      );
      expect(
        navigation
          .querySelector('[aria-current="page"]')
          ?.getAttribute("aria-label"),
      ).toBe("Appearance");
      expect(navigation.textContent).toContain("Colors & layout");

      for (const [index, button] of buttons.entries()) {
        await act(async () => button.click());
        expect(onSelect).toHaveBeenLastCalledWith(SETTINGS_SECTIONS[index].id);
      }
    },
  );

  it("updates the current section without remounting and keeps Back separate", async () => {
    const onSelect = vi.fn();
    const onClose = vi.fn();
    await act(async () =>
      root.render(
        createElement(SettingsNav, {
          section: "general",
          onSelect,
          onClose,
          embedded: true,
        }),
      ),
    );
    await act(async () =>
      root.render(
        createElement(SettingsNav, {
          section: "providers",
          onSelect,
          onClose,
          embedded: true,
        }),
      ),
    );
    expect(
      container
        .querySelector('[aria-current="page"]')
        ?.getAttribute("aria-label"),
    ).toBe("Providers");

    const back = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Back"]',
    )!;
    expect(back.closest("nav")).toBeNull();
    await act(async () => back.click());
    expect(onClose).toHaveBeenCalledOnce();
    expect(onSelect).not.toHaveBeenCalled();
  });
});

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
    vi.restoreAllMocks();
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
      expect(
        navigation
          .querySelector('[aria-current="page"]')
          ?.getAttribute("aria-description"),
      ).toBe("Colour & transparency");

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
    ).toBe("Models");

    const back = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Back to app"]',
    )!;
    expect(back.closest("nav")).toBeNull();
    await act(async () => back.click());
    expect(onClose).toHaveBeenCalledOnce();
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("searches, narrows and clears without adding or removing a wheel listener", async () => {
    // In WebKit each wheel listener added or removed restyles the whole page,
    // and the results list mounts as a search starts and redraws per key.
    await act(async () =>
      root.render(
        createElement(SettingsNav, {
          section: "general",
          onSelect: vi.fn(),
          onClose: vi.fn(),
        }),
      ),
    );
    const search = container.querySelector<HTMLInputElement>(
      'input[aria-label="Search settings"]',
    )!;
    const type = (value: string) =>
      act(async () => {
        Object.getOwnPropertyDescriptor(
          HTMLInputElement.prototype,
          "value",
        )!.set!.call(search, value);
        search.dispatchEvent(new Event("input", { bubbles: true }));
      });
    const results = () =>
      container.querySelector('nav[aria-label="Settings search results"]');
    const wheelListeners = countWheelListeners();

    await type("t");
    expect(results()).not.toBeNull();
    await type("th");
    await type("the");
    await type("them");
    expect(results()?.textContent).toMatch(/setting/);
    await type("");
    expect(results()).toBeNull();
    expect(
      container.querySelector('nav[aria-label="Settings sections"]'),
    ).not.toBeNull();
    expect(wheelListeners()).toEqual({ added: 0, removed: 0 });
  });
});

/**
 * Wheel listeners added and removed from now on, on any element, the
 * document or the window. happy-dom's nodes inherit them from its own
 * EventTarget, not the global one, and the window's are bound copies.
 */
function countWheelListeners() {
  const node = Object.getPrototypeOf(Node.prototype) as EventTarget;
  const spies = (method: "addEventListener" | "removeEventListener") => [
    vi.spyOn(node, method),
    vi.spyOn(window, method),
  ];
  const added = spies("addEventListener");
  const removed = spies("removeEventListener");
  const wheel = (list: typeof added) =>
    list.flatMap((spy) => spy.mock.calls).filter(([type]) => type === "wheel")
      .length;
  return () => ({ added: wheel(added), removed: wheel(removed) });
}

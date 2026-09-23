// @vitest-environment happy-dom
import { act, createElement as h, Fragment, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { playCue } from "../lib/sounds";
import {
  Row,
  SecondaryButton,
  Segmented,
  Select,
  SettingsGroup,
  Slider,
  Toggle,
  settingAnchor,
} from "./SettingsControls";
vi.mock("../lib/sounds", () => ({ playCue: vi.fn() }));

let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.clearAllMocks();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

function ThemeControl() {
  const [value, onChange] = useState("system");
  return h(Segmented, {
    label: "Theme",
    value,
    onChange,
    options: [
      { value: "system", label: "System" },
      { value: "dark", label: "Dark" },
      { value: "light", label: "Light" },
    ],
  });
}
async function key(target: HTMLElement, value: string) {
  await act(async () =>
    target.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: value,
        bubbles: true,
        cancelable: true,
      }),
    ),
  );
}

describe("settings segmented keyboard controls", () => {
  it("has one tab stop and moves selection/focus with arrows, Home and End", async () => {
    await act(async () => root.render(h(ThemeControl)));
    const radios = Array.from(
      container.querySelectorAll<HTMLButtonElement>('[role="radio"]'),
    );
    expect(radios.map((radio) => radio.tabIndex)).toEqual([0, -1, -1]);
    radios[0].focus();
    await key(radios[0], "ArrowRight");
    expect(document.activeElement).toBe(radios[1]);
    expect(radios[1].getAttribute("aria-checked")).toBe("true");
    expect(radios.map((radio) => radio.tabIndex)).toEqual([-1, 0, -1]);
    await key(radios[1], "End");
    expect(document.activeElement).toBe(radios[2]);
    await key(radios[2], "ArrowDown");
    expect(document.activeElement).toBe(radios[0]);
    await key(radios[0], "ArrowLeft");
    expect(document.activeElement).toBe(radios[2]);
    await key(radios[2], "Home");
    expect(document.activeElement).toBe(radios[0]);
  });
  it("retains pointer selection and does not swallow unrelated shortcuts", async () => {
    await act(async () => root.render(h(ThemeControl)));
    const light =
      container.querySelectorAll<HTMLButtonElement>('[role="radio"]')[2];
    await act(async () => light.click());
    expect(light.getAttribute("aria-checked")).toBe("true");
    const event = new KeyboardEvent("keydown", {
      key: "Escape",
      bubbles: true,
      cancelable: true,
    });
    light.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
  });
});

it("connects control help text to its searchable row and honors explicit anchors", async () => {
  await act(async () =>
    root.render(
      h(
        Fragment,
        null,
        h(
          Row,
          {
            label: "Background opacity",
            description: "Lower opacity shows the desktop.",
          },
          h(Slider, {
            label: "Background opacity",
            value: 50,
            display: "50%",
            min: 25,
            max: 100,
            onChange: () => {},
          }),
        ),
        h(
          Row,
          {
            id: "setting-version",
            label: h("span", null, "Version ", h("strong", null, "0.1.81")),
          },
          h(SecondaryButton, {
            onClick: () => {},
            children: "Check for updates",
          }),
        ),
      ),
    ),
  );
  const slider = container.querySelector("input")!;
  const row = container.querySelector(
    `#${settingAnchor("Background opacity")}`,
  )!;
  expect(row.contains(slider)).toBe(true);
  expect(
    document.getElementById(slider.getAttribute("aria-describedby")!)
      ?.textContent,
  ).toBe("Lower opacity shows the desktop.");
  expect(slider.getAttribute("aria-valuetext")).toBe("50%");
  expect(container.querySelector("#setting-version")?.textContent).toContain(
    "Check for updates",
  );
});

it("keeps range changes, select changes and switch sounds wired to the original callbacks", async () => {
  const rangeChange = vi.fn();
  const selectChange = vi.fn();
  const toggleChange = vi.fn();
  await act(async () =>
    root.render(
      h(
        Fragment,
        null,
        h(Slider, {
          label: "Hue",
          value: 0,
          display: "0°",
          min: 0,
          max: 360,
          onChange: rangeChange,
        }),
        h(Select, {
          label: "Default model",
          value: "first",
          options: [
            { value: "first", label: "First" },
            { value: "next", label: "Next" },
          ],
          onChange: selectChange,
        }),
        h(Toggle, { label: "Notes", on: false, onChange: toggleChange }),
      ),
    ),
  );
  await act(async () => {
    const slider = container.querySelector("input")!;
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )!.set!.call(slider, "180");
    slider.dispatchEvent(new Event("input", { bubbles: true }));
    container.querySelector<HTMLButtonElement>('[role="switch"]')!.click();
  });
  await act(async () =>
    container.querySelector<HTMLButtonElement>('[role="combobox"]')!.click(),
  );
  await act(async () =>
    document.querySelectorAll<HTMLButtonElement>('[role="option"]')[1].click(),
  );
  expect(rangeChange).toHaveBeenCalledWith(180);
  expect(selectChange).toHaveBeenCalledWith("next");
  expect(toggleChange).toHaveBeenCalledWith(true);
  expect(playCue).toHaveBeenCalledWith("switch");
});

it("does not activate disabled switches or actions", async () => {
  const onChange = vi.fn();
  const onClick = vi.fn();
  await act(async () =>
    root.render(
      h(
        Fragment,
        null,
        h(Toggle, {
          label: "Keep one provider",
          on: true,
          disabled: true,
          onChange,
        }),
        h(SecondaryButton, { disabled: true, onClick, children: "Restore" }),
      ),
    ),
  );
  await act(async () =>
    container
      .querySelectorAll<HTMLButtonElement>("button")
      .forEach((button) => button.click()),
  );
  expect(onChange).not.toHaveBeenCalled();
  expect(onClick).not.toHaveBeenCalled();
  expect(playCue).not.toHaveBeenCalled();
});

it("names a settings group from its heading and shows its scope", async () => {
  await act(async () =>
    root.render(
      h(SettingsGroup, {
        title: "Theme",
        description: "Make Aven feel like yours.",
        scope: "This workspace",
        id: "theme-group",
        children: h(
          Row,
          { label: "Notes" },
          h(Toggle, { label: "Notes", on: true, onChange: () => {} }),
        ),
      }),
    ),
  );
  const section = container.querySelector("section")!;
  expect(
    document.getElementById(section.getAttribute("aria-labelledby")!)
      ?.textContent,
  ).toBe("Theme");
  expect(section.textContent).toContain("This workspace");
});

it("accepts programmatic search focus without adding rows or groups to the tab order", async () => {
  const result = document.createElement("button");
  result.textContent = "Background opacity";
  document.body.append(result);
  result.focus();
  await act(async () =>
    root.render(
      h(SettingsGroup, {
        title: "Window",
        id: "settings-window",
        children: h(
          Row,
          { label: "Background opacity", description: "Reveal the desktop." },
          h(Slider, {
            label: "Background opacity",
            value: 70,
            display: "70%",
            min: 20,
            max: 100,
            onChange: () => {},
          }),
        ),
      }),
    ),
  );
  // Search results unmount before their destination is focused.
  result.remove();
  const row = document.getElementById(settingAnchor("Background opacity"))!;
  row.focus({ preventScroll: true });
  expect(document.activeElement).toBe(row);
  expect(row.tabIndex).toBe(-1);
  const group = document.getElementById("settings-window")!;
  group.focus({ preventScroll: true });
  expect(document.activeElement).toBe(group);
  expect(group.tabIndex).toBe(-1);
  const slider = container.querySelector("input")!;
  slider.focus();
  expect(document.activeElement).toBe(slider);
});

describe("settings app-rendered select", () => {
  const options = [
    { value: "first", label: "First", description: "The default option." },
    { value: "disabled", label: "Unavailable", disabled: true },
    { value: "second", label: "Second" },
    { value: "third", label: "Third" },
  ];
  function ControlledSelect({ disabled = false }: { disabled?: boolean }) {
    const [value, onChange] = useState("second");
    return h(
      Row,
      { label: "Choice", description: "Choose your preferred option." },
      h(Select, { label: "Choice", value, onChange, options, disabled }),
    );
  }
  const combo = () =>
    container.querySelector<HTMLButtonElement>('[role="combobox"]')!;
  const active = () =>
    document.getElementById(combo().getAttribute("aria-activedescendant")!);

  it("opens instantly in a themed listbox and commits keyboard selection only on Enter", async () => {
    await act(async () => root.render(h(ControlledSelect)));
    expect(container.querySelector("select")).toBeNull();
    expect(combo().textContent).toBe("Second");
    expect(combo().getAttribute("aria-expanded")).toBe("false");
    await key(combo(), "ArrowDown");
    expect(combo().getAttribute("aria-expanded")).toBe("true");
    expect(document.activeElement).toBe(combo());
    expect(active()?.textContent).toBe("Second");
    expect(document.querySelector('[role="listbox"]')?.getAttribute("id")).toBe(
      combo().getAttribute("aria-controls"),
    );
    expect(
      document
        .querySelector('[role="listbox"]')
        ?.getAttribute("aria-describedby"),
    ).toBe(combo().getAttribute("aria-describedby"));
    expect(document.querySelector(".toolbar-panel")).not.toBeNull();
    await key(combo(), "ArrowUp");
    expect(active()?.textContent).toContain("First");
    expect(combo().textContent).toBe("Second");
    await key(combo(), "Enter");
    expect(combo().textContent).toBe("First");
    expect(combo().getAttribute("aria-expanded")).toBe("false");
    expect(document.querySelector('[role="listbox"]')).toBeNull();
    expect(document.activeElement).toBe(combo());
  });

  it("supports Home, End, wrapping arrows, typeahead, and Escape without committing", async () => {
    await act(async () => root.render(h(ControlledSelect)));
    await key(combo(), "Home");
    expect(active()?.textContent).toContain("First");
    await key(combo(), "ArrowUp");
    expect(active()?.textContent).toBe("Third");
    await key(combo(), "ArrowDown");
    expect(active()?.textContent).toContain("First");
    await key(combo(), "End");
    expect(active()?.textContent).toBe("Third");
    await key(combo(), "s");
    expect(active()?.textContent).toBe("Second");
    await key(combo(), "Home");
    await key(combo(), "Escape");
    expect(combo().textContent).toBe("Second");
    expect(combo().getAttribute("aria-expanded")).toBe("false");
    expect(document.activeElement).toBe(combo());
  });

  it("preserves pointer selection and disabled choices while restoring trigger focus", async () => {
    await act(async () => root.render(h(ControlledSelect)));
    await act(async () => combo().click());
    const choices = [
      ...document.querySelectorAll<HTMLButtonElement>('[role="option"]'),
    ];
    expect(choices[1].disabled).toBe(true);
    await act(async () => choices[1].click());
    expect(combo().textContent).toBe("Second");
    expect(combo().getAttribute("aria-expanded")).toBe("true");
    await act(async () => choices[3].click());
    expect(combo().textContent).toBe("Third");
    expect(document.activeElement).toBe(combo());
  });

  it("closes when disabled and does not reopen unexpectedly when enabled", async () => {
    await act(async () => root.render(h(ControlledSelect)));
    await act(async () => combo().click());
    expect(document.querySelector('[role="listbox"]')).not.toBeNull();
    await act(async () => root.render(h(ControlledSelect, { disabled: true })));
    expect(combo().disabled).toBe(true);
    expect(document.querySelector('[role="listbox"]')).toBeNull();
    await act(async () => combo().click());
    expect(document.querySelector('[role="listbox"]')).toBeNull();
    await act(async () => root.render(h(ControlledSelect)));
    expect(combo().getAttribute("aria-expanded")).toBe("false");
  });

  it("dismisses outside and on Tab without stealing focus", async () => {
    await act(async () => root.render(h(ControlledSelect)));
    await act(async () => combo().click());
    await key(combo(), "Tab");
    expect(document.querySelector('[role="listbox"]')).toBeNull();
    await act(async () => combo().click());
    const outside = document.createElement("button");
    document.body.append(outside);
    await act(async () => {
      outside.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
      outside.focus();
    });
    expect(document.querySelector('[role="listbox"]')).toBeNull();
    expect(document.activeElement).toBe(outside);
    outside.remove();
  });
});

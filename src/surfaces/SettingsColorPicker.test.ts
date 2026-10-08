// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SettingsColorPicker } from "./SettingsColorPicker";

const TARGETS = [
  { value: "background", label: "Background" },
  { value: "accent", label: "Accent" },
] as const;

describe("settings color picker", () => {
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

  it("previews while dragging and saves once on release", async () => {
    const onChange = vi.fn();
    const onPreview = vi.fn();
    await act(async () =>
      root.render(
        createElement(SettingsColorPicker<"background" | "accent">, {
          targets: TARGETS,
          target: "background",
          onTarget: () => undefined,
          colors: { background: "#112233", accent: "#445566" },
          onChange,
          onPreview,
        }),
      ),
    );
    const field = container.querySelector<HTMLElement>(
      '[aria-label="Background richness and brightness"]',
    )!;
    field.getBoundingClientRect = () =>
      ({ left: 0, top: 0, width: 100, height: 100 }) as DOMRect;
    field.setPointerCapture = () => undefined;
    const pointer = (type: string, x: number, y: number) =>
      act(async () => {
        field.dispatchEvent(
          new PointerEvent(type, {
            bubbles: true,
            clientX: x,
            clientY: y,
            button: 0,
          }),
        );
      });

    await pointer("pointerdown", 10, 10);
    await pointer("pointermove", 50, 20);
    await pointer("pointermove", 90, 40);
    expect(onPreview).toHaveBeenCalledTimes(3);
    expect(onChange).not.toHaveBeenCalled();

    await pointer("pointerup", 90, 40);
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith(
      "background",
      onPreview.mock.calls.at(-1)![1],
    );
  });
  it("finishes a pending preview in its original target before selecting another", async () => {
    const onChange = vi.fn();
    const onPreview = vi.fn();
    const renderTarget = (target: "background" | "accent") =>
      act(async () =>
        root.render(
          createElement(SettingsColorPicker<"background" | "accent">, {
            targets: TARGETS,
            target,
            onTarget: () => undefined,
            colors: { background: "#112233", accent: "#445566" },
            onChange,
            onPreview,
          }),
        ),
      );
    await renderTarget("background");
    const field = container.querySelector<HTMLElement>(
      '[aria-label="Background richness and brightness"]',
    )!;
    field.getBoundingClientRect = () => new DOMRect(0, 0, 100, 100);
    field.setPointerCapture = vi.fn();
    await act(async () =>
      field.dispatchEvent(
        new PointerEvent("pointerdown", {
          bubbles: true,
          button: 0,
          pointerId: 1,
          clientX: 80,
          clientY: 40,
        }),
      ),
    );
    expect(onChange).not.toHaveBeenCalled();
    await renderTarget("accent");
    expect(onChange).toHaveBeenCalledExactlyOnceWith(
      "background",
      onPreview.mock.calls[0]![1],
    );
    expect(
      container.querySelector<HTMLInputElement>('[aria-label="Accent hex"]')!
        .value,
    ).toBe("#445566");
  });
});

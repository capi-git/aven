// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const availability = vi.hoisted(() => ({
  installed: new Set<string>(["claude"]),
}));

vi.mock("../lib/harness/availability", () => ({
  getHarnessAvailabilitySnapshot: () => 0,
  hasProbedHarnessAvailability: () => true,
  isHarnessAvailable: (harness: string) => availability.installed.has(harness),
  probeHarnessAvailability: () => Promise.resolve(),
  subscribeHarnessAvailability: () => () => undefined,
}));

vi.mock("../lib/harness/registry", () => ({
  refreshHarnessCatalogs: () => Promise.resolve(),
}));

import { SecondOpinionButton } from "./SecondOpinionButton";
import { resetHarnessModelOverlays, setHarnessModels } from "../lib/models";

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  availability.installed = new Set(["claude"]);
  resetHarnessModelOverlays();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  resetHarnessModelOverlays();
  container.remove();
  vi.unstubAllGlobals();
});

function renderButton(onPick = vi.fn()) {
  act(() =>
    root.render(
      createElement(SecondOpinionButton, {
        from: "claude",
        onPick,
        includeCurrent: true,
        excludeModelName: "Answering Model",
      }),
    ),
  );
  return onPick;
}

const trigger = () =>
  container.querySelector<HTMLButtonElement>('button[aria-haspopup="menu"]')!;

describe("second opinion from a single provider", () => {
  it("offers the same provider's other models and hides the one that answered", () => {
    setHarnessModels("claude", [
      { id: "claude:answering", harness: "claude", name: "Answering Model" },
      { id: "claude:reviewer", harness: "claude", name: "Reviewer Model" },
    ]);
    const onPick = renderButton();
    expect(trigger().disabled).toBe(false);
    expect(trigger().getAttribute("aria-label")).toBe("Second opinion");

    act(() => trigger().click());
    const provider = Array.from(
      document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'),
    ).find((row) => row.textContent?.includes("Claude Code"))!;
    expect(provider).toBeTruthy();
    act(() => {
      provider.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
    });
    const models = Array.from(
      document.querySelectorAll(
        '[role="menu"][aria-label="Claude Code models"] [role="menuitem"]',
      ),
    ).map((row) => row.textContent);
    expect(models).toEqual(["Reviewer Model"]);

    // Choosing the provider row picks a different model, never the answer's.
    act(() => provider.click());
    expect(onPick).toHaveBeenCalledExactlyOnceWith("claude", "claude:reviewer");
  });

  it("disables with a clear label when no different model is available", () => {
    setHarnessModels("claude", [
      { id: "claude:answering", harness: "claude", name: "Answering Model" },
    ]);
    renderButton();
    expect(trigger().disabled).toBe(true);
    expect(trigger().getAttribute("aria-label")).toBe(
      "No different model available for a second opinion",
    );
  });

  it("stays enabled while another installed provider's catalog is still loading", () => {
    availability.installed = new Set(["claude", "codex"]);
    setHarnessModels("claude", [
      { id: "claude:answering", harness: "claude", name: "Answering Model" },
    ]);
    renderButton();
    expect(trigger().disabled).toBe(false);
    expect(trigger().getAttribute("aria-label")).toBe("Second opinion");
  });
});

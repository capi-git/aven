// @vitest-environment happy-dom
import { act, createElement, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./ProviderSetup", () => ({
  ProviderSetup: (props: {
    embedded?: {
      onBack: () => void;
      onContinue: (harness?: string) => void;
    };
  }) =>
    createElement(
      "div",
      { "data-provider-setup": "" },
      createElement(
        "button",
        { type: "button", onClick: () => props.embedded?.onBack() },
        "Back",
      ),
      createElement(
        "button",
        {
          type: "button",
          onClick: () => props.embedded?.onContinue("claude"),
        },
        "Continue",
      ),
    ),
}));

import { Walkthrough } from "./Walkthrough";

let root: Root;
let container: HTMLDivElement;
const onAction = vi.fn();
const onAgentsDone = vi.fn();
const onProject = vi.fn<(choice: "folder" | "sample") => Promise<boolean>>();

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  onAction.mockReset();
  onAgentsDone.mockReset();
  onProject.mockReset().mockResolvedValue(true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

async function render(props: Partial<ComponentProps<typeof Walkthrough>> = {}) {
  await act(async () =>
    root.render(
      createElement(Walkthrough, {
        step: "welcome",
        done: [],
        onAction,
        onAgentsDone,
        onProject,
        ...props,
      }),
    ),
  );
}

function dialog() {
  return document.querySelector<HTMLElement>(".walkthrough-panel")!;
}

function button(label: string) {
  const found = [...dialog().querySelectorAll("button")].find(
    (item) => item.textContent === label,
  );
  expect(found, label).toBeDefined();
  return found!;
}

async function click(label: string) {
  await act(async () => button(label).click());
}

describe("the walkthrough dialog", () => {
  it("welcomes with the step strip, three cards, Skip setup and Get started", async () => {
    await render();
    expect(dialog().getAttribute("role")).toBe("dialog");
    expect(dialog().getAttribute("aria-modal")).toBe("true");
    const steps = [...dialog().querySelectorAll(".walkthrough-steps li")];
    expect(steps.map((step) => step.textContent)).toEqual([
      "Welcome",
      "Agents",
      "Project",
      "Tour",
    ]);
    expect(steps[0].getAttribute("aria-current")).toBe("step");
    expect(dialog().querySelector("h2")?.textContent).toBe("Welcome to Aven");
    expect(dialog().textContent).toContain("Your coding agents, side by side.");
    expect(
      [...dialog().querySelectorAll(".walkthrough-card strong")].map(
        (title) => title.textContent,
      ),
    ).toEqual(["Many agents", "Work together", "See and ship"]);
    expect(dialog().querySelectorAll(".walkthrough-cast svg")).toHaveLength(5);
    // Get started has the keyboard, so Enter goes on.
    expect(document.activeElement?.textContent).toBe("Get started");
    await click("Get started");
    expect(onAction).toHaveBeenLastCalledWith({ type: "next" });
    await click("Skip setup");
    expect(onAction).toHaveBeenLastCalledWith({ type: "skip" });
  });

  it("ticks finished steps in the strip", async () => {
    await render({ step: "project", done: ["welcome", "agents"] });
    const steps = [...dialog().querySelectorAll(".walkthrough-steps li")];
    expect(steps.map((step) => step.hasAttribute("data-done"))).toEqual([
      true,
      true,
      false,
      false,
    ]);
    expect(steps[1].querySelector("svg")).not.toBeNull();
    expect(steps[2].getAttribute("aria-current")).toBe("step");
  });

  it("uses provider setup as the Agents step", async () => {
    await render({ step: "agents", done: ["welcome"] });
    expect(dialog().querySelector("[data-provider-setup]")).not.toBeNull();
    await click("Continue");
    expect(onAgentsDone).toHaveBeenCalledExactlyOnceWith("claude");
    expect(onAction).toHaveBeenLastCalledWith({ type: "next" });
    await click("Back");
    expect(onAction).toHaveBeenLastCalledWith({ type: "back" });
    await click("Skip setup");
    expect(onAction).toHaveBeenLastCalledWith({ type: "skip" });
  });

  it("offers a folder or the sample, and goes on once a project is added", async () => {
    await render({ step: "project", done: ["welcome", "agents"] });
    expect(dialog().querySelector("h2")?.textContent).toBe(
      "Pick something to work on",
    );
    const choices = [...dialog().querySelectorAll('[role="radio"]')];
    expect(
      choices.map((choice) => choice.querySelector("strong")?.textContent),
    ).toEqual(["Open a folder", "Try a sample"]);
    // The sample is the suggested start.
    expect(choices[1].getAttribute("aria-checked")).toBe("true");
    await click("Continue");
    expect(onProject).toHaveBeenCalledExactlyOnceWith("sample");
    expect(onAction).toHaveBeenLastCalledWith({ type: "next" });

    onAction.mockClear();
    await act(async () => (choices[0] as HTMLButtonElement).click());
    expect(choices[0].getAttribute("aria-checked")).toBe("true");
    onProject.mockResolvedValueOnce(false);
    await click("Continue");
    expect(onProject).toHaveBeenLastCalledWith("folder");
    // The folder picker was cancelled: stay.
    expect(onAction).not.toHaveBeenCalled();
  });

  it("says what went wrong when the sample can't be made", async () => {
    onProject.mockRejectedValueOnce("Git is not installed");
    await render({ step: "project", done: ["welcome", "agents"] });
    await click("Continue");
    expect(dialog().querySelector('[role="alert"]')?.textContent).toBe(
      "Git is not installed",
    );
    expect(onAction).not.toHaveBeenCalled();
    expect(button("Continue").disabled).toBe(false);
  });

  it("goes back, skips the step, or skips setup from Project", async () => {
    await render({ step: "project", done: ["welcome", "agents"] });
    await click("Back");
    expect(onAction).toHaveBeenLastCalledWith({ type: "back" });
    await click("Skip");
    expect(onAction).toHaveBeenLastCalledWith({ type: "skipStep" });
    await click("Skip setup");
    expect(onAction).toHaveBeenLastCalledWith({ type: "skip" });
    expect(onProject).not.toHaveBeenCalled();
  });
});

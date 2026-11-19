// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HelmBubble, type HelmFix, type HelmSay } from "./HelmRun";

let root: Root;
let host: HTMLDivElement;

beforeEach(() => {
  (
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});

async function render(say: HelmSay, fixes: HelmFix[]) {
  await act(async () =>
    root.render(
      createElement(HelmBubble, {
        say,
        run: null,
        stopInBar: false,
        fixes,
        onDismiss: () => {},
      }),
    ),
  );
}

describe("the usage limit in the helm's bubble", () => {
  it("offers a way round it beside messages that wait", async () => {
    const run = vi.fn();
    await render(
      { kind: "queued", text: "Queued", detail: "Sends at 3:40 PM" },
      [{ label: "Switch to Codex", run }],
    );
    expect(host.textContent).toContain("Sends at 3:40 PM");
    const button = host.querySelector<HTMLButtonElement>("[data-helm-fix]");
    expect(button?.textContent).toBe("Switch to Codex");
    button?.click();
    expect(run).toHaveBeenCalledOnce();
  });

  it("shows Continue at as a choice that stays on", async () => {
    const fix = (pressed: boolean): HelmFix => ({
      label: "Continue at 3:40 PM",
      run: () => {},
      pressed,
    });
    const say: HelmSay = {
      kind: "error",
      text: "Usage limit · resets 3:40 PM",
      detail: "Messages you send wait until then",
    };
    await render(say, [fix(false)]);
    let button = host.querySelector("[data-helm-fix]");
    expect(button?.getAttribute("aria-pressed")).toBe("false");
    expect(button?.querySelector("svg")).toBeNull();
    await render(say, [fix(true)]);
    button = host.querySelector("[data-helm-fix]");
    expect(button?.getAttribute("aria-pressed")).toBe("true");
    expect(button?.querySelector("svg")).not.toBeNull();
    expect(host.textContent).toContain("Usage limit · resets 3:40 PM");
  });
});

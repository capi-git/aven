// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WorkspaceFooter, type WorkspaceFooterProps } from "./WorkspaceFooter";

let root: Root;
let container: HTMLDivElement;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

async function render(props: WorkspaceFooterProps) {
  await act(async () => root.render(createElement(WorkspaceFooter, props)));
}
const terminal = () =>
  container.querySelector<HTMLButtonElement>(".workspace-footer-icon")!;

describe("WorkspaceFooter", () => {
  it("holds only agent usage and the terminal", async () => {
    const toggle = vi.fn();
    await render({
      active: true,
      cwd: "/project",
      onToggleTerminal: toggle,
      usage: createElement("span", { "data-usage": "" }, "usage"),
    });
    expect(container.querySelector("[data-usage]")).not.toBeNull();
    const buttons = [...container.querySelectorAll("button")];
    expect(buttons.map((button) => button.getAttribute("aria-label"))).toEqual([
      "Show terminal",
    ]);
    await act(async () => terminal().click());
    expect(toggle).toHaveBeenCalledOnce();
  });

  it("reflects the open terminal and renders nothing while inactive", async () => {
    await render({
      active: true,
      cwd: "/project",
      onToggleTerminal: vi.fn(),
      terminalOpen: true,
    });
    expect(terminal().getAttribute("aria-pressed")).toBe("true");
    expect(terminal().getAttribute("aria-label")).toBe("Hide terminal");
    await render({ active: false, cwd: "/project" });
    expect(container.childElementCount).toBe(0);
  });

  it("disables the terminal without a working folder", async () => {
    await render({ active: true, cwd: "~", onToggleTerminal: vi.fn() });
    expect(terminal().disabled).toBe(true);
    expect(terminal().title).toBe("Open a project to use the terminal");
  });
});

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

describe("WorkspaceFooter", () => {
  it("holds only shrunk teams, and nothing while inactive", async () => {
    await render({
      active: true,
      teams: createElement("span", { "data-teams": "" }, "pills"),
    });
    expect(
      container.querySelector("footer .workspace-footer-teams [data-teams]"),
    ).not.toBeNull();
    expect(container.querySelectorAll("button")).toHaveLength(0);
    await render({ active: false });
    expect(container.childElementCount).toBe(0);
  });
});

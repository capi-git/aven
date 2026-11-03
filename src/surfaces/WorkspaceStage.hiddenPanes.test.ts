// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LayoutNode } from "../lib/layout";
import {
  stableOrder,
  WorkspaceStage,
  type WorkspaceStageProps,
} from "./WorkspaceStage";

const leaf = (id: string): LayoutNode => ({ type: "leaf", id });

let root: Root;
let container: HTMLDivElement;
const surface = (id: string) =>
  container.querySelector<HTMLElement>(`[data-workspace-surface="${id}"]`)!;
const props = (
  shown: string,
  ids: string[] = ["chat", "notes"],
): WorkspaceStageProps => ({
  layout: leaf(shown),
  focusedId: shown,
  visible: true,
  surfaces: ids.map((id) => ({
    id,
    content: createElement("p", null, id),
  })),
  headers: [],
  onFocus: vi.fn(),
  onLayoutChange: vi.fn(),
  dragTarget: null,
  dragging: false,
});
const render = (next: WorkspaceStageProps) =>
  act(() => root.render(createElement(WorkspaceStage, next)));

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  for (const [name, size] of [
    ["clientWidth", 1000],
    ["clientHeight", 600],
  ] as const)
    Object.defineProperty(HTMLElement.prototype, name, {
      configurable: true,
      get(this: HTMLElement) {
        return this.classList.contains("workspace-stage") ? size : 0;
      },
    });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

describe("a hidden pane", () => {
  it("keeps its size in pixels, and follows the stage again once shown", () => {
    render(props("chat"));
    expect(surface("chat").style.width).toBe("100%");
    render(props("notes"));
    expect(surface("chat").hidden).toBe(true);
    expect(surface("chat").style.width).toBe("1000px");
    expect(surface("chat").style.height).toBe("600px");
    expect(surface("notes").style.width).toBe("100%");
    render(props("chat"));
    expect(surface("chat").style.width).toBe("100%");
  });
});

describe("the surfaces' order", () => {
  it("stays as first seen when the tabs are reordered, so no chat's nodes move", () => {
    const seen = new Map<string, number>();
    const of = (...ids: string[]) =>
      stableOrder(
        seen,
        ids.map((id) => ({ id })),
      ).map(({ id }) => id);
    expect(of("a", "b", "c")).toEqual(["a", "b", "c"]);
    expect(of("c", "a", "b")).toEqual(["a", "b", "c"]);
    expect(of("d", "b")).toEqual(["b", "d"]);
  });

  it("leaves the nodes in place on the page", () => {
    render(props("chat", ["chat", "notes"]));
    const first = surface("chat");
    render(props("chat", ["notes", "chat"]));
    expect(first.nextElementSibling).toBe(surface("notes"));
  });
});

it("keeps the drop hint out of the pane's column", () => {
  render(props("chat"));
  const body = surface("chat").querySelector("[data-workspace-body]")!;
  expect(
    body.querySelector(":scope > .workspace-stage-hint-layer"),
  ).not.toBeNull();
});

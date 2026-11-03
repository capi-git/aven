// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  setWorkspaceSurfaceDrag,
  useWorkspaceSurfaceDrag,
} from "./workspaceSurfaceDrag";

(
  globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

describe("the tab dragged over the panes", () => {
  afterEach(() => setWorkspaceSurfaceDrag({ dragging: false, target: null }));

  it("renders its reader only when the drag changes", () => {
    const render = vi.fn();
    const Reader = () => {
      render(useWorkspaceSurfaceDrag());
      return null;
    };
    const root = createRoot(document.createElement("div"));
    act(() => root.render(createElement(Reader)));
    expect(render).toHaveBeenCalledTimes(1);

    const over = {
      dragging: true,
      target: { id: "a", edge: "left" as const },
    };
    act(() => setWorkspaceSurfaceDrag(over));
    expect(render).toHaveBeenCalledTimes(2);
    expect(render).toHaveBeenLastCalledWith(over);

    // Every frame reports a target; the same one renders nothing.
    act(() =>
      setWorkspaceSurfaceDrag({
        dragging: true,
        target: { id: "a", edge: "left" },
      }),
    );
    expect(render).toHaveBeenCalledTimes(2);

    act(() => setWorkspaceSurfaceDrag({ dragging: false, target: null }));
    expect(render).toHaveBeenCalledTimes(3);
    act(() => root.unmount());
  });
});

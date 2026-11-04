// @vitest-environment happy-dom
import { readFileSync } from "node:fs";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useNarrowMark, useWidthChoice } from "./useNarrow";

describe("width without a render on every frame", () => {
  let container: HTMLDivElement;
  let root: Root;
  let resized: () => void;
  const setWidth = (node: HTMLElement, width: number) =>
    Object.defineProperty(node, "clientWidth", {
      configurable: true,
      value: width,
    });
  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.stubGlobal(
      "ResizeObserver",
      class {
        constructor(callback: () => void) {
          resized = callback;
        }
        observe() {}
        disconnect() {}
      },
    );
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });
  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  it("renders only when the answer changes", async () => {
    const seen: string[] = [];
    let mark = "wide";
    function Box() {
      const [ref, fit] = useWidthChoice<HTMLDivElement, string>((width) =>
        width > 0 && width < 300 ? `narrow ${mark}` : `wide ${mark}`,
      );
      seen.push(fit);
      return createElement("div", { ref });
    }
    await act(async () => root.render(createElement(Box)));
    const node = container.firstElementChild as HTMLElement;
    seen.length = 0;
    for (const width of [500, 480, 420, 360, 310]) {
      setWidth(node, width);
      act(() => resized());
    }
    expect(seen).toEqual([]);
    setWidth(node, 290);
    act(() => resized());
    expect(seen).toEqual(["narrow wide"]);
    // A render for another reason uses the width as it is now.
    mark = "again";
    await act(async () => root.render(createElement(Box)));
    expect(seen.at(-1)).toBe("narrow again");
  });

  it("marks an element across the line and keeps it while parked", async () => {
    const node = document.createElement("div");
    setWidth(node, 600);
    function Mark() {
      useNarrowMark(node, 480);
      return null;
    }
    await act(async () => root.render(createElement(Mark)));
    expect(node.hasAttribute("data-narrow")).toBe(false);
    setWidth(node, 400);
    act(() => resized());
    expect(node.hasAttribute("data-narrow")).toBe(true);
    setWidth(node, 0);
    act(() => resized());
    expect(node.hasAttribute("data-narrow")).toBe(true);
    setWidth(node, 600);
    act(() => resized());
    expect(node.hasAttribute("data-narrow")).toBe(false);
  });

  it("keeps a chat out of any container", () => {
    const css = readFileSync("src/surfaces/AgentTranscript.css", "utf8");
    expect(css).not.toContain("personal-transcript / inline-size");
    expect(readFileSync("src/surfaces/SessionPane.tsx", "utf8")).not.toContain(
      '"@container',
    );
  });
});

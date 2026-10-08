// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  getFileIcon,
  getFolderIcon,
  getIconSvg,
} from "react-material-icon-theme";
import { FileTypeIcon } from "./FileTypeIcon";

const fullSet = vi.hoisted(() => ({ load: vi.fn() }));
vi.mock("material-icon-svgs", async (original) => {
  fullSet.load();
  return original();
});

let container: HTMLDivElement;
let root: Root;

function expectedSvg(name: string) {
  const host = document.createElement("span");
  const svg = getIconSvg(name);
  if (!svg) throw new Error(`Missing reference icon: ${name}`);
  host.innerHTML = svg;
  return host.querySelector("svg")?.outerHTML;
}

async function waitForIcons(count: number) {
  await act(async () => {
    await vi.waitFor(() =>
      expect(container.querySelectorAll("svg")).toHaveLength(count),
    );
  });
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("FileTypeIcon DOM updates", () => {
  it("preserves unchanged SVGs through repeated parent updates, including hidden panels", async () => {
    const render = (tick: number) =>
      root.render(
        createElement(
          "div",
          { hidden: true, "data-tick": tick },
          Array.from({ length: 32 }, (_, key) =>
            createElement(FileTypeIcon, { key, name: "file.ts", isDir: false }),
          ),
        ),
      );
    await act(async () => render(0));
    await waitForIcons(32);
    const svgs = [...container.querySelectorAll("svg")];
    expect(svgs).toHaveLength(32);
    expect(svgs[0].outerHTML).toBe(
      expectedSvg(getFileIcon({ fileExtension: "ts" })),
    );
    expect(fullSet.load).not.toHaveBeenCalled();
    const writes = vi.spyOn(Element.prototype, "innerHTML", "set");

    for (let tick = 1; tick <= 20; tick++) act(() => render(tick));

    expect(writes.mock.calls.length).toBe(0);
    container.querySelectorAll("svg").forEach((svg, index) => {
      expect(svg).toBe(svgs[index]);
    });
  });

  it("updates dimensions and filenames without replacing an unchanged glyph", async () => {
    const render = (name: string, size: number) =>
      root.render(createElement(FileTypeIcon, { name, size, isDir: false }));
    await act(async () => render("first.ts", 16));
    await waitForIcons(1);
    const svg = container.querySelector("svg");
    const writes = vi.spyOn(Element.prototype, "innerHTML", "set");

    act(() => render("second.ts", 24));
    expect(container.querySelector("svg")).toBe(svg);
    expect((container.firstElementChild as HTMLElement).style.width).toBe(
      "24px",
    );
    expect(writes.mock.calls.length).toBe(0);

    act(() => render("second.rs", 24));
    expect(writes).toHaveBeenCalledTimes(1);
    expect(container.querySelector("svg")?.outerHTML).toBe(
      expectedSvg(getFileIcon({ fileExtension: "rs" })),
    );
  });

  it("updates folder glyphs when their expansion state changes", async () => {
    const render = (isOpen: boolean) =>
      root.render(
        createElement(FileTypeIcon, { name: "src", isDir: true, isOpen }),
      );
    await act(async () => render(false));
    await waitForIcons(1);
    expect(container.querySelector("svg")?.outerHTML).toBe(
      expectedSvg(getFolderIcon({ folderName: "src", isOpen: false })),
    );
    act(() => render(true));
    expect(container.querySelector("svg")?.outerHTML).toBe(
      expectedSvg(getFolderIcon({ folderName: "src", isOpen: true })),
    );
  });

  it("loads the original glyph for an uncommon extension on demand", async () => {
    await act(async () =>
      root.render(createElement(FileTypeIcon, { name: "main.nim", isDir: false })),
    );
    await waitForIcons(1);
    expect(container.querySelector("svg")?.outerHTML).toBe(
      expectedSvg(getFileIcon({ fileExtension: "nim" })),
    );
    expect(fullSet.load).toHaveBeenCalledTimes(1);
  });
});

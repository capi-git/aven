// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fs = vi.hoisted(() => ({ readBinaryFile: vi.fn() }));
vi.mock("../lib/fs", async (original) => ({
  ...(await original<typeof import("../lib/fs")>()),
  readBinaryFile: fs.readBinaryFile,
}));

const { LocalMarkdownImage } = await import("./LocalMarkdownImage");
const { forgetPictureSizes } = await import("../lib/pictureSizes");

const PATH = "/Users/me/project/shots/home.png";
const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

describe("a local picture's box", () => {
  let root: Root;
  let host: HTMLDivElement;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.stubGlobal(
      "IntersectionObserver",
      class {
        constructor(
          callback: (entries: { isIntersecting: boolean }[]) => void,
        ) {
          queueMicrotask(() => callback([{ isIntersecting: true }]));
        }
        observe() {}
        disconnect() {}
      },
    );
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:shot");
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    fs.readBinaryFile.mockResolvedValue(png);
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    forgetPictureSizes();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  const render = async () => {
    await act(async () => {
      root.render(createElement(LocalMarkdownImage, { path: PATH }));
    });
    await act(async () => {
      await Promise.resolve();
    });
    return host.querySelector<HTMLElement>("[data-local-image]")!;
  };

  const load = async (image: HTMLImageElement) => {
    Object.defineProperty(image, "naturalWidth", { value: 2400 });
    Object.defineProperty(image, "naturalHeight", { value: 1500 });
    await act(async () => {
      image.dispatchEvent(new Event("load"));
    });
  };

  it("keeps the loading room until a first picture has a size, then sizes from it", async () => {
    const box = await render();
    const image = box.querySelector("img")!;
    expect(image).not.toBeNull();
    expect(box.hasAttribute("data-picture-pending")).toBe(true);
    expect(box.hasAttribute("data-picture-size")).toBe(false);
    await load(image);
    expect(box.hasAttribute("data-picture-pending")).toBe(false);
    expect(box.hasAttribute("data-picture-size")).toBe(true);
    expect(box.style.getPropertyValue("--picture-width")).toBe("2400");
    expect(box.style.getPropertyValue("--picture-height")).toBe("1500");
  });

  it("reserves a picture's box before it loads again", async () => {
    await load((await render()).querySelector("img")!);
    act(() => root.unmount());
    root = createRoot(host);
    fs.readBinaryFile.mockReturnValue(new Promise(() => {}));
    const box = await render();
    // Still reading the file: the loading line holds the picture's box.
    expect(box.querySelector("img")).toBeNull();
    expect(box.hasAttribute("data-picture-size")).toBe(true);
    expect(box.style.getPropertyValue("--picture-width")).toBe("2400");
  });
});

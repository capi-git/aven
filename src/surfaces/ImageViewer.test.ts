// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  closeImageViewer,
  imageViewerSnapshot,
  openImageViewer,
  type ImageViewerItem,
} from "../lib/imageViewer";
import { ImageViewer } from "./ImageViewer";

const mocks = vi.hoisted(() => ({
  read: vi.fn(),
  reveal: vi.fn(),
  copy: vi.fn(),
  message: vi.fn(),
}));
vi.mock("../lib/fs", async (original) => ({
  ...(await original<typeof import("../lib/fs")>()),
  readBinaryFile: mocks.read,
  revealPath: mocks.reveal,
}));
vi.mock("../lib/clipboard", () => ({ copyText: mocks.copy }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ message: mocks.message }));

const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const pair: ImageViewerItem[] = [
  { name: "1-before.png", src: "data:image/png;base64,AAAA", label: "Before" },
  { name: "2-after.png", src: "data:image/png;base64,BBBB", label: "After" },
];

let root: Root;
let host: HTMLDivElement;
let opener: HTMLButtonElement;
let openInTab: ReturnType<typeof vi.fn<(path: string) => void>>;

beforeEach(async () => {
  vi.clearAllMocks();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:picture");
  vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
  mocks.read.mockResolvedValue(png);
  mocks.reveal.mockResolvedValue(undefined);
  mocks.copy.mockResolvedValue(undefined);
  opener = document.createElement("button");
  opener.textContent = "Chat";
  host = document.createElement("div");
  document.body.append(opener, host);
  opener.focus();
  openInTab = vi.fn<(path: string) => void>();
  root = createRoot(host);
  await act(async () =>
    root.render(createElement(ImageViewer, { onOpenInTab: openInTab })),
  );
});

afterEach(async () => {
  await act(async () => closeImageViewer());
  await act(async () => root.unmount());
  document.body.replaceChildren();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function show(items: ImageViewerItem[], index = 0) {
  await act(async () => {
    openImageViewer({ items, index });
  });
}

function dialog() {
  return document.querySelector<HTMLElement>('[role="dialog"]');
}

function button(label: string) {
  return [...document.querySelectorAll<HTMLButtonElement>("button")].find(
    (element) =>
      element.textContent === label ||
      element.getAttribute("aria-label") === label,
  );
}

async function key(value: string) {
  await act(async () => {
    (document.activeElement ?? document.body).dispatchEvent(
      new KeyboardEvent("keydown", {
        key: value,
        bubbles: true,
        cancelable: true,
      }),
    );
  });
}

async function press(element: Element) {
  await act(async () => {
    element.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    element.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

describe("ImageViewer", () => {
  it("renders nothing until a picture is opened", () => {
    expect(dialog()).toBeNull();
  });

  it("shows a file's name and size, then its dimensions once drawn", async () => {
    await show([{ name: "After.png", path: "/shots/After.png" }]);
    const viewer = dialog()!;
    expect(viewer.getAttribute("aria-modal")).toBe("true");
    expect(mocks.read).toHaveBeenCalledExactlyOnceWith("/shots/After.png");
    expect(viewer.querySelector("h2")?.textContent).toBe("After.png");
    expect(viewer.querySelector(".image-viewer-meta")?.textContent).toBe("8 B");
    const image = viewer.querySelector("img")!;
    expect(image.getAttribute("src")).toBe("blob:picture");
    Object.defineProperty(image, "naturalWidth", { value: 1600 });
    Object.defineProperty(image, "naturalHeight", { value: 1100 });
    await act(async () => {
      image.dispatchEvent(new Event("load"));
    });
    expect(viewer.querySelector(".image-viewer-meta")?.textContent).toBe(
      "1600 × 1100 · 8 B",
    );
  });

  it("steps with the arrow keys and the side buttons, wrapping, and counts", async () => {
    await show(pair);
    const count = () =>
      document.querySelector(".image-viewer-count")?.textContent;
    expect(count()).toBe("1 of 2 · Before, After");
    await key("ArrowRight");
    expect(count()).toBe("2 of 2 · Before, After");
    expect(document.querySelector("h2")?.textContent).toBe("2-after.png");
    await key("ArrowRight");
    expect(count()).toBe("1 of 2 · Before, After");
    await act(async () => button("Previous image")!.click());
    expect(count()).toBe("2 of 2 · Before, After");
    await act(async () => button("Next image")!.click());
    expect(imageViewerSnapshot()?.index).toBe(0);
  });

  it("hides the arrows and the count for a single picture", async () => {
    await show([pair[0]]);
    expect(button("Previous image")).toBeUndefined();
    expect(button("Next image")).toBeUndefined();
    expect(document.querySelector(".image-viewer-count")?.textContent).toBe("");
    await key("ArrowRight");
    expect(imageViewerSnapshot()?.index).toBe(0);
  });

  it("closes on Escape, keeps the key from the work underneath and returns focus", async () => {
    const underneath = vi.fn();
    window.addEventListener("keydown", underneath);
    await show(pair);
    expect(document.activeElement).toBe(dialog());
    await key("Escape");
    window.removeEventListener("keydown", underneath);
    expect(dialog()).toBeNull();
    expect(underneath).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(opener);
  });

  it("closes on a click on the backdrop, but a click on the picture zooms", async () => {
    await show(pair);
    const scroller = document.querySelector(".image-viewer-scroller")!;
    const image = scroller.querySelector("img")!;
    expect(scroller.getAttribute("data-zoom")).toBe("fit");
    await press(image);
    expect(scroller.getAttribute("data-zoom")).toBe("actual");
    await press(image);
    expect(scroller.getAttribute("data-zoom")).toBe("fit");
    expect(dialog()).not.toBeNull();
    await press(document.querySelector(".image-viewer-backdrop")!);
    expect(dialog()).toBeNull();
  });

  it("keeps the viewer when a press starts on the picture and ends on the backdrop", async () => {
    await show(pair);
    const image = document.querySelector(".image-viewer-scroller img")!;
    await act(async () => {
      image.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
      document
        .querySelector(".image-viewer-backdrop")!
        .dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(dialog()).not.toBeNull();
  });

  it("opens the file as a tab and closes", async () => {
    await show([{ name: "After.png", path: "/shots/After.png" }]);
    await act(async () => button("Open in tab")!.click());
    expect(openInTab).toHaveBeenCalledExactlyOnceWith("/shots/After.png");
    expect(dialog()).toBeNull();
  });

  it("reveals the file and copies its path", async () => {
    await show([{ name: "After.png", path: "/shots/After.png" }]);
    const reveal = [...document.querySelectorAll("button")].find((element) =>
      /^(Reveal in|Open Containing)/.test(element.textContent ?? ""),
    )!;
    await act(async () => reveal.click());
    expect(mocks.reveal).toHaveBeenCalledExactlyOnceWith("/shots/After.png");
    await act(async () => button("Copy path")!.click());
    expect(mocks.copy).toHaveBeenCalledExactlyOnceWith("/shots/After.png");
    expect(button("Copied")).toBeDefined();
    expect(dialog()).not.toBeNull();
  });

  it("offers no file actions for an inline picture", async () => {
    await show([pair[0]]);
    expect(button("Open in tab")).toBeUndefined();
    expect(button("Copy path")).toBeUndefined();
    expect(button("Close")).toBeDefined();
    expect(mocks.read).not.toHaveBeenCalled();
    expect(document.querySelector(".image-viewer-meta")?.textContent).toBe(
      "3 B",
    );
  });

  it("explains a file that isn't a picture", async () => {
    mocks.read.mockResolvedValue(new TextEncoder().encode("<html></html>"));
    await show([{ name: "fake.png", path: "/shots/fake.png" }]);
    expect(document.querySelector("img")).toBeNull();
    expect(document.querySelector('[role="status"]')?.textContent).toContain(
      "fake.png isn’t a readable image",
    );
    expect(URL.createObjectURL).not.toHaveBeenCalled();
  });

  it("draws an SVG file from its bytes", async () => {
    mocks.read.mockResolvedValue(
      new TextEncoder().encode('<?xml version="1.0"?><svg width="4"></svg>'),
    );
    await show([{ name: "logo.svg", path: "/w/logo.svg" }]);
    expect(URL.createObjectURL).toHaveBeenCalledOnce();
    const blob = vi.mocked(URL.createObjectURL).mock.calls[0][0] as Blob;
    expect(blob.type).toBe("image/svg+xml");
    expect(document.querySelector("img")?.getAttribute("src")).toBe(
      "blob:picture",
    );
  });

  it("keeps Tab inside the viewer", async () => {
    await show([{ name: "After.png", path: "/shots/After.png" }]);
    const close = button("Close")!;
    close.focus();
    await key("Tab");
    expect(dialog()!.contains(document.activeElement)).toBe(true);
    expect(document.activeElement).not.toBe(opener);
  });
});

// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { LocalMarkdownImage } from "./LocalMarkdownImage";

const read = vi.hoisted(() => vi.fn());
vi.mock("../lib/fs", () => ({
  readBinaryFile: read,
  basename: (path: string) => path.split("/").pop(),
}));
let root: Root;
let host: HTMLDivElement;
let reveal: () => void;
let createUrl: ReturnType<typeof vi.spyOn>;
let revokeUrl: ReturnType<typeof vi.spyOn>;
const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      constructor(callback: (entries: { isIntersecting: boolean }[]) => void) {
        reveal = () => callback([{ isIntersecting: true }]);
      }
      observe() {}
      disconnect() {}
    },
  );
  createUrl = vi
    .spyOn(URL, "createObjectURL")
    .mockReturnValue("blob:mock-image");
  revokeUrl = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
  read.mockResolvedValue(png);
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
async function render(onOpenFile = vi.fn()) {
  await act(async () =>
    root.render(
      createElement(LocalMarkdownImage, {
        path: "/project/mock.png",
        alt: "Mockup",
        onOpenFile,
      }),
    ),
  );
}

it("loads only near the viewport, opens the original and releases its preview", async () => {
  const open = vi.fn();
  await render(open);
  expect(read).not.toHaveBeenCalled();
  await act(async () => reveal());
  expect(read).toHaveBeenCalledExactlyOnceWith("/project/mock.png");
  expect(host.querySelector("img")?.getAttribute("src")).toBe(
    "blob:mock-image",
  );
  await act(async () =>
    host.querySelector<HTMLButtonElement>("button")!.click(),
  );
  expect(open).toHaveBeenCalledExactlyOnceWith("/project/mock.png");
  await act(async () => root.render(null));
  expect(revokeUrl).toHaveBeenCalledExactlyOnceWith("blob:mock-image");
});

it("shows a recoverable error for a missing image rather than an empty response", async () => {
  read.mockRejectedValueOnce(new Error("File not found"));
  await render();
  await act(async () => reveal());
  expect(host.textContent).toContain("Couldn’t load Mockup");
  expect(host.textContent).toContain("File not found");
  await act(async () =>
    host.querySelector<HTMLButtonElement>("button")!.click(),
  );
  expect(host.querySelector("img")).not.toBeNull();
});

it("rejects markup masquerading as an image", async () => {
  read.mockResolvedValue(new TextEncoder().encode("<html>not an image</html>"));
  await render();
  await act(async () => reveal());
  expect(host.textContent).toContain("not a supported image");
  expect(createUrl).not.toHaveBeenCalled();
  expect(host.querySelector("img")).toBeNull();
});

it("does not retain a blob after an image is removed while reading", async () => {
  let finish!: (bytes: Uint8Array) => void;
  read.mockReturnValue(
    new Promise<Uint8Array>((resolve) => {
      finish = resolve;
    }),
  );
  await render();
  await act(async () => reveal());
  await act(async () => root.render(null));
  await act(async () => finish(png));
  expect(createUrl).not.toHaveBeenCalled();
});

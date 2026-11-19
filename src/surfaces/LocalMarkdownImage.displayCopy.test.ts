// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { LocalMarkdownImage } from "./LocalMarkdownImage";

const mocks = vi.hoisted(() => ({ read: vi.fn(), copy: vi.fn() }));
vi.mock("../lib/fs", () => ({
  readBinaryFile: mocks.read,
  basename: (path: string) => path.split("/").pop(),
}));
vi.mock("../lib/displayImage", () => ({ readDisplayImage: mocks.copy }));

let root: Root;
let host: HTMLDivElement;
const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("IntersectionObserver", undefined);
  let made = 0;
  vi.spyOn(URL, "createObjectURL").mockImplementation(() => `blob:${++made}`);
  vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
  mocks.copy.mockResolvedValue(png);
  mocks.read.mockResolvedValue(png);
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

it("draws the display copy and keeps the full file for the viewer and Open", async () => {
  const open = vi.fn();
  await act(async () =>
    root.render(
      createElement(LocalMarkdownImage, {
        path: "/shots/wide.png",
        onOpenFile: open,
      }),
    ),
  );
  expect(mocks.copy).toHaveBeenCalledExactlyOnceWith("/shots/wide.png");
  expect(mocks.read).not.toHaveBeenCalled();
  expect(host.querySelector("img")?.getAttribute("src")).toBe("blob:1");
  expect(
    host.querySelector("[data-local-image]")?.getAttribute("data-local-image"),
  ).toBe("/shots/wide.png");
  await act(async () =>
    host.querySelector<HTMLButtonElement>("button")!.click(),
  );
  expect(open).toHaveBeenCalledExactlyOnceWith("/shots/wide.png");
});

it("falls back to the original when the copy will not draw", async () => {
  await act(async () =>
    root.render(createElement(LocalMarkdownImage, { path: "/shots/wide.png" })),
  );
  await act(async () => {
    host.querySelector("img")!.dispatchEvent(new Event("error"));
  });
  expect(mocks.read).toHaveBeenCalledExactlyOnceWith("/shots/wide.png");
  expect(host.querySelector("img")?.getAttribute("src")).toBe("blob:2");
  // The original failing too is reported, not retried for ever.
  await act(async () => {
    host.querySelector("img")!.dispatchEvent(new Event("error"));
  });
  expect(host.textContent).toContain("could not be displayed");
  expect(mocks.read).toHaveBeenCalledOnce();
});

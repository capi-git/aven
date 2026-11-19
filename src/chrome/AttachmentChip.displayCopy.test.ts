// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { AttachmentChip } from "./AttachmentChip";
import {
  closeImageViewer,
  imageViewerSnapshot,
  registerImageViewerHost,
} from "../lib/imageViewer";
import type { Attachment } from "../lib/session";

const mocks = vi.hoisted(() => ({
  read: vi.fn(),
  copy: vi.fn(),
  inline: vi.fn(),
}));
vi.mock("../lib/fs", () => ({ readBinaryFile: mocks.read }));
vi.mock("../lib/inAppLinks", () => ({ openInAppFile: vi.fn() }));
vi.mock("../lib/displayImage", () => ({
  ATTACHMENT_THUMB_WIDTH: 256,
  INLINE_COPY_MIN_BYTES: 1000,
  readDisplayImage: mocks.copy,
  inlineDisplayCopy: mocks.inline,
}));

let root: Root;
let host: HTMLDivElement;
let unregister: () => void;
const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const saved: Attachment = {
  id: "saved",
  name: "screen.png",
  kind: "image",
  mimeType: "image/png",
  size: 5_000_000,
  path: "/attachments/screen.png",
};
const pasted: Attachment = {
  id: "pasted",
  name: "Pasted.png",
  kind: "image",
  mimeType: "image/png",
  size: 4_000,
  data: "AAAA",
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("IntersectionObserver", undefined);
  let made = 0;
  vi.spyOn(URL, "createObjectURL").mockImplementation(() => `blob:${++made}`);
  vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
  mocks.copy.mockResolvedValue(png);
  mocks.read.mockResolvedValue(png);
  mocks.inline.mockResolvedValue("blob:inline-copy");
  unregister = registerImageViewerHost();
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  closeImageViewer();
  unregister();
  host.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function render(attachment: Attachment) {
  await act(async () =>
    root.render(createElement(AttachmentChip, { attachment })),
  );
}

it("draws a small copy of a saved picture and opens the original", async () => {
  await render(saved);
  expect(mocks.copy).toHaveBeenCalledExactlyOnceWith(saved.path, 256);
  expect(mocks.read).not.toHaveBeenCalled();
  expect(host.querySelector("img")?.getAttribute("src")).toBe("blob:1");
  await act(async () =>
    host.querySelector<HTMLButtonElement>("button")!.click(),
  );
  expect(imageViewerSnapshot()?.items).toEqual([
    { name: "screen.png", path: saved.path, size: saved.size },
  ]);
});

it("reads the original when the small copy will not draw", async () => {
  await render(saved);
  await act(async () => {
    host.querySelector("img")!.dispatchEvent(new Event("error"));
  });
  expect(mocks.read).toHaveBeenCalledExactlyOnceWith(saved.path);
});

it("draws a small copy of a large pasted picture and opens the inline original", async () => {
  await render(pasted);
  expect(mocks.inline).toHaveBeenCalledExactlyOnceWith(
    "pasted:4000",
    "data:image/png;base64,AAAA",
    256,
  );
  expect(host.querySelector("img")?.getAttribute("src")).toBe(
    "blob:inline-copy",
  );
  await act(async () =>
    host.querySelector<HTMLButtonElement>("button")!.click(),
  );
  expect(imageViewerSnapshot()?.items[0]?.src).toBe(
    "data:image/png;base64,AAAA",
  );
  // A copy that will not draw gives way to the original.
  await act(async () => {
    host.querySelector("img")!.dispatchEvent(new Event("error"));
  });
  expect(host.querySelector("img")?.getAttribute("src")).toBe(
    "data:image/png;base64,AAAA",
  );
});

it("draws a small pasted picture as it is", async () => {
  await render({ ...pasted, size: 10 });
  expect(mocks.inline).not.toHaveBeenCalled();
  expect(host.querySelector("img")?.getAttribute("src")).toBe(
    "data:image/png;base64,AAAA",
  );
});

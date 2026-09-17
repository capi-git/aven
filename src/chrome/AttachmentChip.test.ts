// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { AttachmentChip } from "./AttachmentChip";
import type { Attachment } from "../lib/session";

const mocks = vi.hoisted(() => ({ read: vi.fn(), open: vi.fn() }));
vi.mock("../lib/fs", () => ({ readBinaryFile: mocks.read }));
vi.mock("../lib/inAppLinks", () => ({ openInAppFile: mocks.open }));
let root: Root;
let host: HTMLDivElement;
let reveal: () => void;
let createUrl: ReturnType<typeof vi.spyOn>;
let revokeUrl: ReturnType<typeof vi.spyOn>;
const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const attachment: Attachment = {
  id: "saved-image",
  name: "screen.png",
  kind: "image",
  mimeType: "image/png",
  size: png.length,
  path: "/attachments/screen.png",
};
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
    .mockReturnValue("blob:saved-image");
  revokeUrl = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
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
async function render(value = attachment, onRemove?: () => void) {
  await act(async () =>
    root.render(createElement(AttachmentChip, { attachment: value, onRemove })),
  );
}

it("restores a persisted image lazily, opens it inside the app and releases its preview", async () => {
  await render();
  expect(mocks.read).not.toHaveBeenCalled();
  await act(async () => reveal());
  expect(mocks.read).toHaveBeenCalledExactlyOnceWith(attachment.path);
  expect(host.querySelector("img")?.getAttribute("src")).toBe(
    "blob:saved-image",
  );
  await act(async () =>
    host
      .querySelector<HTMLButtonElement>("[aria-label='Open screen.png']")!
      .click(),
  );
  expect(mocks.open).toHaveBeenCalledExactlyOnceWith(attachment.path);
  await act(async () => root.render(null));
  expect(revokeUrl).toHaveBeenCalledExactlyOnceWith("blob:saved-image");
});

it("keeps a missing saved image named and openable", async () => {
  mocks.read.mockRejectedValue(new Error("Missing"));
  await render();
  await act(async () => reveal());
  expect(host.querySelector("img")).toBeNull();
  expect(host.textContent).toContain("screen.png");
  expect(host.querySelector("[aria-label='Open screen.png']")).not.toBeNull();
});

it("uses the immediate preview without a disk read and keeps Remove separate from Open", async () => {
  const remove = vi.fn();
  await render({ ...attachment, previewUrl: "blob:composer" }, remove);
  expect(mocks.read).not.toHaveBeenCalled();
  expect(host.querySelector("img")?.getAttribute("src")).toBe("blob:composer");
  await act(async () =>
    host
      .querySelector<HTMLButtonElement>("[aria-label='Remove screen.png']")!
      .click(),
  );
  expect(remove).toHaveBeenCalledOnce();
  expect(mocks.open).not.toHaveBeenCalled();
});

it("does not allocate a preview after removal during the read", async () => {
  let finish!: (value: Uint8Array) => void;
  mocks.read.mockReturnValue(
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

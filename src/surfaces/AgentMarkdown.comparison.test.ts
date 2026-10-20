// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { AgentMarkdown } from "./AgentMarkdown";

const read = vi.hoisted(() => vi.fn());
vi.mock("../lib/fs", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/fs")>()),
  readBinaryFile: read,
}));

const before =
  "/Users/test/Library/Application Support/Aven/turn-shots/s1/1-before.png";
const after =
  "/Users/test/Library/Application Support/Aven/turn-shots/s1/2-after.png";
const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
let root: Root;
let host: HTMLDivElement;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  // Reveal every lazy image immediately.
  vi.stubGlobal("IntersectionObserver", undefined);
  vi.spyOn(URL, "createObjectURL").mockImplementation(() => "blob:shot");
  vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
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

it("opens either side of a Before/After pair larger in the image viewer", async () => {
  const open = vi.fn();
  await act(async () =>
    root.render(
      createElement(AgentMarkdown, {
        text: `Header updated.\n\n![Before](<${before}>)\n![After](<${after}>)`,
        onOpenFile: open,
      }),
    ),
  );
  const figures = host.querySelectorAll(
    ".markdown-before-after > figure.markdown-before-after-item",
  );
  expect(
    [...figures].map(
      (figure) => figure.querySelector("figcaption")?.textContent,
    ),
  ).toEqual(["Before", "After"]);
  expect(read).toHaveBeenCalledWith(before);
  expect(read).toHaveBeenCalledWith(after);
  const buttons = host.querySelectorAll<HTMLButtonElement>(
    ".markdown-before-after .markdown-local-image-open",
  );
  expect([...buttons].map((button) => button.title)).toEqual([
    "Open Before",
    "Open After",
  ]);
  await act(async () => buttons[1].click());
  expect(open).toHaveBeenCalledExactlyOnceWith(after);
  await act(async () => buttons[0].click());
  expect(open).toHaveBeenLastCalledWith(before);
});

it("shows a JPEG Before/After pair, and an older PNG, as images", async () => {
  const jpegBefore = before.replace("1-before.png", "3-before.jpg");
  const jpegAfter = after.replace("2-after.png", "4-after.jpg");
  const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
  read.mockImplementation(async (path: string) =>
    path.endsWith(".jpg") ? jpeg : png,
  );
  const blobs: Blob[] = [];
  vi.mocked(URL.createObjectURL).mockImplementation((blob) => {
    blobs.push(blob as Blob);
    return `blob:shot-${blobs.length}`;
  });
  await act(async () =>
    root.render(
      createElement(AgentMarkdown, {
        text: `![Before](<${jpegBefore}>)\n![After](<${jpegAfter}>)\n\nEarlier: ![Screenshot](<${before}>)`,
        onOpenFile: vi.fn(),
      }),
    ),
  );
  const figures = host.querySelectorAll(
    ".markdown-before-after > figure.markdown-before-after-item",
  );
  expect(
    [...figures].map(
      (figure) => figure.querySelector("figcaption")?.textContent,
    ),
  ).toEqual(["Before", "After"]);
  expect(read).toHaveBeenCalledWith(jpegBefore);
  expect(read).toHaveBeenCalledWith(jpegAfter);
  expect(read).toHaveBeenCalledWith(before);
  expect(blobs.map((blob) => blob.type).sort()).toEqual([
    "image/jpeg",
    "image/jpeg",
    "image/png",
  ]);
  expect(host.querySelectorAll("img[src^='blob:shot-']")).toHaveLength(3);
});

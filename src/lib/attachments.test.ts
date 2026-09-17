// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  filesFromClipboard,
  mergeAttachments,
  hasFileTransfer,
  preventFileDropNavigation,
  attachmentsFromFiles,
  persistableAttachment,
  MAX_ATTACHMENTS,
} from "./attachments";
import type { Attachment } from "./session";

const invoke = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({ invoke }));
beforeEach(() => {
  invoke.mockReset().mockResolvedValue("/app-data/attachments/dropped.png");
});

function file(name: string, type: string, body = "x") {
  return new File([body], name, { type });
}

function item(next: File): {
  kind: string;
  type: string;
  getAsFile: () => File | null;
} {
  return {
    kind: "file",
    type: next.type,
    getAsFile: () => next,
  };
}

function attachment(
  partial: Partial<Attachment> & Pick<Attachment, "id" | "name">,
): Attachment {
  return {
    mimeType: "image/png",
    kind: "image",
    size: 4,
    ...partial,
  };
}

describe("mergeAttachments", () => {
  it("keeps previously attached images when adding more", () => {
    const first = attachment({ id: "a", name: "one.png" });
    const second = attachment({ id: "b", name: "two.png" });
    expect(mergeAttachments([first], [second]).map((file) => file.id)).toEqual([
      "a",
      "b",
    ]);
  });

  it("skips the same path twice", () => {
    const first = attachment({
      id: "a",
      name: "shot.png",
      path: "/tmp/shot.png",
    });
    const again = attachment({
      id: "b",
      name: "shot.png",
      path: "/tmp/shot.png",
    });
    expect(mergeAttachments([first], [again])).toEqual([first]);
  });
});

describe("filesFromClipboard", () => {
  it("returns every file item when the files list is truncated", () => {
    const a = file("a.png", "image/png", "a");
    const b = file("b.png", "image/png", "b");
    expect(
      filesFromClipboard({
        files: [a],
        items: [item(a), item(b)],
      }),
    ).toEqual([a, b]);
  });

  it("drops the unnamed tiff twin of a png screenshot", () => {
    const png = file("image.png", "image/png");
    const tiff = file("image.tiff", "image/tiff");
    expect(
      filesFromClipboard({
        files: [png],
        items: [item(png), item(tiff)],
      }),
    ).toEqual([png]);
  });

  it("keeps a real named tiff next to a png", () => {
    const png = file("diagram.png", "image/png");
    const tiff = file("scan.tiff", "image/tiff");
    expect(
      filesFromClipboard({
        files: [png, tiff],
        items: [item(png), item(tiff)],
      }),
    ).toEqual([png, tiff]);
  });
});

describe("DOM file drops", () => {
  it("recognizes protected drag metadata before file bytes are available", () => {
    expect(
      hasFileTransfer({
        types: ["Files"],
        items: [],
        files: [],
      } as unknown as DataTransfer),
    ).toBe(true);
    expect(
      hasFileTransfer({
        types: [],
        items: [{ kind: "file" }],
        files: [],
      } as unknown as DataTransfer),
    ).toBe(true);
    expect(
      hasFileTransfer({
        types: ["text/plain"],
        items: [{ kind: "string" }],
        files: [],
      } as unknown as DataTransfer),
    ).toBe(false);
  });

  it("blocks file navigation outside targets while retaining accepted drops and text dragging", () => {
    const data = { types: ["Files"], items: [], files: [], dropEffect: "copy" };
    const event = new Event("dragover", { cancelable: true }) as DragEvent;
    Object.defineProperty(event, "dataTransfer", { value: data });
    preventFileDropNavigation(event);
    expect(event.defaultPrevented).toBe(true);
    expect(data.dropEffect).toBe("none");
    const accepted = new Event("dragover", { cancelable: true }) as DragEvent;
    Object.defineProperty(accepted, "dataTransfer", { value: data });
    accepted.preventDefault();
    data.dropEffect = "copy";
    preventFileDropNavigation(accepted);
    expect(data.dropEffect).toBe("copy");
    const drop = new Event("drop", { cancelable: true }) as DragEvent;
    Object.defineProperty(drop, "dataTransfer", { value: data });
    preventFileDropNavigation(drop);
    expect(drop.defaultPrevented).toBe(true);
    const text = new Event("drop", { cancelable: true }) as DragEvent;
    Object.defineProperty(text, "dataTransfer", {
      value: { types: ["text/plain"], items: [], files: [] },
    });
    preventFileDropNavigation(text);
    expect(text.defaultPrevented).toBe(false);
  });

  it("converts a pathless WebKit image File into vision bytes", async () => {
    const [image] = await attachmentsFromFiles([
      file("dropped.png", "image/png", "abc"),
    ]);
    expect(image).toMatchObject({
      name: "dropped.png",
      kind: "image",
      mimeType: "image/png",
      data: "YWJj",
      size: 3,
      path: "/app-data/attachments/dropped.png",
    });
    expect(invoke).toHaveBeenCalledExactlyOnceWith("write_attachment", {
      name: "dropped.png",
      data: "YWJj",
    });
    expect(persistableAttachment(image)).toMatchObject({
      path: "/app-data/attachments/dropped.png",
    });
    expect(persistableAttachment(image).data).toBeUndefined();
    expect(image.previewUrl).toBeTruthy();
    URL.revokeObjectURL(image.previewUrl!);
  });
});

it("never adds a twenty-first attachment, including when a batch crosses the limit", () => {
  const full = Array.from({ length: MAX_ATTACHMENTS }, (_, i) =>
    attachment({ id: String(i), name: `${i}.png` }),
  );
  const incoming = [
    attachment({ id: "new", name: "new.png" }),
    attachment({ id: "extra", name: "extra.png" }),
  ];
  expect(mergeAttachments(full, incoming)).toEqual(full);
  expect(mergeAttachments(full.slice(0, -1), incoming)).toEqual([
    ...full.slice(0, -1),
    incoming[0],
  ]);
});
it("does not accept a pasted image if its durable file cannot be saved", async () => {
  invoke.mockRejectedValueOnce(new Error("Disk full"));
  const revoke = vi.spyOn(URL, "revokeObjectURL");
  expect(
    await attachmentsFromFiles([file("paste.png", "image/png", "abc")]),
  ).toEqual([]);
  expect(revoke).toHaveBeenCalledTimes(1);
  revoke.mockRestore();
});

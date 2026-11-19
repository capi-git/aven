// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ invoke: vi.fn(), read: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
vi.mock("./fs", () => ({ readBinaryFile: mocks.read }));

import {
  ATTACHMENT_THUMB_WIDTH,
  CHAT_IMAGE_WIDTH,
  clearInlineDisplayCopies,
  inlineDisplayCopy,
  inlineImageKey,
  readDisplayImage,
} from "./displayImage";

const original = new Uint8Array([1, 2, 3]);
const copy = new Uint8Array([4, 5]);

beforeEach(() => {
  vi.clearAllMocks();
  mocks.read.mockResolvedValue(original);
});

describe("readDisplayImage", () => {
  it("asks for a copy twice the chat column wide by default", async () => {
    mocks.invoke.mockResolvedValue(copy.buffer);
    await expect(readDisplayImage("/shots/a.png")).resolves.toEqual(copy);
    expect(mocks.invoke).toHaveBeenCalledExactlyOnceWith("read_display_image", {
      path: "/shots/a.png",
      maxWidth: CHAT_IMAGE_WIDTH,
    });
    expect(mocks.read).not.toHaveBeenCalled();
  });

  it("passes a smaller width for thumbnails", async () => {
    mocks.invoke.mockResolvedValue(copy.buffer);
    await readDisplayImage("/shots/a.png", ATTACHMENT_THUMB_WIDTH);
    expect(mocks.invoke).toHaveBeenCalledWith("read_display_image", {
      path: "/shots/a.png",
      maxWidth: ATTACHMENT_THUMB_WIDTH,
    });
  });

  it("reads the original when the copy fails or comes back empty", async () => {
    mocks.invoke.mockRejectedValueOnce(new Error("no command"));
    await expect(readDisplayImage("/shots/a.png")).resolves.toBe(original);
    mocks.invoke.mockResolvedValueOnce(new ArrayBuffer(0));
    await expect(readDisplayImage("/shots/b.png")).resolves.toBe(original);
    expect(mocks.read.mock.calls).toEqual([["/shots/a.png"], ["/shots/b.png"]]);
  });

  it("keeps the original reader's error when neither can read the file", async () => {
    mocks.invoke.mockRejectedValue(new Error("Not a file"));
    mocks.read.mockRejectedValue(new Error("Not a file"));
    await expect(readDisplayImage("/shots")).rejects.toThrow("Not a file");
  });
});

describe("inlineDisplayCopy", () => {
  let decoded: { width: number; height: number };
  let made = 0;
  let revoke: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    clearInlineDisplayCopies();
    decoded = { width: 3000, height: 1900 };
    made = 0;
    vi.stubGlobal(
      "Image",
      class {
        decoding = "";
        src = "";
        get naturalWidth() {
          return decoded.width;
        }
        get naturalHeight() {
          return decoded.height;
        }
        decode() {
          return this.src.includes("broken")
            ? Promise.reject(new Error("bad image"))
            : Promise.resolve();
        }
      },
    );
    const draw = vi.fn();
    vi.spyOn(document, "createElement").mockImplementation(((tag: string) => {
      expect(tag).toBe("canvas");
      return {
        width: 0,
        height: 0,
        getContext: () => ({ drawImage: draw }),
        toBlob(done: (blob: Blob) => void, type: string) {
          done(new Blob(["x"], { type }));
        },
      };
    }) as unknown as typeof document.createElement);
    vi.spyOn(URL, "createObjectURL").mockImplementation(
      () => `blob:copy-${++made}`,
    );
    revoke = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
  });

  afterEach(() => {
    clearInlineDisplayCopies();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("makes one copy per picture and width", async () => {
    const src = "data:image/png;base64,AAAA";
    await expect(inlineDisplayCopy("a", src)).resolves.toBe("blob:copy-1");
    await expect(inlineDisplayCopy("a", src)).resolves.toBe("blob:copy-1");
    await expect(inlineDisplayCopy("a", src, 256)).resolves.toBe("blob:copy-2");
    expect(made).toBe(2);
  });

  it("draws narrow or broken pictures as they are", async () => {
    decoded = { width: 1200, height: 800 };
    await expect(
      inlineDisplayCopy("narrow", "data:image/png;base64,AAAA"),
    ).resolves.toBeUndefined();
    await expect(
      inlineDisplayCopy("broken", "data:image/png;base64,broken"),
    ).resolves.toBeUndefined();
    expect(made).toBe(0);
  });

  it("releases the oldest copies once it holds too many", async () => {
    for (let index = 0; index < 25; index += 1)
      await inlineDisplayCopy(`k${index}`, "data:image/png;base64,AAAA");
    await Promise.resolve();
    expect(revoke).toHaveBeenCalledExactlyOnceWith("blob:copy-1");
  });
});

describe("inlineImageKey", () => {
  it("tells apart pictures that share a start and a length", () => {
    const head = "data:image/png;base64,".padEnd(200, "A");
    const a = `${head}${"B".repeat(5000)}${"C".repeat(200)}`;
    const b = `${head}${"D".repeat(5000)}${"C".repeat(200)}`;
    expect(inlineImageKey(a)).toBe(inlineImageKey(a));
    expect(inlineImageKey(a)).not.toBe(inlineImageKey(b));
  });
});

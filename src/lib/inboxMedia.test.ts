import { describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import {
  INBOX_MEDIA_PREFIXES,
  isInboxMediaUrl,
  sniffInboxMedia,
  fetchInboxMedia,
} from "./inboxMedia";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

describe("fetchInboxMedia account context", () => {
  it("deduplicates within one project and separates the same image across accounts", async () => {
    vi.mocked(invoke).mockResolvedValue(new ArrayBuffer(4));
    const url = "https://github.com/user-attachments/assets/context-test";
    const first = fetchInboxMedia(url, "/personal/repo");
    expect(fetchInboxMedia(url, "/personal/repo")).toBe(first);
    const work = fetchInboxMedia(url, "/work/repo");
    expect(work).not.toBe(first);
    await Promise.all([first, work]);
    expect(invoke).toHaveBeenCalledWith("fetch_inbox_media", {
      url,
      cwd: "/personal/repo",
    });
    expect(invoke).toHaveBeenCalledWith("fetch_inbox_media", {
      url,
      cwd: "/work/repo",
    });
    expect(
      vi
        .mocked(invoke)
        .mock.calls.filter(
          (call) => (call[1] as { url?: string })?.url === url,
        ),
    ).toHaveLength(2);
  });

  it("keeps contextless public images anonymous and permits retry after a failure", async () => {
    const url = "https://github.com/user-attachments/assets/retry-test";
    vi.mocked(invoke).mockRejectedValueOnce(new Error("not authenticated"));
    await expect(fetchInboxMedia(url)).rejects.toThrow("not authenticated");
    vi.mocked(invoke).mockResolvedValueOnce(new ArrayBuffer(2));
    await expect(fetchInboxMedia(url)).resolves.toHaveLength(2);
    expect(invoke).toHaveBeenLastCalledWith("fetch_inbox_media", {
      url,
      cwd: null,
    });
  });
});

describe("isInboxMediaUrl", () => {
  it("allows GitHub and Linear attachment hosts", () => {
    expect(
      isInboxMediaUrl(
        "https://github.com/user-attachments/assets/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
      ),
    ).toBe(true);
    expect(
      isInboxMediaUrl("https://github.com/acme/web/assets/12/aaaaaaaa-bbbb"),
    ).toBe(true);
    expect(
      isInboxMediaUrl("https://user-images.githubusercontent.com/1/shot.png"),
    ).toBe(true);
    expect(
      isInboxMediaUrl("https://uploads.linear.app/org/uuid/file.png"),
    ).toBe(true);
  });

  it("rejects pages, other hosts, and traversal", () => {
    expect(isInboxMediaUrl("https://github.com/acme/web/issues/1")).toBe(false);
    expect(
      isInboxMediaUrl("https://github.com/user-attachments/../login"),
    ).toBe(false);
    expect(isInboxMediaUrl("http://github.com/user-attachments/assets/x")).toBe(
      false,
    );
    expect(isInboxMediaUrl("https://evil.example/shot.png")).toBe(false);
    expect(
      isInboxMediaUrl("https://github.com.evil.com/user-attachments/assets/x"),
    ).toBe(false);
  });
});

describe("INBOX_MEDIA_PREFIXES", () => {
  it("stays on HTTPS attachment hosts", () => {
    expect(
      INBOX_MEDIA_PREFIXES.every((prefix) => prefix.startsWith("https://")),
    ).toBe(true);
    expect(
      INBOX_MEDIA_PREFIXES.some((prefix) =>
        prefix.startsWith("https://github.com/user-attachments/"),
      ),
    ).toBe(true);
  });
});

describe("sniffInboxMedia", () => {
  it("keeps images and recognizes mp4 and webm", () => {
    expect(
      sniffInboxMedia(
        new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      ),
    ).toEqual({ kind: "image", mime: "image/png" });
    expect(
      sniffInboxMedia(
        new Uint8Array([
          0, 0, 0, 0x20, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d,
        ]),
      ),
    ).toEqual({ kind: "video", mime: "video/mp4" });
    expect(
      sniffInboxMedia(new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 1, 2, 3, 4])),
    ).toEqual({ kind: "video", mime: "video/webm" });
  });

  it("does not treat avif, pdf or html as video", () => {
    expect(
      sniffInboxMedia(
        new Uint8Array([
          0, 0, 0, 0x20, 0x66, 0x74, 0x79, 0x70, 0x61, 0x76, 0x69, 0x66,
        ]),
      ),
    ).toEqual({ kind: "image", mime: "image/avif" });
    expect(
      sniffInboxMedia(
        new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37]),
      ),
    ).toBeNull();
    expect(
      sniffInboxMedia(new TextEncoder().encode("<html><script>x()</script>")),
    ).toBeNull();
  });
});

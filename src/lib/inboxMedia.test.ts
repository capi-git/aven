import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  INBOX_MEDIA_PREFIXES,
  isInboxMediaUrl,
  sniffInboxMedia,
  fetchInboxMedia,
} from "./inboxMedia";

const invoke = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({ invoke }));

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

describe("fetchInboxMedia cache budget", () => {
  const MB = 1024 * 1024;
  const url = (i: number) =>
    `https://github.com/user-attachments/assets/cache-${i}`;
  let fetchMedia: typeof fetchInboxMedia;

  beforeEach(async () => {
    invoke.mockReset();
    vi.resetModules();
    ({ fetchInboxMedia: fetchMedia } = await import("./inboxMedia"));
  });

  it("shares a request in flight and serves repeats from cache", async () => {
    invoke.mockResolvedValue(new ArrayBuffer(16));
    const [first, second] = await Promise.all([
      fetchMedia(url(100)),
      fetchMedia(url(100)),
    ]);
    expect(first).toBe(second);
    expect(await fetchMedia(url(100))).toBe(first);
    expect(invoke).toHaveBeenCalledTimes(1);
  });

  it("keeps cached bytes under a total budget", async () => {
    invoke.mockImplementation(async () => new ArrayBuffer(10 * MB));
    for (let i = 0; i < 6; i += 1) await fetchMedia(url(i));
    expect(invoke).toHaveBeenCalledTimes(6);

    // The newest files are still cached; the oldest were dropped.
    await fetchMedia(url(5));
    expect(invoke).toHaveBeenCalledTimes(6);
    await fetchMedia(url(0));
    expect(invoke).toHaveBeenCalledTimes(7);
  });

  it("refreshes recency on cache hits before evicting", async () => {
    invoke.mockImplementation(async () => new ArrayBuffer(10 * MB));
    const first = await fetchMedia(url(0));
    const second = await fetchMedia(url(1));
    const third = await fetchMedia(url(2));

    // Compare identities as booleans so Vitest never deep-compares large arrays.
    expect((await fetchMedia(url(0))) === first).toBe(true);
    const fourth = await fetchMedia(url(3));

    expect((await fetchMedia(url(0))) === first).toBe(true);
    expect((await fetchMedia(url(2))) === third).toBe(true);
    expect((await fetchMedia(url(3))) === fourth).toBe(true);
    expect(invoke).toHaveBeenCalledTimes(4);
    expect((await fetchMedia(url(1))) === second).toBe(false);
    expect(invoke).toHaveBeenCalledTimes(5);
  });

  it("evicts when one new byte exceeds the exact budget", async () => {
    invoke.mockImplementation(async () => new ArrayBuffer(16 * MB));
    const first = await fetchMedia(url(0));
    const second = await fetchMedia(url(1));
    expect(invoke).toHaveBeenCalledTimes(2);

    invoke.mockResolvedValueOnce(new ArrayBuffer(1));
    const tiny = await fetchMedia(url(2));
    expect((await fetchMedia(url(1))) === second).toBe(true);
    expect((await fetchMedia(url(2))) === tiny).toBe(true);
    expect(invoke).toHaveBeenCalledTimes(3);
    expect((await fetchMedia(url(0))) === first).toBe(false);
    expect(invoke).toHaveBeenCalledTimes(4);
  });

  it("returns oversized responses without caching or evicting existing entries", async () => {
    invoke.mockResolvedValueOnce(new ArrayBuffer(16 * MB));
    invoke.mockImplementation(async () => new ArrayBuffer(32 * MB + 1));
    const cached = await fetchMedia(url(0));
    const oversized = await fetchMedia(url(1));

    expect(oversized.byteLength).toBe(32 * MB + 1);
    expect((await fetchMedia(url(0))) === cached).toBe(true);
    expect(invoke).toHaveBeenCalledTimes(2);
    const repeat = await fetchMedia(url(1));
    expect(repeat === oversized).toBe(false);
    expect((await fetchMedia(url(0))) === cached).toBe(true);
    expect(invoke).toHaveBeenCalledTimes(3);
  });

  it("caches the same URL separately per account context", async () => {
    invoke.mockImplementation(async () => new ArrayBuffer(8));
    const personal = await fetchMedia(url(7), "/personal/repo");
    const work = await fetchMedia(url(7), "/work/repo");
    expect(personal === work).toBe(false);
    expect((await fetchMedia(url(7), "/personal/repo")) === personal).toBe(
      true,
    );
    expect((await fetchMedia(url(7), "/work/repo")) === work).toBe(true);
    expect(invoke).toHaveBeenCalledTimes(2);
  });
});

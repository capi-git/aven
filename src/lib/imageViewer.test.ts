// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { openAgentFileInTabs } from "./agentFiles";
import type { FsEntry, GitChangedFile } from "./fs";
import {
  attachmentImageGroup,
  changedImageGroup,
  closeImageViewer,
  collectImageGroup,
  dataUrlBytes,
  folderImageGroup,
  imageGroupSummary,
  imageViewerAvailable,
  imageViewerSnapshot,
  MAX_FOLDER_IMAGES,
  openImageFile,
  openImageViewer,
  registerImageViewerHost,
  shouldOpenInImageViewer,
  stepImageViewer,
  subscribeImageViewer,
} from "./imageViewer";
import { newTab } from "./layout";
import type { Attachment } from "./session";

let unregister: (() => void) | undefined;

beforeEach(() => {
  unregister = registerImageViewerHost();
});

afterEach(() => {
  closeImageViewer();
  unregister?.();
  unregister = undefined;
  document.body.replaceChildren();
});

function file(name: string, isDir = false): FsEntry {
  return { name, path: `/shots/${name}`, isDir, ignored: false };
}

describe("the viewer store", () => {
  it("opens, steps around both ends and closes, telling subscribers", () => {
    const listener = vi.fn();
    const stop = subscribeImageViewer(listener);
    expect(
      openImageViewer({
        items: [
          { name: "a.png", path: "/a.png" },
          { name: "b.png", path: "/b.png" },
          { name: "c.png", path: "/c.png" },
        ],
        index: 1,
      }),
    ).toBe(true);
    expect(imageViewerSnapshot()?.index).toBe(1);
    stepImageViewer(1);
    expect(imageViewerSnapshot()?.index).toBe(2);
    stepImageViewer(1);
    expect(imageViewerSnapshot()?.index).toBe(0);
    stepImageViewer(-1);
    expect(imageViewerSnapshot()?.index).toBe(2);
    closeImageViewer();
    expect(imageViewerSnapshot()).toBeNull();
    expect(listener).toHaveBeenCalledTimes(5);
    stop();
  });

  it("keeps a single picture still, drops empty items and clamps the start", () => {
    openImageViewer({
      items: [{ name: "nothing" }, { name: "one.png", path: "/one.png" }],
      index: 9,
    });
    expect(imageViewerSnapshot()?.items).toEqual([
      { name: "one.png", path: "/one.png" },
    ]);
    expect(imageViewerSnapshot()?.index).toBe(0);
    stepImageViewer(1);
    expect(imageViewerSnapshot()?.index).toBe(0);
    expect(openImageViewer({ items: [{ name: "empty" }] })).toBe(false);
  });

  it("does nothing in a window without a viewer, and closes when the last one goes", () => {
    openImageViewer({ items: [{ name: "a.png", path: "/a.png" }] });
    unregister?.();
    unregister = undefined;
    expect(imageViewerAvailable()).toBe(false);
    expect(imageViewerSnapshot()).toBeNull();
    expect(
      openImageViewer({ items: [{ name: "a.png", path: "/a.png" }] }),
    ).toBe(false);
    expect(shouldOpenInImageViewer("/a.png")).toBe(false);
  });
});

describe("routing a user's file open", () => {
  it("sends pictures and SVG to the viewer and everything else to a tab", () => {
    expect(shouldOpenInImageViewer("/w/shot.PNG")).toBe(true);
    expect(shouldOpenInImageViewer("/w/photo.jpeg")).toBe(true);
    expect(shouldOpenInImageViewer("/w/logo.svg")).toBe(true);
    expect(shouldOpenInImageViewer("/w/main.ts")).toBe(false);
    expect(shouldOpenInImageViewer("/w/README.md")).toBe(false);
    expect(shouldOpenInImageViewer("/w/spec.pdf")).toBe(false);
  });

  it("keeps Open in tab, and an SVG line, in the editor", () => {
    expect(
      shouldOpenInImageViewer("/w/shot.png", undefined, { asTab: true }),
    ).toBe(false);
    expect(
      shouldOpenInImageViewer("/w/logo.svg", undefined, { asTab: true }),
    ).toBe(false);
    expect(shouldOpenInImageViewer("/w/logo.svg", { line: 4 })).toBe(false);
  });

  it("still opens a picture an agent asks for as a tab beside its task", () => {
    const opened = openAgentFileInTabs(
      [newTab("task")],
      "task",
      "/project",
      "/project/shot.png",
      new Set(),
    );
    expect(
      opened.tabs[0].editorPanes
        .flatMap((pane) => pane.files)
        .map((entry) => entry.path),
    ).toEqual(["/project/shot.png"]);
    expect(imageViewerSnapshot()).toBeNull();
  });
});

describe("pictures in the same folder", () => {
  const listing = [
    file("assets", true),
    file("After.png"),
    file("Before.png"),
    file("diagram.svg"),
    file("notes.md"),
    file("photo.JPG"),
  ];

  it("lists the folder's pictures in its order, skipping folders and text", () => {
    const group = folderImageGroup("/shots/diagram.svg", listing);
    expect(group.items.map((item) => item.name)).toEqual([
      "After.png",
      "Before.png",
      "diagram.svg",
      "photo.JPG",
    ]);
    expect(group.index).toBe(2);
    expect(group.items[0]).toEqual({
      name: "After.png",
      path: "/shots/After.png",
    });
  });

  it("keeps the one picture when the folder no longer lists it", () => {
    expect(folderImageGroup("/shots/gone.png", listing)).toEqual({
      items: [{ name: "gone.png", path: "/shots/gone.png" }],
      index: 0,
    });
  });

  it("caps a busy folder to a window around the picture", () => {
    const many = Array.from({ length: 500 }, (_, index) =>
      file(`shot-${String(index).padStart(3, "0")}.png`),
    );
    const group = folderImageGroup("/shots/shot-250.png", many);
    expect(group.items).toHaveLength(MAX_FOLDER_IMAGES);
    expect(group.items[group.index].name).toBe("shot-250.png");
    const first = folderImageGroup("/shots/shot-000.png", many);
    expect(first.index).toBe(0);
    const last = folderImageGroup("/shots/shot-499.png", many);
    expect(last.items[last.index].name).toBe("shot-499.png");
    expect(last.index).toBe(MAX_FOLDER_IMAGES - 1);
  });

  it("opens one picture at once, then steps through its folder once listed", async () => {
    let finish!: (entries: FsEntry[]) => void;
    const list = vi.fn(
      () =>
        new Promise<FsEntry[]>((resolve) => {
          finish = resolve;
        }),
    );
    expect(openImageFile("/shots/Before.png", list)).toBe(true);
    expect(list).toHaveBeenCalledExactlyOnceWith("/shots");
    expect(imageViewerSnapshot()?.items).toEqual([
      { name: "Before.png", path: "/shots/Before.png" },
    ]);
    finish(listing);
    await Promise.resolve();
    await Promise.resolve();
    const state = imageViewerSnapshot();
    expect(state?.items).toHaveLength(4);
    expect(state?.items[state.index].path).toBe("/shots/Before.png");
  });

  it("ignores a listing that arrives after the viewer moved on", async () => {
    let finish!: (entries: FsEntry[]) => void;
    const list = () =>
      new Promise<FsEntry[]>((resolve) => {
        finish = resolve;
      });
    openImageFile("/shots/Before.png", list);
    openImageViewer({ items: [{ name: "other.png", path: "/other.png" }] });
    finish(listing);
    await Promise.resolve();
    await Promise.resolve();
    expect(imageViewerSnapshot()?.items).toEqual([
      { name: "other.png", path: "/other.png" },
    ]);
  });

  it("keeps the one picture when the folder can't be listed", async () => {
    openImageFile("/shots/Before.png", () =>
      Promise.reject(new Error("denied")),
    );
    await Promise.resolve();
    await Promise.resolve();
    expect(imageViewerSnapshot()?.items).toHaveLength(1);
  });
});

describe("pictures in one reply", () => {
  function reply(html: string) {
    const root = document.createElement("div");
    root.className = "agent-markdown";
    root.innerHTML = html;
    document.body.append(root);
    return root;
  }

  it("pairs Before and After with their captions", () => {
    const root = reply(`
      <div class="markdown-before-after">
        <figure class="markdown-before-after-item"><figcaption>Before</figcaption>
          <span class="markdown-local-image" data-local-image="/s/1-before.png"><button><img src="blob:a"></button></span>
        </figure>
        <figure class="markdown-before-after-item"><figcaption>After</figcaption>
          <span class="markdown-local-image" data-local-image="/s/2-after.png"><button><img src="blob:b"></button></span>
        </figure>
      </div>`);
    const after = root.querySelectorAll("button")[1];
    const group = collectImageGroup(after);
    expect(group).toEqual({
      items: [
        { name: "1-before.png", path: "/s/1-before.png", label: "Before" },
        { name: "2-after.png", path: "/s/2-after.png", label: "After" },
      ],
      index: 1,
    });
    expect(imageGroupSummary(group.items, group.index)).toBe(
      "2 of 2 · Before, After",
    );
  });

  it("steps through every picture in the reply, inline ones included, and no other reply's", () => {
    reply(`<span data-local-image="/elsewhere.png"><img src="blob:x"></span>`);
    const root = reply(`
      <p><span data-local-image="/w/one.png"><img src="blob:1"></span></p>
      <p><button data-viewer-image="" data-viewer-name="Chart"><img src="data:image/png;base64,AAAA"></button></p>
      <p><span data-local-image="/w/three.png"><span role="status">Loading</span></span></p>`);
    const inline = root.querySelector("[data-viewer-image]")!;
    const group = collectImageGroup(inline.querySelector("img")!);
    expect(group.index).toBe(1);
    expect(group.items).toEqual([
      { name: "one.png", path: "/w/one.png" },
      { name: "Chart", src: "data:image/png;base64,AAAA" },
      { name: "three.png", path: "/w/three.png" },
    ]);
    expect(imageGroupSummary(group.items, group.index)).toBe("2 of 3");
  });

  it("opens a picture outside any reply on its own", () => {
    const loose = document.createElement("span");
    loose.setAttribute("data-local-image", "/w/loose.png");
    document.body.append(loose);
    expect(collectImageGroup(loose)).toEqual({
      items: [{ name: "loose.png", path: "/w/loose.png" }],
      index: 0,
    });
  });
});

describe("the count under the picture", () => {
  it("is empty for one picture and lists short captions only", () => {
    expect(imageGroupSummary([{ name: "a.png", path: "/a" }], 0)).toBe("");
    expect(
      imageGroupSummary(
        [
          { name: "a.png", path: "/a" },
          { name: "b.png", path: "/b" },
        ],
        0,
      ),
    ).toBe("1 of 2");
    expect(
      imageGroupSummary(
        [
          { name: "a.png", path: "/a", label: "Before" },
          { name: "b.png", path: "/b", label: "x".repeat(40) },
        ],
        1,
      ),
    ).toBe("2 of 2");
  });
});

describe("changed pictures", () => {
  function change(
    path: string,
    patch: Partial<GitChangedFile> = {},
  ): GitChangedFile {
    return {
      path,
      relative: path.slice(1),
      status: "modified",
      additions: 0,
      deletions: 0,
      staged: false,
      unstaged: true,
      ...patch,
    };
  }

  it("groups the pictures changed in the same section, leaving deleted ones out", () => {
    const files = [
      change("/w/a.png"),
      change("/w/b.ts"),
      change("/w/c.png", { status: "deleted" }),
      change("/w/d.webp", { staged: true, unstaged: false }),
      change("/w/e.jpg"),
    ];
    expect(changedImageGroup(files, "/w/e.jpg", "unstaged")).toEqual({
      items: [
        { name: "a.png", path: "/w/a.png" },
        { name: "e.jpg", path: "/w/e.jpg" },
      ],
      index: 1,
    });
    expect(changedImageGroup(files, "/w/d.webp", "staged")?.items).toEqual([
      { name: "d.webp", path: "/w/d.webp" },
    ]);
    // The single list has no sections: every changed picture, staged or not.
    expect(changedImageGroup(files, "/w/d.webp")).toEqual({
      items: [
        { name: "a.png", path: "/w/a.png" },
        { name: "d.webp", path: "/w/d.webp" },
        { name: "e.jpg", path: "/w/e.jpg" },
      ],
      index: 1,
    });
  });

  it("keeps a changed SVG or text file on its diff", () => {
    expect(changedImageGroup([], "/w/logo.svg", "unstaged")).toBeNull();
    expect(changedImageGroup([], "/w/b.ts", "unstaged")).toBeNull();
  });
});

describe("image attachments", () => {
  const saved: Attachment = {
    id: "saved",
    name: "screen.png",
    mimeType: "image/png",
    kind: "image",
    size: 2048,
    path: "/attachments/screen.png",
  };
  const pasted: Attachment = {
    id: "pasted",
    name: "Pasted image.png",
    mimeType: "image/png",
    kind: "image",
    size: 3,
    data: "AAAA",
  };
  const spec: Attachment = {
    id: "doc",
    name: "spec.pdf",
    mimeType: "application/pdf",
    kind: "file",
    size: 10,
    path: "/attachments/spec.pdf",
  };

  it("steps through the message's pictures, skipping other files", () => {
    expect(attachmentImageGroup(pasted, [saved, spec, pasted])).toEqual({
      items: [
        {
          name: "screen.png",
          path: "/attachments/screen.png",
          size: 2048,
        },
        {
          name: "Pasted image.png",
          src: "data:image/png;base64,AAAA",
          size: 3,
        },
      ],
      index: 1,
    });
  });

  it("does not open a non-image attachment in the viewer", () => {
    expect(attachmentImageGroup(spec, [saved, spec])).toBeNull();
  });
});

describe("dataUrlBytes", () => {
  it("measures base64 data without decoding it", () => {
    expect(dataUrlBytes("data:image/png;base64,AAAA")).toBe(3);
    expect(dataUrlBytes("data:image/png;base64,AAA=")).toBe(2);
    expect(dataUrlBytes("data:image/svg+xml,<svg/>")).toBeUndefined();
  });
});

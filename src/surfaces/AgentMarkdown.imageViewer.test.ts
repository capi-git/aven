// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fs = vi.hoisted(() => ({ readBinaryFile: vi.fn() }));
const core = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("../lib/fs", async (original) => ({
  ...(await original<typeof import("../lib/fs")>()),
  readBinaryFile: fs.readBinaryFile,
}));
vi.mock("@tauri-apps/api/core", async (original) => ({
  ...(await original<typeof import("@tauri-apps/api/core")>()),
  isTauri: () => false,
  invoke: core.invoke,
  convertFileSrc: (path: string) => `asset://localhost${path}`,
}));

const { AgentMarkdown } = await import("./AgentMarkdown");
const { closeImageViewer, imageViewerSnapshot, registerImageViewerHost } =
  await import("../lib/imageViewer");

const CWD = "/Users/me/project";
const NOTE = "/note-assets/note-1/123-diagram.png";
const NOTE_FILE = "/app/notes/note-1/123-diagram.png";
const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

describe("pictures in a chat reply", () => {
  let root: Root;
  let host: HTMLDivElement;
  let unregister: (() => void) | undefined;
  const onOpenFile = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.stubGlobal(
      "IntersectionObserver",
      class {
        constructor(
          callback: (entries: { isIntersecting: boolean }[]) => void,
        ) {
          queueMicrotask(() => callback([{ isIntersecting: true }]));
        }
        observe() {}
        disconnect() {}
      },
    );
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:shot");
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    fs.readBinaryFile.mockResolvedValue(png);
    core.invoke.mockImplementation(async (command: string) => {
      if (command === "notes_image_path") return NOTE_FILE;
      throw new Error(`unexpected ${command}`);
    });
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(async () => {
    closeImageViewer();
    unregister?.();
    unregister = undefined;
    await act(async () => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  const render = (text: string) =>
    act(async () =>
      root.render(createElement(AgentMarkdown, { text, cwd: CWD, onOpenFile })),
    );

  it("opens a Before/After pair together, at the picture clicked", async () => {
    unregister = registerImageViewerHost();
    await render(
      "Updated the header.\n\n![Before](shots/before.png)\n![After](shots/after.png)",
    );
    const buttons = host.querySelectorAll<HTMLButtonElement>(
      ".markdown-local-image-open",
    );
    expect(buttons).toHaveLength(2);
    await act(async () => buttons[1].click());
    expect(onOpenFile).not.toHaveBeenCalled();
    expect(imageViewerSnapshot()).toMatchObject({
      index: 1,
      items: [
        {
          name: "before.png",
          path: `${CWD}/shots/before.png`,
          label: "Before",
        },
        { name: "after.png", path: `${CWD}/shots/after.png`, label: "After" },
      ],
    });
  });

  it("makes a note's picture clickable, stepping with the others beside it", async () => {
    unregister = registerImageViewerHost();
    await render(
      `![Diagram](${NOTE})\n\nAnd the file:\n\n![](shots/after.png)`,
    );
    const note = host.querySelector<HTMLButtonElement>(".markdown-image-open")!;
    expect(note.getAttribute("aria-label")).toBe("Open Diagram");
    await act(async () => note.click());
    expect(imageViewerSnapshot()).toMatchObject({
      index: 0,
      items: [
        { name: "Diagram", src: `asset://localhost${NOTE_FILE}` },
        { name: "after.png", path: `${CWD}/shots/after.png` },
      ],
    });
  });

  it("keeps opening the file, and leaves a note's picture plain, without a viewer", async () => {
    await render(`![Diagram](${NOTE})\n\n![](shots/after.png)`);
    expect(host.querySelector("[data-note-image]")).not.toBeNull();
    expect(host.querySelector(".markdown-image-open")).toBeNull();
    const open = host.querySelector<HTMLButtonElement>(
      ".markdown-local-image-open",
    )!;
    await act(async () => open.click());
    expect(onOpenFile).toHaveBeenCalledExactlyOnceWith(
      `${CWD}/shots/after.png`,
    );
    expect(imageViewerSnapshot()).toBeNull();
  });
});

// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import PdfViewer from "./PdfViewer";

const mocks = vi.hoisted(() => ({
  read: vi.fn(),
  watch: vi.fn(),
  getDocument: vi.fn(),
  destroy: vi.fn(),
  getPage: vi.fn(),
  render: vi.fn(),
}));
vi.mock("../lib/fs", () => ({
  basename: (path: string) => path.split(/[\\/]/).pop(),
  readBinaryFile: mocks.read,
}));
vi.mock("../lib/fileWatch", () => ({ watchFile: mocks.watch }));
vi.mock("pdfjs-dist/legacy/build/pdf.mjs", () => ({
  getDocument: mocks.getDocument,
  GlobalWorkerOptions: {},
}));
vi.mock("pdfjs-dist/legacy/build/pdf.worker.min.mjs?url", () => ({
  default: "/assets/pdf.worker.mjs",
}));

let container: HTMLDivElement;
let root: Root;
let props = { path: "/work/Slides.pdf", active: true };
let changed: () => void;
let cancel: ReturnType<typeof vi.fn>;
const pdf = { numPages: 2, getPage: mocks.getPage };
const render = async (overrides: Partial<typeof props> = {}) => {
  props = { ...props, ...overrides };
  await act(async () => root.render(createElement(PdfViewer, props)));
};
const click = async (label: string) => {
  await act(async () =>
    container
      .querySelector<HTMLButtonElement>(`[aria-label="${label}"]`)!
      .click(),
  );
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("devicePixelRatio", 2);
  vi.stubGlobal(
    "ResizeObserver",
    class {
      constructor(private callback: () => void) {}
      observe() {
        this.callback();
      }
      disconnect() {}
    },
  );
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(640);
  vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(480);
  mocks.read.mockResolvedValue(new TextEncoder().encode("%PDF-1.7"));
  mocks.watch.mockImplementation((_path: string, callback: () => void) => {
    changed = callback;
    return vi.fn();
  });
  mocks.destroy.mockResolvedValue(undefined);
  mocks.getDocument.mockImplementation(() => ({
    promise: Promise.resolve(pdf),
    destroy: mocks.destroy,
  }));
  cancel = vi.fn();
  mocks.render.mockImplementation(() => ({
    promise: Promise.resolve(),
    cancel,
  }));
  mocks.getPage.mockImplementation(async () => ({
    getViewport: ({ scale }: { scale: number }) => ({
      width: 612 * scale,
      height: 792 * scale,
    }),
    render: mocks.render,
  }));
  props = { path: "/work/Slides.pdf", active: true };
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

it("renders local PDF bytes at Retina resolution with page and zoom controls", async () => {
  await render();
  expect(mocks.read).toHaveBeenCalledExactlyOnceWith(props.path);
  expect(mocks.getDocument).toHaveBeenCalledWith(
    expect.objectContaining({
      data: expect.any(Uint8Array),
      enableXfa: false,
      useWasm: false,
      cMapUrl: expect.stringMatching(/\/pdfjs\/cmaps\/$/),
    }),
  );
  const first = container.querySelector("canvas")!;
  expect(first.getAttribute("aria-label")).toBe("Page 1 of 2");
  expect(first.width).toBe(Math.floor(parseFloat(first.style.width) * 2));
  expect(container.textContent).toContain("Page 1 of 2");
  await click("Next PDF page");
  expect(container.querySelector("canvas")?.getAttribute("aria-label")).toBe(
    "Page 2 of 2",
  );
  expect(mocks.getPage).toHaveBeenLastCalledWith(2);
  await click("Zoom in PDF");
  expect(container.querySelector("canvas")!.width).toBeGreaterThan(first.width);
  await click("Fit PDF page");
  expect(container.querySelector("canvas")!.width).toBe(first.width);
  expect(mocks.read).toHaveBeenCalledOnce();
});

it("defers hidden restored tabs and file-change reloads until the tab is visible", async () => {
  await render({ active: false });
  expect(mocks.read).not.toHaveBeenCalled();
  expect(mocks.getDocument).not.toHaveBeenCalled();
  await render({ active: true });
  await render({ active: false });
  const count = mocks.render.mock.calls.length;
  await act(async () => {
    changed();
    vi.advanceTimersByTime(100);
  });
  expect(mocks.read).toHaveBeenCalledOnce();
  expect(mocks.render).toHaveBeenCalledTimes(count);
  await render({ active: true });
  expect(mocks.read).toHaveBeenCalledTimes(2);
  expect(mocks.destroy).toHaveBeenCalledOnce();
});

it("does not parse stale file reads after a different PDF replaces the tab", async () => {
  let finish!: (value: Uint8Array) => void;
  mocks.read.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  await render();
  await render({ path: "/work/New.pdf" });
  await act(async () => finish(new TextEncoder().encode("%PDF-old")));
  expect(mocks.getDocument).toHaveBeenCalledOnce();
  expect(container.querySelector("section")?.getAttribute("aria-label")).toBe(
    "PDF viewer: New.pdf",
  );
});

it("destroys a pending loading task and ignores its late completion after closing", async () => {
  let finish!: (value: typeof pdf) => void;
  mocks.getDocument.mockImplementationOnce(() => ({
    promise: new Promise((resolve) => {
      finish = resolve;
    }),
    destroy: mocks.destroy,
  }));
  await render();
  await act(async () => root.render(null));
  expect(mocks.destroy).toHaveBeenCalledOnce();
  await act(async () => finish(pdf));
  expect(mocks.getPage).not.toHaveBeenCalled();
});

it("cancels old rendering so a late first page cannot replace the selected page", async () => {
  let finish!: () => void;
  const oldCancel = vi.fn();
  mocks.render.mockImplementationOnce(() => ({
    promise: new Promise<void>((resolve) => {
      finish = resolve;
    }),
    cancel: oldCancel,
  }));
  await render();
  await click("Next PDF page");
  expect(oldCancel).toHaveBeenCalledOnce();
  await act(async () => finish());
  expect(container.querySelector("canvas")?.getAttribute("aria-label")).toBe(
    "Page 2 of 2",
  );
});

it("shows an unreadable PDF error and retries without sending bytes to the text editor", async () => {
  mocks.getDocument.mockImplementationOnce(() => ({
    promise: Promise.reject(new Error("Invalid PDF structure")),
    destroy: mocks.destroy,
  }));
  await render();
  expect(container.querySelector('[role="alert"]')?.textContent).toContain(
    "Invalid PDF structure",
  );
  await act(async () => container.querySelector("button")!.click());
  expect(container.querySelector("canvas")).not.toBeNull();
  expect(mocks.destroy).toHaveBeenCalledOnce();
});

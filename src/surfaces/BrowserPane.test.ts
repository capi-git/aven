// @vitest-environment happy-dom
import { act, createElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BrowserPane } from "./BrowserPane";
import type { BrowserState } from "../lib/browser";
import * as workspaceTransfers from "../lib/workspaceTransfers";

const appMenu = vi.hoisted(() => ({
  open: vi.fn(),
  update: vi.fn(),
  close: vi.fn(),
  callbacks: new Map<
    string,
    (event: { label: string; presentation: string; action?: string }) => void
  >(),
}));
vi.mock("../lib/workspaceMenuPanel", () => ({
  nativeWorkspaceMenuPanel: {
    ...appMenu,
    listen: vi.fn(
      async (
        name: string,
        callback: (event: {
          label: string;
          presentation: string;
          action?: string;
        }) => void,
      ) => {
        appMenu.callbacks.set(name, callback);
        return () => {
          if (appMenu.callbacks.get(name) === callback)
            appMenu.callbacks.delete(name);
        };
      },
    ),
  },
}));

const mocks = vi.hoisted(() => ({
  attach: vi.fn(),
  create: vi.fn(),
  close: vi.fn(),
  layout: vi.fn(),
  navigate: vi.fn(),
  action: vi.fn(),
  edit: vi.fn(),
  editAttachment: vi.fn(),
  find: vi.fn(),
  downloads: vi.fn(),
  downloadAction: vi.fn(),
  listenDownloads: vi.fn(),
  stopDownloads: vi.fn(),
  listenToolbar: vi.fn(),
  listenEditing: vi.fn(),
  stopEditing: vi.fn(),
  stopToolbar: vi.fn(),
  ownerUnminimize: vi.fn(),
  ownerShow: vi.fn(),
  ownerFocus: vi.fn(),
  shellFocus: vi.fn(),
  snapshot: vi.fn(),
  decode: vi.fn(),
  nativeMenu: vi.fn(),
  browserMenu: vi.fn(),
  dropIndicator: vi.fn(),
  external: vi.fn(),
  setFloating: vi.fn(),
  showFloating: vi.fn(),
  unlisten: vi.fn(),
  listen: vi.fn(),
  bounds: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => true }));
vi.mock("@tauri-apps/api/menu", () => ({ Menu: { new: mocks.nativeMenu } }));
vi.mock("../lib/platform", async (original) => ({
  ...(await original<typeof import("../lib/platform")>()),
  IS_MAC: true,
}));
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({
    onFocusChanged: async () => () => {},
    unminimize: mocks.ownerUnminimize,
    show: mocks.ownerShow,
    setFocus: mocks.ownerFocus,
  }),
}));
vi.mock("@tauri-apps/api/webview", () => ({
  getCurrentWebview: () => ({ setFocus: mocks.shellFocus }),
}));
vi.mock("../lib/browser", async (original) => ({
  ...(await original<typeof import("../lib/browser")>()),
  browserBounds: mocks.bounds,
  browserEditAttachment: mocks.editAttachment,
  openBrowserExternally: mocks.external,
  nativeBrowser: {
    menu: mocks.browserMenu,
    dropIndicator: mocks.dropIndicator,
    attach: mocks.attach,
    create: mocks.create,
    close: mocks.close,
    layout: mocks.layout,
    navigate: mocks.navigate,
    listen: mocks.listen,
    action: mocks.action,
    edit: mocks.edit,
    find: mocks.find,
    downloads: mocks.downloads,
    downloadAction: mocks.downloadAction,
    listenDownloads: mocks.listenDownloads,
    listenToolbar: mocks.listenToolbar,
    listenEditing: mocks.listenEditing,
    snapshot: mocks.snapshot,
    setFloating: mocks.setFloating,
    showFloating: mocks.showFloating,
  },
}));

describe("native preview lifecycle", () => {
  let container: HTMLDivElement;
  let root: Root;
  let frameId: number;
  let frames: Map<number, FrameRequestCallback>;
  let resizeCallback: () => void;
  let mutationCallback: (records: Partial<MutationRecord>[]) => void;
  let observedResizes: Set<object>;
  let observedMutations: Set<typeof mutationCallback>;
  const flushFrame = async () => {
    await act(async () => {
      const pending = [...frames.values()];
      frames.clear();
      for (const callback of pending) callback(0);
    });
  };
  beforeEach(() => {
    vi.clearAllMocks();
    appMenu.open.mockResolvedValue({
      label: "browser-actions",
      presentation: "open-1",
    });
    appMenu.update.mockResolvedValue({
      label: "browser-actions",
      presentation: "open-1",
    });
    appMenu.close.mockResolvedValue(undefined);
    appMenu.callbacks.clear();
    vi.useFakeTimers();
    mocks.create.mockResolvedValue(undefined);
    mocks.attach.mockResolvedValue({
      id: "existing-native",
      url: "https://example.com/",
      title: "Existing page",
      loading: false,
      canGoBack: false,
      canGoForward: false,
      error: null,
    });
    mocks.close.mockResolvedValue(undefined);
    mocks.layout.mockResolvedValue(undefined);
    mocks.navigate.mockResolvedValue(undefined);
    mocks.action.mockResolvedValue(undefined);
    mocks.edit.mockResolvedValue(undefined);
    mocks.editAttachment.mockResolvedValue({
      id: "selected-element",
      name: "Selected element.png",
      mimeType: "image/png",
      kind: "image",
      size: 8,
      data: "iVBORw0KGgo=",
      path: "/tmp/selected-element.png",
    });
    mocks.browserMenu.mockResolvedValue(null);
    mocks.dropIndicator.mockResolvedValue(undefined);
    mocks.find.mockResolvedValue(undefined);
    mocks.downloadAction.mockResolvedValue(undefined);
    mocks.downloads.mockResolvedValue([]);
    mocks.listenDownloads.mockResolvedValue(mocks.stopDownloads);
    mocks.listenToolbar.mockResolvedValue(mocks.stopToolbar);
    mocks.listenEditing.mockResolvedValue(mocks.stopEditing);
    mocks.ownerUnminimize.mockResolvedValue(undefined);
    mocks.ownerShow.mockResolvedValue(undefined);
    mocks.ownerFocus.mockResolvedValue(undefined);
    mocks.shellFocus.mockResolvedValue(undefined);
    mocks.external.mockResolvedValue(undefined);
    mocks.setFloating.mockResolvedValue(undefined);
    mocks.showFloating.mockResolvedValue(undefined);
    mocks.snapshot.mockResolvedValue("data:image/png;base64,c25hcHNob3Q=");
    mocks.decode.mockResolvedValue(undefined);
    vi.spyOn(HTMLImageElement.prototype, "decode").mockImplementation(
      mocks.decode,
    );
    mocks.listen.mockResolvedValue(mocks.unlisten);
    mocks.bounds.mockReturnValue({
      x: 100,
      y: 80,
      width: 600,
      height: 500,
      scale: 2,
    });
    frameId = 0;
    frames = new Map();
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      frames.set(++frameId, callback);
      return frameId;
    });
    vi.stubGlobal("cancelAnimationFrame", (id: number) => frames.delete(id));
    observedResizes = new Set();
    vi.stubGlobal(
      "ResizeObserver",
      class {
        constructor(callback: () => void) {
          resizeCallback = callback;
        }
        observe() {
          observedResizes.add(this);
        }
        disconnect() {
          observedResizes.delete(this);
        }
      },
    );
    observedMutations = new Set();
    mutationCallback = (records) => {
      for (const callback of [...observedMutations]) callback(records);
    };
    vi.stubGlobal(
      "MutationObserver",
      class {
        constructor(private callback: typeof mutationCallback) {}
        observe() {
          observedMutations.add(this.callback);
        }
        disconnect() {
          observedMutations.delete(this.callback);
        }
      },
    );
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    delete document.body.dataset.personalResizing;
    delete document.body.dataset.personalTransitioning;
    document.documentElement.classList.remove("is-resizing");
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("does not allocate a webview for a blank pane", async () => {
    await act(async () =>
      root.render(createElement(BrowserPane, { id: "one" })),
    );
    expect(mocks.create).not.toHaveBeenCalled();
    expect(container.querySelector("iframe")).toBeNull();
    expect(container.textContent).toContain("Enter an address");
  });

  it("acknowledges an attached page in a hidden window without waiting for paint", async () => {
    const ready = vi.fn();
    await act(async () =>
      root.render(
        createElement(BrowserPane, {
          id: "attached",
          initialUrl: "https://example.com/",
          attachedNativeId: "existing-native",
          visible: false,
          onNativeReady: ready,
        }),
      ),
    );
    expect(mocks.attach).toHaveBeenCalledWith("existing-native");
    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.layout).toHaveBeenCalledWith(
      "existing-native",
      mocks.bounds.mock.results[0].value,
      false,
    );
    expect(ready).toHaveBeenCalledWith("existing-native");
    expect(mocks.layout.mock.invocationCallOrder[0]).toBeLessThan(
      ready.mock.invocationCallOrder[0],
    );
    expect(frames.size).toBe(0);
  });

  it.each([false, true])(
    "keeps a created page live when its parent records its native ID (transferred: %s)",
    async (transferred) => {
      const transfer = vi
        .spyOn(workspaceTransfers, "browserIsTransferred")
        .mockReturnValue(transferred);
      const ready = vi.fn();
      const titleChanged = vi.fn();
      function RecordedPage() {
        const [nativeId, setNativeId] = useState<string>();
        return createElement(BrowserPane, {
          id: "recorded",
          initialUrl: "https://example.com/",
          attachedNativeId: nativeId,
          onNativeReady: (id: string) => {
            ready(id);
            setNativeId(id);
          },
          onTitleChange: titleChanged,
        });
      }
      try {
        await act(async () => root.render(createElement(RecordedPage)));
        await flushFrame();
        const nativeId = mocks.create.mock.calls[0][0];
        expect(mocks.create).toHaveBeenCalledOnce();
        expect(ready).toHaveBeenCalledExactlyOnceWith(nativeId);
        expect(mocks.attach).not.toHaveBeenCalled();
        expect(mocks.close).not.toHaveBeenCalled();
        expect(mocks.unlisten).not.toHaveBeenCalled();
        expect(mocks.layout.mock.calls.every((call) => call[2])).toBe(true);
        await receive({ title: "Page is still live" });
        expect(titleChanged).toHaveBeenLastCalledWith("Page is still live");
        await act(async () => root.render(null));
        expect(mocks.unlisten).toHaveBeenCalledOnce();
        if (transferred) expect(mocks.close).not.toHaveBeenCalled();
        else expect(mocks.close).toHaveBeenCalledExactlyOnceWith(nativeId);
      } finally {
        transfer.mockRestore();
      }
    },
  );

  it.each([false, true])(
    "replaces a page only for a different native ID and cleans up its prior generation (creation pending: %s)",
    async (pending) => {
      let finishCreate: (() => void) | undefined;
      if (pending)
        mocks.create.mockImplementationOnce(
          () =>
            new Promise<void>((resolve) => {
              finishCreate = resolve;
            }),
        );
      const ready = vi.fn();
      const titleChanged = vi.fn();
      const props = {
        id: "replacement",
        initialUrl: "https://example.com/",
        onNativeReady: ready,
        onTitleChange: titleChanged,
      };
      await act(async () => root.render(createElement(BrowserPane, props)));
      const previousId = mocks.create.mock.calls[0][0];
      const previousReceive = mocks.listen.mock.calls[0][0];
      await act(async () =>
        root.render(
          createElement(BrowserPane, {
            ...props,
            attachedNativeId: "existing-native",
          }),
        ),
      );
      await act(async () => finishCreate?.());
      expect(mocks.create).toHaveBeenCalledOnce();
      expect(mocks.attach).toHaveBeenCalledExactlyOnceWith("existing-native");
      expect(mocks.close).toHaveBeenCalledExactlyOnceWith(previousId);
      expect(ready).toHaveBeenLastCalledWith("existing-native");
      expect(ready).toHaveBeenCalledTimes(pending ? 1 : 2);
      await act(async () =>
        previousReceive({
          id: previousId,
          title: "Stale page",
          error: "This page has closed",
        }),
      );
      expect(titleChanged).not.toHaveBeenCalledWith("Stale page");
      expect(container.textContent).not.toContain("This page has closed");
      await act(async () => root.render(null));
      expect(mocks.close).toHaveBeenLastCalledWith("existing-native");
      expect(mocks.close).toHaveBeenCalledTimes(2);
    },
  );

  it("republishes unchanged placement after a failed native window transfer", async () => {
    await act(async () =>
      root.render(
        createElement(BrowserPane, {
          id: "rollback",
          initialUrl: "https://example.com/",
        }),
      ),
    );
    const before = mocks.layout.mock.calls.length;
    const committed = mocks.layout.mock.calls.at(-1);
    await act(async () =>
      window.dispatchEvent(new Event("supermono:browser-layout-reset")),
    );
    expect(mocks.layout).toHaveBeenCalledTimes(before + 1);
    expect(mocks.layout.mock.calls.at(-1)).toEqual(committed);
    expect(mocks.create).toHaveBeenCalledTimes(1);
    expect(mocks.snapshot).not.toHaveBeenCalled();
    expect(frames.size).toBe(0);
  });

  it("keeps the selected native page presented when WK reports itself occluded", async () => {
    const visibility = vi
      .spyOn(document, "visibilityState", "get")
      .mockReturnValue("hidden");
    try {
      const id = await openPane();
      expect(mocks.layout).toHaveBeenLastCalledWith(
        id,
        expect.any(Object),
        true,
      );
      mocks.layout.mockClear();
      await act(async () =>
        document.dispatchEvent(new Event("visibilitychange")),
      );
      expect(mocks.layout).not.toHaveBeenCalled();
      expect(mocks.snapshot).not.toHaveBeenCalled();
      await openPane({ visible: false });
      expect(mocks.layout).toHaveBeenLastCalledWith(
        id,
        expect.any(Object),
        false,
      );
      await openPane({ visible: true });
      expect(mocks.layout).toHaveBeenLastCalledWith(
        id,
        expect.any(Object),
        true,
      );
      expect(mocks.create).toHaveBeenCalledOnce();
      expect(mocks.navigate).not.toHaveBeenCalled();
    } finally {
      visibility.mockRestore();
    }
  });

  it("focuses a new blank page address only on its first visible presentation", async () => {
    await act(async () =>
      root.render(createElement(BrowserPane, { id: "blank", visible: false })),
    );
    const input = container.querySelector("input")!;
    expect(document.activeElement).not.toBe(input);
    await act(async () =>
      root.render(createElement(BrowserPane, { id: "blank", visible: true })),
    );
    expect(document.activeElement).toBe(input);
    await act(async () =>
      root.render(createElement(BrowserPane, { id: "blank", visible: false })),
    );
    const elsewhere = document.createElement("button");
    container.append(elsewhere);
    elsewhere.focus();
    await act(async () =>
      root.render(createElement(BrowserPane, { id: "blank", visible: true })),
    );
    expect(document.activeElement).toBe(elsewhere);
    elsewhere.remove();
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("searches words and phrases from the address bar instead of inventing a hostname", async () => {
    await openPane();
    for (const query of ["google", "local preview tools"]) {
      await act(async () => {
        const input = container.querySelector("input")!;
        Object.getOwnPropertyDescriptor(
          HTMLInputElement.prototype,
          "value",
        )!.set!.call(input, query);
        input.dispatchEvent(new Event("input", { bubbles: true }));
      });
      await act(async () => {
        container
          .querySelector("form")!
          .dispatchEvent(
            new Event("submit", { bubbles: true, cancelable: true }),
          );
      });
      expect(mocks.navigate).toHaveBeenLastCalledWith(
        expect.any(String),
        `https://www.google.com/search?q=${query.replaceAll(" ", "+")}`,
      );
    }
    expect(container.querySelector("input")?.placeholder).toBe(
      "Search or enter a web address",
    );
    expect(mocks.close).not.toHaveBeenCalled();
  });

  it("shows real load errors, offers a search for legacy single-word URLs, and restores the same native view", async () => {
    await act(async () =>
      root.render(
        createElement(BrowserPane, {
          id: "legacy",
          initialUrl: "https://google/",
        }),
      ),
    );
    await flushFrame();
    await receive({
      url: "https://google/",
      loading: false,
      error: "The server could not be found.",
    });
    await flushFrame();
    expect(container.textContent).toContain("Preview unavailable");
    expect(container.textContent).toContain("The server could not be found.");
    expect(mocks.layout.mock.calls.at(-1)![2]).toBe(false);
    const search = [...container.querySelectorAll("button")].find(
      (button) => button.textContent === "Search for google",
    )!;
    await act(async () => search.click());
    expect(mocks.navigate).toHaveBeenLastCalledWith(
      expect.any(String),
      "https://www.google.com/search?q=google",
    );
    await receive({
      url: "https://www.google.com/search?q=google",
      loading: false,
      error: null,
    });
    await flushFrame();
    expect(container.textContent).not.toContain("Preview unavailable");
    expect(mocks.layout.mock.calls.at(-1)![2]).toBe(true);
    expect(mocks.create).toHaveBeenCalledOnce();
    expect(mocks.close).not.toHaveBeenCalled();
  });

  it.each([false, true])(
    "closes an unadopted page created after its pane closes (detached: %s)",
    async (detached) => {
      const transfer = vi
        .spyOn(workspaceTransfers, "browserIsTransferred")
        .mockReturnValue(detached);
      const ready = vi.fn();
      let finishCreate!: () => void;
      mocks.create.mockImplementation(
        () =>
          new Promise<void>((resolve) => {
            finishCreate = resolve;
          }),
      );
      await act(async () =>
        root.render(
          createElement(BrowserPane, {
            id: "one",
            initialUrl: "localhost:3000",
            onNativeReady: ready,
          }),
        ),
      );
      expect(mocks.create).toHaveBeenCalledOnce();
      const nativeId = mocks.create.mock.calls[0][0];
      await act(async () => root.render(null));
      await act(async () => finishCreate());
      transfer.mockRestore();
      expect(mocks.close).toHaveBeenCalledExactlyOnceWith(nativeId);
      expect(ready).not.toHaveBeenCalled();
      expect(mocks.unlisten).toHaveBeenCalled();
    },
  );

  it("preserves an attached page if a detached pane unmounts before attach completes", async () => {
    const transfer = vi
      .spyOn(workspaceTransfers, "browserIsTransferred")
      .mockReturnValue(true);
    let finishAttach!: (state: Partial<BrowserState>) => void;
    mocks.attach.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishAttach = resolve;
        }),
    );
    const ready = vi.fn();
    await act(async () =>
      root.render(
        createElement(BrowserPane, {
          id: "transferred",
          initialUrl: "localhost:3000",
          attachedNativeId: "retained-native",
          onNativeReady: ready,
        }),
      ),
    );
    expect(mocks.attach).toHaveBeenCalledExactlyOnceWith("retained-native");
    await act(async () => root.render(null));
    await act(async () => finishAttach({ id: "retained-native" }));
    transfer.mockRestore();
    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.close).not.toHaveBeenCalled();
    expect(ready).not.toHaveBeenCalled();
  });

  it("keeps each project view isolated when switching during creation", async () => {
    const finishes: (() => void)[] = [];
    mocks.create.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finishes.push(resolve);
        }),
    );
    await act(async () =>
      root.render(
        createElement(BrowserPane, { id: "one", initialUrl: "localhost:3000" }),
      ),
    );
    await act(async () =>
      root.render(
        createElement(BrowserPane, { id: "two", initialUrl: "localhost:4000" }),
      ),
    );
    const first = mocks.create.mock.calls[0];
    const second = mocks.create.mock.calls[1];
    expect(first[0]).not.toBe(second[0]);
    expect(first[1]).toBe("http://localhost:3000/");
    expect(second[1]).toBe("http://localhost:4000/");
    await act(async () => finishes[0]());
    expect(mocks.close).toHaveBeenCalledWith(first[0]);
    expect(mocks.close).not.toHaveBeenCalledWith(second[0]);
    await act(async () => root.render(null));
    await act(async () => finishes[1]());
    expect(mocks.close).toHaveBeenCalledWith(second[0]);
  });

  const openPane = async (
    props: Partial<Parameters<typeof BrowserPane>[0]> = {},
  ) => {
    await act(async () =>
      root.render(
        createElement(BrowserPane, {
          id: "one",
          initialUrl: "localhost:3000",
          ...props,
        }),
      ),
    );
    await flushFrame();
    return mocks.create.mock.calls.at(-1)![0] as string;
  };
  const receive = async (state: Partial<BrowserState> = {}) => {
    await act(async () =>
      mocks.listen.mock.calls.at(-1)![0]({
        id: mocks.create.mock.calls.at(-1)![0],
        url: "http://localhost:3000/",
        title: "Working page",
        loading: false,
        canGoBack: true,
        canGoForward: false,
        error: null,
        notice: null,
        ...state,
      }),
    );
  };

  it("attaches a selected element screenshot without JSON or inserted draft text", async () => {
    const add = vi.fn();
    const id = await openPane({ onAddToChat: add });
    expect(container.querySelector(".browser-go")).toBeNull();
    await act(async () =>
      container
        .querySelector<HTMLButtonElement>('[aria-label="Edit page"]')!
        .click(),
    );
    const token = mocks.edit.mock.calls.at(-1)![2];
    expect(mocks.edit).toHaveBeenCalledWith(id, true, token);
    const callback = mocks.listenEditing.mock.calls.at(-1)![0];
    const selection = {
      url: "http://localhost:3000/",
      title: "Example",
      selector: "#submit",
      tag: "button",
      text: "Save",
    };
    await act(async () =>
      callback({ id: "another-browser", token, active: false, selection }),
    );
    expect(add).not.toHaveBeenCalled();
    await act(async () =>
      callback({
        id,
        token,
        active: false,
        selection,
        screenshot: {
          dataUrl: "data:image/png;base64,iVBORw0KGgo=",
          width: 120,
          height: 32,
        },
      }),
    );
    expect(add).toHaveBeenCalledTimes(1);
    expect(add).toHaveBeenCalledWith("", [
      expect.objectContaining({
        name: "Selected element.png",
        kind: "image",
        path: "/tmp/selected-element.png",
      }),
    ]);
    expect(JSON.stringify(add.mock.calls)).not.toContain("selector");
    expect(container.querySelector('[aria-label="Edit page"]')).not.toBeNull();
    expect(mocks.navigate).not.toHaveBeenCalled();
  });

  it("keeps selection active without attaching until the inline comment is committed", async () => {
    let finish!: (value: object) => void;
    mocks.editAttachment.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const add = vi.fn();
    const id = await openPane({ onAddToChat: add });
    await act(async () =>
      container
        .querySelector<HTMLButtonElement>('[aria-label="Edit page"]')!
        .click(),
    );
    const token = mocks.edit.mock.calls.at(-1)![2];
    const callback = mocks.listenEditing.mock.calls.at(-1)![0];
    await act(async () => callback({ id, token, active: true }));
    expect(add).not.toHaveBeenCalled();
    expect(mocks.editAttachment).not.toHaveBeenCalled();
    expect(container.textContent).toContain(
      "Select an element, then add a comment. Press Esc to exit.",
    );
    const committed = {
      id,
      token,
      active: false,
      comment: "Make this heading smaller and blue.",
      selection: {
        url: "http://localhost:3000/",
        title: "Example page",
        selector: "#heading",
        tag: "h1",
        text: "Page text is context, not the user's comment.",
      },
      screenshot: {
        dataUrl: "data:image/png;base64,iVBORw0KGgo=",
        width: 120,
        height: 32,
      },
    };
    await act(async () => callback({ ...committed, active: true }));
    expect(mocks.editAttachment).not.toHaveBeenCalled();
    expect(
      container.querySelector('[aria-label="Exit edit mode"]'),
    ).not.toBeNull();
    await act(async () => {
      callback(committed);
      callback(committed);
    });
    expect(mocks.editAttachment).toHaveBeenCalledOnce();
    expect(add).not.toHaveBeenCalled();
    const attachment = {
      id: "capture",
      kind: "image",
      name: "Selected element.png",
    };
    await act(async () => finish(attachment));
    await act(async () => callback(committed));
    expect(add).toHaveBeenCalledExactlyOnceWith(committed.comment, [
      attachment,
    ]);
    expect(JSON.stringify(add.mock.calls)).not.toContain("#heading");
    expect(JSON.stringify(add.mock.calls)).not.toContain(
      committed.selection.text,
    );
    expect(mocks.navigate).not.toHaveBeenCalled();
  });

  it("does not attach a late commented selection after cancelling the annotation", async () => {
    const add = vi.fn();
    const id = await openPane({ onAddToChat: add });
    await act(async () =>
      container
        .querySelector<HTMLButtonElement>('[aria-label="Edit page"]')!
        .click(),
    );
    const token = mocks.edit.mock.calls.at(-1)![2];
    const callback = mocks.listenEditing.mock.calls.at(-1)![0];
    await act(async () => callback({ id, token, active: true }));
    await act(async () => callback({ id, token, active: false }));
    await act(async () =>
      callback({
        id,
        token,
        active: false,
        comment: "Cancelled comment",
        selection: {
          url: "http://localhost:3000/",
          title: "Example",
          selector: "h1",
          tag: "h1",
          text: "Heading",
        },
        screenshot: {
          dataUrl: "data:image/png;base64,iVBORw0KGgo=",
          width: 120,
          height: 32,
        },
      }),
    );
    expect(add).not.toHaveBeenCalled();
    expect(mocks.editAttachment).not.toHaveBeenCalled();
  });

  it("shows capture failures without falling back to raw element JSON", async () => {
    const add = vi.fn();
    const id = await openPane({ onAddToChat: add });
    await act(async () =>
      container
        .querySelector<HTMLButtonElement>('[aria-label="Edit page"]')!
        .click(),
    );
    const token = mocks.edit.mock.calls.at(-1)![2];
    await act(async () =>
      mocks.listenEditing.mock.calls.at(-1)![0]({
        id,
        token,
        active: false,
        comment: "Make this smaller",
        selection: {
          url: "http://localhost:3000/",
          title: "Page",
          selector: "#save",
          tag: "button",
          text: "Save",
        },
      }),
    );
    expect(add).not.toHaveBeenCalled();
    expect(container.textContent).toContain(
      "Could not capture the selected element",
    );
  });

  it("does not attach a screenshot after its browser is hidden while saving", async () => {
    let finish!: (value: object) => void;
    mocks.editAttachment.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const add = vi.fn();
    const id = await openPane({ onAddToChat: add });
    await act(async () =>
      container
        .querySelector<HTMLButtonElement>('[aria-label="Edit page"]')!
        .click(),
    );
    const token = mocks.edit.mock.calls.at(-1)![2];
    await act(async () =>
      mocks.listenEditing.mock.calls.at(-1)![0]({
        id,
        token,
        active: false,
        selection: {
          url: "http://localhost:3000/",
          title: "Page",
          selector: "#save",
          tag: "button",
          text: "Save",
        },
        screenshot: {
          dataUrl: "data:image/png;base64,iVBORw0KGgo=",
          width: 120,
          height: 32,
        },
      }),
    );
    await act(async () =>
      root.render(
        createElement(BrowserPane, {
          id: "one",
          initialUrl: "localhost:3000",
          visible: false,
          onAddToChat: add,
        }),
      ),
    );
    await act(async () =>
      finish({ id: "capture", kind: "image", name: "Selected element.png" }),
    );
    expect(add).not.toHaveBeenCalled();
  });

  it("cancels selection when hidden and ignores a late selected element", async () => {
    const add = vi.fn();
    const id = await openPane({ onAddToChat: add });
    await act(async () =>
      container
        .querySelector<HTMLButtonElement>('[aria-label="Edit page"]')!
        .click(),
    );
    const callback = mocks.listenEditing.mock.calls.at(-1)![0];
    const token = mocks.edit.mock.calls.at(-1)![2];
    await act(async () =>
      root.render(
        createElement(BrowserPane, {
          id: "one",
          initialUrl: "localhost:3000",
          onAddToChat: add,
          visible: false,
        }),
      ),
    );
    expect(mocks.edit).toHaveBeenCalledWith(id, false, token);
    await act(async () =>
      callback({
        id,
        token,
        active: false,
        selection: {
          url: "http://localhost:3000/",
          title: "Old",
          selector: "body",
          tag: "body",
          text: "Old",
        },
      }),
    );
    expect(add).not.toHaveBeenCalled();
  });

  it("reports picker failure without navigating or adding a misleading draft", async () => {
    const add = vi.fn();
    await openPane({ onAddToChat: add });
    mocks.edit.mockRejectedValueOnce(new Error("Selection unavailable"));
    await act(async () =>
      container
        .querySelector<HTMLButtonElement>('[aria-label="Edit page"]')!
        .click(),
    );
    expect(container.textContent).toContain("Selection unavailable");
    expect(container.querySelector('[aria-label="Edit page"]')).not.toBeNull();
    expect(add).not.toHaveBeenCalled();
  });

  it("exits through the visible Done button without navigating or accepting a late capture", async () => {
    const add = vi.fn();
    const id = await openPane({ onAddToChat: add });
    await act(async () =>
      container
        .querySelector<HTMLButtonElement>('[aria-label="Edit page"]')!
        .click(),
    );
    const token = mocks.edit.mock.calls.at(-1)![2];
    const done = container.querySelector<HTMLButtonElement>(
      '.browser-toolbar [aria-label="Exit edit mode"]',
    )!;
    expect(done.textContent).toBe("Done");
    expect(done.type).toBe("button");
    expect(done.classList.contains("browser-utility")).toBe(false);
    mocks.edit.mockClear();
    await act(async () => {
      done.click();
      done.click();
    });
    expect(mocks.edit).toHaveBeenCalledExactlyOnceWith(id, false, token);
    expect(container.querySelector(".browser-edit-hint")).toBeNull();
    expect(container.querySelector('[aria-label="Edit page"]')).not.toBeNull();
    await act(async () =>
      mocks.listenEditing.mock.calls.at(-1)![0]({
        id,
        token,
        active: false,
        selection: {
          url: "http://localhost:3000/",
          title: "Late",
          selector: "#late",
          tag: "button",
          text: "Late",
        },
        screenshot: {
          dataUrl: "data:image/png;base64,iVBORw0KGgo=",
          width: 120,
          height: 32,
        },
      }),
    );
    expect(add).not.toHaveBeenCalled();
    expect(mocks.navigate).not.toHaveBeenCalled();
  });

  it("cancels page selection with Escape while focus remains in the shell toolbar", async () => {
    const add = vi.fn();
    const id = await openPane({ onAddToChat: add });
    const button = container.querySelector<HTMLButtonElement>(
      '[aria-label="Edit page"]',
    )!;
    await act(async () => {
      button.focus();
      button.click();
    });
    const token = mocks.edit.mock.calls.at(-1)![2];
    expect(document.activeElement).toBe(button);
    expect(container.querySelector(".browser-edit-hint")).not.toBeNull();
    const escape = new KeyboardEvent("keydown", {
      key: "Escape",
      bubbles: true,
      cancelable: true,
    });
    await act(async () => button.dispatchEvent(escape));
    expect(escape.defaultPrevented).toBe(true);
    expect(mocks.edit).toHaveBeenLastCalledWith(id, false, token);
    expect(container.querySelector(".browser-edit-hint")).toBeNull();
    expect(container.querySelector('[aria-label="Edit page"]')).not.toBeNull();
    expect(add).not.toHaveBeenCalled();
    const calls = mocks.edit.mock.calls.length;
    const nextEscape = new KeyboardEvent("keydown", {
      key: "Escape",
      bubbles: true,
      cancelable: true,
    });
    await act(async () => document.body.dispatchEvent(nextEscape));
    expect(nextEscape.defaultPrevented).toBe(false);
    expect(mocks.edit).toHaveBeenCalledTimes(calls);
  });

  it("restores Done after a failed stop and retries the same picker without duplicate stops", async () => {
    const add = vi.fn();
    const id = await openPane({ onAddToChat: add });
    const click = async (label: string) =>
      act(async () =>
        container
          .querySelector<HTMLButtonElement>(`[aria-label="${label}"]`)!
          .click(),
      );
    await click("Edit page");
    const token = mocks.edit.mock.calls.at(-1)![2];
    let rejectStop!: (reason: Error) => void;
    mocks.edit.mockImplementationOnce(
      () =>
        new Promise<void>((_resolve, reject) => {
          rejectStop = reject;
        }),
    );
    await click("Exit edit mode");
    const callback = mocks.listenEditing.mock.calls.at(-1)![0];
    await act(async () =>
      callback({
        id,
        token,
        active: true,
        error: "The selection overlay could not be cleared",
      }),
    );
    expect(
      container.querySelector('[aria-label="Exit edit mode"]'),
    ).not.toBeNull();
    expect(container.querySelector(".browser-edit-hint")).not.toBeNull();
    await click("Exit edit mode");
    await click("Exit edit mode");
    expect(mocks.edit.mock.calls.filter((call) => !call[1])).toHaveLength(1);
    await act(async () => rejectStop(new Error("Overlay stop failed")));
    expect(container.textContent).toContain("Could not exit edit mode");
    await click("Exit edit mode");
    expect(mocks.edit).toHaveBeenLastCalledWith(id, false, token);
    expect(mocks.edit.mock.calls.filter((call) => !call[1])).toHaveLength(2);
    expect(container.querySelector(".browser-edit-hint")).toBeNull();
    expect(add).not.toHaveBeenCalled();
    expect(mocks.navigate).not.toHaveBeenCalled();
  });

  it("keeps shell Escape retryable when stopping rejects without a native event", async () => {
    const id = await openPane({ onAddToChat: vi.fn() });
    const button = container.querySelector<HTMLButtonElement>(
      '[aria-label="Edit page"]',
    )!;
    await act(async () => {
      button.focus();
      button.click();
    });
    const token = mocks.edit.mock.calls.at(-1)![2];
    mocks.edit.mockRejectedValueOnce(new Error("Overlay stop failed"));
    const escape = () =>
      new KeyboardEvent("keydown", {
        key: "Escape",
        bubbles: true,
        cancelable: true,
      });
    const first = escape();
    await act(async () => button.dispatchEvent(first));
    expect(first.defaultPrevented).toBe(true);
    expect(
      container.querySelector('[aria-label="Exit edit mode"]'),
    ).not.toBeNull();
    expect(container.textContent).toContain("Overlay stop failed");
    const retry = escape();
    await act(async () => button.dispatchEvent(retry));
    expect(retry.defaultPrevented).toBe(true);
    expect(mocks.edit).toHaveBeenLastCalledWith(id, false, token);
    expect(mocks.edit.mock.calls.filter((call) => !call[1])).toHaveLength(2);
    expect(container.querySelector(".browser-edit-hint")).toBeNull();
  });

  it.each(["hidden", "floating"])(
    "does not revive a %s picker when a stop error arrives late",
    async (mode) => {
      const add = vi.fn();
      const id = await openPane({ onAddToChat: add });
      await act(async () =>
        container
          .querySelector<HTMLButtonElement>('[aria-label="Edit page"]')!
          .click(),
      );
      const token = mocks.edit.mock.calls.at(-1)![2];
      const callback = mocks.listenEditing.mock.calls.at(-1)![0];
      let rejectStop!: (reason: Error) => void;
      mocks.edit.mockImplementationOnce(
        () =>
          new Promise<void>((_resolve, reject) => {
            rejectStop = reject;
          }),
      );
      await act(async () =>
        container
          .querySelector<HTMLButtonElement>('[aria-label="Exit edit mode"]')!
          .click(),
      );
      if (mode === "floating") await receive({ floating: true });
      else
        await act(async () =>
          root.render(
            createElement(BrowserPane, {
              id: "one",
              initialUrl: "localhost:3000",
              visible: false,
              onAddToChat: add,
            }),
          ),
        );
      await act(async () => {
        callback({ id, token, active: true, error: "Late stop failure" });
        rejectStop(new Error("Late stop rejection"));
      });
      expect(
        container.querySelector('[aria-label="Exit edit mode"]'),
      ).toBeNull();
      expect(container.querySelector(".browser-edit-hint")).toBeNull();
      expect(add).not.toHaveBeenCalled();
    },
  );

  it("ignores a previous run's stop, selection, and rejection after restarting the picker", async () => {
    const add = vi.fn();
    const id = await openPane({ onAddToChat: add });
    let rejectFirst!: (reason: Error) => void;
    mocks.edit.mockImplementationOnce(
      () =>
        new Promise<void>((_resolve, reject) => {
          rejectFirst = reject;
        }),
    );
    const click = async (label: string) =>
      act(async () =>
        container
          .querySelector<HTMLButtonElement>(`[aria-label="${label}"]`)!
          .click(),
      );
    await click("Edit page");
    const firstToken = mocks.edit.mock.calls.at(-1)![2];
    await click("Exit edit mode");
    const stoppedToken = mocks.edit.mock.calls.at(-1)![2];
    await click("Edit page");
    const currentToken = mocks.edit.mock.calls.at(-1)![2];
    expect(stoppedToken).toBe(firstToken);
    expect(currentToken).not.toBe(firstToken);
    const callback = mocks.listenEditing.mock.calls.at(-1)![0];
    const selection = {
      url: "http://localhost:3000/",
      title: "Old selection",
      selector: "#old",
      tag: "button",
      text: "Old",
    };
    await act(async () => {
      callback({ id, token: stoppedToken, active: false });
      callback({
        id,
        token: stoppedToken,
        active: true,
        error: "Old stop failure",
      });
      callback({
        id,
        token: firstToken,
        active: false,
        comment: "This belongs to the previous annotation",
        selection,
        error: "Old failure",
      });
      rejectFirst(new Error("Previous selection was cancelled"));
    });
    expect(
      container.querySelector('[aria-label="Exit edit mode"]'),
    ).not.toBeNull();
    expect(container.querySelector(".browser-edit-hint")).not.toBeNull();
    expect(container.textContent).not.toContain("Old failure");
    expect(container.textContent).not.toContain("Old stop failure");
    expect(container.textContent).not.toContain(
      "Previous selection was cancelled",
    );
    expect(add).not.toHaveBeenCalled();
    await act(async () =>
      callback({
        id,
        token: currentToken,
        active: false,
        selection: { ...selection, selector: "#current", text: "Current" },
        screenshot: {
          dataUrl: "data:image/png;base64,iVBORw0KGgo=",
          width: 120,
          height: 32,
        },
      }),
    );
    expect(add).toHaveBeenCalledOnce();
    expect(add.mock.calls[0][0]).toBe("");
    expect(add.mock.calls[0][1][0].name).toBe("Selected element.png");
    expect(container.querySelector(".browser-edit-hint")).toBeNull();
  });

  it.each(["callback removal", "native page replacement"])(
    "clears the rendered picker on %s and ignores the old listener",
    async (change) => {
      const add = vi.fn();
      const id = await openPane({ onAddToChat: add });
      await act(async () =>
        container
          .querySelector<HTMLButtonElement>('[aria-label="Edit page"]')!
          .click(),
      );
      const token = mocks.edit.mock.calls.at(-1)![2];
      const callback = mocks.listenEditing.mock.calls.at(-1)![0];
      expect(container.querySelector(".browser-edit-hint")).not.toBeNull();
      await act(async () =>
        root.render(
          createElement(BrowserPane, {
            id: "one",
            initialUrl: "localhost:3000",
            visible: true,
            ...(change === "native page replacement"
              ? { attachedNativeId: "existing-native", onAddToChat: add }
              : {}),
          }),
        ),
      );
      await flushFrame();
      expect(mocks.edit).toHaveBeenCalledWith(id, false, token);
      expect(container.querySelector(".browser-edit-hint")).toBeNull();
      expect(
        container.querySelector('[aria-label="Exit edit mode"]'),
      ).toBeNull();
      await act(async () =>
        callback({
          id,
          token,
          active: false,
          selection: {
            url: "http://localhost:3000/",
            title: "Old",
            selector: "body",
            tag: "body",
            text: "Old",
          },
        }),
      );
      expect(add).not.toHaveBeenCalled();
    },
  );

  const submitAddress = async (value: string) => {
    const input = container.querySelector<HTMLInputElement>(
      '[aria-label="Preview address"]',
    )!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )!.set!.call(input, value);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      container
        .querySelector("form")!
        .dispatchEvent(
          new Event("submit", { bubbles: true, cancelable: true }),
        );
      input.blur();
    });
  };

  it.each([
    ["", "http://localhost:3000/"],
    ["about:blank", "http://localhost:3000/"],
    ["https://example.com/redirected", "https://example.com/redirected"],
  ])(
    "does not turn an early native URL %s into another startup navigation",
    async (earlyUrl, committedUrl) => {
      let finishCreate!: () => void;
      mocks.create.mockImplementationOnce(
        () =>
          new Promise<void>((resolve) => {
            finishCreate = resolve;
          }),
      );
      const onUrlChange = vi.fn();
      await openPane({ onUrlChange });
      await receive({ url: earlyUrl, loading: true });
      await act(async () => finishCreate());
      expect(mocks.create).toHaveBeenCalledExactlyOnceWith(
        expect.any(String),
        "http://localhost:3000/",
        expect.any(Object),
      );
      expect(mocks.navigate).not.toHaveBeenCalled();
      if (earlyUrl === "about:blank")
        expect(onUrlChange).not.toHaveBeenCalled();
      if (earlyUrl.startsWith("https:"))
        expect(onUrlChange).toHaveBeenCalledWith(committedUrl);
      const address = container.querySelector<HTMLInputElement>(
        '[aria-label="Preview address"]',
      )!;
      expect(address.value).toBe(
        earlyUrl.startsWith("https:") ? committedUrl : "localhost:3000",
      );
      expect(mocks.close).not.toHaveBeenCalled();
    },
  );

  it("keeps the latest user navigation during creation despite native redirects", async () => {
    let finishCreate!: () => void;
    mocks.create.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finishCreate = resolve;
        }),
    );
    const id = await openPane();
    await submitAddress("https://example.com/first-choice");
    await receive({
      url: "https://example.com/startup-redirect",
      loading: true,
    });
    await submitAddress("https://example.com/latest-choice");
    await receive({
      url: "http://localhost:3000/initial-page",
      loading: false,
    });
    expect(
      container.querySelector<HTMLInputElement>(
        '[aria-label="Preview address"]',
      )!.value,
    ).toBe("https://example.com/latest-choice");
    expect(mocks.navigate).not.toHaveBeenCalled();
    await act(async () => finishCreate());
    expect(mocks.navigate).toHaveBeenCalledExactlyOnceWith(
      id,
      "https://example.com/latest-choice",
    );
    expect(mocks.create).toHaveBeenCalledOnce();
    expect(mocks.close).not.toHaveBeenCalled();
  });

  it("uses a user navigation submitted before listener readiness as the initial create URL", async () => {
    let finishListen!: () => void;
    mocks.listen.mockImplementationOnce(
      () =>
        new Promise<() => void>((resolve) => {
          finishListen = () => resolve(mocks.unlisten);
        }),
    );
    await act(async () =>
      root.render(
        createElement(BrowserPane, { id: "one", initialUrl: "localhost:3000" }),
      ),
    );
    await submitAddress("https://example.com/chosen-before-create");
    await act(async () => finishListen());
    expect(mocks.create).toHaveBeenCalledExactlyOnceWith(
      expect.any(String),
      "https://example.com/chosen-before-create",
      expect.any(Object),
    );
    expect(mocks.navigate).not.toHaveBeenCalled();
  });

  it("ignores a queued startup navigation failure after a newer ready-page submission", async () => {
    let finishCreate!: () => void;
    let rejectQueued!: (reason: Error) => void;
    mocks.create.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finishCreate = resolve;
        }),
    );
    mocks.navigate.mockImplementationOnce(
      () =>
        new Promise<void>((_, reject) => {
          rejectQueued = reject;
        }),
    );
    const id = await openPane();
    await submitAddress("https://example.com/queued");
    await act(async () => finishCreate());
    expect(mocks.navigate).toHaveBeenLastCalledWith(
      id,
      "https://example.com/queued",
    );
    await submitAddress("https://example.com/newer");
    await act(async () =>
      rejectQueued(new Error("Obsolete navigation failed")),
    );
    expect(mocks.navigate).toHaveBeenLastCalledWith(
      id,
      "https://example.com/newer",
    );
    expect(container.textContent).not.toContain("Obsolete navigation failed");
    expect(
      container.querySelector('[aria-label="Stop loading"]'),
    ).not.toBeNull();
    expect(mocks.close).not.toHaveBeenCalled();
  });

  it("waits for its native page before consuming a Picture in Picture request once", async () => {
    let finish!: () => void;
    mocks.create.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    await openPane({ pictureInPictureRequest: 1 });
    expect(mocks.setFloating).not.toHaveBeenCalled();
    await act(async () => finish());
    const id = mocks.create.mock.calls[0][0];
    expect(mocks.setFloating).toHaveBeenCalledExactlyOnceWith(id, true);
    await openPane({ pictureInPictureRequest: 1 });
    expect(mocks.setFloating).toHaveBeenCalledOnce();
    await openPane({ pictureInPictureRequest: 2 });
    expect(mocks.setFloating).toHaveBeenCalledTimes(2);
    expect(mocks.create).toHaveBeenCalledOnce();
    expect(mocks.navigate).not.toHaveBeenCalled();
  });

  it("reports the native floating label only after completion and uses the latest result callback", async () => {
    let finish!: (label: string) => void;
    mocks.setFloating.mockImplementationOnce(
      () =>
        new Promise<string>((resolve) => {
          finish = resolve;
        }),
    );
    const original = vi.fn();
    const latest = vi.fn();
    const id = await openPane({
      pictureInPictureRequest: 7,
      onPictureInPictureResult: original,
    });
    expect(original).not.toHaveBeenCalled();
    await openPane({
      pictureInPictureRequest: 7,
      onPictureInPictureResult: latest,
    });
    expect(mocks.setFloating).toHaveBeenCalledExactlyOnceWith(id, true);
    await act(async () => finish("preview-float-seven"));
    expect(original).not.toHaveBeenCalled();
    expect(latest).toHaveBeenCalledExactlyOnceWith(7, "preview-float-seven");

    mocks.setFloating.mockRejectedValueOnce(new Error("Native popout failed"));
    await openPane({
      pictureInPictureRequest: 8,
      onPictureInPictureResult: latest,
    });
    expect(latest).toHaveBeenLastCalledWith(8, null, "Native popout failed");
    expect(mocks.create).toHaveBeenCalledOnce();
    expect(mocks.navigate).not.toHaveBeenCalled();
    expect(mocks.close).not.toHaveBeenCalled();
  });

  it("keeps a blank Picture in Picture request local with useful guidance", async () => {
    const result = vi.fn();
    await act(async () =>
      root.render(
        createElement(BrowserPane, {
          id: "blank",
          pictureInPictureRequest: 1,
          onPictureInPictureResult: result,
        }),
      ),
    );
    expect(container.textContent).toContain(
      "Open a page before using Picture in Picture.",
    );
    expect(mocks.setFloating).not.toHaveBeenCalled();
    expect(mocks.create).not.toHaveBeenCalled();
    expect(result).toHaveBeenCalledExactlyOnceWith(
      1,
      null,
      "Open a page before using Picture in Picture.",
    );
  });

  it("retains the same detached page while hidden and returns to its owner only on the native return transition", async () => {
    const onPictureInPictureChange = vi.fn();
    const onFocus = vi.fn();
    const props = { onPictureInPictureChange, onFocus };
    const id = await openPane(props);
    await receive({ floating: false });
    expect(onPictureInPictureChange).not.toHaveBeenCalled();
    await receive({ floating: true, focused: true });
    expect(onFocus).not.toHaveBeenCalled();
    expect(onPictureInPictureChange).not.toHaveBeenCalled();
    expect(
      container.querySelector(".browser-floating-placeholder")?.textContent,
    ).toContain("Open in Picture in Picture");
    const buttons = Array.from(
      container.querySelectorAll<HTMLButtonElement>(
        ".browser-floating-placeholder button",
      ),
    );
    await act(async () =>
      buttons.find((b) => b.textContent === "Show window")!.click(),
    );
    expect(mocks.showFloating).toHaveBeenCalledExactlyOnceWith(id);
    await act(async () =>
      buttons.find((b) => b.textContent === "Return to workspace")!.click(),
    );
    expect(mocks.setFloating).toHaveBeenCalledExactlyOnceWith(id, false);
    await openPane({ ...props, visible: false });
    await act(async () => {
      resizeCallback();
      window.dispatchEvent(new Event("supermono:workspace-layout"));
    });
    await flushFrame();
    expect(mocks.snapshot).not.toHaveBeenCalled();
    expect(mocks.close).not.toHaveBeenCalled();
    await receive({ floating: false, focused: false });
    expect(onPictureInPictureChange).toHaveBeenCalledExactlyOnceWith(false);
    await receive({ floating: false });
    expect(onPictureInPictureChange).toHaveBeenCalledOnce();
    await openPane(props);
    expect(container.querySelector(".browser-floating-placeholder")).toBeNull();
    expect(mocks.create).toHaveBeenCalledOnce();
    expect(mocks.navigate).not.toHaveBeenCalled();
  });

  it("keeps a failed detach nonfatal and closes a detached page only when its owner unmounts", async () => {
    mocks.setFloating.mockRejectedValueOnce(new Error("Window unavailable"));
    const id = await openPane({ pictureInPictureRequest: 1 });
    expect(container.textContent).toContain("Window unavailable");
    expect(container.textContent).not.toContain("Preview unavailable");
    expect(mocks.close).not.toHaveBeenCalled();
    await receive({ floating: true });
    await act(async () => root.render(null));
    expect(mocks.close).toHaveBeenCalledExactlyOnceWith(id);
  });

  it("uses an in-toolbar loading indicator without repeating the page title below it", async () => {
    await openPane();
    await receive({ loading: true, title: "Current page title" });
    expect(
      container.querySelector(".browser-toolbar .browser-load-indicator")
        ?.textContent,
    ).toContain("Loading preview");
    expect(container.querySelector(".browser-status")).toBeNull();
    expect(container.textContent).not.toContain("Current page title");
    await receive({ loading: false, title: "Current page title" });
    expect(container.querySelector(".browser-load-indicator")).toBeNull();
  });

  it("preserves the compact toolbar's chat and external actions in its overflow menu and closes it when hidden", async () => {
    const onAddToChat = vi.fn();
    await openPane({ onAddToChat, onToggleExpand: vi.fn(), onClose: vi.fn() });
    await receive();
    const more = container.querySelector<HTMLButtonElement>(
      '[aria-label="More browser actions"]',
    )!;
    const pick = async (label: string) => {
      await act(async () => more.click());
      const item = Array.from(
        document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'),
      ).find((button) => button.textContent === label)!;
      expect(item).not.toBeUndefined();
      await act(async () => item.click());
      expect(
        document.querySelector('[aria-label="Browser actions"]'),
      ).toBeNull();
    };
    await pick("Add URL to chat");
    expect(onAddToChat).toHaveBeenCalledExactlyOnceWith(
      "Working page\nhttp://localhost:3000/",
    );
    await pick("Open in Brave");
    expect(mocks.external).toHaveBeenCalledExactlyOnceWith(
      "http://localhost:3000/",
    );
    for (const action of [
      "Go back",
      "Go forward",
      "Reload preview",
      "Expand preview",
      "Close browser preview",
    ])
      expect(
        container
          .querySelector(`[aria-label="${action}"]`)
          ?.classList.contains("browser-utility"),
      ).toBe(false);
    await act(async () => more.click());
    expect(
      document.querySelector('[aria-label="Browser actions"]'),
    ).not.toBeNull();
    await openPane({ visible: false, onAddToChat });
    expect(document.querySelector('[aria-label="Browser actions"]')).toBeNull();
    expect(mocks.create).toHaveBeenCalledOnce();
    expect(mocks.close).not.toHaveBeenCalled();
  });

  it("disables compact menu URL actions until the blank page has an address", async () => {
    await act(async () =>
      root.render(
        createElement(BrowserPane, { id: "blank", onAddToChat: vi.fn() }),
      ),
    );
    await act(async () =>
      container
        .querySelector<HTMLButtonElement>(
          '[aria-label="More browser actions"]',
        )!
        .click(),
    );
    const items =
      document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]');
    expect(items).toHaveLength(6);
    for (const item of items) expect(item.disabled).toBe(true);
    expect(mocks.create).not.toHaveBeenCalled();
  });

  const clickControl = async (label: string) => {
    const button = document.querySelector<HTMLButtonElement>(
      `button[aria-label="${label}"]`,
    );
    expect(button, label).not.toBeNull();
    await act(async () => button!.click());
  };
  const pickTool = async (label: string) => {
    await clickControl("More browser actions");
    const item = Array.from(
      document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'),
    ).find((button) => button.textContent?.startsWith(label));
    expect(item, label).not.toBeUndefined();
    await act(async () => item!.click());
  };
  const pointerClick = async (button: HTMLButtonElement) => {
    await act(async () =>
      button.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true })),
    );
    await act(async () => button.click());
  };

  it("keeps Chromium live beneath Aven's anchored actions menu without a screenshot swap", async () => {
    await openPane({ onAddToChat: vi.fn() });
    await receive({ nativeMenus: true });
    mocks.layout.mockClear();
    await clickControl("More browser actions");
    expect(mocks.browserMenu).not.toHaveBeenCalled();
    expect(appMenu.open).toHaveBeenCalledExactlyOnceWith(
      container.querySelector('[aria-label="More browser actions"]'),
      expect.objectContaining({
        title: "Browser actions",
        compact: true,
        align: "end",
        gap: 4,
      }),
    );
    await flushFrame();
    await act(async () => vi.advanceTimersByTime(30_000));
    expect(document.querySelector('[role="menu"]')).toBeNull();
    expect(container.querySelector(".browser-page-snapshot")).toBeNull();
    expect(mocks.snapshot).not.toHaveBeenCalled();
    expect(mocks.layout.mock.calls.some((call) => call[2] === false)).toBe(
      false,
    );
    expect(
      container
        .querySelector('[aria-label="More browser actions"]')
        ?.getAttribute("aria-expanded"),
    ).toBe("true");
    await act(async () =>
      appMenu.callbacks.get("workspace-menu-panel-closed")?.({
        label: "browser-actions",
        presentation: "open-1",
      }),
    );
    expect(
      container
        .querySelector('[aria-label="More browser actions"]')
        ?.getAttribute("aria-expanded"),
    ).toBe("false");
    expect(mocks.close).not.toHaveBeenCalled();
  });

  it("routes app menu choices to the owning pane and ignores a choice after hiding it", async () => {
    const add = vi.fn();
    await openPane({ onAddToChat: add });
    await receive({ nativeMenus: true });
    await clickControl("More browser actions");
    const snapshot = appMenu.open.mock.calls[0][1];
    const action = snapshot.items.find(
      (item: { label: string }) => item.label === "Add URL to chat",
    ).id;
    await act(async () =>
      appMenu.callbacks.get("workspace-menu-panel-action")?.({
        label: "browser-actions",
        presentation: "open-1",
        action,
      }),
    );
    expect(add).toHaveBeenCalledExactlyOnceWith(
      "Working page\nhttp://localhost:3000/",
    );
    add.mockClear();
    await clickControl("More browser actions");
    const pick = appMenu.callbacks.get("workspace-menu-panel-action")!;
    await openPane({ visible: false, onAddToChat: add });
    await act(async () =>
      pick({ label: "browser-actions", presentation: "open-1", action }),
    );
    expect(add).not.toHaveBeenCalled();
    expect(mocks.external).not.toHaveBeenCalled();
  });

  it("closes a failed app menu without flashing an HTML replacement over Chromium", async () => {
    await openPane();
    await receive({ nativeMenus: true });
    appMenu.open.mockRejectedValueOnce(new Error("Menu unavailable"));
    await clickControl("More browser actions");
    expect(container.textContent).toContain("Could not open browser actions");
    expect(document.querySelector('[role="menu"]')).toBeNull();
    expect(mocks.snapshot).not.toHaveBeenCalled();
    expect(
      container
        .querySelector('[aria-label="More browser actions"]')
        ?.getAttribute("aria-expanded"),
    ).toBe("false");
  });

  it.each([
    [560, 362],
    [10, 8],
    [1190, 968],
  ])(
    "anchors the Mac browser menu to its own toolbar at x=%i and clamps it to the viewport",
    async (left, expectedLeft) => {
      vi.stubGlobal("innerWidth", 1200);
      vi.stubGlobal("innerHeight", 800);
      await openPane();
      const more = container.querySelector<HTMLButtonElement>(
        '[aria-label="More browser actions"]',
      )!;
      vi.spyOn(more, "getBoundingClientRect").mockReturnValue(
        new DOMRect(left, 80, 26, 28),
      );
      await pointerClick(more);
      const menu = document.querySelector<HTMLElement>(
        '[aria-label="Browser actions"]',
      )!;
      expect(menu).not.toBeNull();
      expect(menu.closest<HTMLElement>(".aven-popover-frame")!.style.left).toBe(
        `${expectedLeft}px`,
      );
      expect(menu.closest<HTMLElement>(".aven-popover-frame")!.style.top).toBe(
        "112px",
      );
      expect(
        menu
          .closest(".toolbar-panel")!
          .querySelector(".browser-menu-heading > span")?.textContent,
      ).toBe("Zoom");
      expect(
        menu
          .closest(".toolbar-panel")!
          .querySelectorAll('[aria-label="Page zoom"] button'),
      ).toHaveLength(3);
      expect(
        menu
          .closest(".toolbar-panel")!
          .querySelector('[aria-label="Reset page zoom"]')?.textContent,
      ).toBe("100%");
      expect(
        [...menu.querySelectorAll('[role="menuitem"]')].some((item) =>
          /zoom/i.test(item.textContent ?? ""),
        ),
      ).toBe(false);
      expect(mocks.nativeMenu).not.toHaveBeenCalled();
    },
  );

  it("toggles its menu closed on a real trigger click and dismisses with Escape or an outside pointer", async () => {
    await openPane();
    const more = container.querySelector<HTMLButtonElement>(
      '[aria-label="More browser actions"]',
    )!;
    await pointerClick(more);
    expect(more.getAttribute("aria-expanded")).toBe("true");
    await pointerClick(more);
    expect(document.querySelector('[aria-label="Browser actions"]')).toBeNull();
    expect(more.getAttribute("aria-expanded")).toBe("false");
    await pointerClick(more);
    await act(async () =>
      window.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      ),
    );
    expect(document.querySelector('[aria-label="Browser actions"]')).toBeNull();
    await pointerClick(more);
    await act(async () =>
      document.body.dispatchEvent(
        new PointerEvent("pointerdown", { bubbles: true }),
      ),
    );
    expect(document.querySelector('[aria-label="Browser actions"]')).toBeNull();
    expect(mocks.create).toHaveBeenCalledOnce();
    expect(mocks.close).not.toHaveBeenCalled();
  });

  it("dismisses a menu when its toolbar moves or its window resizes", async () => {
    await openPane();
    const more = container.querySelector<HTMLButtonElement>(
      '[aria-label="More browser actions"]',
    )!;
    const position = vi
      .spyOn(more, "getBoundingClientRect")
      .mockReturnValue(new DOMRect(560, 80, 26, 28));
    await pointerClick(more);
    await act(async () =>
      window.dispatchEvent(new Event("supermono:workspace-layout")),
    );
    expect(
      document.querySelector('[aria-label="Browser actions"]'),
    ).not.toBeNull();
    position.mockReturnValue(new DOMRect(350, 80, 26, 28));
    await act(async () =>
      window.dispatchEvent(new Event("supermono:workspace-layout")),
    );
    expect(document.querySelector('[aria-label="Browser actions"]')).toBeNull();
    await pointerClick(more);
    await act(async () => window.dispatchEvent(new Event("resize")));
    expect(document.querySelector('[aria-label="Browser actions"]')).toBeNull();
    await pointerClick(more);
    await act(async () =>
      window.dispatchEvent(new Event("supermono:browser-layout-reset")),
    );
    expect(document.querySelector('[aria-label="Browser actions"]')).toBeNull();
    expect(mocks.create).toHaveBeenCalledOnce();
    expect(mocks.close).not.toHaveBeenCalled();
  });

  it("switches between pane menus and keeps zoom actions on the selected native page", async () => {
    await act(async () =>
      root.render(
        createElement(
          "div",
          null,
          createElement(BrowserPane, {
            id: "left",
            initialUrl: "https://example.com/left",
          }),
          createElement(BrowserPane, {
            id: "right",
            initialUrl: "https://example.com/right",
          }),
        ),
      ),
    );
    const [leftId, rightId] = mocks.create.mock.calls.map((call) => call[0]);
    expect(leftId).not.toBe(rightId);
    const [left, right] = container.querySelectorAll<HTMLButtonElement>(
      '[aria-label="More browser actions"]',
    );
    await pointerClick(left!);
    await pointerClick(right!);
    expect(
      document.querySelectorAll('[aria-label="Browser actions"]'),
    ).toHaveLength(1);
    expect(left!.getAttribute("aria-expanded")).toBe("false");
    expect(right!.getAttribute("aria-expanded")).toBe("true");
    await clickControl("Zoom in");
    expect(mocks.action).toHaveBeenLastCalledWith(rightId, "zoom-in");
    expect(
      document.querySelector('[aria-label="Browser actions"]'),
    ).not.toBeNull();
    await receive({
      id: rightId,
      url: "https://example.com/right",
      zoomFactor: 1.25,
    });
    expect(
      document.querySelector('[aria-label="Reset page zoom"]')?.textContent,
    ).toBe("125%");
    await clickControl("Reset page zoom");
    expect(mocks.action).toHaveBeenLastCalledWith(rightId, "zoom-reset");
    await clickControl("Zoom out");
    expect(mocks.action).toHaveBeenLastCalledWith(rightId, "zoom-out");
    expect(
      document.querySelectorAll('[aria-label="Browser actions"]'),
    ).toHaveLength(1);
    expect(mocks.create).toHaveBeenCalledTimes(2);
    expect(mocks.close).not.toHaveBeenCalled();
  });
  const enterFind = async (text: string) => {
    const input = container.querySelector<HTMLInputElement>(
      '[aria-label="Find text in page"]',
    )!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )!.set!.call(input, text);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
  };

  const openToolsOverlay = async () => {
    await clickControl("More browser actions");
    const menu = document.querySelector<HTMLElement>(
      '[aria-label="Browser actions"]',
    )!;
    vi.spyOn(menu, "getClientRects").mockReturnValue([
      new DOMRect(120, 100, 224, 260),
    ] as unknown as DOMRectList);
    mutationCallback([
      { type: "attributes", target: menu, attributeName: "role" },
    ]);
    await flushFrame();
    await flushFrame();
    return menu;
  };
  const closeToolsOverlay = async (menu: HTMLElement) => {
    await act(async () =>
      window.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      ),
    );
    mutationCallback([
      {
        type: "childList",
        addedNodes: [] as unknown as NodeList,
        removedNodes: [menu] as unknown as NodeList,
      },
    ]);
    await act(async () => {});
  };

  it("refreshes the visible backing only after confirmed zoom and coalesces quick changes", async () => {
    const id = await openPane();
    await receive({ zoomFactor: 1 });
    await openToolsOverlay();
    const captures = mocks.snapshot.mock.calls.length;
    const original = container
      .querySelector(".browser-page-snapshot")
      ?.getAttribute("src");
    await clickControl("Zoom in");
    await act(async () => vi.advanceTimersByTime(100));
    expect(mocks.action).toHaveBeenLastCalledWith(id, "zoom-in");
    expect(mocks.snapshot).toHaveBeenCalledTimes(captures);
    await receive({ zoomFactor: 1.1 });
    await act(async () => vi.advanceTimersByTime(30));
    await receive({ zoomFactor: 1.25 });
    await act(async () => vi.advanceTimersByTime(59));
    expect(mocks.snapshot).toHaveBeenCalledTimes(captures);
    expect(
      container.querySelector(".browser-page-snapshot")?.getAttribute("src"),
    ).toBe(original);
    mocks.snapshot.mockResolvedValueOnce("data:image/png;base64,enVvbTEyNQ==");
    await act(async () => vi.advanceTimersByTime(1));
    expect(mocks.snapshot).toHaveBeenCalledTimes(captures + 1);
    expect(mocks.snapshot).toHaveBeenLastCalledWith(id);
    expect(
      container.querySelector(".browser-page-snapshot")?.getAttribute("src"),
    ).toBe("data:image/png;base64,enVvbTEyNQ==");
    expect(
      document.querySelector('[aria-label="Reset page zoom"]')?.textContent,
    ).toBe("125%");
    expect(
      document.querySelector('[aria-label="Browser actions"]'),
    ).not.toBeNull();
    await receive({ zoomFactor: 1.25 });
    await act(async () => vi.advanceTimersByTime(1000));
    expect(mocks.snapshot).toHaveBeenCalledTimes(captures + 1);
    expect(mocks.navigate).not.toHaveBeenCalled();
    expect(mocks.create).toHaveBeenCalledOnce();
    expect(mocks.close).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("runs only the latest queued zoom capture after an older native capture finishes", async () => {
    await openPane();
    await receive({ zoomFactor: 1 });
    await openToolsOverlay();
    let older!: (image: string) => void;
    mocks.snapshot.mockImplementationOnce(
      () =>
        new Promise<string>((resolve) => {
          older = resolve;
        }),
    );
    await receive({ zoomFactor: 1.1 });
    await act(async () => vi.advanceTimersByTime(60));
    mocks.snapshot.mockResolvedValueOnce("data:image/png;base64,bmV3ZXJ6b29t");
    await receive({ zoomFactor: 1.25 });
    await act(async () => vi.advanceTimersByTime(60));
    await receive({ zoomFactor: 1.5 });
    await act(async () => vi.advanceTimersByTime(60));
    expect(mocks.snapshot).toHaveBeenCalledTimes(2);
    expect(
      container.querySelector(".browser-page-snapshot")?.getAttribute("src"),
    ).toBe("data:image/png;base64,c25hcHNob3Q=");
    const decodes = mocks.decode.mock.calls.length;
    await act(async () => older("data:image/png;base64,b2xkZXJ6b29t"));
    expect(mocks.snapshot).toHaveBeenCalledTimes(3);
    expect(mocks.decode).toHaveBeenCalledTimes(decodes + 1);
    expect(
      container.querySelector(".browser-page-snapshot")?.getAttribute("src"),
    ).toBe("data:image/png;base64,bmV3ZXJ6b29t");
    expect(
      document.querySelector('[aria-label="Reset page zoom"]')?.textContent,
    ).toBe("150%");
    await act(async () => vi.advanceTimersByTime(1000));
    expect(mocks.snapshot).toHaveBeenCalledTimes(3);
  });

  it("cancels scheduled and in-flight zoom backings when the menu closes", async () => {
    await openPane();
    await receive({ zoomFactor: 1 });
    let menu = await openToolsOverlay();
    const captures = mocks.snapshot.mock.calls.length;
    await receive({ zoomFactor: 1.1 });
    await closeToolsOverlay(menu);
    await act(async () => vi.advanceTimersByTime(100));
    expect(mocks.snapshot).toHaveBeenCalledTimes(captures);
    expect(container.querySelector(".browser-page-snapshot")).toBeNull();
    menu = await openToolsOverlay();
    let late!: (image: string) => void;
    mocks.snapshot.mockImplementationOnce(
      () =>
        new Promise<string>((resolve) => {
          late = resolve;
        }),
    );
    await receive({ zoomFactor: 1.25 });
    await act(async () => vi.advanceTimersByTime(60));
    await closeToolsOverlay(menu);
    await act(async () => late("data:image/png;base64,bGF0ZXpvb20="));
    expect(container.querySelector(".browser-page-snapshot")).toBeNull();
    expect(document.querySelector('[aria-label="Browser actions"]')).toBeNull();
    expect(mocks.layout.mock.calls.at(-1)![2]).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
    expect(mocks.create).toHaveBeenCalledOnce();
    expect(mocks.close).not.toHaveBeenCalled();
  });

  it("stops real loading and shows only native-reported progress", async () => {
    const id = await openPane();
    await receive({ loading: true, loadProgress: 0.45 });
    expect(
      container
        .querySelector('[role="progressbar"]')
        ?.getAttribute("aria-valuenow"),
    ).toBe("45");
    await clickControl("Stop loading");
    expect(mocks.action).toHaveBeenLastCalledWith(id, "stop");
    await receive({ loading: true });
    expect(
      container
        .querySelector('[role="progressbar"]')
        ?.getAttribute("aria-valuenow"),
    ).toBeNull();
    await receive({ loading: false });
    await clickControl("Reload preview");
    expect(mocks.action).toHaveBeenLastCalledWith(id, "reload");
    expect(mocks.create).toHaveBeenCalledOnce();
    expect(mocks.close).not.toHaveBeenCalled();
  });

  it("applies committed layout changes immediately while keeping the native page visible", async () => {
    const id = await openPane();
    await receive();
    mocks.layout.mockClear();
    const bounds = { x: 24, y: 60, width: 1100, height: 720, scale: 2 };
    mocks.bounds.mockReturnValue(bounds);
    await act(async () =>
      window.dispatchEvent(new Event("supermono:workspace-layout")),
    );
    expect(mocks.layout).toHaveBeenLastCalledWith(id, bounds, true);
    expect(mocks.layout.mock.calls.every((call) => call[2] === true)).toBe(
      true,
    );
    expect(mocks.snapshot).not.toHaveBeenCalled();
    expect(mocks.create).toHaveBeenCalledOnce();
    expect(mocks.close).not.toHaveBeenCalled();
  });

  it("publishes changed favicon thumbnails once and clears an old site's icon", async () => {
    const onFaviconChange = vi.fn();
    await openPane({ onFaviconChange });
    const favicon = "data:image/png;base64,iVBORw0KGgo=";
    await receive({ favicon });
    await receive({ favicon });
    expect(onFaviconChange).toHaveBeenCalledExactlyOnceWith(favicon);
    await receive({ favicon: "" });
    expect(onFaviconChange).toHaveBeenLastCalledWith("");
    await receive({ favicon: "https://remote.example/icon.png" });
    expect(onFaviconChange).toHaveBeenCalledTimes(2);
  });

  it("uses native zoom and developer tools without changing the page identity", async () => {
    const id = await openPane();
    await receive({ zoomFactor: 1.25 });
    await clickControl("More browser actions");
    expect(
      document.querySelector('[aria-label="Reset page zoom"]')?.textContent,
    ).toBe("125%");
    for (const [label, action] of [
      ["Zoom out", "zoom-out"],
      ["Reset page zoom", "zoom-reset"],
      ["Zoom in", "zoom-in"],
    ]) {
      await clickControl(label);
      expect(mocks.action).toHaveBeenLastCalledWith(id, action);
    }
    expect(
      document.querySelector('[aria-label="Reset page zoom"]')?.textContent,
    ).toBe("125%");
    await receive({ zoomFactor: 1 });
    expect(
      document.querySelector('[aria-label="Reset page zoom"]')?.textContent,
    ).toBe("100%");
    const devtools = Array.from(
      document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'),
    ).find((button) => button.textContent === "Developer tools")!;
    mocks.action.mockRejectedValueOnce(
      new Error("Chromium engine is unavailable"),
    );
    await act(async () => devtools.click());
    expect(mocks.action).toHaveBeenLastCalledWith(id, "devtools");
    expect(container.querySelector(".browser-notice")?.textContent).toContain(
      "Developer tools unavailable: Chromium engine is unavailable",
    );
    expect(container.textContent).not.toContain("Preview unavailable");
    expect(mocks.create).toHaveBeenCalledOnce();
    expect(mocks.close).not.toHaveBeenCalled();
  });

  it("finds text with native counts, previous/next and close while retaining the page", async () => {
    const id = await openPane();
    await receive();
    await pickTool("Find in page");
    expect(document.activeElement).toBe(
      container.querySelector('[aria-label="Find text in page"]'),
    );
    await enterFind("alpha");
    await act(async () => vi.advanceTimersByTime(180));
    expect(mocks.find).toHaveBeenLastCalledWith(id, "alpha", true, false);
    await receive({
      findResult: { query: "alpha", activeMatch: 1, totalMatches: 3 },
    });
    expect(container.querySelector(".browser-find-count")?.textContent).toBe(
      "1 of 3",
    );
    await clickControl("Next match");
    expect(mocks.find).toHaveBeenLastCalledWith(id, "alpha", true, true);
    await clickControl("Previous match");
    expect(mocks.find).toHaveBeenLastCalledWith(id, "alpha", false, true);
    await enterFind("missing");
    await act(async () => vi.advanceTimersByTime(180));
    await receive({
      findResult: { query: "alpha", activeMatch: 2, totalMatches: 3 },
    });
    expect(
      container.querySelector(".browser-find-count")?.textContent,
    ).not.toContain("2 of 3");
    await receive({
      findResult: { query: "missing", activeMatch: 0, totalMatches: 0 },
    });
    expect(container.querySelector(".browser-find-count")?.textContent).toBe(
      "No matches",
    );
    await clickControl("Close find in page");
    expect(mocks.action).toHaveBeenLastCalledWith(id, "stop-find");
    expect(container.querySelector(".browser-find-bar")).toBeNull();
    expect(mocks.create).toHaveBeenCalledOnce();
    expect(mocks.close).not.toHaveBeenCalled();
  });

  it("debounces find and cancels pending searches when hidden or closed", async () => {
    const id = await openPane();
    await pickTool("Find in page");
    await enterFind("a");
    await enterFind("alpha");
    await act(async () => vi.advanceTimersByTime(180));
    expect(mocks.find).toHaveBeenCalledExactlyOnceWith(
      id,
      "alpha",
      true,
      false,
    );
    await enterFind("pending");
    await openPane({ visible: false });
    await act(async () => vi.advanceTimersByTime(200));
    expect(mocks.find).toHaveBeenCalledOnce();
    await openPane({ visible: true });
    await clickControl("Close find in page");
    await act(async () => vi.advanceTimersByTime(200));
    expect(mocks.find).toHaveBeenCalledOnce();
    expect(mocks.create).toHaveBeenCalledOnce();
  });

  it("keeps find errors nonfatal and ignores an obsolete request failure", async () => {
    let rejectOld!: (error: Error) => void;
    mocks.find.mockImplementationOnce(
      () =>
        new Promise((_, reject) => {
          rejectOld = reject;
        }),
    );
    await openPane();
    await pickTool("Find in page");
    await enterFind("old");
    await act(async () => vi.advanceTimersByTime(180));
    await enterFind("new");
    await act(async () => rejectOld(new Error("Old request failed")));
    expect(container.textContent).not.toContain("Old request failed");
    mocks.find.mockRejectedValueOnce(
      new Error("Find unavailable in this engine"),
    );
    await act(async () => vi.advanceTimersByTime(180));
    expect(container.querySelector(".browser-notice")?.textContent).toContain(
      "Find in page unavailable",
    );
    expect(container.textContent).not.toContain("Preview unavailable");
    expect(mocks.close).not.toHaveBeenCalled();
  });

  it("queues matching native shortcuts until their browser is visible and attached", async () => {
    const id = await openPane();
    const command = mocks.listenToolbar.mock.calls.at(-1)![0];
    await act(async () => command({ id: "another", action: "find" }));
    expect(container.querySelector(".browser-find-bar")).toBeNull();
    await act(async () => command({ id, action: "find" }));
    expect(container.querySelector(".browser-find-bar")).not.toBeNull();
    await clickControl("Close find in page");
    await openPane({ visible: false });
    await act(async () => command({ id, action: "find" }));
    expect(container.querySelector(".browser-find-bar")).toBeNull();
    await openPane({ visible: true });
    expect(container.querySelector(".browser-find-bar")).not.toBeNull();
    await clickControl("Close find in page");
    await receive({ floating: true });
    await act(async () => command({ id, action: "find" }));
    expect(container.querySelector(".browser-find-bar")).toBeNull();
    await receive({ floating: false });
    expect(container.querySelector(".browser-find-bar")).not.toBeNull();
    await act(async () => command({ id, action: "address" }));
    expect(document.activeElement).toBe(
      container.querySelector('[aria-label="Preview address"]'),
    );
    await act(async () => root.render(null));
    expect(mocks.stopToolbar).toHaveBeenCalledOnce();
  });

  it("selects a stale DOM address when the pointer returns from native Chromium", async () => {
    const onFocus = vi.fn();
    await openPane({ onFocus });
    const input = container.querySelector<HTMLInputElement>(
      '[aria-label="Preview address"]',
    )!;
    input.focus();
    input.setSelectionRange(input.value.length, input.value.length);
    // Native CEF focus does not necessarily change WK's document.activeElement.
    await receive({ focused: true });
    expect(document.activeElement).toBe(input);
    const pointer = new PointerEvent("pointerdown", {
      bubbles: true,
      cancelable: true,
      button: 0,
    });
    await act(async () => input.dispatchEvent(pointer));
    expect(pointer.defaultPrevented).toBe(true);
    expect(mocks.shellFocus).toHaveBeenCalledOnce();
    expect(input.selectionStart).toBe(0);
    expect(input.selectionEnd).toBe(input.value.length);
    const secondPointer = new PointerEvent("pointerdown", {
      bubbles: true,
      cancelable: true,
      button: 0,
    });
    await act(async () => {
      input.dispatchEvent(secondPointer);
      input.setSelectionRange(3, 3);
    });
    expect(secondPointer.defaultPrevented).toBe(false);
    expect([input.selectionStart, input.selectionEnd]).toEqual([3, 3]);
    // CEF reports OnGotFocus; no intervening native blur event is required.
    await receive({ focused: true });
    expect(onFocus).toHaveBeenCalledTimes(2);
    expect(mocks.navigate).not.toHaveBeenCalled();
    expect(mocks.close).not.toHaveBeenCalled();
  });

  it.each(["address", "find"] as const)(
    "preserves the pointer's %s selection after native focus returns",
    async (field) => {
      const id = await openPane();
      if (field === "find")
        await act(async () =>
          mocks.listenToolbar.mock.calls.at(-1)![0]({ id, action: "find" }),
        );
      const input = container.querySelector<HTMLInputElement>(
        field === "address"
          ? '[aria-label="Preview address"]'
          : '[aria-label="Find text in page"]',
      )!;
      let finish!: () => void;
      mocks.shellFocus.mockClear();
      mocks.ownerShow.mockClear();
      mocks.shellFocus.mockImplementationOnce(
        () =>
          new Promise<void>((resolve) => {
            finish = resolve;
          }),
      );
      await act(async () => {
        input.dispatchEvent(
          new PointerEvent("pointerdown", { bubbles: true, button: 0 }),
        );
        input.focus();
        input.value = "sample text";
        input.setSelectionRange(2, 7, "backward");
      });
      await act(async () => finish());
      expect(mocks.shellFocus).toHaveBeenCalledOnce();
      expect(document.activeElement).toBe(input);
      expect([
        input.selectionStart,
        input.selectionEnd,
        input.selectionDirection,
      ]).toEqual([2, 7, "backward"]);
      expect(mocks.ownerShow).not.toHaveBeenCalled();
    },
  );

  it.each([
    "another control",
    "native page",
    "hidden pane",
    "floating pane",
    "window blur",
    "unmount",
  ] as const)(
    "does not restore a pending address focus after moving to %s",
    async (destination) => {
      await openPane();
      const input = container.querySelector<HTMLInputElement>(
        '[aria-label="Preview address"]',
      )!;
      let finish!: () => void;
      mocks.shellFocus.mockImplementationOnce(
        () =>
          new Promise<void>((resolve) => {
            finish = resolve;
          }),
      );
      input.focus();
      await act(async () =>
        input.dispatchEvent(
          new PointerEvent("pointerdown", { bubbles: true, button: 0 }),
        ),
      );
      const restoreFocus = vi.spyOn(input, "focus");
      if (destination === "another control") {
        const button = container.querySelector<HTMLButtonElement>(
          '[aria-label="More browser actions"]',
        )!;
        await act(async () => {
          button.dispatchEvent(
            new PointerEvent("pointerdown", { bubbles: true, button: 0 }),
          );
          button.focus();
        });
      } else if (destination === "native page")
        await receive({ focused: true });
      else if (destination === "hidden pane")
        await openPane({ visible: false });
      else if (destination === "floating pane")
        await receive({ floating: true });
      else if (destination === "window blur")
        window.dispatchEvent(new Event("blur"));
      else await act(async () => root.render(null));
      await act(async () => finish());
      expect(restoreFocus).not.toHaveBeenCalled();
      restoreFocus.mockRestore();
    },
  );

  it("leaves context clicks alone and reports pointer focus failures without recreating the page", async () => {
    await openPane();
    const input = container.querySelector<HTMLInputElement>(
      '[aria-label="Preview address"]',
    )!;
    await act(async () =>
      input.dispatchEvent(
        new PointerEvent("pointerdown", { bubbles: true, button: 2 }),
      ),
    );
    expect(mocks.shellFocus).not.toHaveBeenCalled();
    mocks.shellFocus.mockRejectedValueOnce(new Error("Focus unavailable"));
    await act(async () =>
      input.dispatchEvent(
        new PointerEvent("pointerdown", { bubbles: true, button: 0 }),
      ),
    );
    expect(container.querySelector(".browser-notice")?.textContent).toContain(
      "Could not focus browser toolbar: Focus unavailable",
    );
    expect(mocks.create).toHaveBeenCalledOnce();
    expect(mocks.close).not.toHaveBeenCalled();
  });

  it.each(["find", "address"] as const)(
    "waits for the grouped PiP return before focusing %s without recreating the page",
    async (action) => {
      const onReturned = vi.fn();
      const props = { onPictureInPictureChange: onReturned };
      const id = await openPane(props);
      await receive({ floating: true });
      await openPane({ ...props, visible: false });
      await receive({ floating: false });
      expect(onReturned).toHaveBeenCalledWith(false);
      const command = mocks.listenToolbar.mock.calls.at(-1)![0];
      await act(async () => command({ id, action }));
      // The selected browser has docked, but its session siblings have not
      // completed the native group-return handshake yet.
      expect(mocks.shellFocus).not.toHaveBeenCalled();
      expect(mocks.ownerFocus).not.toHaveBeenCalled();
      await openPane({ ...props, visible: true });
      expect(mocks.shellFocus).toHaveBeenCalledOnce();
      expect(mocks.ownerFocus).toHaveBeenCalledOnce();
      expect(mocks.ownerFocus.mock.invocationCallOrder[0]).toBeLessThan(
        mocks.shellFocus.mock.invocationCallOrder[0],
      );
      expect(document.activeElement).toBe(
        container.querySelector(
          action === "find"
            ? '[aria-label="Find text in page"]'
            : '[aria-label="Preview address"]',
        ),
      );
      expect(mocks.create).toHaveBeenCalledOnce();
      expect(mocks.close).not.toHaveBeenCalled();
      expect(mocks.navigate).not.toHaveBeenCalled();
      expect(mocks.setFloating).not.toHaveBeenCalled();
    },
  );

  it("does not let an older native focus handoff overwrite a newer shortcut", async () => {
    let finishFirst!: () => void;
    mocks.ownerShow.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finishFirst = resolve;
        }),
    );
    const id = await openPane();
    const command = mocks.listenToolbar.mock.calls.at(-1)![0];
    await act(async () => command({ id, action: "find" }));
    expect(mocks.shellFocus).not.toHaveBeenCalled();
    await act(async () => command({ id, action: "address" }));
    expect(document.activeElement).toBe(
      container.querySelector('[aria-label="Preview address"]'),
    );
    await act(async () => finishFirst());
    expect(mocks.shellFocus).toHaveBeenCalledOnce();
    expect(document.activeElement).toBe(
      container.querySelector('[aria-label="Preview address"]'),
    );
  });

  it("cancels native focus transfer after the owning browser hides or unmounts", async () => {
    let finishFocus!: () => void;
    mocks.ownerShow.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finishFocus = resolve;
        }),
    );
    const id = await openPane();
    const command = mocks.listenToolbar.mock.calls.at(-1)![0];
    await act(async () => command({ id, action: "address" }));
    await openPane({ visible: false });
    await act(async () => finishFocus());
    expect(mocks.shellFocus).not.toHaveBeenCalled();
    expect(mocks.ownerFocus).not.toHaveBeenCalled();
    await act(async () => root.render(null));
    expect(mocks.close).toHaveBeenCalledOnce();
  });

  it("reports native toolbar focus failures without closing the page", async () => {
    mocks.shellFocus.mockRejectedValueOnce(new Error("Window closed"));
    const id = await openPane();
    await act(async () =>
      mocks.listenToolbar.mock.calls.at(-1)![0]({ id, action: "find" }),
    );
    expect(container.querySelector(".browser-notice")?.textContent).toContain(
      "Could not focus browser toolbar: Window closed",
    );
    expect(mocks.close).not.toHaveBeenCalled();
  });

  it("loads real downloads only on demand and responds to transfer events without polling", async () => {
    const id = await openPane();
    expect(mocks.downloads).not.toHaveBeenCalled();
    mocks.downloads.mockResolvedValue([
      {
        id: "one",
        filename: "report.csv",
        receivedBytes: 1024,
        totalBytes: 2048,
        state: "in-progress",
      },
    ]);
    await pickTool("Downloads");
    expect(mocks.downloads).toHaveBeenCalledExactlyOnceWith(id);
    expect(
      container.querySelector(".browser-downloads")?.textContent,
    ).toContain("1.0 KB of 2.0 KB");
    const cancel = Array.from(
      container.querySelectorAll<HTMLButtonElement>(
        ".browser-downloads button",
      ),
    ).find((button) => button.textContent === "Cancel")!;
    await act(async () => cancel.click());
    expect(mocks.downloadAction).toHaveBeenLastCalledWith(id, "one", "cancel");
    const event = mocks.listenDownloads.mock.calls.at(-1)![0];
    await act(async () => event({ id: "other", downloads: [] }));
    expect(
      container.querySelector(".browser-downloads")?.textContent,
    ).toContain("report.csv");
    await act(async () =>
      event({
        id,
        downloads: [
          {
            id: "one",
            filename: "report.csv",
            receivedBytes: 2048,
            totalBytes: 2048,
            state: "completed",
          },
        ],
      }),
    );
    for (const [label, action] of [
      ["Open", "open"],
      ["Show in Finder", "reveal"],
    ]) {
      const button = Array.from(
        container.querySelectorAll<HTMLButtonElement>(
          ".browser-downloads button",
        ),
      ).find((item) => item.textContent === label)!;
      await act(async () => button.click());
      expect(mocks.downloadAction).toHaveBeenLastCalledWith(id, "one", action);
    }
    await act(async () => vi.advanceTimersByTime(5000));
    expect(mocks.downloads).toHaveBeenCalledOnce();
    await clickControl("Close downloads");
    expect(mocks.stopDownloads).toHaveBeenCalledOnce();
    expect(mocks.create).toHaveBeenCalledOnce();
    expect(mocks.close).not.toHaveBeenCalled();
  });

  it("does not let a delayed initial downloads query replace a newer event", async () => {
    let resolveQuery!: (items: unknown[]) => void;
    mocks.downloads.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveQuery = resolve;
        }),
    );
    const id = await openPane();
    await pickTool("Downloads");
    await act(async () =>
      mocks.listenDownloads.mock.calls.at(-1)![0]({
        id,
        downloads: [
          {
            id: "new",
            filename: "new.csv",
            receivedBytes: 8,
            state: "completed",
          },
        ],
      }),
    );
    await act(async () => resolveQuery([]));
    expect(
      container.querySelector(".browser-downloads")?.textContent,
    ).toContain("new.csv");
    await openPane({ visible: false });
    expect(container.querySelector(".browser-downloads")).toBeNull();
    expect(mocks.stopDownloads).toHaveBeenCalledOnce();
  });

  it("shows a helpful downloads error without replacing or recreating the page", async () => {
    mocks.downloads.mockRejectedValueOnce(
      new Error("Downloads are not supported by this engine"),
    );
    await openPane();
    await pickTool("Downloads");
    expect(
      container.querySelector(".browser-downloads")?.textContent,
    ).toContain("Downloads unavailable: Downloads are not supported");
    expect(container.textContent).not.toContain("Preview unavailable");
    expect(mocks.create).toHaveBeenCalledOnce();
    expect(mocks.close).not.toHaveBeenCalled();
  });

  it("reports native focus transitions and changed titles without selecting hidden or unrelated panes", async () => {
    const onFocus = vi.fn();
    const onTitleChange = vi.fn();
    await openPane({ onFocus, onTitleChange });
    await receive({ focused: true });
    await receive({ focused: true, loading: true });
    expect(onFocus).toHaveBeenCalledOnce();
    expect(onTitleChange).toHaveBeenCalledExactlyOnceWith("Working page");
    await receive({ focused: false });
    await receive({ focused: true, title: "Second page" });
    expect(onFocus).toHaveBeenCalledTimes(2);
    expect(onTitleChange).toHaveBeenLastCalledWith("Second page");
    await receive({ focused: false });
    await receive({ id: "another-native-view", focused: true });
    expect(onFocus).toHaveBeenCalledTimes(2);
    await openPane({ onFocus, onTitleChange, visible: false });
    await receive({ focused: true });
    expect(onFocus).toHaveBeenCalledTimes(2);
  });

  it("keeps localhost history as native back/forward actions without resubmitting the address", async () => {
    const id = await openPane();
    await receive({
      url: "http://localhost:3000/post-result",
      title: "POST received",
      canGoBack: true,
    });
    await act(async () =>
      container
        .querySelector<HTMLButtonElement>('[aria-label="Go back"]')!
        .click(),
    );
    expect(mocks.action).toHaveBeenLastCalledWith(id, "back");
    await receive({
      url: "http://localhost:3000/",
      canGoBack: false,
      canGoForward: true,
    });
    await act(async () =>
      container
        .querySelector<HTMLButtonElement>('[aria-label="Go forward"]')!
        .click(),
    );
    expect(mocks.action).toHaveBeenLastCalledWith(id, "forward");
    expect(mocks.navigate).not.toHaveBeenCalled();
    expect(mocks.create).toHaveBeenCalledOnce();
  });

  const addOverlay = (rect: DOMRect, role = "menu") => {
    const overlay = document.createElement("div");
    overlay.setAttribute("role", role);
    vi.spyOn(overlay, "getClientRects").mockReturnValue([
      rect,
    ] as unknown as DOMRectList);
    container.appendChild(overlay);
    mutationCallback([
      {
        type: "childList",
        addedNodes: [overlay] as unknown as NodeList,
        removedNodes: [] as unknown as NodeList,
      },
    ]);
    return overlay;
  };
  const removeOverlay = (overlay: HTMLElement) => {
    overlay.remove();
    mutationCallback([
      {
        type: "childList",
        addedNodes: [] as unknown as NodeList,
        removedNodes: [overlay] as unknown as NodeList,
      },
    ]);
  };

  it.each(["personalResizing", "personalTransitioning", "html.is-resizing"])(
    "keeps the page visible during %s and coalesces geometry changes",
    async (flag) => {
      const nativeId = await openPane();
      if (flag === "html.is-resizing")
        document.documentElement.classList.add("is-resizing");
      else document.body.dataset[flag] = "true";
      mocks.layout.mockClear();
      const finalBounds = { x: 50, y: 80, width: 900, height: 500, scale: 2 };
      mocks.bounds.mockReturnValue(finalBounds);
      for (let i = 0; i < 20; i++) resizeCallback();
      expect(frames.size).toBe(1);
      await flushFrame();
      expect(mocks.layout).toHaveBeenCalledExactlyOnceWith(
        nativeId,
        finalBounds,
        true,
      );
      expect(mocks.snapshot).not.toHaveBeenCalled();
      expect(mocks.create).toHaveBeenCalledOnce();
      expect(mocks.close).not.toHaveBeenCalled();
    },
  );

  it("keeps only one layout in flight and then applies the newest bounds", async () => {
    await openPane();
    let finish!: () => void;
    mocks.layout.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    mocks.bounds.mockReturnValue({
      x: 100,
      y: 80,
      width: 700,
      height: 500,
      scale: 2,
    });
    resizeCallback();
    await flushFrame();
    const count = mocks.layout.mock.calls.length;
    const newest = { x: 100, y: 80, width: 810, height: 500, scale: 2 };
    mocks.bounds.mockReturnValue(newest);
    for (let i = 0; i < 10; i++) resizeCallback();
    expect(mocks.layout).toHaveBeenCalledTimes(count);
    await act(async () => finish());
    await flushFrame();
    expect(mocks.layout).toHaveBeenCalledTimes(count + 1);
    expect(mocks.layout).toHaveBeenLastCalledWith(
      expect.any(String),
      newest,
      true,
    );
  });

  it("applies explicit workspace placement immediately and coalesces repeated bounds without hiding or reloading", async () => {
    const id = await openPane();
    mocks.layout.mockClear();
    const movedBounds = { x: 800, y: 80, width: 600, height: 500, scale: 2 };
    mocks.bounds.mockReturnValue(movedBounds);
    await act(async () => {
      for (let count = 0; count < 10; count++)
        window.dispatchEvent(new Event("supermono:workspace-layout"));
      // Explicit workspace presentation must work even when a native child
      // covers the WK shell and no host animation frame is delivered.
      expect(frames.size).toBe(0);
      expect(mocks.layout).toHaveBeenCalledExactlyOnceWith(
        id,
        movedBounds,
        true,
      );
    });
    expect(frames.size).toBe(0);
    expect(mocks.layout).toHaveBeenCalledExactlyOnceWith(id, movedBounds, true);
    expect(mocks.snapshot).not.toHaveBeenCalled();
    expect(mocks.navigate).not.toHaveBeenCalled();
    expect(mocks.create).toHaveBeenCalledOnce();
  });

  it("keeps a hidden pane's view and skips geometry work until shown", async () => {
    const props = { id: "one", initialUrl: "localhost:3000" };
    await openPane();
    expect(observedMutations.size).toBe(1);
    expect(observedResizes.size).toBe(1);
    await act(async () =>
      root.render(createElement(BrowserPane, { ...props, visible: false })),
    );
    await flushFrame();
    expect(mocks.layout.mock.calls.at(-1)![2]).toBe(false);
    expect(observedMutations.size).toBe(0);
    expect(observedResizes.size).toBe(0);
    mocks.bounds.mockClear();
    mocks.layout.mockClear();
    resizeCallback();
    expect(frames.size).toBe(0);
    expect(mocks.bounds).not.toHaveBeenCalled();
    expect(mocks.snapshot).not.toHaveBeenCalled();
    await act(async () => root.render(createElement(BrowserPane, props)));
    await flushFrame();
    expect(mocks.layout).toHaveBeenCalledTimes(1);
    expect(mocks.layout.mock.calls[0][2]).toBe(true);
    expect(observedMutations.size).toBe(1);
    expect(observedResizes.size).toBe(1);
    expect(mocks.create).toHaveBeenCalledOnce();
    expect(mocks.close).not.toHaveBeenCalled();
    expect(mocks.navigate).not.toHaveBeenCalled();
  });

  it("rechecks overlays on return without observing app mutations for hidden tabs", async () => {
    await openPane();
    const nativeId = mocks.create.mock.calls[0][0];
    await openPane({ visible: false });
    expect(observedMutations.size).toBe(0);
    expect(observedResizes.size).toBe(0);
    mocks.layout.mockClear();
    const overlay = addOverlay(new DOMRect(120, 100, 200, 300));
    await flushFrame();
    expect(mocks.layout).not.toHaveBeenCalled();
    await openPane({ visible: true });
    expect(observedMutations.size).toBe(1);
    expect(observedResizes.size).toBe(1);
    expect(mocks.layout.mock.calls.some((call) => call[2] === true)).toBe(false);
    removeOverlay(overlay);
    await flushFrame();
    expect(mocks.layout).toHaveBeenLastCalledWith(
      nativeId,
      expect.any(Object),
      true,
    );
    expect(mocks.create).toHaveBeenCalledOnce();
    expect(mocks.close).not.toHaveBeenCalled();
    expect(mocks.navigate).not.toHaveBeenCalled();
  });

  it("ignores an unrelated left menu and fullscreen dismiss backdrop", async () => {
    await openPane();
    mocks.bounds.mockReturnValue({
      x: 500,
      y: 80,
      width: 600,
      height: 500,
      scale: 2,
    });
    resizeCallback();
    await flushFrame();
    const count = mocks.layout.mock.calls.length;
    const backdrop = document.createElement("div");
    backdrop.className = "popover-backdrop";
    vi.spyOn(backdrop, "getClientRects").mockReturnValue([
      new DOMRect(0, 0, 1400, 900),
    ] as unknown as DOMRectList);
    container.appendChild(backdrop);
    addOverlay(new DOMRect(10, 100, 250, 300), "listbox");
    await flushFrame();
    expect(mocks.layout).toHaveBeenCalledTimes(count);
    expect(mocks.snapshot).not.toHaveBeenCalled();
  });

  it("takes one still image for an overlapping panel and restores the same native page", async () => {
    const nativeId = await openPane();
    const overlay = addOverlay(new DOMRect(120, 100, 200, 300));
    await flushFrame();
    expect(mocks.snapshot).toHaveBeenCalledExactlyOnceWith(nativeId);
    expect(container.querySelector(".browser-page-snapshot")).not.toBeNull();
    await flushFrame();
    expect(mocks.layout).toHaveBeenLastCalledWith(
      nativeId,
      expect.any(Object),
      false,
    );
    mutationCallback([{ type: "attributes", target: overlay }]);
    await flushFrame();
    expect(mocks.snapshot).toHaveBeenCalledOnce();
    removeOverlay(overlay);
    await flushFrame();
    expect(mocks.layout).toHaveBeenLastCalledWith(
      nativeId,
      expect.any(Object),
      true,
    );
    expect(container.querySelector(".browser-page-snapshot")).toBeNull();
    expect(mocks.create).toHaveBeenCalledOnce();
    expect(mocks.close).not.toHaveBeenCalled();
  });

  it("does not hide a page if its overlay closes while the snapshot is pending", async () => {
    await openPane();
    let finish!: (image: string) => void;
    mocks.snapshot.mockImplementationOnce(
      () =>
        new Promise<string>((resolve) => {
          finish = resolve;
        }),
    );
    const overlay = addOverlay(new DOMRect(120, 100, 200, 300));
    await flushFrame();
    removeOverlay(overlay);
    await act(async () => finish("data:image/png;base64,c25hcHNob3Q="));
    await flushFrame();
    expect(mocks.layout.mock.calls.every((call) => call[2] === true)).toBe(
      true,
    );
    expect(container.querySelector(".browser-page-snapshot")).toBeNull();
  });

  it("keeps backing pixels at their captured size and refreshes only the latest resized viewport", async () => {
    const id = await openPane();
    await receive();
    const overlay = addOverlay(new DOMRect(120, 100, 200, 300));
    await flushFrame();
    await flushFrame();
    const backing = () =>
      container.querySelector<HTMLImageElement>(".browser-page-snapshot")!;
    expect(backing().style.width).toBe("600px");
    expect(backing().style.height).toBe("500px");
    let resized!: (image: string) => void;
    mocks.snapshot.mockImplementationOnce(
      () =>
        new Promise<string>((resolve) => {
          resized = resolve;
        }),
    );
    const intermediate = { x: 100, y: 80, width: 760, height: 420, scale: 2 };
    mocks.bounds.mockReturnValue(intermediate);
    resizeCallback();
    await flushFrame();
    expect(mocks.layout).toHaveBeenLastCalledWith(id, intermediate, false);
    expect(mocks.snapshot).toHaveBeenCalledTimes(2);
    expect(backing().style.width).toBe("600px");
    expect(backing().style.height).toBe("500px");
    const latest = { ...intermediate, width: 900, height: 350 };
    mocks.bounds.mockReturnValue(latest);
    resizeCallback();
    await flushFrame();
    expect(mocks.layout).toHaveBeenLastCalledWith(id, latest, false);
    expect(mocks.snapshot).toHaveBeenCalledTimes(2);
    expect(backing().style.width).toBe("600px");
    mocks.snapshot.mockResolvedValueOnce(
      "data:image/png;base64,bGF0ZXN0c2l6ZQ==",
    );
    await act(async () => resized("data:image/png;base64,b2xkc2l6ZQ=="));
    expect(mocks.snapshot).toHaveBeenCalledTimes(3);
    expect(backing().getAttribute("src")).toBe(
      "data:image/png;base64,bGF0ZXN0c2l6ZQ==",
    );
    expect(backing().style.width).toBe("900px");
    expect(backing().style.height).toBe("350px");
    removeOverlay(overlay);
    await act(async () => {});
    expect(mocks.layout).toHaveBeenLastCalledWith(id, latest, true);
    expect(mocks.navigate).not.toHaveBeenCalled();
    expect(mocks.create).toHaveBeenCalledOnce();
    expect(mocks.close).not.toHaveBeenCalled();
  });

  it("refreshes a retained backing when display scale changes without resizing its CSS viewport", async () => {
    const id = await openPane();
    await receive();
    addOverlay(new DOMRect(120, 100, 200, 300));
    await flushFrame();
    await flushFrame();
    const bounds = { x: 100, y: 80, width: 600, height: 500, scale: 1.6 };
    mocks.bounds.mockReturnValue(bounds);
    mocks.snapshot.mockResolvedValueOnce("data:image/png;base64,bmV3c2NhbGU=");
    await act(async () => window.dispatchEvent(new Event("resize")));
    await flushFrame();
    expect(mocks.layout).toHaveBeenLastCalledWith(id, bounds, false);
    expect(mocks.snapshot).toHaveBeenCalledTimes(2);
    const backing = container.querySelector<HTMLImageElement>(
      ".browser-page-snapshot",
    )!;
    expect(backing.getAttribute("src")).toBe(
      "data:image/png;base64,bmV3c2NhbGU=",
    );
    expect(backing.style.width).toBe("600px");
    expect(backing.style.height).toBe("500px");
  });

  it("maps snapshot dimensions and origin to the native frame's aligned backing-pixel edges", async () => {
    mocks.bounds.mockReturnValue({
      x: 100.2,
      y: 80.2,
      width: 600.2,
      height: 500.2,
      scale: 2,
    });
    await openPane();
    await receive();
    addOverlay(new DOMRect(120, 100, 200, 300));
    await flushFrame();
    await flushFrame();
    const backing = container.querySelector<HTMLImageElement>(
      ".browser-page-snapshot",
    )!;
    // round(right * DPR) - round(left * DPR) differs by one pixel from
    // round(width * DPR) here. Its fractional origin must align as well.
    expect(backing.style.width).toBe("600.5px");
    expect(backing.style.height).toBe("500.5px");
    expect(parseFloat(backing.style.left)).toBeCloseTo(-0.2);
    expect(parseFloat(backing.style.top)).toBeCloseTo(-0.2);
    expect(mocks.snapshot).toHaveBeenCalledOnce();
  });

  it("rounds a snapshot's half-pixel vertical origin in top-down viewport coordinates", async () => {
    mocks.bounds.mockReturnValue({
      x: 100.2,
      y: 80.25,
      width: 600.2,
      height: 499.95,
      scale: 2,
    });
    await openPane();
    await receive();
    addOverlay(new DOMRect(120, 100, 200, 300));
    await flushFrame();
    await flushFrame();
    const backing = container.querySelector<HTMLImageElement>(
      ".browser-page-snapshot",
    )!;
    // The native frame shares this top-down tie rule: pixel edges 160.5 and
    // 1160.4 become 161 and 1160, preserving a 999-pixel image at DPR 2.
    expect(backing.style.width).toBe("600.5px");
    expect(backing.style.height).toBe("499.5px");
    expect(parseFloat(backing.style.left)).toBeCloseTo(-0.2);
    expect(parseFloat(backing.style.top)).toBeCloseTo(0.25);
    expect(mocks.snapshot).toHaveBeenCalledOnce();
  });

  it("discards a queued capture after menu closure without delaying native restoration", async () => {
    await openPane();
    await receive({ zoomFactor: 1 });
    const menu = await openToolsOverlay();
    let running!: (image: string) => void;
    mocks.snapshot.mockImplementationOnce(
      () =>
        new Promise<string>((resolve) => {
          running = resolve;
        }),
    );
    await receive({ zoomFactor: 1.1 });
    await act(async () => vi.advanceTimersByTime(60));
    await receive({ zoomFactor: 1.25 });
    await act(async () => vi.advanceTimersByTime(60));
    expect(mocks.snapshot).toHaveBeenCalledTimes(2);
    await closeToolsOverlay(menu);
    expect(mocks.layout.mock.calls.at(-1)![2]).toBe(true);
    const decodes = mocks.decode.mock.calls.length;
    await act(async () => running("data:image/png;base64,Y2xvc2Vk"));
    expect(mocks.snapshot).toHaveBeenCalledTimes(2);
    expect(mocks.decode).toHaveBeenCalledTimes(decodes);
    expect(container.querySelector(".browser-page-snapshot")).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
    expect(mocks.create).toHaveBeenCalledOnce();
    expect(mocks.close).not.toHaveBeenCalled();
  });

  it("releases an overlay backing image when switching away without reloading the retained page", async () => {
    await openPane();
    await receive();
    const overlay = addOverlay(new DOMRect(120, 100, 200, 300));
    await flushFrame();
    await flushFrame();
    expect(container.querySelector(".browser-page-snapshot")).not.toBeNull();
    await openPane({ visible: false });
    expect(container.querySelector(".browser-page-snapshot")).toBeNull();
    expect(observedMutations.size).toBe(0);
    removeOverlay(overlay);
    await openPane({ visible: true });
    expect(mocks.layout.mock.lastCall![2]).toBe(true);
    expect(mocks.create).toHaveBeenCalledOnce();
    expect(mocks.snapshot).toHaveBeenCalledOnce();
    expect(mocks.navigate).not.toHaveBeenCalled();
    expect(mocks.close).not.toHaveBeenCalled();
  });

  it("hides a switched tab immediately while an overlay snapshot is unresolved and ignores its late image", async () => {
    const props = { id: "one", initialUrl: "localhost:3000" };
    await openPane();
    await receive();
    let finish!: (image: string) => void;
    mocks.snapshot.mockImplementationOnce(
      () =>
        new Promise<string>((resolve) => {
          finish = resolve;
        }),
    );
    const overlay = addOverlay(new DOMRect(120, 100, 200, 300));
    expect(mocks.snapshot).toHaveBeenCalledOnce();
    await act(async () =>
      root.render(createElement(BrowserPane, { ...props, visible: false })),
    );
    // No animation frame, timeout advance, or snapshot completion is needed.
    expect(mocks.layout.mock.calls.at(-1)![2]).toBe(false);
    expect(frames.size).toBe(0);
    removeOverlay(overlay);
    await act(async () => root.render(createElement(BrowserPane, props)));
    expect(mocks.layout.mock.calls.at(-1)![2]).toBe(true);
    const layouts = mocks.layout.mock.calls.length;
    await act(async () => finish("data:image/png;base64,bGF0ZQ=="));
    expect(container.querySelector(".browser-page-snapshot")).toBeNull();
    expect(mocks.layout).toHaveBeenCalledTimes(layouts);
    expect(mocks.create).toHaveBeenCalledOnce();
    expect(mocks.close).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("reveals the menu within its deadline and fills its backing when the same capture finishes late", async () => {
    await openPane();
    await receive();
    let finish!: (image: string) => void;
    mocks.snapshot.mockImplementationOnce(
      () =>
        new Promise<string>((resolve) => {
          finish = resolve;
        }),
    );
    const overlay = addOverlay(new DOMRect(120, 100, 200, 300));
    await act(async () => vi.advanceTimersByTime(79));
    expect(mocks.layout.mock.calls.at(-1)![2]).toBe(true);
    await act(async () => vi.advanceTimersByTime(1));
    expect(mocks.layout.mock.calls.at(-1)![2]).toBe(false);
    await act(async () => vi.advanceTimersByTime(5000));
    expect(mocks.snapshot).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
    await act(async () => finish("data:image/png;base64,bGF0ZQ=="));
    expect(
      container.querySelector(".browser-page-snapshot")?.getAttribute("src"),
    ).toBe("data:image/png;base64,bGF0ZQ==");
    expect(mocks.decode).toHaveBeenCalledOnce();
    expect(mocks.layout.mock.calls.at(-1)![2]).toBe(false);
    await flushFrame();
    removeOverlay(overlay);
    await act(async () => {});
    expect(mocks.layout.mock.calls.at(-1)![2]).toBe(true);
    expect(container.querySelector(".browser-page-snapshot")).toBeNull();
    expect(mocks.close).not.toHaveBeenCalled();
  });

  it("decodes a capture before installing its backing and hiding the native page", async () => {
    await openPane();
    await receive();
    let decode!: () => void;
    mocks.decode.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          decode = resolve;
        }),
    );
    addOverlay(new DOMRect(120, 100, 200, 300));
    await flushFrame();
    expect(mocks.decode).toHaveBeenCalledOnce();
    expect(container.querySelector(".browser-page-snapshot")).toBeNull();
    expect(mocks.layout.mock.calls.at(-1)![2]).toBe(true);
    await act(async () => vi.advanceTimersByTime(79));
    await act(async () => decode());
    expect(container.querySelector(".browser-page-snapshot")).not.toBeNull();
    await act(async () => vi.advanceTimersByTime(1));
    expect(mocks.layout.mock.calls.at(-1)![2]).toBe(true);
    await flushFrame();
    expect(mocks.layout.mock.calls.at(-1)![2]).toBe(false);
  });

  it("does not let an old timed-out capture replace a reopened overlay's backing", async () => {
    await openPane();
    await receive();
    let capture!: (image: string) => void;
    mocks.snapshot.mockImplementationOnce(
      () =>
        new Promise<string>((resolve) => {
          capture = resolve;
        }),
    );
    const first = addOverlay(new DOMRect(120, 100, 200, 300));
    await act(async () => vi.advanceTimersByTime(80));
    removeOverlay(first);
    await act(async () => {});
    expect(mocks.layout.mock.calls.at(-1)![2]).toBe(true);
    const second = addOverlay(new DOMRect(120, 100, 200, 300));
    await act(async () => vi.advanceTimersByTime(80));
    // The menu becomes usable without waiting for the old native request;
    // only its newest replacement waits in the capture queue.
    expect(mocks.layout.mock.calls.at(-1)![2]).toBe(false);
    expect(mocks.snapshot).toHaveBeenCalledOnce();
    expect(container.querySelector(".browser-page-snapshot")).toBeNull();
    await act(async () => capture("data:image/png;base64,b2xk"));
    expect(mocks.snapshot).toHaveBeenCalledTimes(2);
    expect(mocks.decode).toHaveBeenCalledOnce();
    expect(
      container.querySelector(".browser-page-snapshot")?.getAttribute("src"),
    ).toBe("data:image/png;base64,c25hcHNob3Q=");
    removeOverlay(second);
    await act(async () => {});
  });

  it("ignores a decoded image from a pane that was hidden before decoding finished", async () => {
    await openPane();
    await receive();
    let decode!: () => void;
    mocks.decode.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          decode = resolve;
        }),
    );
    const overlay = addOverlay(new DOMRect(120, 100, 200, 300));
    await flushFrame();
    await act(async () =>
      root.render(
        createElement(BrowserPane, {
          id: "one",
          initialUrl: "localhost:3000",
          visible: false,
        }),
      ),
    );
    expect(mocks.layout.mock.calls.at(-1)![2]).toBe(false);
    await act(async () => decode());
    expect(container.querySelector(".browser-page-snapshot")).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
    removeOverlay(overlay);
  });

  it("ignores a slow capture when its native page navigated before it completed", async () => {
    await openPane();
    await receive();
    let capture!: (image: string) => void;
    mocks.snapshot.mockImplementationOnce(
      () =>
        new Promise<string>((resolve) => {
          capture = resolve;
        }),
    );
    const overlay = addOverlay(new DOMRect(120, 100, 200, 300));
    await act(async () => vi.advanceTimersByTime(80));
    await receive({ url: "https://example.com/new" });
    await act(async () => capture("data:image/png;base64,b2xk"));
    expect(mocks.decode).not.toHaveBeenCalled();
    expect(container.querySelector(".browser-page-snapshot")).toBeNull();
    removeOverlay(overlay);
    await act(async () => {});
    expect(mocks.layout.mock.calls.at(-1)![2]).toBe(true);
  });

  it("does not scan overlay mutations while a retained pane is hidden", async () => {
    await openPane({ visible: false });
    expect(observedMutations.size).toBe(0);
    expect(observedResizes.size).toBe(0);
    const changed = document.createElement("div");
    const matches = vi.spyOn(changed, "matches");
    const query = vi.spyOn(changed, "querySelector");
    mutationCallback([
      { type: "attributes", target: changed, attributeName: "class" },
    ]);
    expect(matches).not.toHaveBeenCalled();
    expect(query).not.toHaveBeenCalled();
    expect(frames.size).toBe(0);
  });

  const addHoverSidebar = (edge: "left" | "right", rect: DOMRect) => {
    const sidebar = document.createElement("aside");
    sidebar.dataset.nativeBrowserOccluded = "true";
    sidebar.dataset.nativeBrowserEdge = edge;
    vi.spyOn(sidebar, "getClientRects").mockReturnValue([
      rect,
    ] as unknown as DOMRectList);
    container.appendChild(sidebar);
    mutationCallback([
      {
        type: "attributes",
        target: sidebar,
        attributeName: "data-native-browser-occluded",
      },
    ]);
    return sidebar;
  };

  it.each([
    ["left", new DOMRect(5, 0, 295, 700), 200, 0],
    ["right", new DOMRect(500, 0, 295, 700), 0, 200],
  ] as const)(
    "keeps the live page visible beside a %s hover sidebar without changing its viewport",
    async (edge, rect, clipLeft, clipRight) => {
      const id = await openPane();
      const sidebar = addHoverSidebar(edge, rect);
      await act(async () => {});
      expect(mocks.layout).toHaveBeenLastCalledWith(
        id,
        {
          x: 100,
          y: 80,
          width: 600,
          height: 500,
          scale: 2,
          clipLeft,
          clipRight,
        },
        true,
      );
      expect(mocks.layout.mock.calls.every((call) => call[2])).toBe(true);
      expect(mocks.snapshot).not.toHaveBeenCalled();
      delete sidebar.dataset.nativeBrowserOccluded;
      delete sidebar.dataset.nativeBrowserEdge;
      mutationCallback([
        {
          type: "attributes",
          target: sidebar,
          attributeName: "data-native-browser-occluded",
        },
      ]);
      await act(async () => {});
      expect(mocks.layout).toHaveBeenLastCalledWith(
        id,
        {
          x: 100,
          y: 80,
          width: 600,
          height: 500,
          scale: 2,
        },
        true,
      );
      expect(mocks.create).toHaveBeenCalledOnce();
      expect(mocks.close).not.toHaveBeenCalled();
      expect(mocks.navigate).not.toHaveBeenCalled();
    },
  );

  it("clips both hover sidebars and restores each exposed edge independently", async () => {
    const id = await openPane();
    const left = addHoverSidebar("left", new DOMRect(5, 0, 295, 700));
    await act(async () => {});
    addHoverSidebar("right", new DOMRect(500, 0, 295, 700));
    await act(async () => {});
    expect(mocks.layout).toHaveBeenLastCalledWith(
      id,
      expect.objectContaining({ clipLeft: 200, clipRight: 200 }),
      true,
    );
    removeOverlay(left);
    await act(async () => {});
    expect(mocks.layout).toHaveBeenLastCalledWith(
      id,
      expect.objectContaining({ clipLeft: 0, clipRight: 200 }),
      true,
    );
    expect(mocks.snapshot).not.toHaveBeenCalled();
  });

  it("does not clip a browser pane outside the hover sidebar", async () => {
    await openPane();
    mocks.layout.mockClear();
    addHoverSidebar("left", new DOMRect(5, 0, 80, 700));
    await act(async () => {});
    expect(mocks.layout).not.toHaveBeenCalled();
    expect(mocks.snapshot).not.toHaveBeenCalled();
  });

  it("reserves the hover sidebar edge from the first frame of its fade-in", async () => {
    const id = await openPane();
    const sidebar = addHoverSidebar("left", new DOMRect(5, 0, 295, 700));
    sidebar.style.opacity = "0";
    mutationCallback([
      { type: "attributes", target: sidebar, attributeName: "style" },
    ]);
    await act(async () => {});
    await flushFrame();
    expect(mocks.layout).toHaveBeenLastCalledWith(
      id,
      expect.objectContaining({ clipLeft: 200 }),
      true,
    );
    expect(mocks.layout.mock.calls.every((call) => call[2])).toBe(true);
    expect(mocks.snapshot).not.toHaveBeenCalled();
  });

  it("hides only a fully covered browser pane and reveals its same page when the hover sidebar leaves", async () => {
    const id = await openPane();
    const sidebar = addHoverSidebar("left", new DOMRect(5, 0, 795, 700));
    await act(async () => {});
    expect(mocks.layout).toHaveBeenLastCalledWith(
      id,
      expect.objectContaining({ clipLeft: 600, clipRight: 0 }),
      false,
    );
    removeOverlay(sidebar);
    await act(async () => {});
    expect(mocks.layout.mock.calls.at(-1)![2]).toBe(true);
    expect(mocks.snapshot).not.toHaveBeenCalled();
    expect(mocks.create).toHaveBeenCalledOnce();
  });

  it("restores the page when a retained non-edge panel removes its occlusion marker", async () => {
    await openPane();
    const sidebar = document.createElement("aside");
    sidebar.dataset.nativeBrowserOccluded = "true";
    vi.spyOn(sidebar, "getClientRects").mockReturnValue([
      new DOMRect(100, 80, 200, 500),
    ] as unknown as DOMRectList);
    container.appendChild(sidebar);
    mutationCallback([
      {
        type: "attributes",
        target: sidebar,
        attributeName: "data-native-browser-occluded",
      },
    ]);
    await flushFrame();
    await flushFrame();
    expect(mocks.layout.mock.calls.at(-1)![2]).toBe(false);
    delete sidebar.dataset.nativeBrowserOccluded;
    mutationCallback([
      {
        type: "attributes",
        target: sidebar,
        attributeName: "data-native-browser-occluded",
      },
    ]);
    await flushFrame();
    expect(mocks.layout.mock.calls.at(-1)![2]).toBe(true);
    expect(container.querySelector(".browser-page-snapshot")).toBeNull();
  });

  it("keeps the native page alive if an overlay snapshot fails", async () => {
    await openPane();
    mocks.snapshot.mockRejectedValueOnce(new Error("Snapshot unavailable"));
    const overlay = addOverlay(new DOMRect(120, 100, 200, 300));
    await flushFrame();
    expect(container.textContent).not.toContain("Preview unavailable");
    expect(mocks.close).not.toHaveBeenCalled();
    removeOverlay(overlay);
    await flushFrame();
    expect(mocks.layout.mock.calls.at(-1)![2]).toBe(true);
  });

  it("recovers show and hide when animation frames are not delivered and cancels timers", async () => {
    await act(async () =>
      root.render(
        createElement(BrowserPane, { id: "one", initialUrl: "localhost:3000" }),
      ),
    );
    await act(async () => vi.advanceTimersByTime(100));
    expect(mocks.layout.mock.calls.at(-1)![2]).toBe(true);
    expect(frames.size).toBe(0);
    const overlay = addOverlay(new DOMRect(120, 100, 200, 300));
    await act(async () => vi.advanceTimersByTime(100));
    await act(async () => vi.advanceTimersByTime(100));
    expect(mocks.layout.mock.calls.at(-1)![2]).toBe(false);
    removeOverlay(overlay);
    await act(async () => vi.advanceTimersByTime(100));
    expect(mocks.layout.mock.calls.at(-1)![2]).toBe(true);
    await act(async () => root.render(null));
    expect(vi.getTimerCount()).toBe(0);
    expect(frames.size).toBe(0);
  });

  it("keeps a valid page visible on native notices and slow loads beyond 20 seconds", async () => {
    await openPane();
    await receive({ notice: "Popup was blocked" });
    expect(container.querySelector(".browser-notice")?.textContent).toContain(
      "Popup was blocked",
    );
    expect(container.textContent).not.toContain("Preview unavailable");
    await receive({ loading: true });
    await act(async () => vi.advanceTimersByTime(20_001));
    expect(container.querySelector(".browser-notice")?.textContent).toContain(
      "taking longer",
    );
    expect(container.textContent).toContain("Loading preview");
    expect(container.textContent).not.toContain("Preview unavailable");
    expect(mocks.layout.mock.calls.every((call) => call[2] === true)).toBe(
      true,
    );
    expect(mocks.close).not.toHaveBeenCalled();
  });

  it("keeps the page visible for invalid input, rejected actions, and external-open errors", async () => {
    await openPane();
    await receive();
    const input = container.querySelector("input")!;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )!.set!;
      setter.call(input, "javascript:alert(1)");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () =>
      container
        .querySelector("form")!
        .dispatchEvent(
          new Event("submit", { bubbles: true, cancelable: true }),
        ),
    );
    expect(mocks.navigate).not.toHaveBeenCalled();
    expect(container.querySelector(".browser-notice")?.textContent).toContain(
      "http and https",
    );
    mocks.action.mockRejectedValueOnce(new Error("Reload rejected"));
    await act(async () =>
      container
        .querySelector<HTMLButtonElement>('[aria-label="Reload preview"]')!
        .click(),
    );
    expect(container.querySelector(".browser-notice")?.textContent).toContain(
      "Reload rejected",
    );
    mocks.external.mockRejectedValueOnce(new Error("Brave unavailable"));
    await act(async () =>
      container
        .querySelector<HTMLButtonElement>(
          '[aria-label="Open preview in Brave"]',
        )!
        .click(),
    );
    expect(mocks.external).toHaveBeenLastCalledWith("http://localhost:3000/");
    expect(container.querySelector(".browser-notice")?.textContent).toContain(
      "Brave unavailable",
    );
    expect(container.textContent).not.toContain("Preview unavailable");
    expect(mocks.layout.mock.calls.every((call) => call[2] === true)).toBe(
      true,
    );
  });

  it("honors a true modal even when its dialog is outside the preview bounds", async () => {
    await openPane();
    const modal = addOverlay(new DOMRect(5, 5, 40, 40), "dialog");
    modal.setAttribute("aria-modal", "true");
    mutationCallback([
      { type: "attributes", target: modal, attributeName: "aria-modal" },
    ]);
    await flushFrame();
    await flushFrame();
    expect(mocks.layout.mock.calls.at(-1)![2]).toBe(false);
    expect(mocks.snapshot).toHaveBeenCalledOnce();
    removeOverlay(modal);
    await flushFrame();
    expect(mocks.layout.mock.calls.at(-1)![2]).toBe(true);
  });

  it("cancels a pending snapshot paint when the pane closes", async () => {
    await openPane();
    addOverlay(new DOMRect(120, 100, 200, 300));
    await flushFrame();
    expect(container.querySelector(".browser-page-snapshot")).not.toBeNull();
    expect(frames.size).toBe(1);
    await act(async () => root.render(null));
    expect(vi.getTimerCount()).toBe(0);
    expect(frames.size).toBe(0);
    expect(mocks.layout.mock.calls.every((call) => call[2] === true)).toBe(
      true,
    );
    expect(mocks.close).toHaveBeenCalledOnce();
  });

  it("keeps the committed page URL when a navigation request is rejected", async () => {
    await openPane();
    await receive();
    mocks.navigate.mockRejectedValueOnce(new Error("Navigation rejected"));
    const input = container.querySelector("input")!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )!.set!.call(input, "localhost:4000/rejected");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () =>
      container
        .querySelector("form")!
        .dispatchEvent(
          new Event("submit", { bubbles: true, cancelable: true }),
        ),
    );
    expect(mocks.navigate).toHaveBeenLastCalledWith(
      expect.any(String),
      "http://localhost:4000/rejected",
    );
    expect(container.querySelector(".browser-notice")?.textContent).toContain(
      "Navigation rejected",
    );
    await act(async () =>
      container
        .querySelector<HTMLButtonElement>(
          '[aria-label="Open preview in Brave"]',
        )!
        .click(),
    );
    expect(mocks.external).toHaveBeenLastCalledWith("http://localhost:3000/");
    expect(container.textContent).not.toContain("Preview unavailable");
    expect(mocks.layout.mock.calls.every((call) => call[2] === true)).toBe(
      true,
    );
  });

  it("provides optional expand and restore controls without allocating a blank preview", async () => {
    const onToggleExpand = vi.fn();
    await act(async () =>
      root.render(createElement(BrowserPane, { id: "one", onToggleExpand })),
    );
    const expand = container.querySelector<HTMLButtonElement>(
      '[aria-label="Expand preview"]',
    )!;
    act(() => expand.click());
    expect(onToggleExpand).toHaveBeenCalledOnce();
    await act(async () =>
      root.render(
        createElement(BrowserPane, {
          id: "one",
          expanded: true,
          onToggleExpand,
        }),
      ),
    );
    expect(
      container.querySelector(
        '[aria-label="Restore split"][aria-pressed="true"]',
      ),
    ).not.toBeNull();
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it.each([false, true])(
    "recreates an unexpectedly closed browser on Retry (attached=%s)",
    async (attached) => {
      await act(async () =>
        root.render(
          createElement(BrowserPane, {
            id: "recovery",
            initialUrl: "https://example.com/",
            attachedNativeId: attached ? "existing-native" : undefined,
          }),
        ),
      );
      await flushFrame();
      const oldId = attached
        ? "existing-native"
        : mocks.create.mock.calls[0][0];
      const receive = mocks.listen.mock.calls[0][0] as (
        state: BrowserState,
      ) => void;
      const closed: BrowserState = {
        id: oldId,
        url: "https://example.com/",
        title: "Page",
        loading: false,
        canGoBack: false,
        canGoForward: false,
        error: "Page closed",
        notice: null,
        closed: true,
      };
      await act(async () => receive(closed));
      expect(container.textContent).toContain("Page closed");
      const retry = [
        ...container.querySelectorAll<HTMLButtonElement>("button"),
      ].find((button) => button.textContent === "Retry")!;
      await act(async () => retry.click());
      await flushFrame();
      const freshId = mocks.create.mock.calls.at(-1)![0];
      expect(freshId).not.toBe(oldId);
      expect(mocks.create).toHaveBeenLastCalledWith(
        freshId,
        "https://example.com/",
        expect.any(Object),
      );
      expect(mocks.attach).toHaveBeenCalledTimes(attached ? 1 : 0);
      expect(mocks.navigate.mock.calls.every((call) => call[0] !== oldId)).toBe(
        true,
      );
      expect(container.textContent).not.toContain("Page closed");
      await act(async () => receive(closed));
      expect(container.textContent).not.toContain("Page closed");
    },
  );

  it("keeps native drag feedback above a live page and clears it without replacing the page", async () => {
    await act(async () =>
      root.render(
        createElement(
          "div",
          { "data-workspace-stage": "" },
          createElement(
            "div",
            { "data-workspace-body": "page" },
            createElement(BrowserPane, {
              id: "drop",
              initialUrl: "https://example.com/",
            }),
            createElement("div", {
              "data-workspace-drop-hint": "",
              "data-drop-edge": "right",
              "data-drop-kind": "tab",
              "data-drop-title": "Example",
            }),
          ),
        ),
      ),
    );
    const pageId = mocks.create.mock.calls[0][0];
    const hint = container.querySelector<HTMLElement>(
      "[data-workspace-drop-hint]",
    )!;
    vi.spyOn(hint, "getBoundingClientRect").mockReturnValue(
      new DOMRect(400, 80, 300, 500),
    );
    const receive = mocks.listen.mock.calls[0][0] as (
      state: BrowserState,
    ) => void;
    await act(async () =>
      receive({
        id: pageId,
        url: "https://example.com/",
        title: "Example",
        loading: false,
        canGoBack: false,
        canGoForward: false,
        error: null,
        notice: null,
        nativeDropIndicator: true,
      }),
    );
    await flushFrame();
    expect(mocks.dropIndicator).toHaveBeenLastCalledWith(pageId, {
      x: 0.5,
      y: 0,
      width: 0.5,
      height: 1,
      edge: "right",
      kind: "tab",
      title: "Example",
    });
    const stage = container.querySelector("[data-workspace-stage]")!;
    await act(async () => {
      hint.remove();
      stage.dispatchEvent(
        new Event("supermono:workspace-drop-feedback", { bubbles: true }),
      );
    });
    expect(mocks.dropIndicator).toHaveBeenLastCalledWith(pageId, null);
    expect(mocks.create).toHaveBeenCalledTimes(1);
    expect(mocks.close).not.toHaveBeenCalled();
    expect(mocks.snapshot).not.toHaveBeenCalled();
    expect(mocks.layout.mock.calls.every((call) => call[2])).toBe(true);
  });
});

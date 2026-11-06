// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BrowserPane } from "./BrowserPane";
import type { BrowserState } from "../lib/browser";
import { addBookmark, loadBookmarks } from "../lib/browserBookmarks";
import { hostPaneHeaderMenu } from "../lib/paneHeader";

const native = vi.hoisted(() => ({
  create: vi.fn(),
  close: vi.fn(),
  layout: vi.fn(),
  navigate: vi.fn(),
  listen: vi.fn(),
  listenToolbar: vi.fn(),
  listenOpenTab: vi.fn(),
  handlers: new Set<(state: BrowserState) => void>(),
}));
vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => true }));
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({ onFocusChanged: async () => () => {} }),
}));
vi.mock("@tauri-apps/api/webview", () => ({
  getCurrentWebview: () => ({ setFocus: async () => {} }),
}));
vi.mock("../lib/browser", async (original) => ({
  ...(await original<typeof import("../lib/browser")>()),
  browserBounds: () => ({ x: 0, y: 40, width: 600, height: 500, scale: 2 }),
  nativeBrowser: native,
}));

const PROJECT = "/work/app";
const PAGE = "https://docs.example.com/guide";
const ICON = "data:image/png;base64,AAAA";

describe("bookmarks in the browser pane", () => {
  let root: Root;
  let container: HTMLDivElement;
  const onTakenOver = vi.fn();
  const report = async (state: Partial<BrowserState>) => {
    await act(async () => {
      for (const handler of native.handlers)
        handler({
          id: native.create.mock.calls[0][0],
          url: PAGE,
          title: "The guide",
          loading: false,
          canGoBack: false,
          canGoForward: false,
          error: null,
          notice: null,
          ...state,
        } as BrowserState);
    });
  };
  const paint = async (props: Record<string, unknown> = {}) => {
    await act(async () =>
      root.render(
        createElement(BrowserPane, {
          id: "page",
          project: PROJECT,
          onTakenOver,
          ...props,
        }),
      ),
    );
  };
  const star = () =>
    container.querySelector<HTMLButtonElement>(".browser-bookmark-star");

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) =>
      window.setTimeout(() => callback(0), 0),
    );
    vi.stubGlobal("cancelAnimationFrame", (id: number) =>
      window.clearTimeout(id),
    );
    const stored = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => stored.get(key) ?? null,
      setItem: (key: string, value: string) => stored.set(key, value),
      removeItem: (key: string) => stored.delete(key),
    });
    native.handlers.clear();
    native.listen.mockImplementation(async (callback) => {
      native.handlers.add(callback);
      return () => native.handlers.delete(callback);
    });
    native.listenToolbar.mockResolvedValue(() => {});
    native.listenOpenTab.mockResolvedValue(() => {});
    native.create.mockResolvedValue(undefined);
    native.close.mockResolvedValue(undefined);
    native.layout.mockResolvedValue(undefined);
    native.navigate.mockResolvedValue(undefined);
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  it("bookmarks the page in its project with one click, and removes it with another", async () => {
    await paint({ initialUrl: PAGE });
    await report({ favicon: ICON });
    expect(star()?.getAttribute("aria-label")).toBe("Bookmark in app");
    expect(star()?.hasAttribute("data-bookmarked")).toBe(false);

    await act(async () => star()!.click());
    expect(loadBookmarks(PROJECT)).toEqual([
      { url: PAGE, name: "The guide", favicon: ICON },
    ]);
    expect(star()?.getAttribute("aria-label")).toBe("Remove bookmark");
    expect(star()?.hasAttribute("data-bookmarked")).toBe(true);
    expect(container.textContent).not.toContain("Bookmarked");

    await act(async () => star()!.click());
    expect(loadBookmarks(PROJECT)).toEqual([]);
    expect(star()?.hasAttribute("data-bookmarked")).toBe(false);
  });

  it("names a page with no title by its host", async () => {
    await paint({ initialUrl: PAGE });
    await report({ title: "   " });
    await act(async () => star()!.click());
    expect(loadBookmarks(PROJECT)[0].name).toBe("docs.example.com");
  });

  it("shows a bookmark's star filled only on that page, and only in its project", async () => {
    addBookmark("/work/other", { url: PAGE, name: "Elsewhere" });
    await paint({ initialUrl: PAGE });
    await report({});
    expect(star()?.hasAttribute("data-bookmarked")).toBe(false);
    addBookmark(PROJECT, { url: PAGE, name: "Here" });
    await report({});
    expect(star()?.hasAttribute("data-bookmarked")).toBe(true);
    await report({ url: "https://docs.example.com/another" });
    expect(star()?.hasAttribute("data-bookmarked")).toBe(false);
  });

  it("offers no star without a page or a project to keep it in", async () => {
    await paint();
    expect(star()).toBeNull();
    await act(async () => root.unmount());
    root = createRoot(container);
    await paint({ id: "home", project: "~", initialUrl: PAGE });
    expect(star()).toBeNull();
    expect(
      container
        .querySelector(".browser-address")
        ?.hasAttribute("data-bookmarkable"),
    ).toBe(false);
  });

  it("says what to do when the bookmark can't be kept", async () => {
    await paint({ initialUrl: PAGE });
    await report({});
    vi.stubGlobal("localStorage", {
      getItem: () => null,
      setItem: () => {
        throw new Error("Quota");
      },
      removeItem: () => {},
    });
    await act(async () => star()!.click());
    expect(container.textContent).toContain(
      "Couldn't bookmark this page. Remove a bookmark and try again.",
    );
    expect(star()?.hasAttribute("data-bookmarked")).toBe(false);
  });

  it("keeps the blank tab's sentence until the project has bookmarks", async () => {
    addBookmark("/work/other", { url: PAGE, name: "Elsewhere" });
    await paint();
    expect(container.textContent).toContain("Your work, in view.");
    expect(container.querySelector(".browser-bookmarks")).toBeNull();
  });

  it("lists the project's bookmarks on a blank tab, and opens one there", async () => {
    addBookmark(PROJECT, { url: PAGE, name: "The guide" });
    await paint();
    expect(container.textContent).not.toContain("Your work, in view.");
    const row = container.querySelector<HTMLButtonElement>(
      `.browser-bookmark-face[title="${PAGE}"]`,
    )!;
    expect(row.textContent).toContain("The guide");

    await act(async () => row.click());
    expect(onTakenOver).toHaveBeenCalledOnce();
    expect(native.create.mock.calls[0]?.[1]).toBe(PAGE);
    expect(container.querySelector(".browser-bookmarks")).toBeNull();
  });

  it("adds nothing to the pane's menu: the star and the blank tab are the way in", async () => {
    const stop = hostPaneHeaderMenu("page");
    await paint({ initialUrl: PAGE });
    await report({});
    const { paneHeaderMenu } = await import("../lib/paneHeader");
    const labels = paneHeaderMenu("page")!
      .items()
      .flatMap((item) => (item.kind === "item" ? [item.label] : []));
    expect(labels.some((label) => /bookmark/i.test(label))).toBe(false);
    stop();
  });
});

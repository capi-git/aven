// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BrowserBookmarks } from "./BrowserBookmarks";
import {
  addBookmark,
  loadBookmarks,
  type BrowserBookmark,
} from "../lib/browserBookmarks";

const PROJECT = "/work/app";

describe("BrowserBookmarks", () => {
  let container: HTMLDivElement;
  let root: Root;
  const onOpen = vi.fn();
  const paint = async (bookmarks: readonly BrowserBookmark[]) => {
    await act(async () =>
      root.render(
        createElement(BrowserBookmarks, {
          project: PROJECT,
          bookmarks,
          onOpen,
        }),
      ),
    );
  };
  const button = (label: string) =>
    container.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);
  const rename = () =>
    container.querySelector<HTMLInputElement>(".browser-bookmark-rename")!;
  const type = async (value: string) => {
    const input = rename();
    await act(async () => {
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )!.set!.call(input, value);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
  };
  const press = async (key: string) => {
    await act(async () => {
      rename().dispatchEvent(
        new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }),
      );
    });
  };

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    const stored = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => stored.get(key) ?? null,
      setItem: (key: string, value: string) => stored.set(key, value),
      removeItem: (key: string) => stored.delete(key),
    });
    addBookmark(PROJECT, {
      url: "https://docs.example.com/guide",
      name: "Guide",
    });
    addBookmark(PROJECT, { url: "https://example.org/", name: "example.org" });
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    await paint(loadBookmarks(PROJECT));
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  it("lists bookmarks under one heading, naming a host only where it adds something", () => {
    expect(
      container.querySelector(".browser-bookmarks-heading")?.textContent,
    ).toBe("Bookmarks");
    const rows = [...container.querySelectorAll(".browser-bookmark")];
    expect(rows.map((row) => row.textContent)).toEqual([
      "example.org",
      "Guidedocs.example.com",
    ]);
  });

  it("opens the page a row is clicked for", async () => {
    const face = container.querySelector<HTMLButtonElement>(
      'button[title="https://docs.example.com/guide"]',
    )!;
    await act(async () => face.click());
    expect(onOpen).toHaveBeenCalledExactlyOnceWith(
      "https://docs.example.com/guide",
    );
  });

  it("renames in place on Enter, and doesn't open the page", async () => {
    await act(async () => button("Rename Guide")!.click());
    expect(rename().value).toBe("Guide");
    await type("Handbook");
    await press("Enter");
    expect(loadBookmarks(PROJECT)[1].name).toBe("Handbook");
    expect(onOpen).not.toHaveBeenCalled();
    expect(container.querySelector(".browser-bookmark-rename")).toBeNull();
  });

  it("keeps the old name on Escape or when left empty", async () => {
    await act(async () => button("Rename Guide")!.click());
    await type("Handbook");
    await press("Escape");
    expect(loadBookmarks(PROJECT)[1].name).toBe("Guide");
    await act(async () => button("Rename Guide")!.click());
    await type("   ");
    await press("Enter");
    expect(loadBookmarks(PROJECT)[1].name).toBe("Guide");
  });

  it("removes only the row asked for", async () => {
    await act(async () => button("Remove Guide")!.click());
    expect(loadBookmarks(PROJECT).map((item) => item.name)).toEqual([
      "example.org",
    ]);
    expect(onOpen).not.toHaveBeenCalled();
  });
});

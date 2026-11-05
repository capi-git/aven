// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  addBookmark,
  clearBookmarks,
  loadBookmarks,
  removeBookmark,
  renameBookmark,
  subscribeBookmarks,
} from "./browserBookmarks";

const docs = { url: "https://docs.example.com/guide", name: "Guide" };
const blog = { url: "https://blog.example.com/", name: "Blog" };
const ICON = "data:image/png;base64,AAAA";

describe("browser bookmarks", () => {
  let stored: Map<string, string>;
  beforeEach(() => {
    stored = new Map();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => stored.get(key) ?? null,
      setItem: (key: string, value: string) => stored.set(key, value),
      removeItem: (key: string) => stored.delete(key),
    });
  });

  it("keeps each project's bookmarks apart, under its own aven. key", () => {
    addBookmark("/work/one", docs);
    addBookmark("/work/two", blog);
    expect(loadBookmarks("/work/one")).toEqual([docs]);
    expect(loadBookmarks("/work/two")).toEqual([blog]);
    expect([...stored.keys()].sort()).toEqual([
      "aven.bookmarks./work/one",
      "aven.bookmarks./work/two",
    ]);
  });

  it("treats a project's path the same with or without a trailing slash", () => {
    addBookmark("/work/one/", docs);
    expect(loadBookmarks("/work/one")).toEqual([docs]);
  });

  it("comes back after a restart, from what's stored alone", () => {
    addBookmark("/work/one", { ...docs, favicon: ICON });
    const saved = stored.get("aven.bookmarks./work/one")!;
    stored = new Map([["aven.bookmarks./work/one", saved]]);
    expect(loadBookmarks("/work/one")).toEqual([{ ...docs, favicon: ICON }]);
  });

  it("puts the newest first and doesn't bookmark a page twice", () => {
    addBookmark("/work/one", docs);
    addBookmark("/work/one", blog);
    addBookmark("/work/one", { ...docs, name: "Another name" });
    expect(loadBookmarks("/work/one")).toEqual([blog, docs]);
  });

  it("returns the same list until something changes", () => {
    addBookmark("/work/one", docs);
    const first = loadBookmarks("/work/one");
    expect(loadBookmarks("/work/one")).toBe(first);
    addBookmark("/work/one", blog);
    expect(loadBookmarks("/work/one")).not.toBe(first);
    expect(loadBookmarks("/work/empty")).toBe(loadBookmarks("/work/other"));
  });

  it("sees another window's change without being told", () => {
    addBookmark("/work/one", docs);
    expect(loadBookmarks("/work/one")).toEqual([docs]);
    stored.set("aven.bookmarks./work/one", JSON.stringify([blog]));
    expect(loadBookmarks("/work/one")).toEqual([blog]);
  });

  it("renames, and an empty name leaves the bookmark as it was", () => {
    addBookmark("/work/one", docs);
    renameBookmark("/work/one", docs.url, "  Handbook  ");
    expect(loadBookmarks("/work/one")).toEqual([{ ...docs, name: "Handbook" }]);
    renameBookmark("/work/one", docs.url, "   ");
    expect(loadBookmarks("/work/one")[0].name).toBe("Handbook");
  });

  it("removes one bookmark, and its key with the last", () => {
    addBookmark("/work/one", docs);
    addBookmark("/work/one", blog);
    removeBookmark("/work/one", blog.url);
    expect(loadBookmarks("/work/one")).toEqual([docs]);
    removeBookmark("/work/one", docs.url);
    expect(loadBookmarks("/work/one")).toEqual([]);
    expect(stored.has("aven.bookmarks./work/one")).toBe(false);
  });

  it("clears only the project it is given", () => {
    addBookmark("/work/one", docs);
    addBookmark("/work/two", blog);
    clearBookmarks("/work/one");
    expect(loadBookmarks("/work/one")).toEqual([]);
    expect(loadBookmarks("/work/two")).toEqual([blog]);
  });

  it("drops damaged entries and icons that aren't small decoded images", () => {
    stored.set(
      "aven.bookmarks./work/one",
      JSON.stringify([
        { url: "", name: "No address" },
        { url: "https://a.example/", name: "   " },
        "not a bookmark",
        { ...docs, favicon: "https://tracker.example/icon.png" },
        { ...docs, name: "Same page again" },
      ]),
    );
    expect(loadBookmarks("/work/one")).toEqual([docs]);
    stored.set("aven.bookmarks./work/two", "not json");
    expect(loadBookmarks("/work/two")).toEqual([]);
    stored.set("aven.bookmarks./work/three", '{"url":"x"}');
    expect(loadBookmarks("/work/three")).toEqual([]);
  });

  it("says so when storage refuses a bookmark, and keeps what it had", () => {
    addBookmark("/work/one", docs);
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => stored.get(key) ?? null,
      setItem: () => {
        throw new Error("Quota");
      },
      removeItem: (key: string) => stored.delete(key),
    });
    expect(addBookmark("/work/one", blog)).toBe(false);
    expect(loadBookmarks("/work/one")).toEqual([docs]);
  });

  it("tells listeners of changes here and in other windows, until they leave", () => {
    const listener = vi.fn();
    const stop = subscribeBookmarks(listener);
    addBookmark("/work/one", docs);
    expect(listener).toHaveBeenCalledTimes(1);
    window.dispatchEvent(
      new StorageEvent("storage", { key: "aven.bookmarks./work/one" }),
    );
    expect(listener).toHaveBeenCalledTimes(2);
    window.dispatchEvent(
      new StorageEvent("storage", { key: "something.else" }),
    );
    expect(listener).toHaveBeenCalledTimes(2);
    stop();
    addBookmark("/work/one", blog);
    expect(listener).toHaveBeenCalledTimes(2);
  });
});

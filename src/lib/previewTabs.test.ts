import { describe, expect, it } from "vitest";
import { mergePreviewTabOrder, previewTabIds } from "./previewTabs";

describe("previewTabIds", () => {
  it("shows kept tabs and the active preview in their original order", () => {
    expect(
      previewTabIds(
        ["kept-a", "old", "active", "kept-b", "recent"],
        new Set(["kept-a", "kept-b"]),
        "active",
        "old",
      ),
    ).toEqual({
      visibleIds: ["kept-a", "active", "kept-b"],
      previewId: "active",
    });
  });

  it("preserves the last preview when switching to a kept tab", () => {
    const all = ["session", "first", "second", "last"];
    const kept = new Set(["session"]);
    const first = previewTabIds(all, kept, "first");
    expect(previewTabIds(all, kept, "session", first.previewId)).toEqual({
      visibleIds: ["session", "first"],
      previewId: "first",
    });
    expect(previewTabIds(all, kept, "second", first.previewId)).toEqual({
      visibleIds: ["session", "second"],
      previewId: "second",
    });
  });

  it("falls back to the latest unkept tab when the previous preview is closed or kept", () => {
    for (const previous of [undefined, "closed", "session"]) {
      expect(
        previewTabIds(
          ["old", "session", "recent", "other-session"],
          new Set(["session", "other-session"]),
          "session",
          previous,
        ),
      ).toEqual({
        visibleIds: ["session", "recent", "other-session"],
        previewId: "recent",
      });
    }
  });

  it("lets an explicit null suppress a fallback after keeping the preview", () => {
    expect(
      previewTabIds(["old", "kept"], new Set(["kept"]), "kept", null),
    ).toEqual({
      visibleIds: ["kept"],
      previewId: null,
    });
    expect(
      previewTabIds(["old", "kept"], new Set(["kept"]), "old", null),
    ).toEqual({
      visibleIds: ["old", "kept"],
      previewId: "old",
    });
  });

  it("shows all kept tabs with no preview when every tab is kept", () => {
    expect(
      previewTabIds(["a", "b"], new Set(["a", "b", "closed"]), "a"),
    ).toEqual({
      visibleIds: ["a", "b"],
      previewId: null,
    });
    expect(previewTabIds([], new Set(["closed"]), "closed", "old")).toEqual({
      visibleIds: [],
      previewId: null,
    });
  });

  it("does not invent tabs for a stale active selection", () => {
    expect(previewTabIds(["old", "latest"], new Set(), "closed")).toEqual({
      visibleIds: ["latest"],
      previewId: "latest",
    });
  });
});

describe("mergePreviewTabOrder", () => {
  it("reorders kept and preview slots while preserving hidden positions and order", () => {
    const original = [
      "hidden-a",
      "kept-a",
      "hidden-b",
      "preview",
      "hidden-c",
      "kept-b",
    ];
    expect(
      mergePreviewTabOrder(original, ["kept-b", "kept-a", "preview"]),
    ).toEqual([
      "hidden-a",
      "kept-b",
      "hidden-b",
      "kept-a",
      "hidden-c",
      "preview",
    ]);
    expect(original).toEqual([
      "hidden-a",
      "kept-a",
      "hidden-b",
      "preview",
      "hidden-c",
      "kept-b",
    ]);
  });

  it("ignores duplicate and unknown reorder IDs without losing source tabs", () => {
    const original = ["a", "hidden", "b", "c"];
    const merged = mergePreviewTabOrder(original, ["unknown", "c", "c", "a"]);
    expect(merged).toEqual(["c", "hidden", "b", "a"]);
    expect([...merged].sort()).toEqual([...original].sort());
  });

  it("preserves every source identity even if source IDs are duplicated", () => {
    const original = ["a", "hidden", "b", "a", "b"];
    const merged = mergePreviewTabOrder(original, ["b", "a", "b"]);
    expect(merged).toEqual(["b", "hidden", "a", "a", "b"]);
    expect([...merged].sort()).toEqual([...original].sort());
  });

  it("leaves the order unchanged when nothing valid moves", () => {
    for (const reordered of [[], ["unknown"], ["b"], ["a", "b"]])
      expect(mergePreviewTabOrder(["a", "hidden", "b"], reordered)).toEqual([
        "a",
        "hidden",
        "b",
      ]);
    expect(mergePreviewTabOrder([], ["a"])).toEqual([]);
  });
});

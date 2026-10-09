// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  changeSurfaceGroup,
  createSurfaceGroup,
  groupAfterDrop,
  groupChipId,
  loadSurfaceGroups,
  nextSurfaceGroupColor,
  orderFromDisplay,
  setSurfaceGroupMembership,
  stripDisplayIds,
  stripSegments,
  ungroupSurfaceGroup,
  type SurfaceGroupState,
} from "./surfaceGroups";

const state = (
  members: Record<string, string>,
  collapsed: string[] = [],
): SurfaceGroupState => ({
  groups: Object.fromEntries(
    [...new Set(Object.values(members))].map((id) => [
      id,
      { id, name: id, color: 1, collapsed: collapsed.includes(id) },
    ]),
  ),
  members,
});

describe("surface group store", () => {
  beforeEach(() => {
    const store = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => void store.set(key, value),
      removeItem: (key: string) => void store.delete(key),
      clear: () => store.clear(),
    });
  });

  it("creates, renames, regroups and forgets empty groups", () => {
    const id = createSurfaceGroup(["a", "b"], 2);
    changeSurfaceGroup(id, { name: "  Research  " });
    expect(loadSurfaceGroups().groups[id]).toMatchObject({
      name: "Research",
      color: 2,
      collapsed: false,
    });
    setSurfaceGroupMembership({ a: null });
    expect(loadSurfaceGroups().members).toEqual({ b: id });
    ungroupSurfaceGroup(id);
    expect(loadSurfaceGroups()).toEqual({ groups: {}, members: {} });
  });

  it("ignores corrupt storage", () => {
    localStorage.setItem("aven.tabGroups.v1", "{not json");
    expect(loadSurfaceGroups()).toEqual({ groups: {}, members: {} });
    localStorage.setItem(
      "aven.tabGroups.v1",
      JSON.stringify({
        groups: { g: { color: 99 } },
        members: { a: "g", b: "x" },
      }),
    );
    expect(loadSurfaceGroups()).toEqual({
      groups: { g: { id: "g", name: "", color: 1, collapsed: false } },
      members: { a: "g" },
    });
  });

  it("picks the first unused colour after grey", () => {
    expect(nextSurfaceGroupColor([])).toBe(1);
    expect(
      nextSurfaceGroupColor([
        { id: "g", name: "", color: 1, collapsed: false },
      ]),
    ).toBe(2);
  });
});

describe("strip segments", () => {
  it("draws a group at its first member and gathers stray members", () => {
    const segments = stripSegments(
      ["a", "x", "b", "c"],
      state({ a: "g", c: "g" }),
    );
    expect(stripDisplayIds(segments)).toEqual([
      groupChipId("g"),
      "a",
      "c",
      "x",
      "b",
    ]);
  });

  it("shows only the label of a folded group, as Brave does", () => {
    const folded = state({ a: "g", b: "g" }, ["g"]);
    expect(stripDisplayIds(stripSegments(["a", "b", "x"], folded))).toEqual([
      groupChipId("g"),
      "x",
    ]);
  });
});

describe("drops", () => {
  const chip = groupChipId("g");
  const members = { a: "g", b: "g" };

  it("joins right after a label or between two members", () => {
    expect(groupAfterDrop([chip, "x", "a", "b"], "x", members)).toBe("g");
    expect(groupAfterDrop([chip, "a", "x", "b"], "x", members)).toBe("g");
  });

  it("does not join from the far edge of a group", () => {
    expect(groupAfterDrop([chip, "a", "b", "x"], "x", members)).toBeUndefined();
    expect(groupAfterDrop(["x", chip, "a", "b"], "x", members)).toBeUndefined();
  });

  it("keeps a member at its group's end and releases it elsewhere", () => {
    expect(groupAfterDrop([chip, "b", "a", "x"], "a", members)).toBeUndefined();
    expect(groupAfterDrop(["a", "x", chip, "b"], "a", members)).toBeNull();
  });

  it("moves a whole group, folded members included, with its label", () => {
    const display = ["x", chip, "a", "y"];
    // Label dragged after y: a is shown, b is folded away.
    const moved = ["x", "a", "y", chip];
    expect(orderFromDisplay(moved, members, ["a", "b", "x", "y"])).toEqual([
      "x",
      "y",
      "a",
      "b",
    ]);
    expect(orderFromDisplay(display, members, ["a", "b", "x", "y"])).toEqual([
      "x",
      "a",
      "b",
      "y",
    ]);
  });
});

import { describe, expect, it } from "vitest";
import { visibleActivitySessionIds } from "./activityVisibility";
import { leaf, newTab } from "./layout";

const split = {
  ...newTab("a"),
  id: "tab1",
  layout: {
    type: "split" as const,
    id: "split",
    dir: "right" as const,
    children: [leaf("a"), leaf("b")],
    sizes: [0.5, 0.5],
  },
};
const other = { ...newTab("c"), id: "tab2" };
const base = {
  workspaceVisible: true,
  visibleSurfaceIds: ["tab1"],
  tabs: [split, other],
  sessionIds: new Set(["a", "b", "c"]),
  floatingSessionIds: [],
};
describe("Activity transcript visibility", () => {
  it("includes both visible chat siblings and excludes retained background tabs", () => {
    expect([...visibleActivitySessionIds(base)]).toEqual(["a", "b"]);
  });
  it("includes another visible surface but never mistakes a browser surface for a task", () => {
    expect([
      ...visibleActivitySessionIds({
        ...base,
        visibleSurfaceIds: ["tab1", "tab2", "browser:1"],
      }),
    ]).toEqual(["a", "b", "c"]);
  });
  it("keeps covered tasks unread on Home, Settings or full browser", () => {
    expect(
      visibleActivitySessionIds({ ...base, workspaceVisible: false }).size,
    ).toBe(0);
    expect(
      visibleActivitySessionIds({ ...base, visibleSurfaceIds: ["browser:1"] })
        .size,
    ).toBe(0);
  });
  it("excludes floating placeholders and editor/terminal leaves", () => {
    expect([
      ...visibleActivitySessionIds({
        ...base,
        floatingSessionIds: ["a"],
        sessionIds: new Set(["a"]),
      }),
    ]).toEqual([]);
  });
});

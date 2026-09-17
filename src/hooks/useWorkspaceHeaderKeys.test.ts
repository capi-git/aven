import { expect, it } from "vitest";
import { reconcileWorkspaceHeaders } from "./useWorkspaceHeaderKeys";
import { leaf } from "../lib/layout";
import {
  collapseWorkspaceView,
  moveWorkspaceTab,
  resolveWorkspaceView,
} from "../lib/workspaceViews";

it("preserves each strip across selected-tab changes, reorder, additions and close", () => {
  const first = reconcileWorkspaceHeaders(
    { sequence: 0, entries: [] },
    { a: ["a", "b"], c: ["c"] },
  );
  const next = reconcileWorkspaceHeaders(first.state, {
    b: ["b", "new", "a"],
    c: ["c"],
  });
  expect(next.keys.b).toBe(first.keys.a);
  expect(next.keys.c).toBe(first.keys.c);
  expect(
    reconcileWorkspaceHeaders(next.state, { a: ["new", "a"], c: ["c"] }).keys.a,
  ).toBe(first.keys.a);
});

it("retains the destination strip when a sole tab joins it, with unique split keys", () => {
  const first = reconcileWorkspaceHeaders(
    { sequence: 0, entries: [] },
    { a: ["a"], b: ["b", "c"] },
  );
  const merged = reconcileWorkspaceHeaders(first.state, { b: ["b", "c", "a"] });
  expect(merged.keys.b).toBe(first.keys.b);
  const split = reconcileWorkspaceHeaders(merged.state, {
    b: ["b", "c"],
    a: ["a"],
  });
  expect(split.keys.b).toBe(first.keys.b);
  expect(split.keys.a).not.toBe(split.keys.b);
});

it("keeps both pane headers when an active tab moves from a two-tab pane into a singleton pane", () => {
  const view = resolveWorkspaceView(
    {
      layout: {
        type: "split",
        id: "columns",
        dir: "right",
        children: [leaf("a"), leaf("c")],
        sizes: [0.5, 0.5],
      },
      focusedId: "a",
      order: ["a", "b", "c"],
      groups: { a: ["a", "b"], c: ["c"] },
    },
    ["a", "b", "c"],
    "a",
  );
  const first = reconcileWorkspaceHeaders(
    { sequence: 0, entries: [] },
    view.groups,
  );
  const moved = moveWorkspaceTab(view, "a", "c");
  expect(Object.keys(moved.groups)).toEqual(["c", "b"]);
  const next = reconcileWorkspaceHeaders(first.state, moved.groups);
  expect(next.keys.c).toBe(first.keys.c);
  expect(next.keys.b).toBe(first.keys.a);
  expect(next.state.sequence).toBe(first.state.sequence);
});

it("keeps the selected pane's header when collapsing larger neighboring groups into it", () => {
  const view = resolveWorkspaceView(
    {
      layout: {
        type: "split",
        id: "columns",
        dir: "right",
        children: [leaf("a"), leaf("c")],
        sizes: [0.4, 0.6],
      },
      focusedId: "a",
      order: ["a", "c", "d", "e"],
      groups: { a: ["a"], c: ["c", "d", "e"] },
    },
    ["a", "c", "d", "e"],
    "a",
  );
  const first = reconcileWorkspaceHeaders(
    { sequence: 0, entries: [] },
    view.groups,
  );
  const collapsed = collapseWorkspaceView(view, "a");
  const next = reconcileWorkspaceHeaders(first.state, collapsed.groups);
  expect(next.keys.a).toBe(first.keys.a);
  expect(next.state.sequence).toBe(first.state.sequence);
});

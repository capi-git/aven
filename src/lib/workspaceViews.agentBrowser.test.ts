import { describe, expect, it } from "vitest";
import { leaf, leafIds } from "./layout";
import {
  minimizeWorkspaceSide,
  placeAgentBrowserView,
  resolveWorkspaceView,
  restoreWorkspaceSplit,
  type WorkspaceView,
} from "./workspaceViews";

function fixture(focus = "chat-a"): WorkspaceView {
  const order = ["chat-a", "chat-b", "page-a", "page-b", "new"];
  return resolveWorkspaceView(
    {
      layout: {
        type: "split",
        id: "columns",
        dir: "right",
        children: [leaf("chat-a"), leaf("chat-b"), leaf("page-a")],
        sizes: [0.3, 0.3, 0.4],
      },
      order,
      focusedId: focus,
      groups: {
        "chat-a": ["chat-a", "new"],
        "chat-b": ["chat-b"],
        "page-a": ["page-a", "page-b"],
      },
    },
    order,
    focus,
  );
}
const browsers = ["page-a", "page-b", "new"];

describe("agent browser placement", () => {
  it("uses the existing browser group rather than another agent's nearer pane", () => {
    const next = placeAgentBrowserView(fixture(), "new", browsers, "chat-a");
    expect(leafIds(next.layout!)).toEqual(["chat-a", "chat-b", "new"]);
    expect(next.groups.new).toEqual(["page-a", "page-b", "new"]);
    expect(next.focusedId).toBe("chat-a");
    expect(next.layout?.type === "split" && next.layout.sizes).toEqual([
      0.3, 0.3, 0.4,
    ]);
    const again = placeAgentBrowserView(next, "new", browsers, "chat-a");
    expect(again).toEqual(next);
  });
  it("keeps another chat selected while its neighbor prepares a browser tab", () => {
    const before = fixture("chat-b");
    const next = placeAgentBrowserView(before, "new", browsers, "chat-a");
    expect(next.layout).toEqual(before.layout);
    expect(next.focusedId).toBe("chat-b");
    expect(next.groups["page-a"]).toEqual(["page-a", "page-b", "new"]);
  });
  it("does not replace the page the user is typing into", () => {
    const before = fixture("page-a");
    const next = placeAgentBrowserView(before, "page-b", browsers, "chat-a");
    expect(next).toBe(before);
  });
  it("creates one right-hand split only when no other pane exists", () => {
    const before = resolveWorkspaceView(
      undefined,
      ["chat-a", "page-a"],
      "chat-a",
    );
    const next = placeAgentBrowserView(before, "page-a", ["page-a"], "chat-a");
    expect(leafIds(next.layout!)).toEqual(["chat-a", "page-a"]);
    expect(next.focusedId).toBe("chat-a");
    expect(placeAgentBrowserView(next, "page-a", ["page-a"], "chat-a")).toEqual(
      next,
    );
  });
  it("reuses an existing split when it has no browser tabs yet", () => {
    const before = fixture();
    const next = placeAgentBrowserView(before, "new", ["new"], "chat-a");
    expect(leafIds(next.layout!)).toHaveLength(3);
    expect(next.focusedId).toBe("chat-a");
  });
  it("adds to a minimized browser group without opening it or losing restore membership", () => {
    const before = minimizeWorkspaceSide(fixture(), "columns", 1, "after");
    const next = placeAgentBrowserView(before, "new", browsers, "chat-a");
    expect(next.layout).toEqual(before.layout);
    expect(next.focusedId).toBe(before.focusedId);
    expect(next.hiddenGroups?.["page-a"]).toEqual(["page-a", "page-b", "new"]);
    const restored = restoreWorkspaceSplit(next);
    expect(leafIds(restored.layout!)).toEqual(["chat-a", "chat-b", "page-a"]);
    expect(restored.groups["page-a"]).toEqual(["page-a", "page-b", "new"]);
    expect(new Set(Object.values(restored.groups).flat()).size).toBe(
      restored.order.length,
    );
  });
});

import { describe, expect, it } from "vitest";
import { newTab } from "./layout";
import { resolveWorkspaceView } from "./workspaceViews";
import type { DetachedWorkspaceState } from "./detachedWorkspaces";
import { withNewDetachedCloses } from "./detachedWorkspaceClose";

const tab = { ...newTab("session"), id: "tab" };
const browser = {
  id: "browser",
  tabId: "page",
  url: "https://example.test",
};
const open: DetachedWorkspaceState = {
  cwd: "/project",
  title: "Window",
  tabs: [tab],
  browsers: [browser],
  sessions: [],
  view: resolveWorkspaceView(undefined, [tab.id, browser.id], tab.id),
};
const closed: DetachedWorkspaceState = {
  ...open,
  tabs: [],
  browsers: [],
  closedSurfaceIds: [tab.id, browser.id],
};

describe("detached close transitions", () => {
  it("forwards a first close and filters later checkpoints and return snapshots", () => {
    expect(withNewDetachedCloses(open, closed)).toBe(closed);
    expect(withNewDetachedCloses(closed, closed).closedSurfaceIds).toEqual([]);
    expect(closed.closedSurfaceIds).toEqual([tab.id, browser.id]);
  });

  it("does not close a live surface that was restored into the same window", () => {
    const restored = { ...open, closedSurfaceIds: closed.closedSurfaceIds };
    expect(withNewDetachedCloses(closed, restored).closedSurfaceIds).toEqual(
      [],
    );
    // Once restored, a subsequent close is a new transition even though the
    // window's cumulative native snapshot still contains the original close.
    expect(withNewDetachedCloses(restored, closed).closedSurfaceIds).toEqual([
      tab.id,
      browser.id,
    ]);
  });

  it("only forwards newly closed members while another tab remains live", () => {
    const firstClose = {
      ...open,
      browsers: [],
      closedSurfaceIds: [browser.id],
    };
    expect(withNewDetachedCloses(firstClose, closed).closedSurfaceIds).toEqual([
      tab.id,
    ]);
    expect(withNewDetachedCloses(firstClose, firstClose).tabs).toEqual([tab]);
  });

  it("keeps an initial return intact and does not fabricate empty close metadata", () => {
    expect(withNewDetachedCloses(undefined, closed)).toBe(closed);
    expect(withNewDetachedCloses(undefined, open)).toBe(open);
  });
});

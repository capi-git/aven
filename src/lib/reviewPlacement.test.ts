import { describe, expect, it } from "vitest";
import { leaf, leafIds, newTab, type LayoutNode } from "./layout";
import {
  newSessionChangesWorkspaceTab,
  paneWidths,
  reviewPaneFor,
  sessionChangesTabFor,
  showInPane,
} from "./reviewPlacement";
import { resolveWorkspaceView, type WorkspaceView } from "./workspaceViews";

const split = (
  dir: "right" | "down",
  children: LayoutNode[],
  sizes: number[],
): LayoutNode => ({ type: "split", id: `${dir}-split`, dir, children, sizes });

/** A chat's tab beside the live preview, as the dev preview opens it. */
function chatBesidePreview(): WorkspaceView {
  return {
    layout: split("right", [leaf("chat-tab"), leaf("preview")], [0.55, 0.45]),
    focusedId: "chat-tab",
    order: ["chat-tab", "preview"],
    groups: { "chat-tab": ["chat-tab"], preview: ["preview"] },
  };
}

const chats = new Set(["chat-tab", "other-chat-tab"]);
const isChat = (id: string) => chats.has(id);

describe("where a chat's review opens", () => {
  it("measures each pane's share of the width", () => {
    const widths = paneWidths(
      split(
        "right",
        [
          leaf("a"),
          split("down", [leaf("b"), leaf("c")], [0.5, 0.5]),
          leaf("d"),
        ],
        [0.25, 0.5, 0.25],
      ),
    );
    expect(Object.fromEntries(widths)).toEqual({
      a: 0.25,
      b: 0.5,
      c: 0.5,
      d: 0.25,
    });
  });

  it("joins the preview's tab group instead of a third column", () => {
    const view = chatBesidePreview();
    const pane = reviewPaneFor(view, "chat-tab", isChat);
    expect(pane).toBe("preview");
    // The new tab first lands in the focused pane, as any new tab does.
    const added = resolveWorkspaceView(
      view,
      ["chat-tab", "preview", "review"],
      "chat-tab",
    );
    const shown = showInPane(added, "review", pane!);
    expect(leafIds(shown.layout!)).toEqual(["chat-tab", "review"]);
    expect(shown.groups).toEqual({
      "chat-tab": ["chat-tab"],
      review: ["preview", "review"],
    });
    expect(shown.focusedId).toBe("review");
    // The split keeps its sizes: the chat column does not get narrower.
    expect(shown.layout).toMatchObject({ sizes: [0.55, 0.45] });
  });

  it("picks the widest pane that isn't a chat", () => {
    const view: WorkspaceView = {
      layout: split(
        "right",
        [leaf("chat-tab"), leaf("other-chat-tab"), leaf("board"), leaf("web")],
        [0.2, 0.4, 0.15, 0.25],
      ),
      focusedId: "chat-tab",
      order: ["chat-tab", "other-chat-tab", "board", "web"],
      groups: {
        "chat-tab": ["chat-tab"],
        "other-chat-tab": ["other-chat-tab"],
        board: ["board"],
        web: ["web"],
      },
    };
    expect(reviewPaneFor(view, "chat-tab", isChat)).toBe("web");
  });

  it("leaves a chat alone on screen to split as before", () => {
    const alone: WorkspaceView = {
      layout: leaf("chat-tab"),
      focusedId: "chat-tab",
      order: ["chat-tab", "preview"],
      groups: { "chat-tab": ["chat-tab", "preview"] },
    };
    expect(reviewPaneFor(alone, "chat-tab", isChat)).toBeUndefined();
    const twoChats: WorkspaceView = {
      layout: split(
        "right",
        [leaf("chat-tab"), leaf("other-chat-tab")],
        [1, 1],
      ),
      focusedId: "chat-tab",
      order: ["chat-tab", "other-chat-tab"],
      groups: {
        "chat-tab": ["chat-tab"],
        "other-chat-tab": ["other-chat-tab"],
      },
    };
    expect(reviewPaneFor(twoChats, "chat-tab", isChat)).toBeUndefined();
  });

  it("brings an open review forward where it is", () => {
    const view: WorkspaceView = {
      layout: split("right", [leaf("chat-tab"), leaf("preview")], [0.5, 0.5]),
      focusedId: "chat-tab",
      order: ["chat-tab", "preview", "review"],
      groups: { "chat-tab": ["chat-tab"], preview: ["preview", "review"] },
    };
    const shown = showInPane(view, "review", "preview");
    expect(leafIds(shown.layout!)).toEqual(["chat-tab", "review"]);
    expect(shown.groups.review).toEqual(["preview", "review"]);
  });

  it("finds the tab already holding a chat's review", () => {
    const review = newSessionChangesWorkspaceTab("/repo", "chat-1", "/repo/a");
    const tabs = [newTab("chat-1"), review];
    expect(review.editorPanes[0].files[0]).toMatchObject({
      path: "/repo/a",
      sessionChanges: { sessionId: "chat-1" },
    });
    expect(sessionChangesTabFor(tabs, "/repo", "chat-1")).toBe(review);
    expect(sessionChangesTabFor(tabs, "/repo", "chat-2")).toBeUndefined();
  });
});

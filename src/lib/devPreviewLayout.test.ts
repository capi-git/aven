import { describe, expect, it } from "vitest";
import { leaf, leafIds } from "./layout";
import { placeDevPreview } from "./devPreviewLayout";
import { resolveWorkspaceView, type WorkspaceView } from "./workspaceViews";

function columns(focus = "chat"): WorkspaceView {
  const order = ["chat", "docs", "preview"];
  return resolveWorkspaceView(
    {
      layout: {
        type: "split",
        id: "columns",
        dir: "right",
        children: [leaf("chat"), leaf("docs")],
        sizes: [0.55, 0.45],
      },
      order,
      focusedId: focus,
      groups: { chat: ["chat"], docs: ["docs", "preview"] },
    },
    order,
    focus,
  );
}

const pages = ["docs", "preview"];

describe("placeDevPreview", () => {
  it("splits a lone chat and keeps typing focus in it", () => {
    const before = resolveWorkspaceView(undefined, ["chat", "preview"], "chat");
    for (const automatic of [true, false]) {
      const next = placeDevPreview(
        before,
        "preview",
        ["preview"],
        "chat",
        automatic,
      );
      expect(leafIds(next.layout!)).toEqual(["chat", "preview"]);
      expect(next.focusedId).toBe("chat");
    }
  });

  it("brings a clicked preview to the front of the browser pane", () => {
    const next = placeDevPreview(columns(), "preview", pages, "chat", false);
    expect(leafIds(next.layout!)).toEqual(["chat", "preview"]);
    expect(next.focusedId).toBe("chat");
  });

  it("never covers the page the user is reading when opened automatically", () => {
    const before = columns("docs");
    const next = placeDevPreview(before, "preview", pages, "chat", true);
    expect(leafIds(next.layout!)).toEqual(["chat", "docs"]);
    expect(next.focusedId).toBe("docs");
  });

  it("moves focus with a clicked preview that replaces the focused page", () => {
    const next = placeDevPreview(
      columns("docs"),
      "preview",
      pages,
      "chat",
      false,
    );
    expect(leafIds(next.layout!)).toEqual(["chat", "preview"]);
    expect(next.focusedId).toBe("preview");
  });
});

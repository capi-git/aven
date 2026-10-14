// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import {
  decodeSidebarValue,
  encodeSidebarValue,
  overlayLabel,
  overlayOwner,
  paneDropAt,
} from "./floatingSidebar";

describe("floating sidebar bridge", () => {
  it("drops a React click event instead of walking the whole window", () => {
    // What a button passes to a handler given straight to `onClick`.
    const click = {
      type: "click",
      nativeEvent: new MouseEvent("click"),
      view: window,
      target: document.body,
      isDefaultPrevented: () => false,
    };
    const started = performance.now();
    expect(encodeSidebarValue([click])).toEqual([null]);
    expect(encodeSidebarValue({ view: window })).toEqual({});
    expect(performance.now() - started).toBeLessThan(250);
  });

  it("cuts reference cycles but keeps values shared by two branches", () => {
    const shared = { id: "s" };
    const looped: Record<string, unknown> = { id: "loop" };
    looped.self = looped;
    expect(encodeSidebarValue({ a: shared, b: [shared], looped })).toEqual({
      a: { id: "s" },
      b: [{ id: "s" }],
      looped: { id: "loop" },
    });
  });

  it("round-trips the sidebar's structured data and drops callbacks", () => {
    const props = {
      busySessionIds: new Set(["a", "b"]),
      profilePreviews: { work: { name: "Work" } },
      agentsByLead: new Map([["lead", [{ id: "w1", status: "running" }]]]),
      sessions: [{ id: "a", title: "Chat", updatedAt: 3 }],
      onSelectSession: () => {},
      nothing: undefined,
    };
    const decoded = decodeSidebarValue(
      JSON.parse(JSON.stringify(encodeSidebarValue(props))),
    ) as Record<string, unknown>;
    expect(decoded.busySessionIds).toEqual(new Set(["a", "b"]));
    expect(decoded.agentsByLead).toEqual(
      new Map([["lead", [{ id: "w1", status: "running" }]]]),
    );
    expect(decoded.profilePreviews).toEqual({ work: { name: "Work" } });
    expect(decoded.sessions).toEqual([
      { id: "a", title: "Chat", updatedAt: 3 },
    ]);
    expect("onSelectSession" in decoded).toBe(false);
    expect("nothing" in decoded).toBe(false);
  });

  it("never sends DOM nodes or events as callback arguments", () => {
    const anchor = document.createElement("button");
    expect(encodeSidebarValue([anchor, "id"])).toEqual([null, "id"]);
    expect(encodeSidebarValue([new Event("click")])).toEqual([null]);
  });

  it("names overlays after their workspace only", () => {
    expect(overlayLabel("main")).toBe("floating-sidebar-main");
    expect(overlayOwner("floating-sidebar-window-2")).toBe("window-2");
    expect(overlayOwner("floating-sidebar-")).toBeNull();
    expect(overlayOwner("main")).toBeNull();
  });

  it("finds the innermost pane and the edge nearest the pointer", () => {
    const panes = [
      { id: "outer", rect: { x: 0, y: 0, width: 1000, height: 800 } },
      { id: "left", rect: { x: 0, y: 0, width: 500, height: 800 } },
      { id: "right", rect: { x: 500, y: 0, width: 500, height: 800 } },
    ];
    expect(paneDropAt(panes, 50, 400)).toEqual({ id: "left", edge: "left" });
    expect(paneDropAt(panes, 960, 400)).toEqual({ id: "right", edge: "right" });
    expect(paneDropAt(panes, 750, 20)).toEqual({ id: "right", edge: "top" });
    expect(paneDropAt(panes, 1200, 400)).toBeNull();
  });
});

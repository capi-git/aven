import { describe, expect, it } from "vitest";
import { railJoins, sashBetweenRails } from "./WorkspaceStage";

const rail = (id: string, x: number, w: number) => ({
  id,
  rect: { x, y: 0, w, h: 1 },
});

describe("closed panes side by side", () => {
  it("join where two rails meet, and nowhere else", () => {
    const joins = railJoins([rail("a", 0, 0.05), rail("b", 0.05, 0.05)]);
    expect(joins.get("a")).toEqual({ right: true });
    expect(joins.get("b")).toEqual({ left: true });
    // A rail beside an open pane keeps its gap and its round corners.
    expect(railJoins([rail("a", 0, 0.05)]).size).toBe(0);
  });

  it("drop the divider between two rails, keep it beside an open pane", () => {
    const rails = [rail("a", 0, 0.05), rail("b", 0.05, 0.05)];
    const group = { x: 0, y: 0, w: 1, h: 1 };
    expect(sashBetweenRails({ dir: "right", at: 0.05, group }, rails)).toBe(
      true,
    );
    expect(sashBetweenRails({ dir: "right", at: 0.1, group }, rails)).toBe(
      false,
    );
  });
});

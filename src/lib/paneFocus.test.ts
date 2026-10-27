// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vitest";
import { focusPaneContent, workspacePane } from "./paneFocus";

afterEach(() => {
  document.body.replaceChildren();
});

describe("handing the keyboard to a pane", () => {
  it("prefers the message box to an earlier button, such as Approve", () => {
    document.body.innerHTML = `
      <div data-workspace-stage>
        <div data-workspace-surface="chat" data-focused="true">
          <button id="approve">Approve</button>
          <div data-composer><textarea id="box"></textarea></div>
        </div>
      </div>`;
    expect(focusPaneContent(workspacePane())).toBe(true);
    expect(document.activeElement?.id).toBe("box");
  });

  it("falls back to another field, then the first control, skipping hidden parts", () => {
    document.body.innerHTML = `
      <div data-workspace-stage>
        <div data-workspace-surface="page">
          <div hidden><input id="hidden-field" /></div>
          <button id="back">Back</button>
          <input id="address" />
        </div>
        <div data-workspace-surface="board"><button id="card">Card</button></div>
      </div>`;
    expect(focusPaneContent(workspacePane("page"))).toBe(true);
    expect(document.activeElement?.id).toBe("address");
    expect(focusPaneContent(workspacePane("board"))).toBe(true);
    expect(document.activeElement?.id).toBe("card");
    expect(focusPaneContent(workspacePane("missing"))).toBe(false);
  });
});

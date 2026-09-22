// @vitest-environment happy-dom
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { afterEach, describe, expect, it } from "vitest";
import { indentFocusedEditor } from "./editorShortcuts";

let view: EditorView | undefined;
afterEach(() => {
  view?.destroy();
  view = undefined;
  document.body.replaceChildren();
});

describe("native editor indentation", () => {
  it("indents and outdents the focused editor without tab navigation", () => {
    view = new EditorView({
      state: EditorState.create({ doc: "const value = 1;" }),
      parent: document.body,
    });
    view.focus();
    expect(indentFocusedEditor("more")).toBe(true);
    expect(view.state.doc.toString()).toBe("  const value = 1;");
    expect(indentFocusedEditor("less")).toBe(true);
    expect(view.state.doc.toString()).toBe("const value = 1;");
  });
  it("does not target a background editor or steal ordinary navigation", () => {
    view = new EditorView({
      state: EditorState.create({ doc: "value" }),
      parent: document.body,
    });
    const input = document.createElement("input");
    document.body.append(input);
    input.focus();
    expect(indentFocusedEditor("more")).toBe(false);
    view.focus();
    view.dom.hidden = true;
    expect(indentFocusedEditor("more")).toBe(false);
    expect(view.state.doc.toString()).toBe("value");
  });
});

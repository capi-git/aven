import { indentLess, indentMore } from "@codemirror/commands";
import { EditorView } from "@codemirror/view";

/** Native menu accelerators must retain editor meaning when it owns focus. */
export function indentFocusedEditor(direction: "more" | "less"): boolean {
  const active = document.activeElement;
  const editor =
    active instanceof Element
      ? active.closest<HTMLElement>(".cm-editor")
      : null;
  if (
    !editor ||
    editor.closest(
      '[hidden], [inert], [aria-hidden="true"], .hidden, .invisible',
    )
  )
    return false;
  for (let node: HTMLElement | null = editor; node; node = node.parentElement) {
    const style = getComputedStyle(node);
    if (style.display === "none" || style.visibility === "hidden") return false;
  }
  const view = EditorView.findFromDOM(editor);
  if (!view) return false;
  (direction === "more" ? indentMore : indentLess)(view);
  // A read-only editor still owns the shortcut; never navigate its tab instead.
  return true;
}

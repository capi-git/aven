/**
 * App-level editor shortcuts without a static CodeMirror dependency.
 * Only FileEditor creates editors, and it registers the real commands when
 * its module loads, so before then there is no editor to act on.
 */
export type EditorCommands = {
  handleFindKey: (event: KeyboardEvent) => boolean;
  openFind: () => boolean;
  indent: (direction: "more" | "less") => boolean;
};

let commands: EditorCommands | null = null;

export function registerEditorCommands(next: EditorCommands): void {
  commands = next;
}

export function handleEditorFindKey(event: KeyboardEvent): boolean {
  return commands?.handleFindKey(event) ?? false;
}

export function openFindInActiveEditor(): boolean {
  return commands?.openFind() ?? false;
}

export function indentFocusedEditor(direction: "more" | "less"): boolean {
  return commands?.indent(direction) ?? false;
}

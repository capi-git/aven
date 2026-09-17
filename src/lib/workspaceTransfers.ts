import type { ComposerDraft } from "./composerDrafts";

export type EditorTransferDraft = {
  text: string;
  baseline: string;
  updatedAt: number;
};
const editors = new Map<string, EditorTransferDraft>();
const editorOwners = new Map<string, number>();
/** A view unmount can be a transfer. Only clean contents are released here. */
export function retainEditorDraft(path: string) {
  editorOwners.set(path, (editorOwners.get(path) ?? 0) + 1);
  return () => {
    const count = Math.max(0, (editorOwners.get(path) ?? 1) - 1);
    if (count) editorOwners.set(path, count);
    else {
      editorOwners.delete(path);
      const draft = editors.get(path);
      if (draft?.text === draft?.baseline) editors.delete(path);
    }
  };
}
/** Called only after all close confirmations succeed. Other mounted owners
 * retain their text; transfer/unmount alone never discards an unsaved draft. */
export function discardEditorDrafts(files: readonly { path: string }[]) {
  const counts = new Map<string, number>();
  for (const file of files) counts.set(file.path, (counts.get(file.path) ?? 0) + 1);
  for (const [path, count] of counts) {
    if ((editorOwners.get(path) ?? 0) <= count) editors.delete(path);
  }
}
export function releaseTerminalScreen(id: string) { terminalScreens.delete(id); }
const editorListeners = new Set<() => void>();
const retainedBrowsers = new Set<string>();
const retainedTerminals = new Set<string>();
const terminalScreens = new Map<string, string>();
export const isDetachedWorkspace = () =>
  new URLSearchParams(location.search).has("workspaceWindow");
export function retainTransferredBrowser(id: string, retained = true) {
  if (retained) retainedBrowsers.add(id);
  else retainedBrowsers.delete(id);
}
export function browserIsTransferred(id: string) {
  return retainedBrowsers.has(id) || isDetachedWorkspace();
}
export function retainTransferredTerminal(id: string, retained = true) {
  if (retained) retainedTerminals.add(id);
  else retainedTerminals.delete(id);
}
export function terminalIsTransferred(id: string) {
  return retainedTerminals.has(id) || isDetachedWorkspace();
}
export function rememberTerminalScreen(id: string, text: string) {
  terminalScreens.set(id, text.slice(-256_000));
}
export function captureTerminalScreens(ids: string[]) {
  window.dispatchEvent(new Event("workspace-transfer-capture"));
  return Object.fromEntries(
    ids.flatMap((id) =>
      terminalScreens.has(id) ? [[id, terminalScreens.get(id)!]] : [],
    ),
  );
}
export function restoreTerminalScreens(screens: Record<string, string> = {}) {
  for (const [id, value] of Object.entries(screens))
    terminalScreens.set(id, value);
}
export function readTerminalScreen(id: string) {
  return terminalScreens.get(id);
}
export function recordEditorDraft(
  path: string,
  text: string,
  baseline: string,
) {
  const previous = editors.get(path);
  if (previous?.text === text && previous.baseline === baseline) return;
  editors.set(path, { text, baseline, updatedAt: Date.now() });
  editorListeners.forEach((fn) => fn());
}
export function readEditorDraft(path: string) {
  return editors.get(path);
}
export function captureEditorDrafts(
  paths?: Set<string>,
): Record<string, EditorTransferDraft> {
  return Object.fromEntries(
    [...editors].filter(([path]) => !paths || paths.has(path)),
  );
}
export function restoreEditorDrafts(
  drafts: Record<string, EditorTransferDraft> = {},
) {
  for (const [path, draft] of Object.entries(drafts)) {
    if (typeof draft?.text !== "string" || typeof draft.baseline !== "string")
      continue;
    if ((editors.get(path)?.updatedAt ?? -1) <= draft.updatedAt)
      editors.set(path, draft);
  }
}
export function subscribeEditorDrafts(fn: () => void) {
  editorListeners.add(fn);
  return () => {
    editorListeners.delete(fn);
  };
}
export type DetachedDrafts = Record<string, ComposerDraft>;

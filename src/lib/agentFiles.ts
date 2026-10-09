import {
  leafIds,
  newFileTab,
  openEditorTab,
  type WorkspaceTab,
} from "./layout";

/** Agent output belongs beside its requesting task, not whichever tab is active. */
export function openAgentFileInTabs(
  tabs: WorkspaceTab[],
  sessionId: string,
  cwd: string,
  path: string,
  detached: ReadonlySet<string>,
): { tabs: WorkspaceTab[]; tabId: string } {
  const target = tabs.find(
    (tab) =>
      !detached.has(tab.id) &&
      (leafIds(tab.layout).includes(sessionId) ||
        tab.editorPanes.some((pane) =>
          pane.files.some((file) => file.agent?.sessionId === sessionId),
        )),
  );
  if (!target)
    throw new Error(
      "The requesting task's editor is no longer available. Reopen the task and try again.",
    );
  const opened = {
    ...openEditorTab(target, newFileTab(path, cwd)),
    focusedId: target.focusedId,
    diffFocused: target.diffFocused,
  };
  // An agent can add a file while the user edits another file or chats with a
  // sibling agent. Preserve those panes' selected documents as well as focus.
  if (target.focusedId !== sessionId) {
    opened.editorPanes = opened.editorPanes.map((pane) => {
      const previous = target.editorPanes.find((entry) => entry.id === pane.id);
      return previous ? { ...pane, activeFileId: previous.activeFileId } : pane;
    });
  }
  return {
    tabId: target.id,
    tabs: tabs.map((tab) => (tab === target ? opened : tab)),
  };
}

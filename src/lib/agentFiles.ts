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
  const opened = openEditorTab(target, newFileTab(path, cwd));
  return {
    tabId: target.id,
    tabs: tabs.map((tab) => (tab === target ? opened : tab)),
  };
}

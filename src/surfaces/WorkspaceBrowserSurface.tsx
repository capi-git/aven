import { memo, useCallback, type RefObject } from "react";
import { RetainedBrowserPane } from "./RetainedBrowserPane";
import type { Attachment } from "../lib/session";

export type BrowserSurfaceActions = {
  focus(project: string, id: string): void;
  close(project: string, id: string): void;
  expand(id: string): void;
  update(
    project: string,
    tabId: string,
    patch: { url?: string; title?: string; favicon?: string },
  ): void;
  addToChat(text: string, attachments?: Attachment[]): void;
  openTab(project: string, id: string, url: string, background: boolean): void;
};

/** Keep unrelated agent updates out of both visible and retained native pages. */
export const WorkspaceBrowserSurface = memo(function WorkspaceBrowserSurface({
  id,
  project,
  tabId,
  url,
  attachedNativeId,
  visible,
  agentRequested,
  expanded,
  actions,
}: {
  id: string;
  project: string;
  tabId: string;
  url: string;
  attachedNativeId?: string;
  visible: boolean;
  agentRequested?: boolean;
  expanded: boolean;
  actions: RefObject<BrowserSurfaceActions>;
}) {
  const onFocus = useCallback(
    () => actions.current.focus(project, id),
    [actions, project, id],
  );
  const onClose = useCallback(
    () => actions.current.close(project, id),
    [actions, project, id],
  );
  const onToggleExpand = useCallback(
    () => actions.current.expand(id),
    [actions, id],
  );
  const onUrlChange = useCallback(
    (url: string) => actions.current.update(project, tabId, { url }),
    [actions, project, tabId],
  );
  const onTitleChange = useCallback(
    (title: string) => actions.current.update(project, tabId, { title }),
    [actions, project, tabId],
  );
  const onFaviconChange = useCallback(
    (favicon: string) => actions.current.update(project, tabId, { favicon }),
    [actions, project, tabId],
  );
  const onOpenTab = useCallback(
    (url: string, background: boolean) =>
      actions.current.openTab(project, id, url, background),
    [actions, project, id],
  );
  const onAddToChat = useCallback(
    (text: string, attachments?: Attachment[]) =>
      attachments
        ? actions.current.addToChat(text, attachments)
        : actions.current.addToChat(text),
    [actions],
  );
  return (
    <RetainedBrowserPane
      id={id}
      initialUrl={url}
      attachedNativeId={attachedNativeId}
      visible={visible}
      agentRequested={agentRequested}
      expanded={expanded}
      onFocus={onFocus}
      onClose={onClose}
      onToggleExpand={onToggleExpand}
      onUrlChange={onUrlChange}
      onTitleChange={onTitleChange}
      onFaviconChange={onFaviconChange}
      onOpenTab={onOpenTab}
      onAddToChat={onAddToChat}
    />
  );
});

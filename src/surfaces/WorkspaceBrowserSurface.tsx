import { memo, useCallback, type RefObject } from "react";
import { RetainedBrowserPane } from "./RetainedBrowserPane";
import type { Attachment } from "../lib/session";

export type BrowserSurfaceActions = {
  pictureInPictureResult?(
    id: string,
    request: number,
    label: string | null,
    error?: string,
  ): void;
  focus(project: string, id: string): void;
  close(project: string, id: string): void;
  expand(id: string): void;
  returnToWorkspace?(project: string, id: string, tabId: string): void;
  update(
    project: string,
    tabId: string,
    patch: { url?: string; title?: string; favicon?: string },
  ): void;
  addToChat(text: string, attachments?: Attachment[]): void;
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
  pictureInPictureRequest,
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
  pictureInPictureRequest?: number;
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
  const onAddToChat = useCallback(
    (text: string, attachments?: Attachment[]) =>
      attachments
        ? actions.current.addToChat(text, attachments)
        : actions.current.addToChat(text),
    [actions],
  );
  const onPictureInPictureChange = useCallback(
    (floating: boolean) => {
      if (!floating) actions.current.returnToWorkspace?.(project, id, tabId);
    },
    [actions, project, id, tabId],
  );
  const onPictureInPictureResult = useCallback(
    (request: number, label: string | null, error?: string) =>
      actions.current.pictureInPictureResult?.(id, request, label, error),
    [actions, id],
  );
  return (
    <RetainedBrowserPane
      id={id}
      initialUrl={url}
      attachedNativeId={attachedNativeId}
      visible={visible}
      agentRequested={agentRequested}
      expanded={expanded}
      pictureInPictureRequest={pictureInPictureRequest}
      onPictureInPictureChange={onPictureInPictureChange}
      onPictureInPictureResult={onPictureInPictureResult}
      onFocus={onFocus}
      onClose={onClose}
      onToggleExpand={onToggleExpand}
      onUrlChange={onUrlChange}
      onTitleChange={onTitleChange}
      onFaviconChange={onFaviconChange}
      onAddToChat={onAddToChat}
    />
  );
});

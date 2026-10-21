import { attachmentsFromPaths } from "./attachments";
import { isImagePath } from "./filePreview";
import { leafIds, siblingLeafId, type WorkspaceTab } from "./layout";
import { requestAddFileToChat, requestAddToChat } from "./quoteDraft";
import { harnessSupportsAttachments, type Session } from "./session";

export type FileChatTarget = { tabId: string; session: Session };

/**
 * The chat "Add to chat" on a file tab fills: a chat beside the file in its
 * own tab (the focused one, else its neighbour, else the first), else the
 * active tab's chat, else the first chat in any tab.
 */
export function fileChatTarget(
  tabs: readonly WorkspaceTab[],
  paneId: string,
  sessions: readonly Session[],
  activeTabId?: string,
): FileChatTarget | undefined {
  const byId = new Map(
    sessions
      .filter((session) => !session.inboxAsk)
      .map((session) => [session.id, session]),
  );
  const chatIn = (tab: WorkspaceTab): Session | undefined => {
    const ids = leafIds(tab.layout).filter((id) => byId.has(id));
    if (ids.length === 0) return undefined;
    const sibling = siblingLeafId(tab.layout, paneId);
    const id = ids.includes(tab.focusedId)
      ? tab.focusedId
      : sibling && ids.includes(sibling)
        ? sibling
        : ids[0]!;
    return byId.get(id);
  };
  const own = tabs.find((tab) => leafIds(tab.layout).includes(paneId));
  const active = tabs.find((tab) => tab.id === activeTabId);
  for (const tab of [own, active, ...tabs]) {
    if (!tab) continue;
    const session = chatIn(tab);
    if (session) return { tabId: tab.id, session };
  }
  return undefined;
}

/**
 * Put the file at `path` in a chat's message box: an image as an attachment,
 * as a pasted one would be, where the chat's agent takes attachments; any
 * other file as an `@` mention.
 */
export async function addFileToChat(
  path: string,
  session: Pick<Session, "id" | "harness">,
): Promise<void> {
  if (isImagePath(path) && harnessSupportsAttachments(session.harness)) {
    const attachments = await attachmentsFromPaths([path]).catch(() => []);
    if (attachments.length > 0) {
      requestAddToChat("", "plain", attachments, session.id);
      return;
    }
  }
  requestAddFileToChat(path, session.id);
}

/** What a chat is called until it has a title of its own. */
export const UNTITLED_CHAT_TITLE = "New chat";

/**
 * Whether `title` is the untitled placeholder. Older chats, and some providers
 * for a fresh chat, still say "New session", which reads the same.
 */
export function isUntitledChatTitle(title: string): boolean {
  return title === UNTITLED_CHAT_TITLE || title === "New session";
}

import { projectKey } from "./paths";
import { clearProjectLogo } from "./projectLogos";
import { clearProjectChatBackground } from "./chatBackground";
import { clearProjectChatBackgroundSetting } from "./projectChatBackground";
import { normalizeProjectPath } from "./recents";
import { listProjectSessionIds } from "./sessionStore";
import { clearTabGroupSettings } from "./tabGroups";

/** Saved chats filed under this project, so the confirm prompt can count them. */
export async function projectSessionCount(path: string): Promise<number> {
  const sessions = await listProjectSessionIds(path);
  return sessions.length;
}

/** Saved chats and rail appearance. The caller owns the live-session lifecycle. */
export async function removeProjectData(
  path: string,
  options: {
    openSessionIds: string[];
    removeSession: (id: string) => Promise<boolean>;
    assertWorkspaceReady: () => void;
  },
): Promise<void> {
  const normalized = normalizeProjectPath(path);
  const key = projectKey(normalized);
  let removed = 0;
  try {
    // A failed read must never look like an empty project. Include chats whose
    // first save is still queued; the callback drains and deletes those too.
    const sessions = await listProjectSessionIds(normalized);
    const ids = new Set([...sessions, ...options.openSessionIds]);
    for (const id of ids) {
      if (!(await options.removeSession(id))) {
        throw new Error(
          "Conversation deletion was cancelled or could not finish.",
        );
      }
      removed += 1;
    }
    options.assertWorkspaceReady();
    // Drops copied images only after every conversation has been removed.
    await clearProjectLogo(key);
    await clearProjectChatBackground(key);
    options.assertWorkspaceReady();
    clearProjectChatBackgroundSetting(key);
    clearTabGroupSettings(key);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    const progress = removed
      ? `${removed} conversation${removed === 1 ? " has" : "s have"} already been deleted. `
      : "";
    throw new Error(
      `${progress}The project remains available. Retry to finish deleting its data.\n\n${detail}`,
    );
  }
}

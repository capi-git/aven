import { isProjectView, type FilePaneTab, type WorkspaceTab } from "./layout";
import { projectKey } from "./paths";
import { clearProjectLogo } from "./projectLogos";
import { clearProjectChatBackground } from "./chatBackground";
import { clearProjectChatBackgroundSetting } from "./projectChatBackground";
import { clearProjectMemory } from "./projectMemory";
import { normalizeProjectPath } from "./recents";
import { listProjectSessionIds } from "./sessionStore";
import type { Session } from "./session";
import { clearTabGroupSettings } from "./tabGroups";
import { filterTabsForProject } from "./workspaceTabGroups";

/**
 * Files the project still has open as work, which keep it from being
 * deleted. Its board and race overviews only show its work: they close with
 * the project instead.
 */
export function openProjectFiles(
  tabs: readonly WorkspaceTab[],
  sessions: Session[],
  project: string,
): FilePaneTab[] {
  return filterTabsForProject([...tabs], sessions, project)
    .flatMap((tab) => [
      ...tab.editorPanes.flatMap((pane) => pane.files),
      ...(tab.terminalPanes ?? []).flatMap((pane) => pane.files),
    ])
    .filter((file) => !isProjectView(file));
}

/** Saved chats filed under this project, so the confirm prompt can count them. */
export async function projectSessionCount(path: string): Promise<number> {
  const sessions = await listProjectSessionIds(path);
  return sessions.length;
}

/** Saved chats, rail appearance and project memory. The caller owns the live-session lifecycle. */
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
    await clearProjectMemory(normalized);
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

import { isProjectView, type FilePaneTab, type WorkspaceTab } from "./layout";
import { projectKey } from "./paths";
import { clearProjectLogo } from "./projectLogos";
import { clearProjectChatBackground } from "./chatBackground";
import { clearProjectChatBackgroundSetting } from "./projectChatBackground";
import { clearProjectMemory } from "./projectMemory";
import { clearFeatureCards } from "./featureCards";
import { clearIosSimProject } from "./iosSimulator";
import { forgetBotForProject } from "./projectBotActions";
import { normalizeProjectPath, sameProjectPath } from "./recents";
import { listProjectSessionIds } from "./sessionStore";
import { isInFlightSession } from "./inFlight";
import { sessionNeedsInput, type Session } from "./session";
import { uncertainSessionAgents } from "./sessionAgents";
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

/** Saved chats, rail appearance, project memory, board cards, its bot and iPhone builds. The caller owns the live-session lifecycle. */
/**
 * What keeps a project from being deleted, each in words: a chat with
 * messages, one at work or waiting for an answer, one whose agents are
 * uncertain, one with queued messages, a draft or a seeded message, or a
 * card to answer; a file open from the project; a terminal in its panel
 * that isn't closing with it. Empty when nothing does.
 */
export function projectOpenWork(input: {
  sessions: readonly Session[];
  tabs: readonly WorkspaceTab[];
  project: string;
  draft: (
    sessionId: string,
  ) => { text?: string; attachments?: readonly unknown[] } | null | undefined;
  /** The project's panel terminals that are not being closed with it. */
  terminals: readonly FilePaneTab[];
}): string[] {
  const normalized = normalizeProjectPath(input.project);
  const work: string[] = [];
  for (const session of input.sessions) {
    if (!sameProjectPath(session.cwd, normalized)) continue;
    const draft = input.draft(session.id);
    const why = [
      session.blocks.length
        ? `${session.blocks.length} message${session.blocks.length === 1 ? "" : "s"}`
        : "",
      session.busy ? "at work" : "",
      sessionNeedsInput(session) ? "waiting for an answer" : "",
      !session.busy && !sessionNeedsInput(session) && isInFlightSession(session)
        ? "agents still running"
        : "",
      uncertainSessionAgents(session).length ? "agents uncertain" : "",
      session.queuedMessages?.length ? "queued messages" : "",
      draft?.text || draft?.attachments?.length ? "a draft" : "",
      session.composerSeed ? "a seeded message" : "",
      session.inboxCard ? "an inbox card" : "",
      session.noteCard ? "a note card" : "",
      session.handoffCard ? "a handoff card" : "",
    ].filter(Boolean);
    if (why.length)
      work.push(`chat “${session.title || session.id}” (${why.join(", ")})`);
  }
  for (const file of openProjectFiles(
    [...input.tabs],
    [...input.sessions],
    normalized,
  ))
    work.push(`file ${file.path}`);
  for (const terminal of input.terminals)
    work.push(`terminal ${terminal.path || terminal.id}`);
  return work;
}

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
    await clearFeatureCards(normalized);
    // Its bot's copy of the project goes, and so does the bot.
    await forgetBotForProject(normalized);
    // The iPhone pane's DerivedData, build log and remembered device.
    await clearIosSimProject(normalized);
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

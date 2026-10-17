import type { Block } from "./session";

/**
 * What a team's card asks of the workspace, supplied by App so the cards in
 * any transcript can act without props threaded through every pane (as
 * `raceWorkspace` does for the race overview).
 */
export type TeamWorkspace = {
  /** Show the project's changes in the Changes panel. */
  reviewChanges(project: string): void;
  /** Open a chat, restoring it into a tab when none holds it. */
  openChat(sessionId: string): void;
  /**
   * Watch a team (`<kind>:<id>`) in the window's floating panel, or bring
   * its own window forward when it is popped out. Absent where the window
   * has no panel.
   */
  watch?(teamId: string): void;
  /**
   * Open a chat and send it a message as your own, written from its
   * transcript once it is loaded; the transcript shows `shown` in its place
   * when given. Resolves false when it could not.
   */
  send(
    sessionId: string,
    compose: (blocks: readonly Block[]) => { text: string; shown?: string },
  ): Promise<boolean>;
};

let workspace: TeamWorkspace | null = null;

export function installTeamWorkspace(next: TeamWorkspace) {
  workspace = next;
  return () => {
    if (workspace === next) workspace = null;
  };
}

export function teamWorkspace(): TeamWorkspace | null {
  return workspace;
}

import { useSyncExternalStore } from "react";
import type { ControlOutcome } from "./orchestration";
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
   * when given. `onSettled` hears how that turn ended. `whenIdle` refuses a
   * chat that is working or has messages waiting, rather than queueing the
   * message or steering it in. Resolves false when it could not.
   */
  send(
    sessionId: string,
    compose: (blocks: readonly Block[]) => { text: string; shown?: string },
    options?: {
      onSettled?: (outcome: ControlOutcome) => void;
      whenIdle?: boolean;
    },
  ): Promise<boolean>;
};

let workspace: TeamWorkspace | null = null;
const listeners = new Set<() => void>();

function changed() {
  for (const listener of listeners) listener();
}

export function installTeamWorkspace(next: TeamWorkspace) {
  workspace = next;
  changed();
  return () => {
    if (workspace !== next) return;
    workspace = null;
    changed();
  };
}

export function teamWorkspace(): TeamWorkspace | null {
  return workspace;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * The workspace for what a card shows, kept current: App installs it in an
 * effect, after its children first draw, so a card read only at render
 * would leave out its buttons until something else redrew it.
 */
export function useTeamWorkspace(): TeamWorkspace | null {
  return useSyncExternalStore(subscribe, teamWorkspace, teamWorkspace);
}

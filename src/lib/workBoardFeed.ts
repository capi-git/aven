import { useSyncExternalStore } from "react";
import type { ChatStatusWord } from "./chatStatus";
import type { CommitTabSource } from "./layout";
import type { TeamRun } from "./teamRuns";
import type { BoardChat } from "./workBoard";

/**
 * What the workspace tells its project boards, published by App while a
 * board tab is open: the loaded chats as small rows, each chat's status
 * word and the team runs, from which the board's cards move by themselves.
 * Each part keeps its identity until something in it changes, so a
 * streamed reply, which changes none of them, re-renders no board.
 */
export type WorkBoardFeed = {
  chats: readonly BoardChat[];
  statuses: Readonly<Record<string, ChatStatusWord>>;
  teams: readonly TeamRun[];
};

/** What a board's buttons ask of the workspace. */
export type WorkBoardActions = {
  openChat(sessionId: string): void;
  allow(sessionId: string, requestId: number): void;
  /** Open the chat with the diff of its changes beside it. */
  review(sessionId: string, cwd: string): void;
  /** Start the Ship flow for the chat's changes. */
  ship(sessionId: string, cwd: string): void;
  watch(teamId: string): void;
  compare(raceId: string): void;
  preview(previewKey: string): void;
  openCommit(sessionId: string, cwd: string, commit: CommitTabSource): void;
  openUrl(url: string): void;
  /**
   * Build: a new chat in the project with the default agent and model,
   * `text` sent at once, behind the board. Returns its id, or null.
   */
  build(project: string, text: string): string | null;
  /**
   * Open as draft: a new chat in the project, shown, with `text` typed in
   * and not sent, so another agent, a race or the Orchestrator can be
   * picked first. Returns its id.
   */
  draft(project: string, text: string): string | null;
};

const EMPTY: WorkBoardFeed = Object.freeze({
  chats: Object.freeze([]) as readonly BoardChat[],
  statuses: Object.freeze({}),
  teams: Object.freeze([]) as readonly TeamRun[],
});

let feed: WorkBoardFeed = EMPTY;
let actions: WorkBoardActions | null = null;
const listeners = new Set<() => void>();

function changed() {
  for (const listener of [...listeners]) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Publish the workspace's latest feed; the same parts change nothing. */
export function publishWorkBoardFeed(next: WorkBoardFeed): void {
  if (
    next.chats === feed.chats &&
    next.statuses === feed.statuses &&
    next.teams === feed.teams
  )
    return;
  feed = next;
  changed();
}

export function workBoardFeed(): WorkBoardFeed {
  return feed;
}

/** Whether the workspace has published anything yet: else it is loading. */
export function workBoardFeedLoaded(shown: WorkBoardFeed): boolean {
  return shown !== EMPTY;
}

/** The feed, while `live`; a hidden board keeps the one it last drew. */
export function useWorkBoardFeed(live = true): WorkBoardFeed {
  return useSyncExternalStore(
    live ? subscribe : noSubscription,
    workBoardFeed,
    workBoardFeed,
  );
}

const noSubscription = () => () => {};

export function installWorkBoardActions(next: WorkBoardActions): () => void {
  actions = next;
  changed();
  return () => {
    if (actions !== next) return;
    actions = null;
    changed();
  };
}

export function workBoardActions(): WorkBoardActions | null {
  return actions;
}

/** Reset for tests. */
export function resetWorkBoardFeed(): void {
  feed = EMPTY;
  actions = null;
  changed();
}

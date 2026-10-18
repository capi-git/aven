import { useEffect } from "react";
import {
  chatReviewsSnapshot,
  noteChatReview,
  type ChatReview,
} from "../lib/chatReview";
import {
  sessionCheckpointStatus,
  subscribeReviewChanged,
  type CheckpointStatus,
} from "../lib/checkpoint";
import { gitChangeAffects, subscribeGitChangedPath } from "../lib/fs";
import { installChatFolders } from "../lib/teamChanges";
import {
  sessionDisplayTitle,
  sessionWorkCwd,
  type Session,
} from "../lib/session";

/** Several notices for one chat in quick succession read its checkpoint once. */
const SETTLE_MS = 250;
/** After launch, saved reviews are checked again once the workspace settles. */
const LAUNCH_CHECK_MS = 2_000;

type Lookup = Pick<
  Session,
  "id" | "cwd" | "worktreeCwd" | "busy" | "title" | "harness" | "inboxAsk"
>;

export type ChatReviewTrackerDeps = {
  /** A loaded chat, current at the time of asking. */
  session: (id: string) => Lookup | undefined;
  /** Every loaded chat, current at the time of asking. */
  sessions: () => readonly Lookup[];
  reviews?: () => Readonly<Record<string, ChatReview>>;
  status?: (sessionId: string, cwd: string) => Promise<CheckpointStatus>;
  note?: typeof noteChatReview;
};

/**
 * Keeps each chat's review record (see `chatReview`) in step with its
 * checkpoint, reading it only when something says it changed: a turn ended
 * or an edit was captured (`notifyReviewChanged`), or Git changed in its
 * folder (Keep, Undo, a commit). Nothing polls. A chat at work is read once
 * its turn ends; saved reviews are checked again once after launch, as are
 * the chats the workspace reopened.
 */
export function startChatReviewTracker({
  session,
  sessions,
  reviews = chatReviewsSnapshot,
  status = sessionCheckpointStatus,
  note = noteChatReview,
}: ChatReviewTrackerDeps): () => void {
  const pending = new Set<string>();
  let timer: ReturnType<typeof setTimeout> | null = null;
  let stopped = false;

  const check = (id: string) => {
    const loaded = session(id);
    if (loaded?.inboxAsk) return;
    // A chat at work reads Working; its turn's end asks again.
    if (loaded?.busy) return;
    const saved = reviews()[id];
    if (!loaded && !saved) return;
    const cwd = loaded ? sessionWorkCwd(loaded) : saved!.cwd;
    const project = loaded?.cwd ?? saved!.project;
    if (!cwd || cwd === "~") return;
    void status(id, cwd).then(
      (result) => {
        if (stopped) return;
        note({
          sessionId: id,
          project,
          cwd,
          files: result.files,
          ...(loaded?.title
            ? { title: sessionDisplayTitle(loaded.title, loaded.harness) }
            : {}),
          ...(loaded?.harness ? { harness: loaded.harness } : {}),
        });
      },
      // A checkpoint that cannot be read keeps what was known.
      () => {},
    );
  };

  const flush = () => {
    timer = null;
    const ids = [...pending];
    pending.clear();
    for (const id of ids) check(id);
  };
  const schedule = (ids: Iterable<string>) => {
    for (const id of ids) pending.add(id);
    if (timer === null && pending.size) timer = setTimeout(flush, SETTLE_MS);
  };

  const stopReview = subscribeReviewChanged((id) =>
    schedule(id ? [id] : Object.keys(reviews())),
  );
  const stopGit = subscribeGitChangedPath((path) =>
    schedule(
      Object.values(reviews())
        .filter((review) => gitChangeAffects(path, review.cwd))
        .map((review) => review.sessionId),
    ),
  );
  const launch = setTimeout(() => {
    const ids = new Set(Object.keys(reviews()));
    for (const loaded of sessions()) ids.add(loaded.id);
    schedule(ids);
  }, LAUNCH_CHECK_MS);

  return () => {
    stopped = true;
    stopReview();
    stopGit();
    clearTimeout(launch);
    if (timer !== null) clearTimeout(timer);
    pending.clear();
  };
}

/**
 * `startChatReviewTracker` for the workspace's chats, for its lifetime. It
 * also tells team runs where each chat keeps its changes, so what a kept
 * race brings in lands in its chat's review (see `teamChanges`).
 */
export function useChatReviewTracker(sessionsRef: {
  readonly current: readonly Session[];
}): void {
  useEffect(() => {
    const stopTracker = startChatReviewTracker({
      session: (id) => sessionsRef.current.find((entry) => entry.id === id),
      sessions: () => sessionsRef.current,
    });
    const stopFolders = installChatFolders((id) => {
      const loaded = sessionsRef.current.find((entry) => entry.id === id);
      return loaded ? sessionWorkCwd(loaded) : undefined;
    });
    return () => {
      stopTracker();
      stopFolders();
    };
  }, [sessionsRef]);
}

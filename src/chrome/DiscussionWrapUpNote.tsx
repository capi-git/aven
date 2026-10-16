import { createContext, useContext, useMemo, type ReactNode } from "react";
import { useDiscussionWrapUp } from "../hooks/useDiscussions";
import type { DiscussionHost } from "../lib/discussions";
import { discussionVoices } from "../lib/discussionVoices";
import type { DiscussionWrapUpMeta } from "../lib/session";
import { DiscussionOpenContext } from "./DiscussionRelayCard";
import { DiscussionWrapUpCard, WrapUpLists } from "./DiscussionWrapUp";

/**
 * Has a chat build what a discussion landed on, as the page's buttons do.
 * Provided by chat panes in a window that drives discussions; absent
 * elsewhere, where the card has no buttons.
 */
export const DiscussionBuildContext =
  createContext<DiscussionHost["build"]>(undefined);

/**
 * Gives a chat's transcript the window's discussion actions: relay cards
 * and the wrap-up open the page, and the wrap-up's buttons build. Without a
 * host (Inbox chats, read-only worker transcripts) they stay plain.
 */
export function DiscussionActions({
  host,
  children,
}: {
  host?: DiscussionHost;
  children?: ReactNode;
}) {
  return (
    <DiscussionOpenContext.Provider value={host?.open}>
      <DiscussionBuildContext.Provider value={host?.build}>
        {children}
      </DiscussionBuildContext.Provider>
    </DiscussionOpenContext.Provider>
  );
}

/**
 * Where a discussion landed, under its closing note in the chat that
 * started it: "Summing up…", then what they agreed on and what is still
 * open, with the build buttons and a link to the page. It reads the
 * discussion by id and re-renders only when its ending or summary changes.
 * Once Aven no longer keeps that ending, the lists copied into the note are
 * shown as plain text, or nothing when they never were. The agent never
 * receives any of it.
 */
export function DiscussionWrapUpNote({ meta }: { meta: DiscussionWrapUpMeta }) {
  const open = useContext(DiscussionOpenContext);
  const build = useContext(DiscussionBuildContext);
  const discussion = useDiscussionWrapUp(meta.id);
  // The ending this note closed; continuing the discussion moves past it.
  const current =
    discussion?.status === "ended" &&
    discussion.settled === meta.settled &&
    discussion.ended?.kind === "completed"
      ? discussion
      : null;
  const voices = useMemo(
    () => (current ? discussionVoices(current) : null),
    [current],
  );
  if (current && voices)
    return (
      <div className="px-4 pb-2" data-discussion-wrapup-note={meta.id}>
        <DiscussionWrapUpCard
          as="div"
          compact
          discussion={current}
          voices={voices}
          build={build}
          onOpen={open ? () => open(meta.id) : undefined}
        />
      </div>
    );
  if (!meta.agreed || !meta.open) return null;
  return (
    <div className="px-4 pb-2" data-discussion-wrapup-note={meta.id}>
      <div
        className="discussion-wrapup discussion-wrapup-compact"
        data-discussion-wrapup="saved"
        aria-label="Where they landed"
      >
        <div className="discussion-wrapup-head">
          <h3 className="discussion-wrapup-title">Where they landed</h3>
        </div>
        <WrapUpLists agreed={meta.agreed} open={meta.open} />
      </div>
    </div>
  );
}

import { createContext, useContext, useSyncExternalStore } from "react";
import { discussionStore } from "../lib/discussions";
import type { DiscussionRelayMeta } from "../lib/session";
import { HarnessIcon } from "./HarnessIcon";
import { ExternalLink, MessageMultiple } from "./icons";
import { ProjectMark } from "./ProjectMark";

/**
 * Opens a discussion in the team panel from a chat's transcript. Provided
 * by chat panes in a window that drives discussions; absent elsewhere (Inbox
 * chats, read-only worker transcripts), where relay cards stay plain text.
 */
export const DiscussionOpenContext = createContext<
  ((id: string) => void) | undefined
>(undefined);

const idle = () => () => {};

/**
 * Marks a user-side message Aven relayed in a discussion: who said it (or,
 * on the opening topic, who this chat is talking with) and the round. While
 * the discussion is still known here (running, or kept as history once it
 * ended), pressing the card shows it in the team panel.
 */
export function DiscussionRelayCard({ meta }: { meta: DiscussionRelayMeta }) {
  const open = useContext(DiscussionOpenContext);
  const store = discussionStore();
  // A yes/no snapshot: the card re-renders only when that answer changes.
  const known = useSyncExternalStore(
    open ? store.subscribe : idle,
    () => !!open && store.get(meta.id) !== undefined,
    () => false,
  );
  const opening = meta.turn === 0;
  const round = Math.min(meta.rounds, Math.floor(meta.turn / 2) + 1);
  const { partner } = meta;
  const content = (
    <>
      <MessageMultiple className="size-3 shrink-0" />
      <span className="shrink-0">
        {opening ? "Discussion with" : "Relayed from"}
      </span>
      <ProjectMark path={partner.cwd} />
      <HarnessIcon harness={partner.harness} className="size-3 shrink-0" />
      <span
        className="min-w-0 truncate text-content/80"
        title={`${partner.model} in “${partner.title}”`}
      >
        {partner.model} in “{partner.title}”
      </span>
      <span className="shrink-0 text-content/40">
        ·{" "}
        {opening
          ? `${meta.rounds} ${meta.rounds === 1 ? "round" : "rounds"}`
          : `round ${round} of ${meta.rounds}`}
        {meta.truncated ? " · shortened" : ""}
      </span>
    </>
  );
  const layout =
    "flex min-w-0 items-center gap-1.5 font-sans text-ui-caption leading-4 text-content/55";
  if (known && open)
    return (
      <button
        type="button"
        className={`${layout} group max-w-full rounded-sm text-left hover:text-content/80`}
        data-discussion-relay={meta.id}
        data-discussion-open
        title="Open the discussion"
        onClick={() => open(meta.id)}
      >
        {content}
        <ExternalLink className="size-3 shrink-0 opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100" />
      </button>
    );
  return (
    <div className={layout} data-discussion-relay={meta.id}>
      {content}
    </div>
  );
}

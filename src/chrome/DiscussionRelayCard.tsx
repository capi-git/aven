import type { DiscussionRelayMeta } from "../lib/session";
import { HarnessIcon } from "./HarnessIcon";
import { MessageMultiple } from "./icons";
import { ProjectMark } from "./ProjectMark";

/**
 * Marks a user-side message Aven relayed in a discussion: who said it (or,
 * on the opening topic, who this chat is talking with) and the round.
 */
export function DiscussionRelayCard({ meta }: { meta: DiscussionRelayMeta }) {
  const opening = meta.turn === 0;
  const round = Math.min(meta.rounds, Math.floor(meta.turn / 2) + 1);
  const { partner } = meta;
  return (
    <div
      className="flex min-w-0 items-center gap-1.5 font-sans text-ui-caption leading-4 text-content/55"
      data-discussion-relay={meta.id}
    >
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
    </div>
  );
}

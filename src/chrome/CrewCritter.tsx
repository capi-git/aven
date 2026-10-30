import { memo } from "react";
import type { CrewRole } from "../lib/crews";
import {
  CREW_STATUS_LABEL,
  CREW_STATUS_STAGE,
  type CrewStatus,
} from "../lib/crewView";
import { crewMemberSigil } from "../lib/dotSigils";
import { DotMark, type DotMarkState } from "./DotMark";
import "./ChatStatusPill.css";
import "./CrewCritter.css";

/**
 * A crew member drawn as its mark: its role's sigil (the Builder's two
 * blocks, the Checker's ring, Security's shield, the Scout's diamond, the
 * Fixer's plus), or the one you chose for it. The sigil says the role, so
 * there is no badge.
 */
export const CrewCritter = memo(function CrewCritter({
  role,
  critter,
  active = false,
  state,
  className = "crew-critter",
}: {
  /** The crew's project; its members' marks are their own. */
  path?: string;
  role: CrewRole;
  /** The mark you chose for this member (or a critter from before marks). */
  critter?: string;
  /** Sweeps a light across it while it works. */
  active?: boolean;
  /** A state of its own (needs you, idle), over `active`. */
  state?: DotMarkState;
  className?: string;
}) {
  return (
    <span className="crew-critter-wrap" data-crew-critter={role}>
      <DotMark
        sigil={crewMemberSigil(role, critter)}
        state={state ?? (active ? "working" : "still")}
        className={className}
      />
    </span>
  );
});

/** A member's mark state from its word: working, waiting on you, or at rest. */
export function crewMarkState(
  status: CrewStatus | undefined,
  active: boolean,
  rest: DotMarkState = "still",
): DotMarkState {
  if (status === "needs-you") return "needs";
  if (active || status === "working") return "working";
  return rest;
}

/** One mark in a row: a role, or a member with its own id and mark. */
export type CrewFace =
  CrewRole | { id: string; role: CrewRole; critter?: string };

/** A crew's marks side by side, the most a row shows, then "+2". */
export function CrewCritters({
  roles,
  active,
  max = 3,
  className,
}: {
  path?: string;
  roles: readonly CrewFace[];
  /** The one that works: its role, or its member id. */
  active?: string | boolean;
  max?: number;
  className?: string;
}) {
  const faces = roles.map((face) =>
    typeof face === "string" ? { id: face, role: face } : face,
  );
  const shown = faces.slice(0, max);
  const more = faces.length - shown.length;
  return (
    <span className={`crew-critters ${className ?? ""}`} aria-hidden="true">
      {shown.map((face) => (
        <CrewCritter
          key={face.id}
          role={face.role}
          {...("critter" in face && face.critter
            ? { critter: face.critter }
            : {})}
          active={active === true || active === face.id || active === face.role}
        />
      ))}
      {more > 0 ? <span className="crew-critters-more">+{more}</span> : null}
    </span>
  );
}

/** A crew's or a bot's one word, in the chat status pill's tones. */
export function CrewStatusPill({ status }: { status: CrewStatus }) {
  return (
    <span
      className="aven-chat-status"
      data-crew-status={status}
      data-stage={CREW_STATUS_STAGE[status]}
    >
      {CREW_STATUS_LABEL[status]}
    </span>
  );
}

/** Round dots: one per round, the current one outlined, earlier ones filled. */
export function CrewRoundDots({
  current,
  total,
}: {
  current: number;
  total: number;
}) {
  return (
    <span
      className="crew-dots"
      role="img"
      aria-label={`Round ${current} of ${total}`}
    >
      {Array.from({ length: Math.max(total, current) }, (_, index) => (
        <span
          key={index}
          className="crew-dot"
          data-state={
            index + 1 < current
              ? "done"
              : index + 1 === current
                ? "now"
                : "later"
          }
        />
      ))}
    </span>
  );
}

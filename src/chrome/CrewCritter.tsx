import { memo } from "react";
import { useProjectTone } from "../hooks/useProjectTone";
import type { CrewRole } from "../lib/crews";
import {
  CREW_STATUS_LABEL,
  CREW_STATUS_STAGE,
  type CrewStatus,
} from "../lib/crewView";
import { hopperMemberTone, type HopperState } from "../lib/hopper";
import { HopperMark } from "./HopperMark";
import "./ChatStatusPill.css";
import "./CrewCritter.css";

/**
 * A team member drawn as Hopper, in the teammate's colour: the Lead (Avos)
 * and the Fixer in their project's, every other role its own (Builder blue,
 * Checker purple and so on). The mark it once chose (`critter`) is kept and
 * still picks a Tester's or a Scribe's colour, but every agent wears the
 * same steps; its name says the role.
 */
export const CrewCritter = memo(function CrewCritter({
  path,
  role,
  critter,
  active = false,
  state,
  className = "crew-critter",
}: {
  /** The team's project: the Lead's and the Fixer's marks take its colour. */
  path?: string;
  role: CrewRole;
  /** The mark this member chose before Hopper, which keeps its colour. */
  critter?: string;
  /** Hops up its steps while it works. */
  active?: boolean;
  /** A state of its own (needs you, watching, resting), over `active`. */
  state?: HopperState;
  className?: string;
}) {
  const projectTone = useProjectTone(path);
  return (
    <span className="crew-critter-wrap" data-crew-critter={role}>
      <HopperMark
        tone={hopperMemberTone(role, critter, projectTone)}
        state={state ?? (active ? "working" : "still")}
        className={className}
      />
    </span>
  );
});

/** One mark in a row: a role, or a member with its own id and mark. */
export type CrewFace =
  CrewRole | { id: string; role: CrewRole; critter?: string };

/** A crew's marks side by side, the most a row shows, then "+2". */
export function CrewCritters({
  path,
  roles,
  active,
  max = 3,
  className,
}: {
  /** The team's project (the Lead's and the Fixer's marks take its colour). */
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
          path={path}
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

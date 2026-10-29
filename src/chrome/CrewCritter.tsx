import { memo } from "react";
import { CREW_ROLE_INFO, type CrewRole } from "../lib/crews";
import {
  CREW_STATUS_LABEL,
  CREW_STATUS_STAGE,
  type CrewStatus,
} from "../lib/crewView";
import { BotCritter } from "./BotCritter";
import { ProjectMascot } from "./ProjectMascot";
import "./ChatStatusPill.css";
import "./CrewCritter.css";

/**
 * A crew member drawn as its critter: the Builder a beetle, the Checker an
 * owl, the Scout a fox, each in its own colour; the Fixer is the project's
 * own critter, as its bot always was. A small badge says the role.
 */

const BADGE_PATHS: Readonly<Record<CrewRole, string>> = {
  // A hammer, a check mark, a spark and a wrench, on an 8-unit grid.
  builder: "M2 2.6h4M4 2.6v3.4",
  checker: "M2.2 4.2l1.3 1.3 2.4-2.8",
  scout: "M4 2v4M2 4h4",
  fixer: "M2.6 5.4l2.8-2.8M4.6 2.4l1 1",
};

export function CrewRoleBadge({ role }: { role: CrewRole }) {
  return (
    <svg
      className="crew-badge"
      data-role={role}
      viewBox="0 0 8 8"
      aria-hidden="true"
      focusable="false"
    >
      <circle cx="4" cy="4" r="3.6" />
      <path d={BADGE_PATHS[role]} />
    </svg>
  );
}

export const CrewCritter = memo(function CrewCritter({
  path,
  role,
  critter,
  active = false,
  badge = true,
  className = "crew-critter",
}: {
  path: string;
  role: CrewRole;
  /** The critter you chose for this member, when not its role's. */
  critter?: string;
  /** Steps its two frames while it works. */
  active?: boolean;
  badge?: boolean;
  className?: string;
}) {
  const info = CREW_ROLE_INFO[role];
  const drawn = critter ?? info.critter;
  return (
    <span className="crew-critter-wrap" data-crew-critter={role}>
      {role === "fixer" || !drawn ? (
        <BotCritter path={path} active={active} className={className} />
      ) : (
        <ProjectMascot
          project={`crew:${role}`}
          name={drawn}
          color={info.color}
          active={active}
          className={className}
        />
      )}
      {badge ? <CrewRoleBadge role={role} /> : null}
    </span>
  );
});

/** One critter in a row: a role, or a member with its own id and critter. */
export type CrewFace =
  CrewRole | { id: string; role: CrewRole; critter?: string };

/** A crew's critters side by side, the most a row shows, then "+2". */
export function CrewCritters({
  path,
  roles,
  active,
  max = 3,
  className,
}: {
  path: string;
  roles: readonly CrewFace[];
  /** The one that moves: its role, or its member id. */
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
          badge={false}
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

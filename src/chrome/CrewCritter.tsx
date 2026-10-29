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
  active = false,
  badge = true,
  className = "crew-critter",
}: {
  path: string;
  role: CrewRole;
  /** Steps its two frames while it works. */
  active?: boolean;
  badge?: boolean;
  className?: string;
}) {
  const info = CREW_ROLE_INFO[role];
  return (
    <span className="crew-critter-wrap" data-crew-critter={role}>
      {role === "fixer" || !info.critter ? (
        <BotCritter path={path} active={active} className={className} />
      ) : (
        <ProjectMascot
          project={`crew:${role}`}
          name={info.critter}
          color={info.color}
          active={active}
          className={className}
        />
      )}
      {badge ? <CrewRoleBadge role={role} /> : null}
    </span>
  );
});

/** A crew's critters side by side, the most a row shows, then "+2". */
export function CrewCritters({
  path,
  roles,
  active,
  max = 3,
  className,
}: {
  path: string;
  roles: readonly CrewRole[];
  /** The one that moves. */
  active?: CrewRole | boolean;
  max?: number;
  className?: string;
}) {
  const shown = roles.slice(0, max);
  const more = roles.length - shown.length;
  return (
    <span className={`crew-critters ${className ?? ""}`} aria-hidden="true">
      {shown.map((role) => (
        <CrewCritter
          key={role}
          path={path}
          role={role}
          badge={false}
          active={active === true || active === role}
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

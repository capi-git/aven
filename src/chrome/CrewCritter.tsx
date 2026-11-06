import { memo, useMemo } from "react";
import { useProjectTone } from "../hooks/useProjectTone";
import { useCrew, type CrewRole } from "../lib/crews";
import type { MarkTone } from "../lib/markTones";
import {
  CREW_STATUS_LABEL,
  CREW_STATUS_STAGE,
  type CrewStatus,
} from "../lib/crewView";
import {
  agentMemberTone,
  agentOutfit,
  agentPhase,
  helperTones,
  type AgentState,
} from "../lib/agentMark";
import { AgentMark } from "./AgentMark";
import "./ChatStatusPill.css";
import "./CrewCritter.css";

/**
 * A team member drawn as Bot, in the teammate's colour: the Lead (Avos)
 * and the Fixer in their project's, every other role its own (Builder blue,
 * Checker purple and so on), wearing its role's outfit at 28 px and up (the
 * Lead's headset, the Builder's hard hat). The mark it once chose
 * (`critter`) is kept and still picks a Tester's or a Scribe's colour.
 */
export const CrewCritter = memo(function CrewCritter({
  path,
  role,
  critter,
  active = false,
  state,
  taken,
  className = "crew-critter",
}: {
  /** The team's project: the Lead's and the Fixer's marks take its colour. */
  path?: string;
  role: CrewRole;
  /** The mark this member chose before Bot, which keeps its colour. */
  critter?: string;
  /** Works (types, its light pulsing) while true. */
  active?: boolean;
  /** A state of its own (needs you, watching, resting), over `active`. */
  state?: AgentState;
  /**
   * Colours the other helpers on screen wear (`helperTones`), when known;
   * otherwise its team's, from the store.
   */
  taken?: ReadonlySet<MarkTone>;
  className?: string;
}) {
  const projectTone = useProjectTone(path);
  const crew = useCrew(taken ? undefined : path);
  const avoid = useMemo(
    () => taken ?? (crew ? helperTones(crew.members) : undefined),
    [taken, crew],
  );
  return (
    <span className="crew-critter-wrap" data-crew-critter={role}>
      <AgentMark
        tone={agentMemberTone(role, critter, projectTone, avoid)}
        state={state ?? (active ? "working" : "still")}
        outfit={agentOutfit(role)}
        phase={agentPhase(role)}
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
  const taken = helperTones(
    faces.map((face) => ({
      role: face.role,
      ...("critter" in face && face.critter ? { critter: face.critter } : {}),
    })),
  );
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
          taken={taken}
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

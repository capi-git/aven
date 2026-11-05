import { useState } from "react";
import { updateCrewRoutine, useCrewWorkspace } from "../lib/crewActions";
import {
  crewMemberName,
  crewMembers,
  type Crew,
  type CrewMember,
} from "../lib/crews";
import { formatClockMinutes } from "../lib/projectBots";

/**
 * Avos's quieter pages, after MonoCode's Mono panel (MIT): what Avos and its
 * helpers keep in mind, and when they work.
 */

/** What each teammate keeps in mind about this project. */
export function TeamNotes({ crew }: { crew: Crew }) {
  const workspace = useCrewWorkspace();
  const members = crewMembers(crew).filter((member) => member.role !== "fixer");
  const kept = members.filter((member) => member.memory);
  if (!kept.length)
    return (
      <p className="team-panel-empty">
        Teammates keep short notes about this project as they work. None yet.
      </p>
    );
  return (
    <ul className="team-notes" role="list">
      {kept.map((member) => (
        <li key={member.id}>
          <button
            type="button"
            onClick={() => workspace?.openSettings(crew.path, member.id)}
          >
            <b>{crewMemberName(crew, member.id)}</b>
            <span>{member.memory}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}

/** When the team works by itself. */
/** What a teammate does by itself: its own rhythm, and any routine you set. */
function scheduleLine(member: CrewMember): string {
  const parts: string[] = [];
  if (member.role === "scout" && !member.paused && member.schedule !== "off")
    parts.push(
      member.schedule === "weekly"
        ? "Looks for ideas once a week"
        : "Looks for ideas once a day",
    );
  if (member.role === "security" && !member.paused && member.sweep === "weekly")
    parts.push("Sweeps the project once a week");
  if (member.routine)
    parts.push(
      `${member.routine.every === "week" ? "Every week" : "Every day"}: ${member.routine.text}`,
    );
  return parts.join(" · ") || "Only when asked";
}

/** One teammate: what it does by itself, opening to set what you want. */
function ScheduleRow({ crew, member }: { crew: Crew; member: CrewMember }) {
  const workspace = useCrewWorkspace();
  const [open, setOpen] = useState(false);
  const routine = member.routine;
  const [text, setText] = useState(routine?.text ?? "");
  const name = crewMemberName(crew, member.id);
  const save = (every: "day" | "week" | null) => {
    const words = text.trim();
    updateCrewRoutine(
      crew.path,
      member.id,
      every && words ? { text: words, every, at: routine?.at ?? 0 } : null,
    );
    if (!every) setText("");
    setOpen(false);
  };
  return (
    <div data-team-routine={member.id}>
      <button
        type="button"
        className="team-schedule-row"
        aria-expanded={open}
        onClick={() => setOpen((was) => !was)}
      >
        <span>{name}</span>
        <small>{scheduleLine(member)}</small>
      </button>
      {open ? (
        <div className="team-routine-edit">
          <textarea
            aria-label={`What ${name} does by itself`}
            placeholder="What it does by itself, like “Tell me what changed”"
            rows={2}
            value={text}
            onChange={(event) => setText(event.target.value)}
          />
          <div>
            <button
              type="button"
              disabled={!text.trim()}
              onClick={() => save("day")}
            >
              Every day
            </button>
            <button
              type="button"
              disabled={!text.trim()}
              onClick={() => save("week")}
            >
              Every week
            </button>
            {routine ? (
              <button type="button" onClick={() => save(null)}>
                Stop
              </button>
            ) : null}
            {member.role === "scout" || member.role === "security" ? (
              <button
                type="button"
                onClick={() => workspace?.openSettings(crew.path, member.id)}
              >
                Settings
              </button>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}

export function TeamSchedule({ crew }: { crew: Crew }) {
  const workspace = useCrewWorkspace();
  const quiet = crew.limits.quiet;
  return (
    <div className="team-schedule" data-team-schedule>
      {crewMembers(crew)
        .filter((member) => member.role !== "fixer")
        .map((member) => (
          <ScheduleRow key={member.id} crew={crew} member={member} />
        ))}
      <button
        type="button"
        className="team-schedule-row team-schedule-quiet"
        onClick={() => workspace?.openSettings(crew.path)}
      >
        <span>Quiet hours</span>
        <small>
          {quiet.on
            ? `No new work from ${formatClockMinutes(quiet.start)} to ${formatClockMinutes(quiet.end)}`
            : "Off"}
        </small>
      </button>
    </div>
  );
}

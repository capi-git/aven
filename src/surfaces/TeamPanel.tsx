import { useState, useSyncExternalStore } from "react";
import {
  agentProblem,
  agentWord,
  memberApp,
  shortModelName,
  useInstalledAgents,
} from "../chrome/crewSettingsParts";
import { ExplorerMenu, type ExplorerMenuItem } from "../chrome/ExplorerMenu";
import { ChevronDown } from "../chrome/icons";
import { ideaWaits } from "../lib/crewLimits";
import {
  updateCrewMember,
  updateCrewRoutine,
  useCrewWorkspace,
} from "../lib/crewActions";
import {
  crewAgentsFor,
  crewMemberName,
  crewMembers,
  crewRunsToday,
  type Crew,
  type CrewMember,
} from "../lib/crews";
import {
  getModelSnapshot,
  pickerModelsFor,
  subscribeModels,
} from "../lib/models";
import type { HarnessId } from "../lib/session";
import type { BoardCard, BoardColumnId } from "../lib/workBoard";
import { formatClockMinutes } from "../lib/projectBots";

/**
 * The team panel's quiet pages, after MonoCode's Mono panel (MIT): where the
 * team stands today, what its teammates keep in mind and when it works.
 */

/** A teammate's model, one click from the panel. */
export function TeamModelButton({
  path,
  member,
}: {
  path: string;
  member: CrewMember;
}) {
  useSyncExternalStore(subscribeModels, getModelSnapshot, getModelSnapshot);
  const installed = useInstalledAgents();
  const [menu, setMenu] = useState<HTMLElement | null>(null);
  const { harness, model } = memberApp(member);
  const agents = crewAgentsFor(member.role).filter(
    (agent) =>
      agent === harness ||
      (installed.includes(agent) && !agentProblem(agent, member.role)),
  );
  const items: ExplorerMenuItem[] = agents.flatMap((agent, index) => {
    const models = pickerModelsFor(agent);
    const shown = models.slice(0, 6);
    // Its model is always there to see, however far down the list it is.
    const current =
      agent === harness && !shown.some((item) => item.id === model)
        ? [{ id: model, name: shortModelName(model) }]
        : [];
    return [
      ...(index ? [{ kind: "sep" as const }] : []),
      ...[...current, ...shown].map((item): ExplorerMenuItem => ({
        kind: "item",
        id: `${agent}\n${item.id}`,
        label: `${agentWord(agent)} · ${shortModelName(item.id)}`,
        checked: agent === harness && item.id === model,
      })),
    ];
  });
  return (
    <>
      <button
        type="button"
        className="team-model-button"
        aria-haspopup="menu"
        aria-expanded={!!menu}
        aria-label={`Model for ${crewMemberNameOf(member)}`}
        data-team-model={member.id}
        onClick={(event) => {
          event.stopPropagation();
          setMenu(menu ? null : event.currentTarget);
        }}
      >
        <span>
          {agentWord(harness)} · {shortModelName(model)}
        </span>
        <ChevronDown size={12} aria-hidden />
      </button>
      {menu ? (
        <ExplorerMenu
          x={0}
          y={0}
          anchor={menu}
          align="end"
          gap={4}
          ariaLabel="Choose a model"
          items={items}
          onClose={() => setMenu(null)}
          onPick={(id) => {
            setMenu(null);
            const [agent, picked] = id.split("\n") as [HarnessId, string];
            updateCrewMember(path, member.id, {
              harness: agent,
              model: picked,
            });
          }}
        />
      ) : null}
    </>
  );
}

const crewMemberNameOf = (member: CrewMember) => member.name ?? member.role;

/** Today's numbers, who is doing what, and what comes next. */
export function TeamOverview({
  crew,
  columns,
  batchSize,
  now,
  name,
}: {
  crew: Crew;
  columns: Readonly<Record<BoardColumnId, readonly BoardCard[]>>;
  batchSize: number;
  now: number;
  name: (who: string) => string;
}) {
  const next = columns.idea.find(
    (card) =>
      !ideaWaits(
        crew,
        {
          id: card.id,
          chatIds: [...card.chatIds],
          ...(card.source ? { sourceUrl: card.source.url } : {}),
        },
        now,
      ),
  );
  const stats = [
    { value: String(batchSize), label: "Ready to apply" },
    { value: String(columns.shipped.length), label: "Done" },
    { value: String(columns.idea.length), label: "Ideas" },
    {
      value: `${crewRunsToday(crew, now)}/${crew.limits.runsPerDay}`,
      label: "Runs today",
    },
  ];
  return (
    <div className="team-overview" data-team-overview>
      <h2>Today</h2>
      <div className="team-stats">
        {stats.map((stat) => (
          <div key={stat.label} className="team-stat">
            <b>{stat.value}</b>
            <span>{stat.label}</span>
          </div>
        ))}
      </div>
      <h2>Up next</h2>
      <p>
        {crew.paused
          ? `Paused. ${name("builder")} starts again when you resume.`
          : next
            ? `${next.title} builds next.`
            : "Nothing is lined up. Tell the team what to build."}
      </p>
    </div>
  );
}

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
/** One teammate's routine: what to do by itself, and how often. */
function RoutineRow({ crew, member }: { crew: Crew; member: CrewMember }) {
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
        <small>
          {routine
            ? `${routine.every === "week" ? "Every week" : "Every day"}: ${routine.text}`
            : "No routine"}
        </small>
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
            <button type="button" onClick={() => save("day")}>
              Every day
            </button>
            <button type="button" onClick={() => save("week")}>
              Every week
            </button>
            {routine ? (
              <button type="button" onClick={() => save(null)}>
                Off
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
  const member = (role: CrewMember["role"]) =>
    crew.members.find((item) => item.role === role);
  const scout = member("scout");
  const security = member("security");
  const quiet = crew.limits.quiet;
  const rows = [
    {
      id: scout?.id,
      label: scout ? crewMemberName(crew, scout.id) : "Scout",
      value: !scout
        ? "Not on this team"
        : scout.paused || scout.schedule === "off"
          ? "Off"
          : scout.schedule === "weekly"
            ? "Looks for ideas once a week"
            : "Looks for ideas once a day",
    },
    {
      id: security?.id,
      label: security ? crewMemberName(crew, security.id) : "Security",
      value: !security
        ? "Not on this team"
        : security.paused || security.sweep !== "weekly"
          ? "Checks each card only"
          : "Checks each card, and sweeps the project weekly",
    },
    {
      label: "Quiet hours",
      value: quiet.on
        ? `${formatClockMinutes(quiet.start)} to ${formatClockMinutes(quiet.end)}`
        : "Off",
    },
  ];
  return (
    <div className="team-schedule" data-team-schedule>
      {rows.map((row) => (
        <button
          type="button"
          key={row.label}
          className="team-schedule-row"
          onClick={() => workspace?.openSettings(crew.path, row.id)}
        >
          <span>{row.label}</span>
          <small>{row.value}</small>
        </button>
      ))}
      <h2>Routines</h2>
      {crewMembers(crew)
        .filter((member) => member.role !== "fixer")
        .map((member) => (
          <RoutineRow key={member.id} crew={crew} member={member} />
        ))}
    </div>
  );
}

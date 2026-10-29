import { Fragment, useState, type MouseEvent as ReactMouseEvent } from "react";
import { CREW_ROLE_INFO } from "../lib/crews";
import type { CrewMemberView, CrewStatus } from "../lib/crewView";
import { ExplorerMenu, type ExplorerMenuItem } from "./ExplorerMenu";
import { ChevronRight } from "./icons";
import { CrewCritter, CrewCritters, CrewStatusPill } from "./CrewCritter";
import "./BotCritter.css";
import "./CrewCritter.css";

/** A crew as its sidebar row shows it: plain data, so the floating sidebar can show it too. */
export type SidebarCrew = {
  path: string;
  /** Its project's name. */
  project: string;
  status: CrewStatus;
  /** "7 of 20 runs today". */
  runsLine: string;
  paused: boolean;
  members: CrewMemberView[];
};

export type SidebarCrewAction =
  "open" | "tell" | "pause" | "resume" | "settings";

const OPEN_KEY = "aven.sidebar.crewsOpen";

function loadOpen(): ReadonlySet<string> {
  try {
    const saved = JSON.parse(localStorage.getItem(OPEN_KEY) ?? "[]");
    return new Set(
      Array.isArray(saved)
        ? saved.filter((item): item is string => typeof item === "string")
        : [],
    );
  } catch {
    return new Set();
  }
}

function saveOpen(open: ReadonlySet<string>) {
  try {
    localStorage.setItem(OPEN_KEY, JSON.stringify([...open].slice(-40)));
  } catch {
    // Without storage the folds last as long as the window.
  }
}

/** The crew's right-click menu, its runs today below the line. */
export function crewMenuItems(crew: SidebarCrew): ExplorerMenuItem[] {
  return [
    { kind: "item", id: "open", label: "Open crew" },
    { kind: "item", id: "tell", label: "Tell the crew…" },
    { kind: "sep" },
    crew.paused
      ? { kind: "item", id: "resume", label: "Resume crew" }
      : { kind: "item", id: "pause", label: "Pause crew" },
    { kind: "item", id: "settings", label: "Settings…" },
    { kind: "sep" },
    { kind: "item", id: "runs", label: crew.runsLine, disabled: true },
  ];
}

/**
 * The Crews section's rows: one per crew, its critters, its project and the
 * one word that matters most. The chevron unfolds its bots: each critter
 * with its role badge, its name, its role in grey, its word while it works,
 * and what it is doing.
 */
export function SidebarCrewRows({
  crews,
  activeSessionId,
  onOpenCrew,
  onOpenMember,
  onAction,
}: {
  crews: readonly SidebarCrew[];
  activeSessionId?: string | null;
  onOpenCrew?: (path: string) => void;
  /** Open a member's chat, by its id. */
  onOpenMember?: (path: string, who: string) => void;
  onAction?: (path: string, action: SidebarCrewAction) => void;
}) {
  const [open, setOpen] = useState<ReadonlySet<string>>(loadOpen);
  const [menu, setMenu] = useState<{
    crew: SidebarCrew;
    x: number;
    y: number;
  } | null>(null);
  const toggle = (path: string) =>
    setOpen((current) => {
      const next = new Set(current);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      saveOpen(next);
      return next;
    });
  const showMenu = (event: ReactMouseEvent, crew: SidebarCrew) => {
    if (!onAction) return;
    event.preventDefault();
    event.stopPropagation();
    setMenu({ crew, x: event.clientX, y: event.clientY });
  };
  return (
    <>
      {crews.map((crew) => {
        const expanded = open.has(crew.path);
        const roles = crew.members.map((member) => ({
          id: member.id,
          role: member.role,
          ...(member.critter ? { critter: member.critter } : {}),
        }));
        const working = crew.members.find((member) => member.active)?.id;
        return (
          <Fragment key={`crew:${crew.path}`}>
            <div
              className="personal-crew-row"
              data-crew-row={crew.path}
              data-open={expanded || undefined}
              onContextMenu={(event) => showMenu(event, crew)}
            >
              <button
                type="button"
                className="personal-other-task personal-task-card personal-bot-row personal-crew-open"
                title={`${crew.project} crew · ${crew.runsLine}`}
                onClick={() => onOpenCrew?.(crew.path)}
              >
                <CrewCritters path={crew.path} roles={roles} active={working} />
                <span className="personal-task-title">{crew.project}</span>
              </button>
              <button
                type="button"
                className="personal-crew-fold"
                aria-expanded={expanded}
                aria-label={
                  expanded
                    ? `Fold ${crew.project}'s crew`
                    : `Show ${crew.project}'s crew`
                }
                onClick={() => toggle(crew.path)}
              >
                <ChevronRight className="size-3" />
              </button>
              <span className="personal-task-status">
                <CrewStatusPill status={crew.status} />
              </span>
            </div>
            {expanded ? (
              <div
                className="personal-crew-members"
                role="group"
                aria-label={`${crew.project}'s crew`}
              >
                {crew.members.map((member) => (
                  <button
                    key={member.id}
                    type="button"
                    className="personal-other-task personal-task-card personal-bot-row personal-crew-member"
                    data-crew-member={member.id}
                    data-crew-role={member.role}
                    title={`${member.name} · ${member.roleLabel}\n${member.job ?? CREW_ROLE_INFO[member.role].job}${member.line ? `\n${member.line}` : ""}`}
                    aria-current={
                      member.sessionId && member.sessionId === activeSessionId
                        ? "true"
                        : undefined
                    }
                    onClick={() => onOpenMember?.(crew.path, member.id)}
                    onContextMenu={(event) => showMenu(event, crew)}
                  >
                    <CrewCritter
                      path={crew.path}
                      role={member.role}
                      {...(member.critter ? { critter: member.critter } : {})}
                      active={member.active}
                    />
                    <span className="personal-crew-member-text">
                      <span className="personal-crew-member-name">
                        <span className="personal-task-title">
                          {member.name}
                        </span>
                        <span className="personal-crew-role">
                          {member.roleLabel}
                        </span>
                      </span>
                      {member.line ? (
                        <span className="personal-crew-line">
                          {member.line}
                        </span>
                      ) : null}
                    </span>
                    {member.status ? (
                      <span className="personal-task-status">
                        <CrewStatusPill status={member.status} />
                      </span>
                    ) : null}
                  </button>
                ))}
              </div>
            ) : null}
          </Fragment>
        );
      })}
      {menu ? (
        <ExplorerMenu
          x={menu.x}
          y={menu.y}
          items={crewMenuItems(menu.crew)}
          ariaLabel={`${menu.crew.project} crew actions`}
          onClose={() => setMenu(null)}
          onPick={(id) => {
            const path = menu.crew.path;
            setMenu(null);
            if (id === "runs") return;
            onAction?.(path, id as SidebarCrewAction);
          }}
        />
      ) : null}
    </>
  );
}

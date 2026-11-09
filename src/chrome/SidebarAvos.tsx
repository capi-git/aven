import { memo, useState, type KeyboardEvent } from "react";
import { useProjectTone } from "../hooks/useProjectTone";
import { agentOutfit, agentPhase } from "../lib/agentMark";
import { AVOS_NOTE_LABEL, type AvosGlance } from "../lib/avos";
import { avosMenuItems, runAvosMenu } from "../lib/avosMenu";
import { useCrewWorkspace } from "../lib/crewActions";
import { getCrew } from "../lib/crews";
import { AgentMark } from "./AgentMark";
import { AvosHelperMarks } from "./AvosHelperMarks";
import { ExplorerMenu } from "./ExplorerMenu";
import "./SidebarAvos.css";

/**
 * A project's Avos, the first row under the project in the sidebar: its Bot
 * in the project's colour, its name, its helpers' small faces while they
 * work (each popping out from Avos as it starts), and a short note on the
 * right only when it needs you (in amber) or is working. The first open is
 * meeting it. Right-click (or the menu key) gives Avos's own menu: Open,
 * Stop now while it works, What it remembers, Pause and Settings.
 */
export const SidebarAvosRow = memo(function SidebarAvosRow({
  avos,
  active,
  onOpen,
}: {
  avos: AvosGlance;
  /** Its screen is the one in front. */
  active?: boolean;
  onOpen?: (path: string) => void;
}) {
  const tone = useProjectTone(avos.path);
  const workspace = useCrewWorkspace();
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const menuKey = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key !== "ContextMenu" && !(event.shiftKey && event.key === "F10"))
      return;
    event.preventDefault();
    const rect = event.currentTarget.getBoundingClientRect();
    setMenu({ x: rect.left, y: rect.bottom });
  };
  return (
    <>
      <button
        type="button"
        className="personal-other-task personal-task-card personal-avos-row"
        data-avos-row={avos.path}
        data-avos-note={avos.note ?? undefined}
        data-tour="avos"
        aria-current={active ? "true" : undefined}
        title={
          avos.line ? `Avos · ${avos.line}` : "Avos looks after this project"
        }
        disabled={!onOpen}
        onClick={() => onOpen?.(avos.path)}
        onContextMenu={(event) => {
          event.preventDefault();
          setMenu({ x: event.clientX, y: event.clientY });
        }}
        onKeyDown={menuKey}
      >
        <span className="personal-task-lead">
          <AgentMark
            tone={tone}
            state={avos.state}
            outfit={agentOutfit("lead")}
            phase={agentPhase("lead")}
            className="personal-avos-mark"
          />
        </span>
        <span className="personal-task-title">Avos</span>
        {avos.helpers?.length ? (
          <AvosHelperMarks path={avos.path} helpers={avos.helpers} />
        ) : null}
        {avos.note ? (
          <span className="personal-task-status personal-avos-note">
            {AVOS_NOTE_LABEL[avos.note]}
          </span>
        ) : null}
      </button>
      {menu ? (
        <ExplorerMenu
          x={menu.x}
          y={menu.y}
          ariaLabel="Avos actions"
          items={avosMenuItems({
            paused: !!getCrew(avos.path)?.paused,
            working: avos.note === "working",
            dailyCap: false,
            open: !!onOpen,
          })}
          onClose={() => setMenu(null)}
          onPick={(id) => {
            setMenu(null);
            if (id === "open") onOpen?.(avos.path);
            else runAvosMenu(id, avos.path, workspace);
          }}
        />
      ) : null}
    </>
  );
});

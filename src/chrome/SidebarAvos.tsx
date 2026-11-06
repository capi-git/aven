import { memo } from "react";
import { useProjectTone } from "../hooks/useProjectTone";
import { agentOutfit, agentPhase } from "../lib/agentMark";
import { AVOS_NOTE_LABEL, type AvosGlance } from "../lib/avos";
import { AgentMark } from "./AgentMark";
import "./SidebarAvos.css";

/**
 * A project's Avos, the first row under the project in the sidebar: its Bot
 * in the project's colour, its name, and a short note on the right only when
 * it needs you (in amber) or is working. The first open is meeting it.
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
  return (
    <button
      type="button"
      className="personal-other-task personal-task-card personal-avos-row"
      data-avos-row={avos.path}
      data-avos-note={avos.note ?? undefined}
      aria-current={active ? "true" : undefined}
      title={
        avos.line ? `Avos · ${avos.line}` : "Avos looks after this project"
      }
      disabled={!onOpen}
      onClick={() => onOpen?.(avos.path)}
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
      {avos.note ? (
        <span className="personal-task-status personal-avos-note">
          {AVOS_NOTE_LABEL[avos.note]}
        </span>
      ) : null}
    </button>
  );
});

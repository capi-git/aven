import { memo } from "react";
import { CrewCritter } from "../chrome/CrewCritter";
import { useProjectAppearance } from "../hooks/useProjectAppearance";
import { setCrewPaused, useCrewWorkspace } from "../lib/crewActions";
import {
  CREW_ROLE_INFO,
  crewMemberName,
  useCrew,
  type CrewRole,
} from "../lib/crews";
import { projectName } from "../lib/paths";
import "../chrome/TeamCard.css";
import "./BotChat.css";

/**
 * A crew member's chat header: its critter, whose crew it is, its role and
 * job, Pause and Settings. Its name is the tab's, so it isn't repeated.
 */
export const CrewChatHeader = memo(function CrewChatHeader({
  path,
  role,
  working,
}: {
  path: string;
  role: CrewRole;
  working: boolean;
}) {
  const crew = useCrew(path);
  const appearance = useProjectAppearance(path);
  const workspace = useCrewWorkspace();
  const project = appearance?.label || projectName(path);
  const info = CREW_ROLE_INFO[role];
  const paused = !!crew?.paused;
  return (
    <header className="bot-chat-header" data-crew-header={role}>
      <CrewCritter
        path={path}
        role={role}
        active={working}
        className="bot-chat-critter"
      />
      <div className="bot-chat-heading">
        <span className="bot-chat-whose">
          {`${project} crew · ${info.label} · ${info.job.toLowerCase()}`}
        </span>
      </div>
      <div className="bot-chat-actions">
        <button
          type="button"
          className="team-card-button"
          onClick={() => setCrewPaused(path, !paused)}
          disabled={!crew?.on}
        >
          {paused ? "Resume" : "Pause"}
        </button>
        <button
          type="button"
          className="team-card-button"
          onClick={() => workspace?.openSettings(path)}
          disabled={!workspace}
        >
          Settings
        </button>
      </div>
    </header>
  );
});

/** Before its first turn: who it is, in one line. */
export function CrewIntro({ path, role }: { path: string; role: CrewRole }) {
  const crew = useCrew(path);
  if (!crew) return null;
  const name = crewMemberName(crew, role);
  const line =
    role === "builder"
      ? "I build the cards you give the crew, in the crew's own copy. The Checker looks at each round before you see it."
      : role === "checker"
        ? "I check every build with fresh eyes before you see it. I can't change the files; I pass a card or send it back."
        : "I look over the project once a day and suggest small ideas. Small ones start by themselves, within the crew's limits.";
  return (
    <div className="bot-chat-intro" data-crew-intro={role}>
      <CrewCritter path={path} role={role} className="bot-chat-intro-critter" />
      <div className="bot-chat-intro-body">
        <span className="bot-chat-intro-name">{name}</span>
        <p className="bot-chat-intro-text">
          {line} I never push or publish; you apply and ship.
        </p>
      </div>
    </div>
  );
}

import { useState } from "react";
import { memberAppLine } from "../chrome/crewSettingsParts";
import { CrewCritter } from "../chrome/CrewCritter";
import { TeamCardButton } from "../chrome/TeamCard";
import {
  firstCardChatText,
  teammateChatReady,
  useCrewWorkspace,
} from "../lib/crewActions";
import { crewMemberById, type Crew } from "../lib/crews";
import type { CrewMemberView } from "../lib/crewView";
import { helperWord } from "../lib/avos";
import "./AvosAgents.css";

/**
 * Sub agents, in Avos's header: the helpers Avos has brought in (and any
 * one-job sub-agent a helper started), each with its Bot, name, one word on
 * how it is, and what it's doing; Open chat and Settings (its model,
 * instructions, routine and notes) on each, and Add a helper at the foot.
 */
export function AvosAgents({
  project,
  crew,
  members,
  name,
}: {
  project: string;
  crew: Crew;
  members: readonly CrewMemberView[];
  name: (who: string) => string;
}) {
  const workspace = useCrewWorkspace();
  // Why a helper's chat didn't open, under its row.
  const [problem, setProblem] = useState<{ id: string; text: string } | null>(
    null,
  );
  const helpers = members.filter((member) => member.role !== "lead");
  const subAgents = crew.helpers ?? [];
  return (
    <div className="avos-agents" data-avos-agents>
      {helpers.length || subAgents.length ? (
        <ul className="avos-agents-list" role="list">
          {helpers.map((member) => {
            const word = helperWord(member);
            const stored = crewMemberById(crew, member.id);
            const ready = teammateChatReady(crew, member.id);
            return (
              <li
                key={member.id}
                className="avos-agent"
                data-avos-agent={member.id}
              >
                <CrewCritter
                  path={project}
                  role={member.role}
                  {...(member.critter ? { critter: member.critter } : {})}
                  state={
                    word === "Needs you"
                      ? "needs"
                      : word === "Working"
                        ? "working"
                        : "resting"
                  }
                  className="avos-agent-mark"
                />
                <div className="avos-agent-text">
                  <p className="avos-agent-name">
                    <b>{member.name}</b>
                    {member.name !== member.roleLabel ? (
                      <span>{member.roleLabel}</span>
                    ) : null}
                  </p>
                  <p className="avos-agent-line">
                    {member.line ??
                      (stored ? memberAppLine(stored) : member.roleLabel)}
                  </p>
                  {problem?.id === member.id || !ready ? (
                    <p
                      className="avos-agent-note"
                      role="status"
                      data-avos-agent-note
                    >
                      {problem?.id === member.id
                        ? problem.text
                        : firstCardChatText(member.name)}
                    </p>
                  ) : null}
                </div>
                <span
                  className="avos-agent-word"
                  data-needs-you={word === "Needs you" || undefined}
                >
                  {word}
                </span>
                <span className="avos-agent-tools">
                  <TeamCardButton
                    size="compact"
                    disabled={!ready}
                    title={ready ? undefined : firstCardChatText(member.name)}
                    data-avos-agent-chat
                    onClick={() => {
                      setProblem(null);
                      void Promise.resolve(
                        workspace?.openChat(project, member.id),
                      ).then((why) =>
                        setProblem(why ? { id: member.id, text: why } : null),
                      );
                    }}
                  >
                    Open chat
                  </TeamCardButton>
                  <TeamCardButton
                    size="compact"
                    data-avos-agent-settings
                    onClick={() => workspace?.openSettings(project, member.id)}
                  >
                    Settings
                  </TeamCardButton>
                </span>
              </li>
            );
          })}
          {subAgents.map((helper) => (
            <li
              key={helper.id}
              className="avos-agent"
              data-avos-agent={helper.id}
              data-avos-sub-agent
            >
              <CrewCritter
                path={project}
                role="helper"
                state="working"
                className="avos-agent-mark"
              />
              <div className="avos-agent-text">
                <p className="avos-agent-name">
                  <b>{helper.name ?? "Sub agent"}</b>
                  <span>
                    For {helper.helperOf ? name(helper.helperOf) : "Avos"}
                  </span>
                </p>
                <p className="avos-agent-line">
                  {helper.doing?.text ?? "Looking into one thing, then goes"}
                </p>
              </div>
              <span className="avos-agent-word">Working</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="avos-agents-empty">
          No helpers yet. Avos brings one in when work needs it.
        </p>
      )}
      <div className="avos-agents-add">
        <TeamCardButton
          size="compact"
          data-avos-add-helper
          onClick={() => workspace?.openSettings(project, "add")}
        >
          Add a helper
        </TeamCardButton>
      </div>
    </div>
  );
}

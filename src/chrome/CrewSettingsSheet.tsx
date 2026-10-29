import { useState } from "react";
import { useProjectAppearance } from "../hooks/useProjectAppearance";
import { Toggle } from "../surfaces/SettingsControls";
import {
  setCrewPaused,
  setCrewQuietHours,
  turnOffCrew,
} from "../lib/crewActions";
import { crewLimitRows, quietText } from "../lib/crewLimits";
import {
  CREW_ROLE_INFO,
  crewMemberName,
  crewMembers,
  useCrew,
} from "../lib/crews";
import { projectName } from "../lib/paths";
import { ALWAYS_ASKS_LINE } from "../lib/projectBotPermissions";
import { formatClockMinutes } from "../lib/projectBots";
import { CrewCritter, CrewCritters } from "./CrewCritter";
import { Modal } from "./Modal";
import "./TeamCard.css";
import "./BotSettingsSheet.css";
import "./CrewCritter.css";

/** Whole hours a quiet time can start or end at, as the pickers list them. */
const HOURS = Array.from({ length: 24 }, (_, hour) => hour * 60);

/**
 * A crew's settings: who is in it and what each does, quiet hours (the one
 * limit you set), the fixed limits as plain counts, Pause and Turn off. The
 * crew works only while Aven is open and the Mac awake.
 */
export function CrewSettingsSheet({
  path,
  fixerName,
  onTurnOn,
  onClose,
}: {
  path: string;
  fixerName?: string;
  /** Turn the crew on (it is off). Resolves with why it couldn't, or null. */
  onTurnOn: (path: string) => Promise<string | null>;
  onClose: () => void;
}) {
  const crew = useCrew(path);
  const appearance = useProjectAppearance(path);
  const project = appearance?.label || projectName(path);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [confirmingOff, setConfirmingOff] = useState(false);
  if (!crew) return null;
  const quiet = crew.limits.quiet;
  const members = crewMembers(crew).filter(
    (member) => member.role !== "fixer" || !!fixerName,
  );
  const turnOn = async () => {
    setBusy(true);
    setProblem(null);
    const error = await onTurnOn(path);
    setBusy(false);
    if (error) setProblem(error);
  };
  return (
    <Modal
      onClose={onClose}
      title={`${project} crew`}
      description="Works only while Aven is open and your Mac is awake"
      size="sm"
      className="bot-sheet crew-settings"
      leading={
        <span className="bot-sheet-critter">
          <CrewCritters
            path={path}
            roles={members.map((member) => member.role)}
          />
        </span>
      }
      trailing={
        <Toggle
          label="Crew on"
          on={crew.on}
          disabled={busy}
          onChange={(on) => {
            if (on) void turnOn();
            else setConfirmingOff(true);
          }}
        />
      }
    >
      {confirmingOff ? (
        <div className="bot-sheet-body">
          <p className="bot-sheet-question">Turn the crew off?</p>
          <p className="bot-sheet-note">
            What it is doing stops and nothing new starts. Its cards and its
            copy stay, so Ready work is still there when you turn it on.
          </p>
          <div className="bot-sheet-actions">
            <button
              type="button"
              className="team-card-button"
              onClick={() => setConfirmingOff(false)}
            >
              Keep it on
            </button>
            <button
              type="button"
              className="team-card-button"
              data-variant="primary"
              onClick={() => {
                void turnOffCrew(path);
                setConfirmingOff(false);
              }}
            >
              Turn off
            </button>
          </div>
        </div>
      ) : (
        <div className="bot-sheet-body" data-crew-settings={path}>
          {members.map((member) => (
            <div
              key={member.role}
              className="bot-sheet-row crew-settings-member"
            >
              <CrewCritter path={path} role={member.role} />
              <span>
                <strong>
                  {crewMemberName(crew, member.role, fixerName)}{" "}
                  <small className="crew-settings-role">
                    {CREW_ROLE_INFO[member.role].label}
                  </small>
                </strong>
                <small>{CREW_ROLE_INFO[member.role].job}</small>
              </span>
            </div>
          ))}
          <div className="bot-sheet-row">
            <span>
              Quiet hours
              <small>
                {quiet.on
                  ? `Nothing new starts ${quietText(quiet)}`
                  : "The crew may start work at any hour"}
              </small>
            </span>
            <Toggle
              label="Quiet hours"
              on={quiet.on}
              onChange={(on) => setCrewQuietHours(path, { ...quiet, on })}
            />
          </div>
          {quiet.on ? (
            <div className="bot-sheet-row crew-settings-hours">
              <label>
                From
                <select
                  value={quiet.start - (quiet.start % 60)}
                  onChange={(event) =>
                    setCrewQuietHours(path, {
                      ...quiet,
                      start: Number(event.target.value),
                    })
                  }
                >
                  {HOURS.map((minutes) => (
                    <option key={minutes} value={minutes}>
                      {formatClockMinutes(minutes)}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                to
                <select
                  value={quiet.end - (quiet.end % 60)}
                  onChange={(event) =>
                    setCrewQuietHours(path, {
                      ...quiet,
                      end: Number(event.target.value),
                    })
                  }
                >
                  {HOURS.map((minutes) => (
                    <option key={minutes} value={minutes}>
                      {formatClockMinutes(minutes)}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          ) : null}
          <ul className="crew-settings-limits">
            {crewLimitRows(crew).map((row) => (
              <li key={row.title}>
                <strong>{row.title}</strong>
                <small>{row.detail}</small>
              </li>
            ))}
          </ul>
          <p className="bot-sheet-note">{ALWAYS_ASKS_LINE}</p>
          {problem ? (
            <p className="bot-sheet-problem" role="alert">
              {problem}
            </p>
          ) : null}
          <div className="bot-sheet-actions">
            {crew.on ? (
              <button
                type="button"
                className="team-card-button"
                data-variant="ghost"
                onClick={() => setCrewPaused(path, !crew.paused)}
              >
                {crew.paused ? "Resume crew" : "Pause crew"}
              </button>
            ) : null}
            <button
              type="button"
              className="team-card-button"
              data-variant="primary"
              onClick={onClose}
            >
              Done
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}

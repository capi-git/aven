import { useId, useState } from "react";
import { useProjectAppearance } from "../hooks/useProjectAppearance";
import { Toggle } from "../surfaces/SettingsControls";
import { projectName } from "../lib/paths";
import { saveBotSettings, turnOffProjectBot } from "../lib/projectBotActions";
import { ALWAYS_ASKS_LINE } from "../lib/projectBotPermissions";
import {
  BOT_DEFAULT_PAUSE_PERCENT,
  BOT_DEFAULT_QUIET,
  BOT_DEFAULT_RUNS_PER_DAY,
  BOT_WAKE_KINDS,
  defaultBotName,
  formatClockMinutes,
  useProjectBot,
} from "../lib/projectBots";
import { BotCritter } from "./BotCritter";
import { Modal } from "./Modal";
import "./TeamCard.css";
import "./BotSettingsSheet.css";

/** The fixed limits, said once in small print. */
export const BOT_LIMITS_LINE = `Up to ${BOT_DEFAULT_RUNS_PER_DAY} runs a day, quiet ${formatClockMinutes(
  BOT_DEFAULT_QUIET.start,
)}–${formatClockMinutes(BOT_DEFAULT_QUIET.end)}, and it pauses once Claude is ${BOT_DEFAULT_PAUSE_PERCENT}% used for the week.`;

/**
 * A bot's settings, for a bot that is on (turning one on needs none): its
 * name, three switches that apply as you flip them, and Turn off, which
 * asks first.
 */
export function BotSettingsSheet({
  path,
  onClose,
}: {
  path: string;
  onClose: () => void;
}) {
  const bot = useProjectBot(path);
  const appearance = useProjectAppearance(path);
  const fallbackName = defaultBotName(path, appearance?.mascot);
  const project = appearance?.label || projectName(path);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [confirmingOff, setConfirmingOff] = useState(false);
  const nameId = useId();
  if (!bot) return null;
  const name = bot.name?.trim() || fallbackName;

  const turnOff = async () => {
    setBusy(true);
    const error = await turnOffProjectBot(path);
    setBusy(false);
    if (error) {
      setProblem(error);
      setConfirmingOff(false);
      return;
    }
    onClose();
  };

  return (
    <Modal
      onClose={onClose}
      // The name is the sheet's title and its field: a Name row below would
      // only say it twice.
      title={
        <input
          id={nameId}
          aria-label="Name"
          className="bot-sheet-title-field"
          defaultValue={name}
          placeholder={fallbackName}
          maxLength={40}
          spellCheck={false}
          onChange={(event) => {
            const next = event.target.value.trim();
            // The default name is never stored, so it can follow the
            // project's mascot.
            saveBotSettings(path, {
              name: next && next !== fallbackName ? next : undefined,
            });
          }}
        />
      }
      description={`${project}'s teammate`}
      size="sm"
      className="bot-sheet"
      leading={
        <span className="bot-sheet-critter">
          <BotCritter path={path} className="bot-sheet-critter-sprite" />
        </span>
      }
    >
      {confirmingOff ? (
        <div className="bot-sheet-body">
          <p className="bot-sheet-question">Turn off {name}?</p>
          <p className="bot-sheet-note">
            It stops, and its copy of {project} is removed, along with any fix
            waiting there. Your files and its chat stay as they are.
          </p>
          <div className="bot-sheet-actions">
            <button
              type="button"
              className="team-card-button"
              disabled={busy}
              onClick={() => setConfirmingOff(false)}
            >
              Keep it on
            </button>
            <button
              type="button"
              className="team-card-button"
              data-variant="primary"
              disabled={busy}
              onClick={() => void turnOff()}
            >
              {busy ? "Turning off…" : "Turn off"}
            </button>
          </div>
        </div>
      ) : (
        <div className="bot-sheet-body">
          {BOT_WAKE_KINDS.map((info) => (
            <div key={info.kind} className="bot-sheet-row">
              <span>{info.label}</span>
              <Toggle
                label={info.label}
                on={bot.wakes[info.kind]}
                onChange={(on) =>
                  saveBotSettings(path, {
                    wakes: { ...bot.wakes, [info.kind]: on },
                  })
                }
              />
            </div>
          ))}
          <div className="bot-sheet-row">
            <span>
              Start fixes on its own
              <small>
                {bot.can.fix
                  ? "In its own copy. Your files change only when you apply a fix."
                  : "It only tells you what it found."}
              </small>
            </span>
            <Toggle
              label="Start fixes on its own"
              on={bot.can.fix}
              onChange={(fix) => saveBotSettings(path, { can: { fix } })}
            />
          </div>
          <p className="bot-sheet-note">{ALWAYS_ASKS_LINE}</p>
          <p className="bot-sheet-small">{BOT_LIMITS_LINE}</p>
          {problem ? (
            <p className="bot-sheet-problem" role="alert">
              {problem}
            </p>
          ) : null}
          <div className="bot-sheet-actions">
            {bot.on ? (
              <button
                type="button"
                className="team-card-button"
                data-variant="ghost"
                disabled={busy}
                onClick={() => setConfirmingOff(true)}
              >
                Turn off
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

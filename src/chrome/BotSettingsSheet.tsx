import { useEffect, useId, useState } from "react";
import { useProjectAppearance } from "../hooks/useProjectAppearance";
import { Toggle } from "../surfaces/SettingsControls";
import {
  isHarnessAvailable,
  probeHarnessAvailability,
} from "../lib/harness/availability";
import { projectName } from "../lib/paths";
import {
  saveBotSettings,
  turnOffProjectBot,
  turnOnProjectBot,
} from "../lib/projectBotActions";
import { ALWAYS_ASKS_LINE } from "../lib/projectBotPermissions";
import {
  BOT_DEFAULT_PAUSE_PERCENT,
  BOT_DEFAULT_QUIET,
  BOT_DEFAULT_RUNS_PER_DAY,
  BOT_WAKE_KINDS,
  defaultBotName,
  defaultWakes,
  formatClockMinutes,
  useProjectBot,
  type BotWakeKind,
} from "../lib/projectBots";
import { BotCritter } from "./BotCritter";
import { Modal } from "./Modal";
import "./TeamCard.css";
import "./BotSettingsSheet.css";

/** The fixed limits, said once in small print. */
export const BOT_LIMITS_LINE = `Up to ${BOT_DEFAULT_RUNS_PER_DAY} runs a day, quiet ${formatClockMinutes(
  BOT_DEFAULT_QUIET.start,
)}–${formatClockMinutes(BOT_DEFAULT_QUIET.end)}, and it pauses once Claude is ${BOT_DEFAULT_PAUSE_PERCENT}% used for the week.`;

type Draft = {
  name: string;
  on: boolean;
  wakes: Record<BotWakeKind, boolean>;
  fix: boolean;
};

/**
 * A project's bot: its name and critter, an On switch, what wakes it and
 * whether it starts fixes on its own. Opened from the project's menu, its
 * Home tile or its chat. Changes apply on Done; turning it on makes its copy
 * of the project first, and says so plainly when the folder is not a Git
 * project.
 */
export function BotSettingsSheet({
  path,
  onClose,
  onTurnedOn,
}: {
  path: string;
  onClose: () => void;
  /** The bot was just turned on: show its chat. */
  onTurnedOn?: (path: string) => void;
}) {
  const bot = useProjectBot(path);
  const appearance = useProjectAppearance(path);
  const fallbackName = defaultBotName(path, appearance?.mascot);
  const project = appearance?.label || projectName(path);
  const [draft, setDraft] = useState<Draft>(() => ({
    name: bot?.name ?? "",
    // Opening the sheet for a bot that is off is how you turn it on.
    on: true,
    wakes: bot?.wakes ?? defaultWakes(),
    fix: bot?.can.fix ?? true,
  }));
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [confirmingOff, setConfirmingOff] = useState(false);
  const [claude, setClaude] = useState(() => isHarnessAvailable("claude"));
  const nameId = useId();
  const name = draft.name.trim() || fallbackName;
  const wasOn = !!bot?.on;

  useEffect(() => {
    let live = true;
    void probeHarnessAvailability().then(() => {
      if (live) setClaude(isHarnessAvailable("claude"));
    });
    return () => {
      live = false;
    };
  }, []);

  const settings = () => ({
    name: draft.name.trim() || undefined,
    wakes: draft.wakes,
    can: { fix: draft.fix },
  });

  const done = async () => {
    if (busy) return;
    setProblem(null);
    if (!draft.on) {
      if (wasOn) setConfirmingOff(true);
      else onClose();
      return;
    }
    if (wasOn) {
      saveBotSettings(path, settings());
      onClose();
      return;
    }
    setBusy(true);
    const error = await turnOnProjectBot(path, settings(), name);
    setBusy(false);
    if (error) {
      setProblem(error);
      return;
    }
    onClose();
    onTurnedOn?.(path);
  };

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

  const blocked = draft.on && !wasOn && !claude;

  return (
    <Modal
      onClose={onClose}
      title={name}
      description={`${project}'s bot`}
      size="sm"
      className="bot-sheet"
      leading={
        <span className="bot-sheet-critter">
          <BotCritter path={path} className="bot-sheet-critter-sprite" />
        </span>
      }
      trailing={
        <span className="bot-sheet-on">
          <span aria-hidden>{draft.on ? "On" : "Off"}</span>
          <Toggle
            label={`${name} is on`}
            on={draft.on}
            disabled={busy}
            onChange={(on) => setDraft((current) => ({ ...current, on }))}
          />
        </span>
      }
    >
      {confirmingOff ? (
        <div className="bot-sheet-body">
          <p className="bot-sheet-question">Turn off {name}?</p>
          <p className="bot-sheet-note">
            Its copy of {project}, and any fix waiting there, will be removed.
            Your files and its chat stay as they are.
          </p>
          <div className="bot-sheet-actions">
            <button
              type="button"
              className="team-card-button"
              disabled={busy}
              onClick={() => {
                setConfirmingOff(false);
                setDraft((current) => ({ ...current, on: true }));
              }}
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
          <label className="bot-sheet-row" htmlFor={nameId}>
            <span>Name</span>
            <input
              id={nameId}
              className="bot-sheet-name"
              value={draft.name}
              placeholder={fallbackName}
              maxLength={40}
              spellCheck={false}
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  name: event.target.value,
                }))
              }
            />
          </label>
          {BOT_WAKE_KINDS.map((info) => (
            <div key={info.kind} className="bot-sheet-row">
              <span>{info.label}</span>
              <Toggle
                label={info.label}
                on={draft.wakes[info.kind]}
                disabled={!draft.on}
                onChange={(on) =>
                  setDraft((current) => ({
                    ...current,
                    wakes: { ...current.wakes, [info.kind]: on },
                  }))
                }
              />
            </div>
          ))}
          <div className="bot-sheet-row">
            <span>
              Start fixes on its own
              <small>
                {draft.fix
                  ? "In its own copy. Your files change only when you apply a fix."
                  : "It only tells you what it found."}
              </small>
            </span>
            <Toggle
              label="Start fixes on its own"
              on={draft.fix}
              disabled={!draft.on}
              onChange={(fix) => setDraft((current) => ({ ...current, fix }))}
            />
          </div>
          <p className="bot-sheet-note">{ALWAYS_ASKS_LINE}</p>
          <p className="bot-sheet-small">{BOT_LIMITS_LINE}</p>
          {blocked ? (
            <p className="bot-sheet-problem" role="status">
              Bots use Claude Code. Install it and sign in, then turn the bot
              on.
            </p>
          ) : null}
          {problem ? (
            <p className="bot-sheet-problem" role="alert">
              {problem}
            </p>
          ) : null}
          <div className="bot-sheet-actions">
            {wasOn ? (
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
              disabled={busy || blocked}
              onClick={() => void done()}
            >
              {busy ? "Setting up its copy…" : "Done"}
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}

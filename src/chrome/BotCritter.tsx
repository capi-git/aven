import { memo } from "react";
import { useProjectAppearance } from "../hooks/useProjectAppearance";
import {
  BOT_STATUS_LABEL,
  BOT_STATUS_STAGE,
  type BotStatus,
} from "../lib/projectBots";
import { DotMark, type DotMarkState } from "./DotMark";
import "./ChatStatusPill.css";
import "./BotCritter.css";

/**
 * A project's bot, drawn as the Fixer's mark: the bot is its project's
 * crew's Fixer wherever it shows (the sidebar, its tab and chat, Home).
 */
export const BotCritter = memo(function BotCritter({
  path,
  active = false,
  state,
  className = "bot-critter",
}: {
  path: string;
  /** Sweeps a light across it while the bot works. */
  active?: boolean;
  /** A state of its own, over `active`. */
  state?: DotMarkState;
  className?: string;
}) {
  const appearance = useProjectAppearance(path);
  if (!appearance) return null;
  return (
    <DotMark
      sigil="fixer"
      state={state ?? (active ? "working" : "still")}
      className={className}
    />
  );
});

/** The bot's one word as a small pill, in the chat status pill's tones. */
export function BotStatusPill({ status }: { status: BotStatus }) {
  return (
    <span
      className="aven-chat-status"
      data-bot-status={status}
      data-stage={BOT_STATUS_STAGE[status]}
    >
      {BOT_STATUS_LABEL[status]}
    </span>
  );
}

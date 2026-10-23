import { memo } from "react";
import { useProjectAppearance } from "../hooks/useProjectAppearance";
import {
  BOT_STATUS_LABEL,
  BOT_STATUS_STAGE,
  type BotStatus,
} from "../lib/projectBots";
import { ProjectMascot } from "./ProjectMascot";
import "./ChatStatusPill.css";
import "./BotCritter.css";

/**
 * A project's bot drawn as the project's critter, in the project colour,
 * even where the project shows a logo: the bot is the critter.
 */
export const BotCritter = memo(function BotCritter({
  path,
  active = false,
  className = "bot-critter",
}: {
  path: string;
  /** Steps its two frames while the bot works. */
  active?: boolean;
  className?: string;
}) {
  const appearance = useProjectAppearance(path);
  if (!appearance) return null;
  return (
    <ProjectMascot
      project={appearance.key}
      name={appearance.mascot}
      color={appearance.color}
      active={active}
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

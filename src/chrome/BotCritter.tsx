import { memo } from "react";
import { useProjectAppearance } from "../hooks/useProjectAppearance";
import {
  botHopperState,
  hopperWatchOffset,
  type HopperState,
} from "../lib/hopper";
import { appearanceTone } from "../lib/markTones";
import {
  BOT_STATUS_LABEL,
  BOT_STATUS_STAGE,
  type BotStatus,
} from "../lib/projectBots";
import { HopperMark } from "./HopperMark";
import "./ChatStatusPill.css";
import "./BotCritter.css";

/**
 * A project's bot, drawn as Hopper in its project's colour wherever it
 * shows (the sidebar, its tab and chat, Home): watching from the top step,
 * hopping up while it works, amber when it needs you.
 */
export const BotCritter = memo(function BotCritter({
  path,
  active = false,
  status,
  state,
  className = "bot-critter",
}: {
  path: string;
  /** Hops up its steps while the bot works. */
  active?: boolean;
  /** The bot's word, which picks its state when `state` is not given. */
  status?: BotStatus;
  /** A state of its own, over `status` and `active`. */
  state?: HopperState;
  className?: string;
}) {
  const appearance = useProjectAppearance(path);
  if (!appearance) return null;
  return (
    <HopperMark
      tone={appearanceTone(appearance)}
      state={
        state ??
        (active ? "working" : status ? botHopperState(status) : "still")
      }
      offset={hopperWatchOffset("fixer")}
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

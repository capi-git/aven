import { memo } from "react";
import { useProjectAppearance } from "../hooks/useProjectAppearance";
import {
  agentOutfit,
  agentPhase,
  botAgentState,
  type AgentState,
} from "../lib/agentMark";
import { appearanceTone } from "../lib/markTones";
import {
  BOT_STATUS_LABEL,
  BOT_STATUS_STAGE,
  type BotStatus,
} from "../lib/projectBots";
import { AgentMark } from "./AgentMark";
import "./ChatStatusPill.css";
import "./BotCritter.css";

/**
 * A project's bot (its team's Fixer), drawn as Bot in its project's colour
 * wherever it shows (the sidebar, its tab and chat, Home), with the Fixer's
 * plus badge at 28 px and up: watching, working, amber when it needs you.
 */
export const BotCritter = memo(function BotCritter({
  path,
  active = false,
  status,
  state,
  className = "bot-critter",
}: {
  path: string;
  /** Works while true. */
  active?: boolean;
  /** The bot's word, which picks its state when `state` is not given. */
  status?: BotStatus;
  /** A state of its own, over `status` and `active`. */
  state?: AgentState;
  className?: string;
}) {
  const appearance = useProjectAppearance(path);
  if (!appearance) return null;
  return (
    <AgentMark
      tone={appearanceTone(appearance)}
      state={
        state ?? (active ? "working" : status ? botAgentState(status) : "still")
      }
      outfit={agentOutfit("fixer")}
      phase={agentPhase("fixer")}
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

import type { OrbLook } from "@yogesharc/thinking-orbs";
import type { AgentState } from "./agentMark";
import { isAgentTool, isSearchTool } from "./harness/preview";
import type { Session } from "./session";
import { sessionHoldUps } from "./sessionHoldUp";

/**
 * What a working agent is doing, finer than `working`, for its orb: the
 * Thinking Orbs state that draws it (thinkingorbs.com).
 */
export type OrbActivity =
  | "reasoning"
  | "searching"
  | "using"
  | "background"
  | "retrying"
  | "compacting"
  | "waiting";

/** A tool that drives a browser or the Mac, by its name or kind. */
const USING_TOOL = /browser|computer[_ -]?use|screenshot|playwright/i;

/**
 * What the current turn of `session` is doing, as an orb activity: the
 * latest thing it did since your last message. Undefined while it writes
 * or runs an ordinary tool (plain `working`).
 */
export function sessionOrbActivity(session: Session): OrbActivity | undefined {
  const holdUp = sessionHoldUps(session)[0];
  if (holdUp?.kind === "retrying") return "retrying";
  if (holdUp?.kind === "usage-limit") return "waiting";
  if (holdUp?.kind === "helpers") return "background";
  const blocks = session.blocks;
  for (let index = blocks.length - 1; index >= 0; index--) {
    const block = blocks[index];
    if (block.role === "user") break;
    if (block.role === "reasoning") return "reasoning";
    if (block.role === "plan") return "reasoning";
    if (block.role !== "tool") return undefined;
    const kind = block.tool?.kind;
    const name = block.tool?.title || block.text;
    if (/compact/i.test(name ?? "")) return "compacting";
    if (isAgentTool(kind, name)) return "background";
    if (isSearchTool(kind, name, block.tool?.preview)) return "searching";
    // A tool on a file or a command is plain work, whatever its path says.
    const preview = block.tool?.preview;
    if (
      !preview?.path &&
      preview?.kind !== "shell" &&
      USING_TOOL.test(`${kind ?? ""} ${name ?? ""}`)
    )
      return "using";
    return undefined;
  }
  return "reasoning";
}

/**
 * The orb an agent's mark draws for its state: idle and still at rest, the comet
 * while it watches or waits, the running ring (or its finer activity)
 * while it works, idle blinking when it needs you or its work is ready.
 */
export function orbLook(
  state: AgentState,
  activity?: OrbActivity,
): OrbLook & { moving: boolean } {
  switch (state) {
    case "working":
      return activity
        ? { state: activity, moving: true }
        : { state: "working", moving: true };
    case "watching":
      return { state: "waiting", moving: true };
    case "needs":
      return { state: "idle", variant: "blink", moving: true };
    case "ready":
      return { state: "idle", variant: "blink", moving: false };
    default:
      return { state: "idle", moving: false };
  }
}

import { isAgentTool } from "./harness/preview";
import type { Block } from "./session";

/**
 * Subagents a chat started, drawn as one card: a header with how many there
 * are and how many still run, then a row each with its name, what it is doing
 * now, its agent type and how long it has run.
 */

export type SubagentState =
  "running" | "waiting" | "done" | "failed" | "stopped" | "ended";

/** One step of a phase, or a run of subagent calls side by side. */
export type SubagentStepGroup =
  | { type: "step"; block: Block }
  | { type: "subagents"; id: string; blocks: Block[] };

export function isSubagentBlock(block: Block): boolean {
  return (
    block.role === "tool" &&
    isAgentTool(block.tool?.kind, block.text || block.tool?.title)
  );
}

/**
 * Steps in order, with each run of subagent calls next to one another made
 * into one group. Other steps stay as they are.
 */
export function groupSubagentSteps(steps: Block[]): SubagentStepGroup[] {
  const groups: SubagentStepGroup[] = [];
  for (const block of steps) {
    const last = groups[groups.length - 1];
    if (isSubagentBlock(block)) {
      if (last?.type === "subagents") last.blocks.push(block);
      else groups.push({ type: "subagents", id: block.id, blocks: [block] });
    } else {
      groups.push({ type: "step", block });
    }
  }
  return groups;
}

/** True when a phase's steps are only subagent calls. */
export function onlySubagents(steps: Block[]): boolean {
  return steps.length > 0 && steps.every(isSubagentBlock);
}

/**
 * Where a subagent is. `live` is whether its turn still runs: a call that
 * never heard its end in a finished turn has ended, how is not known.
 */
export function subagentState(block: Block, live: boolean): SubagentState {
  const status = block.tool?.status?.toLowerCase() ?? "";
  if (status === "completed" || status === "success") return "done";
  if (
    status === "failed" ||
    status === "error" ||
    block.approval?.decided === "deny"
  )
    return "failed";
  if (
    status === "stopped" ||
    status === "killed" ||
    status === "cancelled" ||
    status === "canceled"
  )
    return "stopped";
  if (!live) return "ended";
  if (status === "waiting" || status === "paused") return "waiting";
  return "running";
}

export function subagentIsActive(state: SubagentState): boolean {
  return state === "running" || state === "waiting";
}

/** The type of agent, as a short word: "general-purpose" is "General". */
export function subagentTypeLabel(type: string | undefined): string {
  const raw = type?.trim() ?? "";
  if (!raw) return "";
  if (/^general[-_ ]?purpose$/i.test(raw)) return "General";
  const words = raw.replace(/[-_]+/g, " ").replace(/\s+/g, " ").trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/**
 * What a subagent is doing, from the kind of the tool it just called, in a
 * few plain words.
 */
export function subagentActivityFor(toolName: string, kind: string): string {
  const name = toolName.toLowerCase();
  if (name === "webfetch" || kind === "fetch") return "Reading the web";
  if (name === "websearch") return "Searching the web";
  switch (kind) {
    case "execute":
      return "Running a command";
    case "edit":
      return "Editing";
    case "read":
      return "Reading files";
    case "search":
      return "Searching";
    case "agent":
      return "Starting a subagent";
    case "tasks":
      return "Planning";
    case "skill":
      return "Using a skill";
    case "think":
      return "Thinking";
    default:
      return "Using a tool";
  }
}

/** The muted words after a row's name. */
export function subagentRowLine(block: Block, state: SubagentState): string {
  switch (state) {
    case "running":
      // Not every provider says what its subagents do; those just work.
      return block.tool?.agentActivity || "Working";
    case "waiting":
      return "Waiting";
    case "done":
      return "Done";
    case "failed":
      return "Failed";
    case "stopped":
      return "Stopped";
    default:
      return "";
  }
}

/** The muted words after "2 subagents": "2 running", "1 running, 1 done". */
export function subagentHeaderLine(states: SubagentState[]): string {
  const count = (wanted: SubagentState[]) =>
    states.filter((state) => wanted.includes(state)).length;
  const active = count(["running", "waiting"]);
  const failed = count(["failed"]);
  const stopped = count(["stopped"]);
  const done = count(["done"]);
  const parts: string[] = [];
  if (active) parts.push(`${active} running`);
  if (failed) parts.push(`${failed} failed`);
  if (stopped) parts.push(`${stopped} stopped`);
  if (active && done) parts.push(`${done} done`);
  if (!parts.length && done === states.length && done > 0) return "Done";
  return parts.join(", ");
}

/**
 * How long a subagent has run, in ms: to now while it runs, else what was
 * kept when it ended. Undefined when Aven never saw it start.
 */
export function subagentElapsedMs(
  block: Block,
  state: SubagentState,
  now: number,
): number | undefined {
  const tool = block.tool;
  if (tool?.durationMs !== undefined) return tool.durationMs;
  if (tool?.startedAt === undefined || !subagentIsActive(state))
    return undefined;
  return Math.max(0, now - tool.startedAt);
}

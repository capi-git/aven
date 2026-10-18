/**
 * What an agent asks of you, said plainly wherever a team or a chat waits
 * on you: "Codex wants to run npm test", "Claude asked: Which port?".
 */

/** A tool title that already reads as an action: "Run npm test". */
const ACTION =
  /^(run|edit|read|write|create|delete|remove|move|rename|fetch|open|search|install|apply|update|execute|use|call|list|make|add|change|replace|copy|download|upload|push|commit|start|stop|launch)\b/i;

/** How a chat says it has a question when it gave none in words. */
const GENERIC_QUESTION = /has a question for you$/;

const MAX_CHARS = 120;

function firstLine(text: string): string {
  const line =
    text
      .split(/\r?\n/)
      .map((part) => part.trim())
      .find(Boolean) ?? "";
  return line.length > MAX_CHARS
    ? `${line.slice(0, MAX_CHARS - 1).trimEnd()}…`
    : line;
}

export type AgentRequest = {
  kind: "approval" | "question";
  /** The tool's title or the question, as the agent put it. */
  what?: string;
  /** The tool's kind ("execute" for a command), when known. */
  tool?: string;
  /** Who decides it: you (the default), or a run's lead for its agent. */
  to?: "you" | "lead";
};

/** "Codex wants to run npm test", "Claude asked: Which port?". */
export function requestText(name: string, request: AgentRequest): string {
  const what = request.what ? firstLine(request.what) : "";
  if (request.kind === "question")
    return what && !GENERIC_QUESTION.test(what)
      ? `${name} asked: ${what}`
      : `${name} asked a question`;
  const approval = request.to === "lead" ? "approval" : "your approval";
  if (!what) return `${name} wants ${approval}`;
  if (ACTION.test(what))
    return `${name} wants to ${what[0].toLowerCase()}${what.slice(1)}`;
  if (request.tool === "execute") return `${name} wants to run ${what}`;
  return `${name} wants ${approval}: ${what}`;
}

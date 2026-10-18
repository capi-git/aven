import { basename } from "./fs";
import { toolDisplayLabel } from "./commandLabel";
import { isWeakToolTitle } from "./harness/preview";
import { displayPath } from "./paths";
import type { Session } from "./session";
import { isActiveSessionAgent } from "./sessionAgents";

const DETAIL_MAX = 160;

function clip(text: string): string {
  const line = text.replace(/\s+/g, " ").trim();
  return line.length > DETAIL_MAX
    ? `${line.slice(0, DETAIL_MAX - 1).trimEnd()}…`
    : line;
}

type Activity = {
  text: string;
  /** False for a bare verb ("Shell", "Read") or a tool with no name. */
  specific: boolean;
};

/** The current turn's latest activity, if it has one. */
function latestActivity(session: Session): Activity | undefined {
  const said = (text: string): Activity => ({ text, specific: true });
  const blocks = session.blocks;
  for (let i = blocks.length - 1; i >= 0; i--) {
    const block = blocks[i];
    if (block.role === "user") break;
    if (block.role === "reasoning") return said("Thinking");
    if (block.role === "assistant") return said("Writing a reply");
    if (block.role === "handoff" && block.handoff?.status === "preparing")
      return said("Preparing a handoff");
    if (block.role !== "tool") continue;
    const preview = block.tool?.preview;
    const path = preview?.path
      ? displayPath(preview.path, session.cwd)
      : preview?.fileName;
    const label = toolDisplayLabel({
      kind: block.tool?.kind,
      title: block.text || block.tool?.title,
      path,
      query: preview?.query,
      previewKind: preview?.kind,
      cwd: session.cwd,
    });
    // A bare verb ("Edit") gains the file it acts on; a bubble is narrow, so
    // the file name rather than its path.
    if (label && path && isWeakToolTitle(label))
      return said(clip(`${label} ${basename(path)}`));
    if (!label) return { text: "Working", specific: false };
    return { text: clip(label), specific: !isWeakToolTitle(label) };
  }
  if (!session.busy && session.liveAgents?.some(isActiveSessionAgent))
    return said("Background agents working");
  return undefined;
}

/**
 * What a working session is doing now, from its current turn only: the
 * latest tool call (worded as the live agents list words it), a reply being
 * written, or thinking. A turn's earlier tools never stand in for it. The
 * line Home, the team panel and the run status card share.
 */
export function currentActivity(session: Session): string {
  return latestActivity(session)?.text ?? "Thinking";
}

/**
 * `currentActivity` only when it says something specific ("Edit app.js",
 * "npm test", "Writing a reply"); nothing for a bare verb or while the turn
 * has done nothing yet, for a caller with words of its own for those.
 */
export function sessionDoing(session: Session): string | undefined {
  const doing = latestActivity(session);
  return doing?.specific ? doing.text : undefined;
}

/**
 * Helpers a chat starts when you ask it to, in words ("start two agents
 * side by side to …"): what Aven needs around the run (`orchestration.ts`,
 * `mode: "helpers"`) to show them the way a chat's own work shows. They open
 * as named panes in one tab beside the chat, and the chat's reply carries a
 * card per helper with its last line, its time and the files it changed.
 */
import { leaf, leafIds, newTab, type WorkspaceTab } from "./layout";
import type { OrchestrationRun, OrchestrationTask } from "./orchestration";
import { displayPath, pathKey } from "./paths";
import type { Block } from "./session";
import type { SharedWorkTurn } from "./sharedWork";

/**
 * Whether a message plainly asks for agents or helpers of their own, so a
 * Codex chat may reach Aven's control command from its sandbox this turn.
 * Only the network door depends on it: whether to start helpers is the
 * agent's to judge from the words, as its brief says.
 */
export function asksForHelpers(text: string): boolean {
  const words = text.toLowerCase();
  return (
    /\b(agents?|helpers?|chats?|workers?)\b/.test(words) &&
    /\b(start|spin|launch|open|run|create|spawn|orchestrat\w*|side[- ]by[- ]side|in parallel|parallel|split|delegate|hand (?:off|out))\b/.test(
      words,
    )
  );
}

/**
 * Another chat worked in the same project at some point while this turn ran
 * (`startedAt` until now): one still working, or one whose turn ended after
 * this one started. The chat's own helpers count, as they change the same
 * folder.
 */
export function othersWorkedDuring(
  sessionId: string,
  project: string,
  startedAt: number,
  turns: readonly SharedWorkTurn[],
): boolean {
  const key = pathKey(project);
  return turns.some(
    (turn) =>
      turn.sessionId !== sessionId &&
      pathKey(turn.project) === key &&
      (turn.running > 0 || (turn.endedAt ?? 0) >= startedAt),
  );
}

/** The latest message of yours (or Aven's shown one) that started a turn. */
export function lastShownUserBlock(
  blocks: readonly Block[],
): Block | undefined {
  for (let index = blocks.length - 1; index >= 0; index--) {
    const block = blocks[index];
    if (block.role === "user" && !block.internal) return block;
  }
  return undefined;
}

/** When the turn of the latest shown message started. */
export function turnStartedAt(blocks: readonly Block[]): number | undefined {
  return lastShownUserBlock(blocks)?.startedAt;
}

/** Mark the turn's message when another chat worked beside it. */
export function withOthersWorked<T extends { blocks: Block[] }>(
  session: T,
  othersWorked: boolean,
): T {
  if (!othersWorked) return session;
  const user = lastShownUserBlock(session.blocks);
  if (!user || user.othersWorked) return session;
  return {
    ...session,
    blocks: session.blocks.map((block) =>
      block === user ? { ...block, othersWorked: true } : block,
    ),
  };
}

/**
 * The tab of panes a lead's helpers share: the one that already shows a
 * helper of this run, if any.
 */
export function helperTabFor(
  tabs: readonly WorkspaceTab[],
  run: Pick<OrchestrationRun, "tasks">,
): WorkspaceTab | undefined {
  const ids = new Set(run.tasks.map((task) => task.sessionId));
  return tabs.find((tab) => leafIds(tab.layout).some((id) => ids.has(id)));
}

/**
 * Open a helper as a pane: beside its fellow helpers in their tab, side by
 * side in equal widths, or in a new tab placed right after the lead's.
 * The tab in front stays in front. Returns the tabs unchanged when the
 * helper already has a pane.
 */
export function withHelperPane(
  tabs: readonly WorkspaceTab[],
  run: Pick<OrchestrationRun, "leadId" | "tasks">,
  helperId: string,
): WorkspaceTab[] {
  if (tabs.some((tab) => leafIds(tab.layout).includes(helperId)))
    return tabs as WorkspaceTab[];
  const shared = helperTabFor(tabs, run);
  if (shared) {
    const ids = [...leafIds(shared.layout), helperId];
    const layout =
      ids.length === 1
        ? leaf(ids[0])
        : {
            type: "split" as const,
            id:
              shared.layout.type === "split"
                ? shared.layout.id
                : crypto.randomUUID(),
            dir: "right" as const,
            children: ids.map((id) => leaf(id)),
            sizes: ids.map(() => 1 / ids.length),
          };
    return tabs.map((tab) => (tab === shared ? { ...tab, layout } : tab));
  }
  const tab = newTab(helperId);
  const leadAt = tabs.findIndex((entry) =>
    leafIds(entry.layout).includes(run.leadId),
  );
  if (leadAt < 0) return [...tabs, tab];
  const lead = tabs[leadAt];
  const next = tabs.slice();
  next.splice(
    leadAt + 1,
    0,
    lead.groupId ? { ...tab, groupId: lead.groupId } : tab,
  );
  return next;
}

/** "2 helpers": the helpers tab's name in the top strip. */
export function helpersTabTitle(count: number): string {
  return count === 1 ? "1 helper" : `${count} helpers`;
}

/** One file a helper changed, with its lines added and removed. */
export type HelperFile = {
  /** Absolute, or as the agent gave it. */
  path: string;
  /** Relative to the project, for its row. */
  label: string;
  additions: number;
  deletions: number;
};

/**
 * The files a helper's own transcript shows it writing, oldest first, with
 * the lines each write added and removed summed per file. Failed writes are
 * left out.
 */
export function helperFiles(
  blocks: readonly Block[],
  cwd: string,
): HelperFile[] {
  const files = new Map<string, HelperFile>();
  for (const block of blocks) {
    const preview = block.tool?.preview;
    if (block.role !== "tool" || preview?.kind !== "write" || !preview.path)
      continue;
    const status = block.tool?.status?.toLowerCase();
    if (status === "failed" || status === "error" || status === "declined")
      continue;
    const key = pathKey(preview.path);
    const file = files.get(key) ?? {
      path: preview.path,
      label: displayPath(preview.path, cwd),
      additions: 0,
      deletions: 0,
    };
    file.additions += preview.additions ?? countLines(preview.lines, "add");
    file.deletions += preview.deletions ?? countLines(preview.lines, "del");
    files.set(key, file);
  }
  return [...files.values()];
}

function countLines(
  lines: NonNullable<NonNullable<Block["tool"]>["preview"]>["lines"],
  kind: "add" | "del",
): number {
  return lines?.filter((line) => line.kind === kind).length ?? 0;
}

/**
 * The five-segment bar beside a file's counts: how many segments show
 * added lines, the rest removed, as Git's stat bar does. A change with no
 * counts shows none lit.
 */
export function changeBar(additions: number, deletions: number): number {
  const total = additions + deletions;
  if (!total) return 0;
  return Math.max(
    additions ? 1 : 0,
    Math.min(deletions ? 4 : 5, Math.round((additions / total) * 5)),
  );
}

/** The last line a helper wrote, for its card: one line, no Markdown marks. */
export function helperLastLine(blocks: readonly Block[]): string {
  for (let index = blocks.length - 1; index >= 0; index--) {
    const block = blocks[index];
    if (block.role !== "assistant" || !block.text.trim()) continue;
    const lines = block.text
      .split("\n")
      .map((line) =>
        line
          .replace(/^\s*(?:[-*+]|\d+\.|#+|>)\s*/, "")
          .replace(/[*_`]/g, "")
          .trim(),
      )
      .filter(Boolean);
    const line = lines.at(-1);
    if (line) return line;
  }
  return "";
}

/** "0:06": how long a helper has worked, or worked. */
export function helperClock(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const rest = String(seconds % 60).padStart(2, "0");
  return hours
    ? `${hours}:${String(minutes).padStart(2, "0")}:${rest}`
    : `${minutes}:${rest}`;
}

/** The helpers a lead started in the turn of one of its messages. */
export function helpersOfTurn(
  run: Pick<OrchestrationRun, "tasks"> | undefined,
  turnId: string | undefined,
): OrchestrationTask[] {
  if (!run || !turnId) return [];
  return run.tasks.filter((task) => task.turn === turnId);
}

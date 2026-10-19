import { useCallback, useContext, useEffect, useRef, useState } from "react";
import { createRefreshGate } from "../lib/refreshGate";
import { watchGitReader } from "../lib/gitRefresh";
import { isWindowVisible } from "../lib/windowActivity";
import {
  ArrowUp,
  ChevronRight,
  ExternalLink,
  GitBranch,
  GitCompare,
  MessageSquare,
  Trash2,
} from "./icons";
import { ProviderMarks } from "./ProviderMarks";
import { ProjectMark } from "./ProjectMark";
import { ShipFlow } from "./ShipFlow";
import {
  basename,
  gitDiffIndex,
  gitPrStatus,
  gitWorktrees,
  notifyGitChanged,
  removeGitWorktree,
  revealPath,
  type GitDiffIndex,
  type GitPr,
  type GitWorktree,
} from "../lib/fs";
import { useActivity } from "../lib/activity";
import { errorText, logError } from "../lib/errors";
import { loadShowStaging, shortTimeAgo } from "../lib/gitChangesView";
import { LiveSessionsContext } from "../lib/liveSessions";
import {
  displayAppData,
  isEqualOrInside,
  pathKey,
  prettyCwd,
} from "../lib/paths";
import {
  finishRace,
  raceHost,
  raceLaneAtPath,
  raceLaneBases,
  raceWorkspace,
  type RaceRecord,
} from "../lib/race";
import {
  raceDiscardQuestion,
  raceLaneName,
  raceLaneState,
  raceProgress,
  type RaceLaneState,
} from "../lib/raceLanes";
import { listText } from "../lib/words";
import {
  sessionDisplayTitle,
  sessionNeedsInput,
  sessionWorkCwd,
  type HarnessId,
  type Session,
} from "../lib/session";
import {
  listSessionsByProject,
  type SessionSummary,
} from "../lib/sessionStore";
import { requestOpenChat } from "../lib/shipRequest";
import "./GitCopies.css";

/** Other checkouts refresh less often than the open folder; each costs several Git calls. */
const COPIES_POLL_MS = 10_000;
const FILES_SHOWN = 6;

export type CopySummary = {
  worktree: GitWorktree;
  name: string;
  detail: string;
  harness?: HarnessId;
  /**
   * No uncommitted files and nothing the default branch lacks, even when a
   * squash merge left different commits. Never the main copy or a lane of a
   * race that is still running.
   */
  finished: boolean;
  /** The race this copy is a lane of, if any. */
  race?: ReturnType<typeof raceLaneAtPath>;
};

/** Other checkouts of this repository, most in need of attention first. */
export function summarizeCopies(
  worktrees: readonly GitWorktree[],
): CopySummary[] {
  return worktrees
    .filter((worktree) => !worktree.current)
    .map((worktree) => {
      const race = raceLaneAtPath(worktree.path);
      const finished =
        !worktree.primary &&
        worktree.files.length === 0 &&
        worktree.mergedIntoDefault &&
        race?.race.state !== "running";
      return {
        worktree,
        name: race
          ? firstLine(race.race.prompt)
          : worktree.primary
            ? "Main folder"
            : copyName(worktree),
        detail: race ? race.lane.label : (worktree.branch ?? "Detached"),
        harness: race?.lane.harness,
        finished,
        race,
      };
    })
    .sort(
      (a, b) =>
        Number(a.finished) - Number(b.finished) ||
        b.worktree.files.length - a.worktree.files.length ||
        b.worktree.aheadOfDefault - a.worktree.aheadOfDefault,
    );
}

/** Copies that still need attention, and finished ones to tuck away. */
export function partitionCopies(copies: readonly CopySummary[]): {
  active: CopySummary[];
  finished: CopySummary[];
} {
  return {
    active: copies.filter((copy) => !copy.finished),
    finished: copies.filter((copy) => copy.finished),
  };
}

/**
 * How many copies hold work in progress, for the section header. A clean main
 * folder is listed for reference but is not work in progress.
 */
export function parallelWorkCount(active: readonly CopySummary[]): number {
  // A running race is one piece of work, however many agents it has.
  const races = new Set<string>();
  let count = 0;
  for (const copy of active) {
    if (copy.race?.race.state === "running") races.add(copy.race.race.id);
    else if (!copy.worktree.primary || copy.worktree.files.length > 0) count++;
  }
  return count + races.size;
}

/** A running race's lane copies, shown as one row. */
export type RaceGroup = {
  race: RaceRecord;
  /** Each lane's copy, in lane order; absent when it is the one open here. */
  copies: (CopySummary | undefined)[];
};

/** Running races' lanes grouped per race; every other copy on its own. */
export function groupParallelWork(active: readonly CopySummary[]): {
  races: RaceGroup[];
  copies: CopySummary[];
} {
  const races = new Map<string, RaceGroup>();
  const copies: CopySummary[] = [];
  for (const copy of active) {
    const race = copy.race?.race;
    if (!race || race.state !== "running") {
      copies.push(copy);
      continue;
    }
    let group = races.get(race.id);
    if (!group) {
      group = { race, copies: race.lanes.map(() => undefined) };
      races.set(race.id, group);
    }
    const lane = race.lanes.findIndex(
      (entry) => pathKey(entry.path) === pathKey(copy.worktree.path),
    );
    if (lane >= 0) group.copies[lane] = copy;
  }
  return { races: [...races.values()], copies };
}

/** "Race · Fix the login loop" and "2 of 3 done". */
export function raceGroupLine(
  race: RaceRecord,
  lanes: readonly RaceLaneState[],
): { name: string; short: string } {
  const done = lanes.filter((lane) => lane.kind === "done").length;
  return {
    name: `Race · ${firstLine(race.prompt)}`,
    short: `${done} of ${race.lanes.length} done`,
  };
}

export type CopyStatus = {
  /** One plain line, e.g. "Has work not in main yet · 2 changed files". */
  text: string;
  tone: "merged" | "uncommitted" | "ahead" | "quiet";
  /** More detail for a tooltip, when the sentence can't say it all. */
  hint?: string;
};

function count(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** What state a copy is in, measured against the default branch (`base`). */
export function copyStatus(copy: CopySummary, base = "main"): CopyStatus {
  const { worktree } = copy;
  if (copy.finished) return { text: `Merged into ${base}`, tone: "merged" };
  const files = worktree.files.length;
  const parts: string[] = [];
  // The counts go in the tooltip; the line says what it means.
  const counts: string[] = [];
  if (worktree.aheadOfDefault > 0) {
    parts.push(`Has work not in ${base} yet`);
    counts.push(
      `${count(worktree.aheadOfDefault, "commit", "commits")} not in ${base} yet.`,
    );
  }
  if (worktree.behindDefault > 0) {
    parts.push(`${base} has newer work`);
    counts.push(
      `${base} has ${count(worktree.behindDefault, "newer commit", "newer commits")}.`,
    );
  }
  if (files > 0) {
    parts.push(count(files, "changed file", "changed files"));
    counts.push(
      `${count(files, "file has", "files have")} changes not saved to Git.`,
    );
  }
  if (parts.length === 0)
    parts.push(worktree.primary ? `Up to date with ${base}` : "No changes yet");
  if (files === 0 && worktree.aheadOfDefault > 0 && !worktree.mergedIntoDefault)
    counts.push(
      `If this branch was squash-merged, its changes may already be in ${base}.`,
    );
  return {
    text: parts.join(" · "),
    tone:
      files > 0
        ? "uncommitted"
        : worktree.aheadOfDefault > 0
          ? "ahead"
          : "quiet",
    ...(counts.length ? { hint: counts.join(" ") } : {}),
  };
}

/** The short status at the end of a copy's one-line row. */
export function copyShortStatus(copy: CopySummary): string {
  if (copy.finished) return "Merged";
  const files = copy.worktree.files.length;
  const ahead = copy.worktree.aheadOfDefault;
  const parts = [
    files > 0 ? `${count(files, "file", "files")} changed` : "",
    ahead > 0 ? `${ahead} to merge` : "",
  ].filter(Boolean);
  return parts.join(" · ") || "Up to date";
}

/** The conversation that works, or last worked, in a copy. */
export type CopyChat = {
  id: string;
  title: string;
  state: "working" | "waiting" | "idle";
  /** When it was last active, in ms; 0 when unknown. */
  at: number;
};

function latestTurnAt(session: Session): number {
  for (let index = session.blocks.length - 1; index >= 0; index -= 1) {
    const block = session.blocks[index];
    if (block.role === "user" && !block.internal) return block.startedAt ?? 0;
  }
  return 0;
}

const CHAT_RANK = { working: 2, waiting: 1, idle: 0 } as const;

/** One row of Parallel work: a copy, or a running race with its lanes. */
type ParallelRow =
  | { kind: "copy"; copy: CopySummary; chat: CopyChat | null }
  | {
      kind: "race";
      group: RaceGroup;
      lanes: RaceLaneState[];
      chat: CopyChat | null;
    };

function raceKey(race: RaceRecord): string {
  return `race:${race.id}`;
}

/**
 * The chat to show for a copy: one with an agent working or waiting there
 * first, otherwise the most recently active, from open chats and history.
 */
export function chatForCopy(
  path: string,
  sessions: readonly Session[],
  history: readonly SessionSummary[] = [],
): CopyChat | null {
  const roots = [path, prettyCwd(path)];
  const inCopy = (where: string | undefined) =>
    !!where && roots.some((root) => isEqualOrInside(where, root));
  let best: CopyChat | null = null;
  const consider = (chat: CopyChat) => {
    if (
      !best ||
      CHAT_RANK[chat.state] > CHAT_RANK[best.state] ||
      (CHAT_RANK[chat.state] === CHAT_RANK[best.state] && chat.at > best.at)
    )
      best = chat;
  };
  const open = new Set<string>();
  for (const session of sessions) {
    if (session.inboxAsk || !inCopy(sessionWorkCwd(session))) continue;
    open.add(session.id);
    const working =
      !!session.busy ||
      !!session.liveAgents?.some((agent) => agent.status === "running");
    consider({
      id: session.id,
      title: sessionDisplayTitle(session.title, session.harness),
      state: sessionNeedsInput(session)
        ? "waiting"
        : working
          ? "working"
          : "idle",
      at: latestTurnAt(session),
    });
  }
  for (const row of history) {
    if (row.archived || open.has(row.id)) continue;
    consider({
      id: row.id,
      title: sessionDisplayTitle(row.title, row.harness),
      state: "idle",
      at: row.updatedAt,
    });
  }
  return best;
}

/** "Fix tab groups · agent working" / "Fix tab groups · last active 2h ago". */
export function describeCopyChat(chat: CopyChat, now: number): string {
  if (chat.state === "working") return `${chat.title} · agent working`;
  if (chat.state === "waiting") return `${chat.title} · needs you`;
  const age = shortTimeAgo(chat.at, now);
  return age ? `${chat.title} · last active ${age}` : chat.title;
}

/**
 * Whether an agent is working in `path` right now: mid-turn, with queued
 * messages, waiting on the user, or running subagents. Idle chats that only
 * point at the folder do not count.
 */
export function copyInUse(path: string, sessions: readonly Session[]): boolean {
  const roots = [path, prettyCwd(path)];
  return sessions.some((session) => {
    const active =
      session.busy ||
      (session.queuedMessages?.length ?? 0) > 0 ||
      sessionNeedsInput(session) ||
      session.liveAgents?.some((agent) => agent.status === "running");
    if (!active) return false;
    return [session.cwd, session.worktreeCwd].some(
      (where) => !!where && roots.some((root) => isEqualOrInside(where, root)),
    );
  });
}

/** Why Clean up leaves a copy alone, or null when it may be removed. */
export function cleanupSkipReason(
  copy: CopySummary,
  sessions: readonly Session[],
): string | null {
  const { worktree, race } = copy;
  if (worktree.primary) return "it's the main folder";
  if (worktree.current) return "it's open here";
  if (worktree.files.length > 0) return "it has unsaved files";
  if (!worktree.mergedIntoDefault) return "main doesn't have all of it";
  if (race?.race.state === "running") return "its race is still running";
  if (copyInUse(worktree.path, sessions)) return "an agent is using it";
  if (!race && !worktree.branch) return "it has no branch";
  return null;
}

/**
 * A race's copy, recorded or not: a race whose record was pruned after
 * its cleanup failed leaves a copy on an `aven/race/` branch, which is
 * removed the way its race would have removed it.
 */
function isRaceCopy(copy: CopySummary): boolean {
  return !!copy.race || !!copy.worktree.branch?.startsWith("aven/race/");
}

export type CleanupPlan = {
  remove: CopySummary[];
  skip: { copy: CopySummary; reason: string }[];
};

/** Which finished copies Clean up removes, and which it leaves and why. */
export function planCleanup(
  copies: readonly CopySummary[],
  sessions: readonly Session[],
): CleanupPlan {
  const plan: CleanupPlan = { remove: [], skip: [] };
  for (const copy of copies) {
    const reason = cleanupSkipReason(copy, sessions);
    if (reason) plan.skip.push({ copy, reason });
    else plan.remove.push(copy);
  }
  return plan;
}

export type CleanupResult = {
  removed: CopySummary[];
  failures: { copy: CopySummary; message: string }[];
};

/**
 * Remove finished copies one at a time, continuing past failures. Each copy
 * is checked again against a fresh listing and the sessions at that moment,
 * so one that gained work after the confirmation is kept. A running race is
 * never finished from here.
 */
export async function cleanUpCopies(
  cwd: string,
  copies: readonly CopySummary[],
  sessions: () => readonly Session[],
  onProgress?: (done: number) => void,
): Promise<CleanupResult> {
  const latest = summarizeCopies(await gitWorktrees(cwd, raceLaneBases()));
  const result: CleanupResult = { removed: [], failures: [] };
  for (const [index, planned] of copies.entries()) {
    onProgress?.(index);
    const copy = latest.find(
      ({ worktree }) =>
        pathKey(worktree.path) === pathKey(planned.worktree.path),
    );
    if (!copy) {
      result.failures.push({
        copy: planned,
        message: "It's no longer part of the project.",
      });
      continue;
    }
    // Everything that stops a copy counting as finished is a skip reason.
    const reason = cleanupSkipReason(copy, sessions());
    if (reason) {
      result.failures.push({ copy, message: `Kept because ${reason}.` });
      continue;
    }
    try {
      await removeCopy(cwd, copy);
      result.removed.push(copy);
    } catch (error) {
      result.failures.push({
        copy,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }
  onProgress?.(copies.length);
  return result;
}

/** What removing a copy throws away, for its confirmation. */
export function removalWarning(copy: CopySummary): string {
  const { worktree } = copy;
  const race = isRaceCopy(copy);
  if (copy.race?.race.state === "running")
    return "This race is still running. Removing it stops its agents and deletes their work, including files Git ignores.";
  if (!race && !worktree.branch)
    return "This copy has no branch. Create a branch in it before removing it so its commits stay reachable.";
  const parts = [
    race
      ? "The entire folder, including ignored files, will be deleted."
      : "The folder will be deleted. Copies with ignored files must be backed up and cleared first.",
  ];
  const files = worktree.files.length;
  if (files > 0)
    parts.push(
      `${files} unsaved ${files === 1 ? "file" : "files"} will be deleted.`,
    );
  if (worktree.aheadOfDefault > 0)
    parts.push(
      race
        ? `Its ${worktree.aheadOfDefault} unmerged ${worktree.aheadOfDefault === 1 ? "commit is" : "commits are"} deleted too.`
        : `Its branch keeps the ${worktree.aheadOfDefault} ${worktree.aheadOfDefault === 1 ? "commit" : "commits"} main doesn't have.`,
    );
  return parts.join(" ");
}

/** Remove a copy the right way: races clean up through their race. */
export async function removeCopy(cwd: string, copy: CopySummary) {
  const { race, worktree } = copy;
  if (race?.race.state === "running") return finishRace(race.race, null);
  if (race) return raceHost.cleanup(race.race.root, [race.lane]);
  // A race copy whose race is no longer recorded: the host removes only
  // copies in its races folder on an aven/race/ branch.
  if (worktree.branch?.startsWith("aven/race/"))
    return raceHost.cleanup(cwd, [
      { path: worktree.path, branch: worktree.branch },
    ]);
  return removeGitWorktree(cwd, worktree.path);
}

function firstLine(text: string): string {
  return (
    text
      .split("\n")
      .map((line) => line.trim())
      .find(Boolean) ?? "Race"
  );
}

// Branch prefixes that say what kind of change or which tool made it, not
// what the work is: "feat/tab-groups" is about tab groups.
const BRANCH_KIND =
  /^(?:feat|feature|fix|bugfix|hotfix|chore|refactor|docs|test|tests|perf|build|ci|style|wip|codex|claude|cursor|copilot|agent)$/i;

/** Words that read as abbreviations: "preview/ui" → "Preview UI". */
const ABBREVIATION =
  /^(?:ui|ux|db|ai|qa|ci|cd|pr|id|os|js|ts|api|css|cli|sdk|sql|url|mcp|llm|ios|html)$/i;

/**
 * A friendly name from the branch: "fix/race-safety" → "Race safety",
 * "preview/ui" → "Preview UI". Falls back to the folder name.
 */
export function copyName(
  worktree: Pick<GitWorktree, "branch" | "path">,
): string {
  const branch = worktree.branch ?? "";
  if (branch.startsWith("aven/race/")) return "Race folder";
  const segments = branch.split("/").filter(Boolean);
  while (segments.length > 1 && BRANCH_KIND.test(segments[0])) segments.shift();
  const words = (segments.join(" ") || basename(worktree.path))
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((word) => (ABBREVIATION.test(word) ? word.toUpperCase() : word));
  const text = words.join(" ");
  return text ? text[0].toUpperCase() + text.slice(1) : "Copy";
}

function useWorktrees(
  cwd: string,
  enabled: boolean,
): { worktrees: GitWorktree[]; refresh: () => void } {
  const [worktrees, setWorktrees] = useState<GitWorktree[]>([]);
  const refreshNow = useRef<() => void>(() => {});
  useEffect(() => {
    if (!enabled || !cwd || cwd === "~") return;
    let cancelled = false;
    const gate = createRefreshGate(async () => {
      if (cancelled || !isWindowVisible()) return;
      try {
        // Race lanes count from where their race started, not from main.
        const next = await gitWorktrees(cwd, raceLaneBases());
        if (!cancelled) setWorktrees(next);
      } catch {
        if (!cancelled) setWorktrees([]);
      }
    }, COPIES_POLL_MS);
    // Git changes arrive every couple of seconds while an agent edits; each
    // scan runs several git commands per copy, so scans are spaced out.
    // After the user's own change (removing a copy), scan straight away.
    refreshNow.current = () => gate.request(true);
    // Like the open folder's index: Git changes are read while the window is
    // on screen, focused or not, and the periodic scan runs only with focus.
    const stop = watchGitReader(() => gate.request(), COPIES_POLL_MS);
    return () => {
      cancelled = true;
      gate.stop();
      refreshNow.current = () => {};
      stop();
    };
  }, [cwd, enabled]);
  const refresh = useCallback(() => refreshNow.current(), []);
  return { worktrees, refresh };
}

type CleanupState =
  | { phase: "confirm"; plan: CleanupPlan }
  | { phase: "running"; plan: CleanupPlan; done: number }
  | { phase: "done"; result: CleanupResult }
  | { phase: "error"; message: string };

/**
 * Which checkout the panel is showing, for the Changes header: the main
 * folder, a race lane, or a parallel copy. Null when there is only one.
 */
export function currentCopyLabel(
  worktrees: readonly GitWorktree[],
): string | null {
  if (worktrees.length < 2) return null;
  const current = worktrees.find((worktree) => worktree.current);
  if (!current) return null;
  if (current.primary) return "Main folder";
  const race = raceLaneAtPath(current.path);
  if (race)
    return `Race · ${raceLaneName(race.race, race.race.lanes.indexOf(race.lane))}`;
  return `Parallel · ${copyName(current)}`;
}

export const PARALLEL_WORK_EXPLAINER =
  "Separate copies of this project, so agents can work without touching your main folder.";
const EXPLAINED_KEY = "aven.parallelWorkExplained";

function loadExplained(): boolean {
  try {
    return localStorage.getItem(EXPLAINED_KEY) === "1";
  } catch {
    return false;
  }
}

const OPEN_KEY = "aven.parallelWorkOpen";
/** Rows shown before the rest fold into "+N more". */
export const PARALLEL_ROWS_SHOWN = 3;

/** Whether the section is open; it starts folded to its header line. */
export function loadParallelWorkOpen(): boolean {
  try {
    return localStorage.getItem(OPEN_KEY) === "1";
  } catch {
    return false;
  }
}

export function saveParallelWorkOpen(open: boolean): void {
  try {
    if (open) localStorage.setItem(OPEN_KEY, "1");
    else localStorage.removeItem(OPEN_KEY);
  } catch {
    // Private mode or a full quota: it opens folded next time.
  }
}

/**
 * Copies with an agent working first, then the most recently active chat,
 * keeping the list's own order (uncommitted work first) between equals.
 */
export function orderParallelWork<T extends { chat: CopyChat | null }>(
  rows: readonly T[],
): T[] {
  return rows
    .map((row, index) => ({ row, index }))
    .sort((a, b) => {
      const working =
        Number(b.row.chat?.state === "working") -
        Number(a.row.chat?.state === "working");
      if (working) return working;
      const recent = (b.row.chat?.at ?? 0) - (a.row.chat?.at ?? 0);
      return recent || a.index - b.index;
    })
    .map(({ row }) => row);
}

function saveExplained(): void {
  try {
    localStorage.setItem(EXPLAINED_KEY, "1");
  } catch {
    // Private mode or a full quota: the line shows again next time.
  }
}

/** Chats that worked in each copy, read once per set of copies, not polled. */
const historyByPath = new Map<string, SessionSummary[]>();

function useCopyHistory(
  paths: readonly string[],
  enabled: boolean,
): ReadonlyMap<string, SessionSummary[]> {
  const [, setRevision] = useState(0);
  const key = paths.join("\n");
  useEffect(() => {
    if (!enabled || !key) return;
    let cancelled = false;
    void Promise.all(
      key.split("\n").map((path) =>
        listSessionsByProject(path)
          .then((rows) => {
            historyByPath.set(path, rows);
          })
          .catch(() => {}),
      ),
    ).then(() => {
      if (!cancelled) setRevision((value) => value + 1);
    });
    return () => {
      cancelled = true;
    };
  }, [key, enabled]);
  return historyByPath;
}

const noBusy = () => {};

/** Ship it for another copy: reads that copy once, then the usual card. */
function CopyShip({
  path,
  enabled,
  textHarness,
  onClose,
}: {
  path: string;
  enabled: boolean;
  textHarness?: HarnessId;
  onClose: () => void;
}) {
  const [state, setState] = useState<{
    index: GitDiffIndex;
    pr: GitPr | null;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [nonce, setNonce] = useState(0);
  useEffect(() => {
    let cancelled = false;
    void Promise.all([
      gitDiffIndex(path),
      gitPrStatus(path).catch(() => null),
    ]).then(
      ([index, pr]) => {
        if (!cancelled) setState({ index, pr });
      },
      (reason) => {
        if (cancelled) return;
        logError("ship another copy", reason);
        setError(errorText(reason));
      },
    );
    return () => {
      cancelled = true;
    };
  }, [path, nonce]);
  const reload = useCallback(() => {
    setNonce((value) => value + 1);
    notifyGitChanged(path);
  }, [path]);
  if (error)
    return (
      <div className="git-copy-ship">
        <p className="git-copy-error" role="alert">
          {error}
        </p>
        <button type="button" className="git-copy-action" onClick={onClose}>
          Close
        </button>
      </div>
    );
  if (!state)
    return (
      <p className="git-copy-ship git-copy-reading" role="status">
        Reading this copy…
      </p>
    );
  return (
    <div className="git-copy-ship">
      <ShipFlow
        cwd={path}
        index={state.index}
        files={state.index.files}
        stagingShown={loadShowStaging()}
        pr={state.pr}
        enabled={enabled}
        textHarness={textHarness}
        message={message}
        onMessageChange={setMessage}
        onBusyChange={noBusy}
        onMutated={reload}
        onPrChanged={reload}
        onClose={onClose}
      />
    </div>
  );
}

/**
 * Parallel work: other checkouts of this project, where agents (or races)
 * work on their own branches, and what each one holds.
 */
export function GitCopies({
  cwd,
  enabled,
  projectCwd,
  base = "main",
  textHarness,
  onWorktrees,
}: {
  cwd: string;
  enabled: boolean;
  /** The project folder, whose mark stands for the agent in each copy. */
  projectCwd?: string;
  /** The default branch every copy is measured against. */
  base?: string;
  textHarness?: HarnessId;
  /** Every checkout, including this one, whenever a scan finishes. */
  onWorktrees?: (worktrees: GitWorktree[]) => void;
}) {
  const { worktrees, refresh: refreshCopies } = useWorktrees(cwd, enabled);
  const reportRef = useRef(onWorktrees);
  reportRef.current = onWorktrees;
  useEffect(() => {
    reportRef.current?.(worktrees);
  }, [worktrees]);
  const copies = summarizeCopies(worktrees);
  const { active, finished } = partitionCopies(copies);
  const live = useContext(LiveSessionsContext);
  const sessions = () => live?.list() ?? [];
  // A finished, failed or stopped lane records an outcome; recount then.
  const entries = useActivity();
  // Folded to one header line until opened; the choice is remembered.
  const [sectionOpen, setSectionOpen] = useState(loadParallelWorkOpen);
  const [showAll, setShowAll] = useState(false);
  // Chats from history only matter once the rows are on screen.
  const history = useCopyHistory(
    copies
      .filter(({ worktree }) => !worktree.primary)
      .map(({ worktree }) => worktree.path),
    enabled && sectionOpen,
  );
  const [explained] = useState(loadExplained);
  const shown = copies.length > 0;
  useEffect(() => {
    if (shown && sectionOpen && !explained) saveExplained();
  }, [shown, sectionOpen, explained]);
  const [open, setOpen] = useState<string | null>(null);
  const [shipping, setShipping] = useState<string | null>(null);
  const [finishedOpen, setFinishedOpen] = useState(false);
  const [cleanup, setCleanup] = useState<CleanupState | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);
  const [failure, setFailure] = useState<{
    path: string;
    message: string;
  } | null>(null);
  const discardRace = async (race: RaceRecord) => {
    const key = raceKey(race);
    setRemoving(key);
    setFailure(null);
    try {
      await finishRace(race, null);
      setConfirming(null);
      setOpen(null);
    } catch (error) {
      logError("Discard the race", error);
      setFailure({
        path: key,
        message: "Couldn't discard the race. Try again, or use Compare.",
      });
    } finally {
      setRemoving(null);
      notifyGitChanged(cwd);
      refreshCopies();
    }
  };
  const remove = async (copy: CopySummary) => {
    const { path } = copy.worktree;
    setRemoving(path);
    setFailure(null);
    try {
      await removeCopy(cwd, copy);
      setConfirming(null);
      setOpen(null);
    } catch (error) {
      setFailure({ path, message: errorText(error) });
    } finally {
      setRemoving(null);
      notifyGitChanged(cwd);
      refreshCopies();
    }
  };
  const cleanUp = async (plan: CleanupPlan) => {
    setCleanup({ phase: "running", plan, done: 0 });
    try {
      const result = await cleanUpCopies(cwd, plan.remove, sessions, (done) =>
        setCleanup({ phase: "running", plan, done }),
      );
      setCleanup({ phase: "done", result });
    } catch (error) {
      logError("Clean up finished copies", error);
      setCleanup({
        phase: "error",
        message: "Couldn't check the copies again. Nothing was removed.",
      });
    } finally {
      notifyGitChanged(cwd);
      refreshCopies();
    }
  };
  if (!shown) return null;
  const cleaning = cleanup?.phase === "running";
  const inProgress = parallelWorkCount(active);
  // Ages are worked out when the list renders; nothing ticks on a clock.
  const now = Date.now();
  const openSessions = sessions();
  const withChat = (copy: CopySummary) => ({
    copy,
    chat: copy.worktree.primary
      ? null
      : chatForCopy(
          copy.worktree.path,
          openSessions,
          history.get(copy.worktree.path),
        ),
  });
  const grouped = groupParallelWork(active);
  const raceRow = (group: RaceGroup): ParallelRow => {
    let chat: CopyChat | null = null;
    for (const copy of group.copies) {
      if (!copy) continue;
      const lane = withChat(copy).chat;
      if (
        lane &&
        (!chat ||
          CHAT_RANK[lane.state] > CHAT_RANK[chat.state] ||
          (CHAT_RANK[lane.state] === CHAT_RANK[chat.state] &&
            lane.at > chat.at))
      )
        chat = lane;
    }
    return {
      kind: "race",
      group,
      lanes: group.race.lanes.map((lane, index) =>
        raceLaneState(
          lane.sessionId,
          live?.session(lane.sessionId),
          entries,
          group.race.ends?.[index],
        ),
      ),
      chat,
    };
  };
  const rows = orderParallelWork<ParallelRow>([
    ...grouped.copies.map((copy) => ({
      kind: "copy" as const,
      ...withChat(copy),
    })),
    ...grouped.races.map(raceRow),
  ]);
  const working = rows.filter(({ chat }) => chat?.state === "working");
  const visible = showAll ? rows : rows.slice(0, PARALLEL_ROWS_SHOWN);
  const hidden = rows.length - visible.length;
  const mark = projectCwd || cwd;
  const toggleSection = () => {
    const next = !sectionOpen;
    setSectionOpen(next);
    saveParallelWorkOpen(next);
  };

  const renderCopy = ({
    copy,
    chat,
  }: {
    copy: CopySummary;
    chat: CopyChat | null;
  }) => {
    const { worktree, race } = copy;
    const expanded = open === worktree.path;
    const files = worktree.files.length;
    const status = copyStatus(copy, base);
    const chatLine = chat ? describeCopyChat(chat, now) : null;
    // A race's copy is kept or discarded through its race, never shipped.
    const canShip =
      !copy.finished &&
      (files > 0 || worktree.aheadOfDefault > 0) &&
      !isRaceCopy(copy);
    const where = worktree.branch ?? "No branch";
    return (
      <div key={worktree.path}>
        <div
          className="git-copy"
          data-finished={copy.finished || undefined}
          data-open={expanded || undefined}
          data-tone={status.tone}
        >
          <button
            type="button"
            className="git-copy-line"
            aria-expanded={expanded}
            title={[
              status.text,
              status.hint,
              chatLine,
              `${where} · ${displayAppData(worktree.path)}`,
            ]
              .filter(Boolean)
              .join("\n")}
            onClick={() => setOpen(expanded ? null : worktree.path)}
          >
            <span className="git-copy-dots">
              {chat?.state === "working" ? (
                <span
                  className="git-copy-dot"
                  data-dot="working"
                  role="img"
                  aria-label="Agent working"
                />
              ) : null}
              {files > 0 ? (
                <span
                  className="git-copy-dot"
                  data-dot="uncommitted"
                  role="img"
                  aria-label="Has changed files"
                />
              ) : null}
            </span>
            <span className="git-copy-name">{copy.name}</span>
            <span className="git-copy-short">{copyShortStatus(copy)}</span>
          </button>
          {expanded ? (
            <div className="git-copy-files">
              <p className="git-copy-status" title={status.hint}>
                {status.text}
              </p>
              {chat ? (
                <p className="git-copy-chat" data-state={chat.state}>
                  {chat.state === "working" && mark ? (
                    <ProjectMark path={mark} active />
                  ) : copy.harness ? (
                    <ProviderMarks harnesses={[copy.harness]} />
                  ) : null}
                  <span className="min-w-0 flex-1 truncate">{chatLine}</span>
                </p>
              ) : null}
              <p
                className="git-copy-branch"
                title={displayAppData(worktree.path)}
              >
                <GitBranch className="size-3 shrink-0" strokeWidth={1.75} />
                <span className="min-w-0 flex-1 truncate">
                  {race ? `${where} · ${copy.detail}` : where}
                </span>
                {worktree.additions > 0 ? (
                  <span className="git-copy-added">+{worktree.additions}</span>
                ) : null}
                {worktree.deletions > 0 ? (
                  <span className="git-copy-deleted">
                    −{worktree.deletions}
                  </span>
                ) : null}
              </p>
              {worktree.files.slice(0, FILES_SHOWN).map((file) => (
                <p key={file.relative} title={file.relative}>
                  <span data-status={file.status}>
                    {file.status.slice(0, 1).toUpperCase()}
                  </span>
                  <span className="min-w-0 flex-1 truncate">
                    {file.relative}
                  </span>
                  {file.additions > 0 ? (
                    <span className="git-copy-added">+{file.additions}</span>
                  ) : null}
                  {file.deletions > 0 ? (
                    <span className="git-copy-deleted">−{file.deletions}</span>
                  ) : null}
                </p>
              ))}
              {files > FILES_SHOWN ? (
                <p className="text-content/45">+ {files - FILES_SHOWN} more</p>
              ) : null}
              {copy.finished ? (
                <p className="text-content/45">
                  Nothing here that {base} doesn't have.
                </p>
              ) : null}
              {confirming === worktree.path ? (
                <div
                  className="git-copy-confirm"
                  role="group"
                  aria-label="Remove this copy?"
                >
                  <p>{removalWarning(copy)}</p>
                  <div>
                    <button
                      type="button"
                      className="git-copy-action"
                      data-tone="danger"
                      disabled={removing === worktree.path}
                      onClick={() => void remove(copy)}
                    >
                      {removing === worktree.path ? "Removing…" : "Remove copy"}
                    </button>
                    <button
                      type="button"
                      className="git-copy-action"
                      disabled={removing === worktree.path}
                      onClick={() => setConfirming(null)}
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <div className="git-copy-actions">
                  {chat ? (
                    <button
                      type="button"
                      className="git-copy-action"
                      title={`Open “${chat.title}”`}
                      onClick={() => requestOpenChat(chat.id)}
                    >
                      <MessageSquare className="size-3" strokeWidth={1.75} />
                      Open chat
                    </button>
                  ) : null}
                  {canShip ? (
                    <button
                      type="button"
                      className="git-copy-action"
                      aria-expanded={shipping === worktree.path}
                      title="Commit, push or open a pull request for this copy"
                      onClick={() =>
                        setShipping(
                          shipping === worktree.path ? null : worktree.path,
                        )
                      }
                    >
                      <ArrowUp className="size-3" strokeWidth={2} />
                      Ship it
                    </button>
                  ) : null}
                  <button
                    type="button"
                    className="git-copy-action"
                    onClick={() => void revealPath(worktree.path)}
                  >
                    <ExternalLink className="size-3" strokeWidth={1.75} />
                    Show in Finder
                  </button>
                  {worktree.primary ? null : (
                    <button
                      type="button"
                      className="git-copy-action"
                      onClick={() => {
                        setFailure(null);
                        setConfirming(worktree.path);
                      }}
                    >
                      <Trash2 className="size-3" strokeWidth={1.75} />
                      Remove
                    </button>
                  )}
                </div>
              )}
              {failure?.path === worktree.path ? (
                <p className="git-copy-error" role="alert">
                  {failure.message}
                </p>
              ) : null}
            </div>
          ) : null}
        </div>
        {shipping === worktree.path ? (
          <CopyShip
            path={worktree.path}
            enabled={enabled}
            textHarness={textHarness}
            onClose={() => setShipping(null)}
          />
        ) : null}
      </div>
    );
  };

  const renderRace = (
    group: RaceGroup,
    lanes: readonly RaceLaneState[],
    chat: CopyChat | null,
  ) => {
    const { race } = group;
    const key = raceKey(race);
    const expanded = open === key;
    const line = raceGroupLine(race, lanes);
    const files = group.copies.reduce(
      (sum, copy) => sum + (copy?.worktree.files.length ?? 0),
      0,
    );
    // Each agent's changes since the race began, committed or not: its
    // last read numbers, or at least its uncommitted files.
    const question = raceDiscardQuestion(
      race,
      lanes,
      group.copies.map((copy, index) =>
        Math.max(
          race.stats?.[index]?.files ?? 0,
          copy?.worktree.files.length ?? 0,
        ),
      ),
    );
    return (
      <div key={key}>
        <div
          className="git-copy"
          data-race-group={race.id}
          data-open={expanded || undefined}
          data-tone={files > 0 ? "uncommitted" : "quiet"}
        >
          <button
            type="button"
            className="git-copy-line"
            aria-expanded={expanded}
            title={[race.prompt, raceProgress(lanes)].join("\n")}
            onClick={() => setOpen(expanded ? null : key)}
          >
            <span className="git-copy-dots">
              {chat?.state === "working" ? (
                <span
                  className="git-copy-dot"
                  data-dot="working"
                  role="img"
                  aria-label="Agent working"
                />
              ) : null}
              {files > 0 ? (
                <span
                  className="git-copy-dot"
                  data-dot="uncommitted"
                  role="img"
                  aria-label="Has changed files"
                />
              ) : null}
            </span>
            <span className="git-copy-name">{line.name}</span>
            <span className="git-copy-short">{line.short}</span>
          </button>
          {expanded ? (
            <div className="git-copy-files">
              <p className="git-copy-status">{raceProgress(lanes)}</p>
              {race.lanes.map((lane, index) => {
                const copy = group.copies[index];
                const state = lanes[index];
                const text = `${raceLaneName(race, index)} · ${state?.label ?? "Closed"}`;
                return (
                  <p
                    key={lane.sessionId}
                    className="git-copy-chat"
                    data-race-lane={index}
                    data-state={
                      state?.kind === "working"
                        ? "working"
                        : state?.kind === "waiting"
                          ? "waiting"
                          : "idle"
                    }
                    title={text}
                  >
                    {state?.kind === "working" && mark ? (
                      <ProjectMark path={mark} active />
                    ) : (
                      <ProviderMarks harnesses={[lane.harness]} />
                    )}
                    <span className="min-w-0 flex-1 truncate">{text}</span>
                    <span className="git-copy-short">
                      {copy ? copyShortStatus(copy) : "In this window"}
                    </span>
                  </p>
                );
              })}
              {confirming === key ? (
                <div
                  className="git-copy-confirm"
                  role="group"
                  aria-label={question.title}
                >
                  <p>{`${question.title} ${question.body}`}</p>
                  <div>
                    <button
                      type="button"
                      className="git-copy-action"
                      data-tone="danger"
                      disabled={removing === key}
                      onClick={() => void discardRace(race)}
                    >
                      {removing === key ? "Discarding…" : question.confirm}
                    </button>
                    <button
                      type="button"
                      className="git-copy-action"
                      disabled={removing === key}
                      // The question replaced Discard race: the keyboard
                      // comes here, and goes back there on Cancel.
                      autoFocus
                      onClick={() => {
                        setConfirming(null);
                        requestAnimationFrame(() =>
                          document
                            .querySelector<HTMLElement>(
                              `[data-race-discard="${race.id}"]`,
                            )
                            ?.focus(),
                        );
                      }}
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <div className="git-copy-actions">
                  <button
                    type="button"
                    className="git-copy-action"
                    data-race-compare
                    title="Compare the agents' changes and keep one"
                    onClick={() => raceWorkspace()?.compare(race.id)}
                  >
                    <GitCompare className="size-3" strokeWidth={1.75} />
                    Compare
                  </button>
                  {chat ? (
                    <button
                      type="button"
                      className="git-copy-action"
                      title={`Open “${chat.title}”`}
                      onClick={() => requestOpenChat(chat.id)}
                    >
                      <MessageSquare className="size-3" strokeWidth={1.75} />
                      Open chat
                    </button>
                  ) : null}
                  <button
                    type="button"
                    className="git-copy-action"
                    data-race-discard={race.id}
                    onClick={() => {
                      setFailure(null);
                      setConfirming(key);
                    }}
                  >
                    <Trash2 className="size-3" strokeWidth={1.75} />
                    Discard race
                  </button>
                </div>
              )}
              {failure?.path === key ? (
                <p className="git-copy-error" role="alert">
                  {failure.message}
                </p>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
    );
  };

  const renderRow = (row: ParallelRow) =>
    row.kind === "race"
      ? renderRace(row.group, row.lanes, row.chat)
      : renderCopy(row);

  const renderCleanup = () => {
    if (!cleanup) return null;
    if (cleanup.phase === "error")
      return (
        <div className="git-copies-cleanup">
          <p className="git-copy-error" role="alert">
            {cleanup.message}
          </p>
        </div>
      );
    if (cleanup.phase === "done") {
      const { removed, failures } = cleanup.result;
      return (
        <div className="git-copies-cleanup">
          <p role="status">
            {removed.length === 0
              ? "Nothing was removed."
              : `Removed ${removed.length} ${removed.length === 1 ? "copy" : "copies"}.`}
          </p>
          {failures.length > 0 ? (
            <div role="alert">
              {failures.map(({ copy, message }) => (
                <p key={copy.worktree.path} className="git-copy-error">
                  {`${copy.name}: ${message}`}
                </p>
              ))}
            </div>
          ) : null}
          <button
            type="button"
            className="git-copy-action"
            onClick={() => setCleanup(null)}
          >
            Done
          </button>
        </div>
      );
    }
    const { plan } = cleanup;
    const removable = plan.remove.length;
    const races = plan.remove.some((copy) => copy.race);
    return (
      <div
        className="git-copies-cleanup git-copy-confirm"
        role="group"
        aria-label="Clean up finished copies?"
      >
        <p>
          {removable === 0
            ? "Nothing can be cleaned up right now."
            : `Remove ${removable} finished ${removable === 1 ? "copy" : "copies"}: ${listText(plan.remove.map((copy) => copy.name))}? Their changes are already on ${base}. ${races ? "Race folders are deleted entirely, including files Git ignores; copies" : "Copies"} with ignored files are kept.`}
        </p>
        {plan.skip.length > 0 ? (
          <p>
            {`Keeping ${listText(plan.skip.map(({ copy, reason }) => `${copy.name} (${reason})`))}.`}
          </p>
        ) : null}
        <div>
          {removable > 0 ? (
            <button
              type="button"
              className="git-copy-action"
              data-tone="danger"
              disabled={cleaning}
              onClick={() => void cleanUp(plan)}
            >
              {cleanup.phase === "running"
                ? `Removing ${Math.min(cleanup.done + 1, removable)} of ${removable}…`
                : `Remove ${removable} ${removable === 1 ? "copy" : "copies"}`}
            </button>
          ) : null}
          <button
            type="button"
            className="git-copy-action"
            disabled={cleaning}
            onClick={() => setCleanup(null)}
          >
            {removable > 0 ? "Cancel" : "Close"}
          </button>
        </div>
      </div>
    );
  };

  return (
    <section
      className="git-copies"
      aria-label="Parallel work"
      data-open={sectionOpen || undefined}
    >
      <h3 className="git-copies-title">
        <button
          type="button"
          className="git-copies-toggle"
          aria-expanded={sectionOpen}
          title={PARALLEL_WORK_EXPLAINER}
          onClick={toggleSection}
        >
          <ChevronRight
            className="git-copy-chevron size-3 shrink-0"
            strokeWidth={2}
          />
          Parallel work
          <span className="git-copies-count">
            {inProgress > 0
              ? `· ${inProgress}`
              : finished.length > 0
                ? `· ${finished.length} merged`
                : ""}
          </span>
          {working.length > 0 && mark ? (
            <span
              className="git-copies-working"
              aria-label={`${working.length} ${working.length === 1 ? "agent" : "agents"} working`}
            >
              {working.slice(0, 3).map((row) => (
                <ProjectMark
                  key={
                    row.kind === "race"
                      ? raceKey(row.group.race)
                      : row.copy.worktree.path
                  }
                  path={mark}
                  active
                />
              ))}
            </span>
          ) : null}
        </button>
      </h3>
      {sectionOpen ? (
        <>
          {explained ? null : (
            <p className="git-copies-explainer">{PARALLEL_WORK_EXPLAINER}</p>
          )}
          {visible.map(renderRow)}
          {hidden > 0 ? (
            <button
              type="button"
              className="git-copies-more"
              onClick={() => setShowAll(true)}
            >
              +{hidden} more
            </button>
          ) : null}
          {finished.length > 0 ? (
            <div className="git-copies-group">
              <button
                type="button"
                className="git-copy-head"
                aria-expanded={finishedOpen}
                title={`Copies whose changes are already in ${base}`}
                onClick={() => setFinishedOpen(!finishedOpen)}
              >
                <ChevronRight
                  className="git-copy-chevron size-3 shrink-0"
                  strokeWidth={2}
                />
                <span className="git-copy-name">{`${finished.length} merged into ${base}`}</span>
              </button>
              {cleanup?.phase === "confirm" || cleaning ? null : (
                <button
                  type="button"
                  className="git-copy-action"
                  onClick={() =>
                    setCleanup({
                      phase: "confirm",
                      plan: planCleanup(finished, sessions()),
                    })
                  }
                >
                  <Trash2 className="size-3" strokeWidth={1.75} />
                  Clean up
                </button>
              )}
            </div>
          ) : null}
          {renderCleanup()}
          {finishedOpen
            ? finished.map((copy) => renderCopy({ copy, chat: null }))
            : null}
        </>
      ) : null}
    </section>
  );
}

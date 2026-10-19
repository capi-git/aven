import { toolDisplayLabel } from "./commandLabel";
import { isExecuteTool, isWeakToolTitle } from "./harness/preview";
import {
  HARNESS_TITLE,
  sessionIsWaitingForInput,
  type Block,
  type HarnessId,
  type Session,
  type TurnRetryReason,
} from "./session";

/**
 * What holds a working chat up when it is not its agent's own work: a
 * request being retried, the usage limit, the agent still starting, a long
 * command, or helper agents still running after the reply is done. A chat
 * that needs you says so instead (see `sessionRunStatus`).
 */
export type SessionHoldUp =
  | {
      kind: "retrying";
      harness: HarnessId;
      attempt?: number;
      retryAt?: number;
      reason?: TurnRetryReason;
      /** The usage limit is reached too, which is likely why. */
      usageLimit?: boolean;
    }
  | { kind: "usage-limit"; resetsAt?: number }
  | { kind: "starting"; harness: HarnessId; since: number }
  | { kind: "command"; since: number; command?: string }
  | { kind: "helpers"; count: number; since?: number };

/** A start shorter than this is not worth a line of its own. */
export const STARTING_HOLD_UP_MS = 1_000;
/** Nor is a command shorter than this. */
export const COMMAND_HOLD_UP_MS = 10_000;
/** A retry that never reported back stops counting this long after its time. */
const RETRY_GRACE_MS = 30_000;

/**
 * Everything holding the chat up, most specific first: retrying, the usage
 * limit, starting, a running command, helper agents. Nothing while it needs
 * you, or while its turn is simply working. Holds no clock: `holdUpAt`
 * decides which of them shows at a given time.
 */
export function sessionHoldUps(session: Session): SessionHoldUp[] {
  if (sessionIsWaitingForInput(session)) return [];
  const running =
    session.liveAgents?.filter((agent) => agent.status === "running").length ??
    0;
  if (!session.busy)
    return running ? [{ kind: "helpers", count: running }] : [];
  const holdUps: SessionHoldUp[] = [];
  const wait = session.waitingOn;
  if (wait?.retry)
    holdUps.push({
      kind: "retrying",
      harness: session.harness,
      ...wait.retry,
      ...(wait.usageLimit ? { usageLimit: true } : {}),
    });
  if (wait?.usageLimit)
    holdUps.push({ kind: "usage-limit", ...wait.usageLimit });
  if (wait?.starting !== undefined)
    holdUps.push({
      kind: "starting",
      harness: session.harness,
      since: wait.starting,
    });
  const command = runningCommand(session);
  if (command) holdUps.push(command);
  if (wait?.helpers !== undefined && running)
    holdUps.push({ kind: "helpers", count: running, since: wait.helpers });
  return holdUps;
}

/** A tool call that has not finished yet. */
function stillRunning(block: Block): boolean {
  if (block.approval?.decided === "deny") return false;
  const status = block.tool?.status?.toLowerCase();
  if (status === "in_progress" || status === "pending" || status === "running")
    return true;
  return !status && !!block.streaming;
}

/** The current turn's shell command still running, among its latest calls. */
function runningCommand(session: Session): SessionHoldUp | undefined {
  const { blocks } = session;
  for (let index = blocks.length - 1; index >= 0; index--) {
    const block = blocks[index];
    if (block.role === "user") {
      // Steering belongs to the turn; a message with a clock starts it.
      if (block.startedAt !== undefined || block.turnModel) return undefined;
      continue;
    }
    // Once the agent writes, thinks or plans again, its calls are behind it.
    if (
      block.role === "assistant" ||
      block.role === "reasoning" ||
      block.role === "plan" ||
      block.role === "handoff"
    )
      return undefined;
    const since = block.tool?.startedAt;
    if (since === undefined || !stillRunning(block)) continue;
    const { kind, title, preview } = block.tool ?? {};
    const name = block.text || title;
    if (!isExecuteTool(kind, name) && preview?.kind !== "shell") continue;
    const command = toolDisplayLabel({
      kind,
      title: name,
      previewKind: preview?.kind,
      cwd: session.cwd,
    });
    return {
      kind: "command",
      since,
      ...(command && !isWeakToolTitle(command) ? { command } : {}),
    };
  }
  return undefined;
}

/** A hold-up in words: the run card's bold label and its detail, and both as one line. */
export type HoldUpWords = {
  kind: SessionHoldUp["kind"];
  label: string;
  detail: string;
  line: string;
};

/**
 * The hold-up to show at `now`, in words: the first of `holdUps` that
 * applies then. A start under a second or a command under ten seconds is
 * ordinary work; a retry long past its time or a limit past its reset has
 * stopped holding anything up. `wakeAt` is when the answer next changes
 * (a countdown ticks, a threshold passes), for a caller that redraws then.
 */
export function holdUpAt(
  holdUps: readonly SessionHoldUp[],
  now: number,
): { words?: HoldUpWords; wakeAt?: number } {
  let wakeAt: number | undefined;
  const wake = (at: number | undefined) => {
    if (at !== undefined && at > now && (wakeAt === undefined || at < wakeAt))
      wakeAt = at;
  };
  for (const holdUp of holdUps) {
    const from =
      holdUp.kind === "starting"
        ? holdUp.since + STARTING_HOLD_UP_MS
        : holdUp.kind === "command"
          ? holdUp.since + COMMAND_HOLD_UP_MS
          : undefined;
    if (from !== undefined && now < from) {
      wake(from);
      continue;
    }
    const until =
      holdUp.kind === "retrying" && holdUp.retryAt !== undefined
        ? holdUp.retryAt + RETRY_GRACE_MS
        : holdUp.kind === "usage-limit"
          ? holdUp.resetsAt
          : undefined;
    if (until !== undefined && now >= until) continue;
    wake(until);
    const { words, next } = wordHoldUp(holdUp, now, false);
    wake(next);
    return { words, ...(wakeAt !== undefined ? { wakeAt } : {}) };
  }
  return wakeAt !== undefined ? { wakeAt } : {};
}

/**
 * One line for a chat's status tooltip in the sidebar or a tab: a retry,
 * the usage limit or helper agents, with no clock that would go stale.
 * Starts and commands are too short-lived for a tooltip.
 */
export function holdUpHint(
  holdUps: readonly SessionHoldUp[],
  now = Date.now(),
): string | undefined {
  const holdUp = holdUps.find(
    (entry) =>
      entry.kind === "retrying" ||
      entry.kind === "helpers" ||
      (entry.kind === "usage-limit" &&
        (entry.resetsAt === undefined || entry.resetsAt > now)),
  );
  return holdUp ? wordHoldUp(holdUp, now, true).words.line : undefined;
}

function providerName(harness: HarnessId): string {
  return harness === "claude" ? "Claude" : HARNESS_TITLE[harness];
}

function retryLabel(
  holdUp: Extract<SessionHoldUp, { kind: "retrying" }>,
): string {
  const name = providerName(holdUp.harness);
  switch (holdUp.reason) {
    case "rate-limit":
      return holdUp.usageLimit ? "Usage limit reached" : "Too many requests";
    case "server":
      return `${name} had an error`;
    case "connection":
      return `Can’t reach ${name}`;
    case "no-response":
      return `${name} isn’t responding`;
    default:
      return `${name} is busy`;
  }
}

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}

function wordHoldUp(
  holdUp: SessionHoldUp,
  now: number,
  timeless: boolean,
): { words: HoldUpWords; next?: number } {
  const words = (
    label: string,
    rest = "",
    detail = rest ? rest[0].toUpperCase() + rest.slice(1) : "",
  ): HoldUpWords => ({
    kind: holdUp.kind,
    label,
    detail,
    line: rest ? `${label} · ${rest}` : label,
  });
  switch (holdUp.kind) {
    case "retrying": {
      const tries =
        holdUp.attempt !== undefined ? ` (try ${holdUp.attempt + 1})` : "";
      const left =
        holdUp.retryAt !== undefined && !timeless
          ? holdUp.retryAt - now
          : undefined;
      const when =
        left === undefined
          ? "retrying"
          : left > 0
            ? `retrying in ${countdownText(left)}`
            : "retrying now";
      return {
        words: words(retryLabel(holdUp), `${when}${tries}`),
        ...(left !== undefined && left > 0
          ? { next: now + countdownTick(left) }
          : {}),
      };
    }
    case "usage-limit":
      return {
        words: words(
          "Usage limit reached",
          holdUp.resetsAt !== undefined
            ? `resets ${clockTime(holdUp.resetsAt, now)}`
            : "",
        ),
      };
    case "starting":
      return {
        words: words(`Starting ${providerName(holdUp.harness)}…`),
      };
    case "command": {
      const elapsed = now - holdUp.since;
      const time = elapsedText(elapsed);
      return {
        words: words(
          "Running a command",
          time,
          holdUp.command ? `${holdUp.command} · ${time}` : time,
        ),
        next: now + elapsedTick(elapsed),
      };
    }
    case "helpers": {
      const label = `Waiting on ${plural(holdUp.count, "helper agent")}`;
      if (holdUp.since === undefined || timeless)
        return { words: words(label, "", "Reply done") };
      const elapsed = now - holdUp.since;
      const time = elapsedText(elapsed);
      return {
        words: words(label, time, `Reply done · ${time}`),
        next: now + elapsedTick(elapsed),
      };
    }
  }
}

/** "45s", "19m", "2h 5m": how long so far, in whole units. */
function elapsedText(ms: number): string {
  const seconds = Math.floor(Math.max(0, ms) / 1000);
  if (seconds < 60) return `${seconds}s`;
  return hoursAndMinutes(Math.floor(seconds / 60));
}

/** How long until `elapsedText` reads differently. */
function elapsedTick(ms: number): number {
  const unit = ms < 60_000 ? 1_000 : 60_000;
  return unit - (Math.max(0, ms) % unit);
}

/** "20s", "4m", "2h 13m": what is left, rounded up. */
function countdownText(ms: number): string {
  const seconds = Math.ceil(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  return hoursAndMinutes(Math.ceil(ms / 60_000));
}

/** How long until `countdownText` reads differently. */
function countdownTick(ms: number): number {
  return ((ms - 1) % (ms <= 120_000 ? 1_000 : 60_000)) + 1;
}

function hoursAndMinutes(minutes: number): string {
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  return minutes % 60 ? `${hours}h ${minutes % 60}m` : `${hours}h`;
}

/** "3:40 PM" today, "Oct 26, 3:40 PM" on another day. */
function clockTime(at: number, now: number): string {
  const date = new Date(at);
  const sameDay = date.toDateString() === new Date(now).toDateString();
  return date.toLocaleString(
    undefined,
    sameDay
      ? { hour: "numeric", minute: "2-digit" }
      : { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" },
  );
}

import { isTurnActivity, type ActivityEntry } from "./activity";
import { isEqualOrInside, projectName } from "./paths";
import type { BotWakeKind, ProjectBot } from "./projectBots";
import type { TestRun } from "./turnTests";

/**
 * What wakes a project's bot and what it is told. Each event is one thing
 * that happened in the project; several within the settle time wake the bot
 * once, together. New kinds (GitHub, outside changes) add a case to
 * `BotEvent`, a line to `eventLines` and a tag to `wakeLabel`.
 */

/** Wait this long after an event, so a burst of them wakes the bot once. */
export const BOT_SETTLE_MS = 45_000;
/** Activity older than this when first seen is history, not news. */
export const BOT_FRESH_MS = 60_000;
/** Lines of a dev server's output the bot is shown. */
export const BOT_OUTPUT_LINES = 40;
/** At most this many events ride in one wake-up. */
const MAX_EVENTS = 8;
const MAX_FILES = 12;

export type BotChangedFile = {
  path: string;
  additions: number;
  deletions: number;
};

export type BotChatFinished = {
  kind: "chatFinished";
  /** The activity entry, so another window claims the same event. */
  id: string;
  at: number;
  sessionId: string;
  title: string;
  outcome: "completed" | "failed";
  /** Files the chat changed and has not yet had reviewed, when known. */
  files?: BotChangedFile[];
  /** The last test command the chat's agent ran, when it ran one. */
  tests?: TestRun | null;
  summary?: string;
};

export type BotDevServerStopped = {
  kind: "devServer";
  id: string;
  at: number;
  /** "localhost:3000". */
  label: string;
  /** The framework or script, when known. */
  app?: string;
  /** The last lines of its terminal. */
  output: string;
};

export type BotEvent = BotChatFinished | BotDevServerStopped;

export function eventKind(event: BotEvent): BotWakeKind {
  return event.kind;
}

/**
 * Whether a ledger entry is a chat in the bot's project finishing: a chat's
 * own turn ending (or a run of agents finishing), fresh, never the bot's
 * own chat, a team member's quiet turn, a discussion or race notice, or a
 * scheduled run.
 */
export function wakesFromActivity(
  entry: ActivityEntry,
  bot: Pick<ProjectBot, "path" | "sessionId" | "copy">,
  context: {
    now: number;
    /** Every bot's chat: no bot wakes for a bot. */
    botChats: ReadonlySet<string>;
    scheduledChats: ReadonlySet<string>;
  },
): boolean {
  if (entry.outcome !== "completed" && entry.outcome !== "failed") return false;
  if (Math.abs(context.now - entry.createdAt) > BOT_FRESH_MS) return false;
  if (entry.sessionId === bot.sessionId) return false;
  if (context.botChats.has(entry.sessionId)) return false;
  if (context.scheduledChats.has(entry.sessionId)) return false;
  if (entry.team?.member) return false;
  const runFinished =
    entry.team?.kind === "orchestrate" &&
    !entry.team.need &&
    entry.outcome === "completed";
  if (entry.team && !runFinished) return false;
  if (!entry.team && !isTurnActivity(entry.sessionId, entry.id)) return false;
  if (!isEqualOrInside(entry.cwd, bot.path)) return false;
  if (bot.copy && isEqualOrInside(entry.cwd, bot.copy.path)) return false;
  return true;
}

/**
 * Add an event to those waiting for the bot. The same event twice counts
 * once; a newer finish of the same chat, or a newer stop of the dev server,
 * replaces the older one. The oldest drop off past the limit.
 */
export function coalesceEvents(
  pending: readonly BotEvent[],
  next: BotEvent,
): BotEvent[] {
  if (pending.some((event) => event.id === next.id)) return [...pending];
  const kept = pending.filter((event) =>
    next.kind === "chatFinished"
      ? !(event.kind === "chatFinished" && event.sessionId === next.sessionId)
      : !(event.kind === "devServer" && event.label === next.label),
  );
  return [...kept, next].slice(-MAX_EVENTS);
}

function quoted(text: string): string {
  return `“${text.replace(/\s+/g, " ").trim().slice(0, 80)}”`;
}

/**
 * The small tag the bot's chat shows for a wake-up, in place of the
 * message the bot was sent: "Chat finished · Add sign-up flow".
 */
export function wakeLabel(events: readonly BotEvent[]): string {
  const chats = events.filter(
    (event): event is BotChatFinished => event.kind === "chatFinished",
  );
  const crashed = events.some((event) => event.kind === "devServer");
  const parts: string[] = [];
  if (chats.length === 1)
    parts.push(
      `${chats[0].outcome === "failed" ? "Chat stopped" : "Chat finished"} · ${chats[0].title.trim() || "Untitled chat"}`,
    );
  else if (chats.length > 1) parts.push(`${chats.length} chats finished`);
  if (crashed) parts.push("Dev server crashed");
  return parts.join(" · ") || "Checking in";
}

export function lastLines(text: string, count = BOT_OUTPUT_LINES): string {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
  return lines.slice(-count).join("\n");
}

function testLine(test: TestRun): string {
  const counts = [
    test.failed ? `${test.failed} failed` : null,
    test.passed !== undefined ? `${test.passed} passed` : null,
  ]
    .filter(Boolean)
    .join(", ");
  const how =
    test.status === "passed"
      ? "passed"
      : test.status === "failed"
        ? "failed"
        : test.status === "running"
          ? "was still running"
          : "was stopped";
  return `\`${test.command}\` ${how}${counts ? ` (${counts})` : ""}`;
}

function eventLines(event: BotEvent): string[] {
  if (event.kind === "chatFinished") {
    const lines = [
      `- The user's chat ${quoted(event.title || "Untitled chat")} ${
        event.outcome === "failed" ? "stopped with an error" : "finished"
      }.`,
    ];
    if (event.summary)
      lines.push(`  Its last words: ${quoted(event.summary.slice(0, 200))}`);
    const files = event.files ?? [];
    if (files.length) {
      const shown = files
        .slice(0, MAX_FILES)
        .map((file) => `${file.path} (+${file.additions} −${file.deletions})`)
        .join(", ");
      const more =
        files.length > MAX_FILES
          ? `, and ${files.length - MAX_FILES} more`
          : "";
      lines.push(`  Files it changed: ${shown}${more}.`);
    } else if (event.files) lines.push("  It changed no files Aven tracked.");
    if (event.tests)
      lines.push(`  Tests its agent ran: ${testLine(event.tests)}.`);
    else if (event.tests === null)
      lines.push("  Its agent didn't run any tests.");
    return lines;
  }
  const what = event.app ? `${event.app} dev server` : "dev server";
  return [
    `- The project's ${what} (${event.label}) stopped on its own. The last lines of its terminal:`,
    "```",
    lastLines(event.output) || "(no output)",
    "```",
  ];
}

export type BotSyncNote =
  | { kind: "synced"; base: string; uncommitted: boolean; untracked: boolean }
  | { kind: "fix-waiting" }
  | { kind: "failed"; error: string };

function syncLines(sync: BotSyncNote | null): string[] {
  if (!sync) return [];
  if (sync.kind === "synced")
    return [
      `Aven synced your copy to the user's current files (commit ${sync.base.slice(0, 10)}${
        sync.uncommitted ? ", including their uncommitted changes" : ""
      }).${sync.untracked ? " Files the user hasn't added to git yet are not in your copy." : ""}`,
    ];
  if (sync.kind === "fix-waiting")
    return [
      "A fix you made earlier is still waiting for the user to apply or throw away, so your copy still holds it and was not synced. Look into this and tell the user what you find, but don't start another fix or change files in your copy until they decide on the waiting one.",
    ];
  return [
    `Aven couldn't update your copy (${sync.error}), so it may be behind the user's files. Say so if it matters.`,
  ];
}

export type BotBriefInput = {
  name: string;
  project: string;
  copyPath: string;
  can: ProjectBot["can"];
};

/**
 * The bot's role, given on the first message of a conversation: who it is,
 * where it works, how to answer, and what it must never do on its own.
 */
export function botBrief(input: BotBriefInput): string {
  const project = projectName(input.project);
  const doing = input.can.fix
    ? "If something broke, fix it in your copy and say what you changed; Aven shows your changes to the user, who decides whether to apply them to their files."
    : "Don't change files, even in your copy: tell the user what you found and suggest the fix.";
  return [
    `You are ${input.name}, ${project}'s bot: a teammate who keeps an eye on this project for the user.`,
    `You work in your own copy of the project at ${input.copyPath}, never in the user's folder (${input.project}).`,
    "When something changes, check what changed and run the relevant tests or build quickly.",
    `Reply in 1–3 plain sentences, like a teammate. If nothing is wrong, reply exactly "Nothing to report." ${doing}`,
    "Never push, open or merge pull requests, commit, deploy, publish, send or post messages, or delete things: ask the user first.",
  ].join(" ");
}

/** The message a wake-up sends the bot. */
export function buildWakeMessage(input: {
  events: readonly BotEvent[];
  sync: BotSyncNote | null;
  canFix: boolean;
  /** Its role, on the first message of a conversation. */
  brief?: string;
}): string {
  const lines: string[] = [];
  if (input.brief) lines.push(input.brief, "");
  lines.push("Something changed in the project:");
  for (const event of input.events) lines.push(...eventLines(event));
  lines.push("");
  lines.push(...syncLines(input.sync));
  lines.push(
    input.canFix
      ? 'Check whether anything is wrong. If nothing is, reply exactly "Nothing to report."'
      : 'Check whether anything is wrong and suggest a fix without changing files. If nothing is, reply exactly "Nothing to report."',
  );
  return lines.join("\n").trim();
}

/**
 * What the bot is sent when you message it yourself: your words as you
 * wrote them. Its copy was synced first; only a copy it could not sync (a
 * fix waits there, or the sync failed) is mentioned, after your words and in
 * them, so nothing reads as an instruction from someone else.
 */
export function buildDirectMessage(input: {
  text: string;
  sync: BotSyncNote | null;
  brief?: string;
}): string {
  const aside =
    input.sync?.kind === "fix-waiting"
      ? "(Your earlier fix is still waiting for me to apply or throw away, so your copy wasn't updated to my latest files.)"
      : input.sync?.kind === "failed"
        ? `(Your copy couldn't be updated to my latest files: ${input.sync.error})`
        : "";
  return [
    ...(input.brief ? [input.brief, ""] : []),
    input.text,
    ...(aside ? ["", aside] : []),
  ]
    .join("\n")
    .trim();
}

/** Whether a reply is the bot's "Nothing to report.", give or take punctuation and formatting. */
export function isNothingToReport(text: string): boolean {
  const plain = text
    .replace(/[*_`"“”'’.!\s]+/g, " ")
    .trim()
    .toLowerCase();
  return plain === "nothing to report";
}

/** The first sentence-ish line of a reply, for Home and Activity. */
export function replyHeadline(text: string, max = 140): string {
  const line =
    text
      .replace(/```[\s\S]*?```/g, " ")
      .split(/\n\s*\n|\n/)
      .map((part) =>
        part
          .replace(/[*_`#>]+/g, "")
          .replace(/\s+/g, " ")
          .trim(),
      )
      .find(Boolean) ?? "";
  return line.length > max ? `${line.slice(0, max - 1).trimEnd()}…` : line;
}

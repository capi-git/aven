import {
  devPreviewsSnapshot,
  duplicateDevServers,
  liveServersFor,
  type DevPreview,
} from "./devPreviews";
import { displayPath, pathKey, prettyCwd, isEqualOrInside } from "./paths";
import { raceLaneAtPath } from "./race";
import { isRaceLanePath } from "./recents";
import type { HarnessId, RuntimeMode, TurnIntent } from "./session";
import {
  agentName,
  sharedWorkSession,
  sharedWorkTurns,
  type SharedWorkTurn,
} from "./sharedWork";

/**
 * The live "what's running" note each chat receives: the project's dev
 * servers, the other agents working in it and the files they are editing.
 * It is built when a message is sent, from what Aven already observed, and
 * rides ahead of that message (hidden from the transcript) only when it
 * differs from what this chat last received. One block carries it for every
 * provider: a launch option or developer instruction reaches only a new
 * conversation, and this changes between turns.
 *
 * This is the only place running servers are told to agents; the browser
 * guidance no longer repeats them.
 */

export const SHARED_WORK_TAG = "aven-shared-work";
/** Longest note, in characters, including its tags. */
export const SHARED_WORK_NOTE_LIMIT = 1_200;
/** A finished turn's edits stay worth knowing about this long. */
export const RECENT_TURN_MS = 20 * 60_000;

const MAX_SERVERS = 4;
const MAX_AGENTS = 4;
const MAX_FILES = 4;
const MAX_TITLE = 40;
const MAX_REQUEST = 60;

export type NoteServer = {
  url: string;
  port: number;
  /** Folder relative to the project, when it is not the project itself. */
  folder?: string;
  /** "you", "Claude in “Fix login”", "the user's terminal". */
  by: string;
  own: boolean;
};

export type NoteAgent = {
  /** "Claude in “Fix login”". */
  name: string;
  working: boolean;
  request?: string;
  /** Files relative to the project, most recent last. */
  files: readonly string[];
};

export type NoteDuplicate = {
  port: number;
  original: { port: number; by: string };
};

export type SharedWorkNoteInput = {
  servers: readonly NoteServer[];
  agents: readonly NoteAgent[];
  /** A second copy of a running app that this chat started. */
  duplicate?: NoteDuplicate;
  /** The chat's sandbox may block connections to local servers. */
  sandboxed: boolean;
};

function clip(text: string, max: number): string {
  const line = text.replace(/\s+/g, " ").trim();
  return line.length > max ? `${line.slice(0, max - 1).trimEnd()}…` : line;
}

function filesText(files: readonly string[], max: number): string {
  const shown = files.slice(-max);
  const more = files.length - shown.length;
  return more > 0 ? `${shown.join(", ")} and ${more} more` : shown.join(", ");
}

type Budget = {
  servers: number;
  agents: number;
  files: number;
  finished: boolean;
};

const BUDGETS: readonly Budget[] = [
  {
    servers: MAX_SERVERS,
    agents: MAX_AGENTS,
    files: MAX_FILES,
    finished: true,
  },
  { servers: MAX_SERVERS, agents: MAX_AGENTS, files: 2, finished: true },
  { servers: MAX_SERVERS, agents: MAX_AGENTS, files: 2, finished: false },
  { servers: 2, agents: 2, files: 1, finished: false },
];

function render(input: SharedWorkNoteInput, budget: Budget): string {
  const lines: string[] = [];
  const servers = input.servers.slice(0, budget.servers);
  if (servers.length) {
    const items = servers.map(
      (server) =>
        `${server.url}${server.folder ? ` in ${server.folder}` : ""} (${
          server.own ? "started by you" : server.by
        })`,
    );
    lines.push(
      `Dev ${servers.length === 1 ? "server" : "servers"} running: ${items.join("; ")}.`,
    );
  }
  if (input.duplicate) {
    const { port, original } = input.duplicate;
    lines.push(
      `You started a second dev server on :${port} while :${original.port} (${original.by}) was already running for the same app. Use :${original.port}, and stop yours unless the user wants both.`,
    );
  }
  const others = input.servers.find((server) => !server.own);
  if (input.sandboxed && others) {
    const host = (() => {
      try {
        return new URL(others.url).host;
      } catch {
        return `localhost:${others.port}`;
      }
    })();
    lines.push(
      `Your sandbox may not reach ${host}; ask the user before starting another server.`,
    );
  }
  const agents = input.agents
    .filter((agent) => agent.working || budget.finished)
    .slice(0, budget.agents);
  if (agents.length) {
    const items = agents.map((agent) => {
      const files = agent.files.length
        ? filesText(agent.files, budget.files)
        : "";
      if (agent.working) {
        const task = agent.request ? ` on “${agent.request}”` : "";
        return `${agent.name} is working${task}${files ? `, editing ${files}` : ""}`;
      }
      return `${agent.name} finished recently${files ? `; it edited ${files}` : ""}`;
    });
    lines.push(`Other agents here: ${items.join(". ")}.`);
  }
  const guidance: string[] = [];
  if (servers.length)
    guidance.push(
      "Reuse a running dev server rather than starting another: list the in-app browser pages, reuse one already showing it and reload after edits. If you need a different port or a restart, say so first. If it does not load, it may have stopped since.",
    );
  if (agents.some((agent) => agent.working && agent.files.length))
    guidance.push(
      "Avoid editing files another agent is editing right now; if you must, tell the user first.",
    );
  if (guidance.length) lines.push(guidance.join(" "));
  if (!lines.length) return "";
  return `<${SHARED_WORK_TAG}>\nLive from Aven: other work in this project. A newer note replaces this one.\n${lines.join("\n")}\n</${SHARED_WORK_TAG}>`;
}

/** The note, or "" when nothing else is running. Never over the limit. */
export function buildSharedWorkNote(input: SharedWorkNoteInput): string {
  let note = "";
  for (const budget of BUDGETS) {
    note = render(input, budget);
    if (note.length <= SHARED_WORK_NOTE_LIMIT) return note;
  }
  const close = `\n</${SHARED_WORK_TAG}>`;
  return `${note.slice(0, SHARED_WORK_NOTE_LIMIT - close.length - 1)}…${close}`;
}

/** Sent once when an earlier note no longer holds. */
export const SHARED_WORK_CLEARED = `<${SHARED_WORK_TAG}>\nNo other agents or dev servers are active in this project now; the earlier note no longer applies.\n</${SHARED_WORK_TAG}>`;

/** "Claude in “Fix login”"; "Codex" when the chat has no title yet. */
export function chatName(sessionId: string | undefined): string {
  const session = sessionId ? sharedWorkSession(sessionId) : undefined;
  if (!session) return "another chat";
  const name = agentName(session.harness);
  const title = session.title.trim();
  return title && title !== "New session"
    ? `${name} in “${clip(title, MAX_TITLE)}”`
    : `${name} in a new chat`;
}

function serverBy(preview: DevPreview, sessionId: string): string {
  if (preview.source === "terminal") return "started in the user's terminal";
  if (preview.sessionId === sessionId) return "started by you";
  return `started by ${chatName(preview.sessionId)}`;
}

function folderLabel(folder: string, project: string): string | undefined {
  if (!folder || pathKey(folder) === pathKey(project)) return undefined;
  return isEqualOrInside(folder, project)
    ? displayPath(folder, project)
    : prettyCwd(folder);
}

/** Codex runs commands in a sandbox without network unless given full access. */
export function sandboxBlocksLocalhost(input: {
  harness: HarnessId;
  runtimeMode?: RuntimeMode;
  intent?: TurnIntent;
  controlsAgents?: boolean;
}): boolean {
  if (input.harness !== "codex" || input.controlsAgents) return false;
  return input.intent === "plan" || input.runtimeMode !== "full-access";
}

export type SharedWorkContext = {
  sessionId: string;
  harness: HarnessId;
  /** The checkout the turn runs in. */
  cwd: string;
  runtimeMode?: RuntimeMode;
  intent?: TurnIntent;
  controlsAgents?: boolean;
};

function agentFor(turn: SharedWorkTurn, project: string): NoteAgent {
  const session = sharedWorkSession(turn.sessionId);
  return {
    name: chatName(turn.sessionId),
    working: turn.running > 0,
    ...(turn.running > 0 && session?.request
      ? { request: clip(session.request, MAX_REQUEST) }
      : {}),
    files: turn.files.map((file) => displayPath(file, project)),
  };
}

/** Gather this chat's note from the dev servers and other chats now. */
export function sharedWorkNoteFor(
  context: SharedWorkContext,
  now = Date.now(),
): string {
  const session = sharedWorkSession(context.sessionId);
  // A race lane works in its own copy of the project: only that copy's
  // servers and edits concern it, and other chats ignore the copies.
  const lane = isRaceLanePath(context.cwd)
    ? (raceLaneAtPath(context.cwd)?.lane.path ?? context.cwd)
    : undefined;
  const project = lane ?? session?.project ?? context.cwd;
  const inScope = (cwd: string) =>
    lane ? isEqualOrInside(cwd, lane) : !isRaceLanePath(cwd);
  const previews = devPreviewsSnapshot();
  const live = liveServersFor(previews, {
    cwd: context.cwd,
    project: session?.project ?? context.cwd,
    sessionId: context.sessionId,
  }).filter((preview) => inScope(preview.cwd));
  const servers: NoteServer[] = live.slice(0, MAX_SERVERS).map((preview) => ({
    url: preview.url,
    port: preview.port,
    by: serverBy(preview, context.sessionId),
    own: preview.source === "agent" && preview.sessionId === context.sessionId,
    ...(folderLabel(preview.folder, project)
      ? { folder: folderLabel(preview.folder, project) }
      : {}),
  }));
  const duplicate = duplicateDevServers(previews).find(
    (entry) =>
      entry.preview.source === "agent" &&
      entry.preview.sessionId === context.sessionId &&
      entry.preview.duplicateHandled !== "kept",
  );
  const agents = sharedWorkTurns()
    .filter(
      (turn) =>
        turn.sessionId !== context.sessionId &&
        (!!lane || pathKey(turn.project) === pathKey(project)) &&
        inScope(turn.cwd) &&
        (turn.running > 0 ||
          (turn.files.length > 0 &&
            now - (turn.endedAt ?? 0) <= RECENT_TURN_MS)),
    )
    .sort(
      (a, b) =>
        Number(b.running > 0) - Number(a.running > 0) ||
        (b.endedAt ?? b.startedAt) - (a.endedAt ?? a.startedAt),
    )
    .map((turn) => agentFor(turn, project));
  return buildSharedWorkNote({
    servers,
    agents,
    ...(duplicate
      ? {
          duplicate: {
            port: duplicate.preview.port,
            original: {
              port: duplicate.original.port,
              by: serverBy(duplicate.original, context.sessionId),
            },
          },
        }
      : {}),
    sandboxed: sandboxBlocksLocalhost({
      harness: context.harness,
      runtimeMode: context.runtimeMode ?? session?.runtimeMode,
      intent: context.intent,
      controlsAgents: context.controlsAgents,
    }),
  });
}

/** The note each chat holds, for the provider and checkout it was sent to. */
type Delivered = { harness: HarnessId; cwd: string; note: string };
const MAX_REMEMBERED = 200;
const delivered = new Map<string, Delivered>();

function remember(sessionId: string, entry: Delivered) {
  delivered.delete(sessionId);
  delivered.set(sessionId, entry);
  while (delivered.size > MAX_REMEMBERED) {
    const oldest = delivered.keys().next().value;
    if (oldest === undefined) break;
    delivered.delete(oldest);
  }
}

/**
 * What this message must carry so the chat holds the current note, and an
 * undo for when the message never reached the provider. Pure apart from the
 * record of what each chat holds.
 */
export function prepareSharedWorkTurn(
  input: SharedWorkContext & { text: string },
  now = Date.now(),
): { text: string; rollback: () => void } {
  const unchanged = { text: input.text, rollback: () => {} };
  // Provider commands (`/compact`) must reach the CLI untouched.
  if (input.text.trimStart().startsWith("/")) return unchanged;
  const note = sharedWorkNoteFor(input, now);
  const previous = delivered.get(input.sessionId);
  const known =
    previous?.harness === input.harness && previous.cwd === input.cwd
      ? previous.note
      : "";
  if (note === known) return unchanged;
  const prefix = note || SHARED_WORK_CLEARED;
  const entry: Delivered = {
    harness: input.harness,
    cwd: input.cwd,
    note,
  };
  remember(input.sessionId, entry);
  return {
    text: `${prefix}\n\n${input.text}`,
    rollback: () => {
      if (delivered.get(input.sessionId) !== entry) return;
      if (previous) remember(input.sessionId, previous);
      else delivered.delete(input.sessionId);
    },
  };
}

/** The conversation may no longer hold the note (compacted, replaced). */
export function resetSharedWorkDelivery(sessionId: string): void {
  delivered.delete(sessionId);
}

/** Tests only. */
export function resetSharedWorkDeliveryState(): void {
  delivered.clear();
}

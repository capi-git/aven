import {
  claudeConnectionsFromStatus,
  codexConnectionsFromStatus,
  listClaudeConnections,
  listCodexConnections,
} from "./harness/providerConnections";
import { sessionPermissions } from "./harness/sessionPermissions";
import { asRecord, stringField } from "./harness/codexProtocol";
import type { HarnessId } from "./session";

/**
 * What each open chat's provider says about its connections, for the one line
 * above the message box. Providers report this themselves: Claude Code in the
 * `mcp_servers` list of each turn's `system`/`init` line, Codex in
 * `mcpServer/startupStatus/updated` notifications.
 *
 * It lives outside session state on purpose. A report never touches the
 * transcript, and subscribers hear only about their own chat, only when its
 * line changes. Kept in memory: a chat reports again on its next message.
 * Only dismissals persist.
 */

type ChatConnectionProblem = {
  /** The provider's own name for the server. */
  key: string;
  name: string;
  state: "needs-sign-in" | "failed";
};

export type ChatConnectionLine = {
  harness: HarnessId;
  text: string;
  action: "Sign in" | "Connections" | "Reconnect";
  /** The names behind "and 2 others". */
  title?: string;
};

type ChatEntry = {
  harness: HarnessId;
  problems: readonly ChatConnectionProblem[];
  /** Problems a fresh check found fixed; this chat still needs reconnecting. */
  ready: ReadonlySet<string>;
  /** The check after Settings could not say. */
  unsure: boolean;
  /** Left for Settings from this chat's line, to check on return. */
  checkFolder?: string;
  line: ChatConnectionLine | null;
};

const DISMISSED_KEY = "aven.chatConnections.dismissed";
/** Chats whose dismissals are remembered; the oldest are dropped first. */
const DISMISSED_CHATS = 200;

const entries = new Map<string, ChatEntry>();
const listeners = new Map<string, Set<() => void>>();
let dismissed: Map<string, readonly string[]> | null = null;
let openConnections: (() => void) | null = null;

function loadDismissed(): Map<string, readonly string[]> {
  if (dismissed) return dismissed;
  dismissed = new Map();
  try {
    const stored: unknown = JSON.parse(
      localStorage.getItem(DISMISSED_KEY) ?? "{}",
    );
    for (const [id, keys] of Object.entries(asRecord(stored) ?? {})) {
      if (Array.isArray(keys))
        dismissed.set(
          id,
          keys.filter((key): key is string => typeof key === "string"),
        );
    }
  } catch {
    // Unreadable storage only means a dismissed line can come back.
  }
  return dismissed;
}

function saveDismissed(next: Map<string, readonly string[]>): void {
  try {
    localStorage.setItem(
      DISMISSED_KEY,
      JSON.stringify(Object.fromEntries(next)),
    );
  } catch {
    // The dismissal still holds until Aven restarts.
  }
}

function joinedNames(names: readonly string[]): string {
  const [first, ...rest] = names;
  if (!rest.length) return first ?? "";
  return `${first} and ${rest.length} ${rest.length === 1 ? "other" : "others"}`;
}

function titleFor(names: readonly string[]): { title?: string } {
  return names.length > 1 ? { title: names.join(", ") } : {};
}

function lineFor(
  entry: Omit<ChatEntry, "line">,
  hidden: readonly string[],
): ChatConnectionLine | null {
  const { harness } = entry;
  const ready = entry.problems
    .filter((problem) => entry.ready.has(problem.key))
    .map((problem) => problem.name);
  if (ready.length)
    return {
      harness,
      text:
        ready.length === 1
          ? `${ready[0]} is ready. Reconnect this chat to use it.`
          : `${joinedNames(ready)} are ready. Reconnect this chat to use them.`,
      action: "Reconnect",
      ...titleFor(ready),
    };
  if (entry.unsure)
    return {
      harness,
      text: "Signed in? Reconnect this chat to use it.",
      action: "Reconnect",
    };
  const shown = entry.problems.filter(
    (problem) => !hidden.includes(problem.key),
  );
  const signedOut = shown.filter((problem) => problem.state !== "failed");
  // Whoever can be fixed by signing in comes first.
  const ordered = [
    ...signedOut,
    ...shown.filter((problem) => problem.state === "failed"),
  ];
  const first = ordered[0];
  if (!first) return null;
  const action = signedOut.length ? "Sign in" : "Connections";
  const names = ordered.map((problem) => problem.name);
  return {
    harness,
    text:
      ordered.length > 1
        ? `${joinedNames(names)} aren't connected`
        : first.state === "failed"
          ? `${first.name} couldn't connect`
          : `${first.name} isn't signed in`,
    action,
    ...titleFor(names),
  };
}

function sameLine(
  a: ChatConnectionLine | null,
  b: ChatConnectionLine | null,
): boolean {
  return (
    a === b ||
    (!!a &&
      !!b &&
      a.harness === b.harness &&
      a.text === b.text &&
      a.action === b.action &&
      a.title === b.title)
  );
}

/** Stores the chat's new state, telling its line only when the line changed. */
function commit(sessionId: string, next: Omit<ChatEntry, "line">): void {
  const previous = entries.get(sessionId)?.line ?? null;
  const computed = lineFor(next, loadDismissed().get(sessionId) ?? []);
  const line = sameLine(previous, computed) ? previous : computed;
  entries.set(sessionId, { ...next, line });
  if (line !== previous) notify(sessionId);
}

function notify(sessionId: string): void {
  for (const listener of listeners.get(sessionId) ?? []) listener();
}

function mergedEntry(
  sessionId: string,
  harness: HarnessId,
  problems: readonly ChatConnectionProblem[],
): Omit<ChatEntry, "line"> {
  const current = entries.get(sessionId);
  const same = current?.harness === harness;
  // A server the running provider still can't use stays "ready to reconnect"
  // through later turns; once it stops reporting the problem, that's over.
  const ready = new Set(
    same
      ? problems
          .filter((problem) => current.ready.has(problem.key))
          .map((problem) => problem.key)
      : [],
  );
  return {
    harness,
    problems,
    ready,
    unsure: same ? current.unsure && problems.length > 0 : false,
    ...(same && current.checkFolder
      ? { checkFolder: current.checkFolder }
      : {}),
  };
}

/** A chat with no connections on purpose (a teammate's, a bot's) shows nothing. */
function closedChat(sessionId: string): boolean {
  return sessionPermissions(sessionId)?.noMcp === true;
}

function problemFrom(
  connection: ReturnType<typeof claudeConnectionsFromStatus>[number],
): ChatConnectionProblem | null {
  if (connection.state !== "needs-sign-in" && connection.state !== "failed")
    return null;
  return {
    key: connection.key,
    // Accounts' servers are "claude.ai Gmail" here, with no scope to tell.
    name: connection.name.replace(/^claude\.ai\s+/i, ""),
    state: connection.state,
  };
}

/** Claude Code's whole list, from a `system`/`init` line. */
export function noteClaudeInit(
  sessionId: string,
  rec: Record<string, unknown>,
): void {
  const servers = rec.mcp_servers;
  if (!Array.isArray(servers) || closedChat(sessionId)) return;
  const problems = claudeConnectionsFromStatus({ mcpServers: servers }).flatMap(
    (connection) => problemFrom(connection) ?? [],
  );
  commit(sessionId, mergedEntry(sessionId, "claude", problems));
}

/**
 * One server's change, from Codex's `mcpServer/startupStatus/updated`. Codex
 * has no signed-out state here: a signed-out server is `failed`, sometimes
 * with `failureReason`, otherwise only recognisable by its error. Getting that
 * wrong changes the words and the button's label, not where it goes.
 */
export function noteCodexServerStatus(
  sessionId: string,
  params: unknown,
  threadId: string | undefined,
): void {
  const record = asRecord(params);
  const key = stringField(record, "name");
  if (!key || closedChat(sessionId)) return;
  const from = stringField(record, "threadId");
  // A sub-agent's thread is not this chat's.
  if (from && threadId && from !== threadId) return;
  const failed = stringField(record, "status") === "failed";
  const signedOut =
    stringField(record, "failureReason") === "reauthenticationRequired" ||
    /not logged in/i.test(stringField(record, "error") ?? "");
  const current = entries.get(sessionId);
  const others = (current?.harness === "codex" ? current.problems : []).filter(
    (problem) => problem.key !== key,
  );
  const problems: ChatConnectionProblem[] = failed
    ? [
        ...others,
        {
          key,
          name: codexConnectionsFromStatus([{ name: key }])[0]?.name ?? key,
          state: signedOut ? "needs-sign-in" : "failed",
        },
      ]
    : others;
  commit(sessionId, mergedEntry(sessionId, "codex", problems));
}

/** The provider is starting over, or the conversation is gone. */
export function clearChatConnections(sessionId: string): void {
  if (!entries.has(sessionId)) return;
  const hadLine = entries.get(sessionId)?.line != null;
  entries.delete(sessionId);
  if (hadLine) notify(sessionId);
}

export function chatConnectionLine(
  sessionId: string,
): ChatConnectionLine | null {
  return entries.get(sessionId)?.line ?? null;
}

export function subscribeChatConnections(
  sessionId: string,
  listener: () => void,
): () => void {
  let set = listeners.get(sessionId);
  if (!set) {
    set = new Set();
    listeners.set(sessionId, set);
  }
  set.add(listener);
  return () => {
    const current = listeners.get(sessionId);
    current?.delete(listener);
    if (!current?.size) listeners.delete(sessionId);
  };
}

/** Says it once: what's on the line stays quiet in this chat from now on. */
export function dismissChatConnections(sessionId: string): void {
  const entry = entries.get(sessionId);
  if (!entry) return;
  const all = loadDismissed();
  const keys = new Set([
    ...(all.get(sessionId) ?? []),
    ...entry.problems.map((problem) => problem.key),
  ]);
  all.delete(sessionId);
  all.set(sessionId, [...keys]);
  for (const id of [...all.keys()].slice(
    0,
    Math.max(0, all.size - DISMISSED_CHATS),
  ))
    all.delete(id);
  saveDismissed(all);
  commit(sessionId, { ...entry, ready: new Set(), unsure: false });
}

/** Registered by the app, which owns Settings. */
export function installChatConnectionsOpener(open: () => void): () => void {
  openConnections = open;
  return () => {
    if (openConnections === open) openConnections = null;
  };
}

/** Opens the connections page; coming back checks what changed for this chat. */
export function openConnectionsFromChat(
  sessionId: string,
  folder: string,
): void {
  const entry = entries.get(sessionId);
  if (entry) entries.set(sessionId, { ...entry, checkFolder: folder });
  openConnections?.();
}

/**
 * Settings closed. A running provider doesn't notice a sign-in by itself, so
 * for the chats that sent someone there, ask the provider what's true now.
 */
export async function checkChatConnectionsAfterSettings(): Promise<void> {
  await Promise.all(
    [...entries].flatMap(([sessionId, entry]) =>
      entry.checkFolder ? [checkChat(sessionId, entry, entry.checkFolder)] : [],
    ),
  );
}

async function checkChat(
  sessionId: string,
  entry: ChatEntry,
  folder: string,
): Promise<void> {
  const { checkFolder: _checked, ...rest } = entry;
  entries.set(sessionId, rest);
  try {
    const connections = await (entry.harness === "codex"
      ? listCodexConnections(folder)
      : listClaudeConnections(folder));
    const current = entries.get(sessionId);
    if (!current || current.harness !== entry.harness) return;
    const nowReady = new Set(
      connections
        .filter((connection) => connection.state === "ready")
        .map((connection) => connection.key),
    );
    commit(sessionId, {
      ...current,
      ready: new Set(
        current.problems
          .filter((problem) => nowReady.has(problem.key))
          .map((problem) => problem.key),
      ),
      unsure: false,
    });
  } catch {
    // Not knowing still leaves a next step, so the line asks instead.
    const current = entries.get(sessionId);
    if (current?.harness === entry.harness)
      commit(sessionId, { ...current, unsure: true });
  }
}

/** Test seam. */
export function __chatConnectionsTestReset(): void {
  entries.clear();
  listeners.clear();
  dismissed = null;
  openConnections = null;
}

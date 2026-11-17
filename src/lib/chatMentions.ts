import type { RankedFile } from "./fileIndex";
import type { ProjectFile } from "./fs";
import { fuzzyMatch } from "./fuzzy";
import { limitSection } from "./jsonText";
import { projectName } from "./paths";
import { looksLikeProject, sameProjectPath } from "./recents";
import type { SessionSummary } from "./sessionStore";
import {
  HARNESS_TITLE,
  sessionDisplayTitle,
  type HarnessId,
  type Session,
} from "./session";

/**
 * `@chat/<name>` points at another chat. On send, the referenced chat's
 * recent conversation is added to the message, the way `@note/…` adds a note.
 */
export const CHAT_MENTION_PREFIX = "chat/";
export const CHAT_PATH_PREFIX = "chat:";

/** What `@` and Forward need to know about a chat. */
export type ChatRef = {
  id: string;
  title: string;
  harness: HarnessId;
  cwd: string;
  /** Larger is more recent; only used to order the list. */
  recency: number;
};

const MAX_CHAT_PICKER = 8;
const MAX_CHAT_PICKER_EMPTY = 4;
const MAX_SLUG = 48;
const MESSAGE_LIMIT = 1_200;
const REFERENCE_LIMIT = 6_000;
const MAX_MESSAGES = 10;

/**
 * Labels given this run, each owned by one chat for good, so a draft still
 * names the same chat when it is sent, even after a rename.
 */
const labelOwner = new Map<string, string>();
const labelsOf = new Map<string, string>();
/** Name and agent of each labelled chat, to draw its mention. */
const namesOf = new Map<string, { title: string; harness: HarnessId }>();

export function resetChatMentionLabels() {
  labelOwner.clear();
  labelsOf.clear();
  namesOf.clear();
}

export function isChatMentionPath(path: string): boolean {
  return path.startsWith(CHAT_PATH_PREFIX);
}

export function chatIdFromPath(path: string): string | null {
  return isChatMentionPath(path) ? path.slice(CHAT_PATH_PREFIX.length) : null;
}

export function chatTitle(chat: Pick<ChatRef, "title" | "harness">): string {
  return sessionDisplayTitle(chat.title, chat.harness);
}

export function chatSlug(title: string): string {
  const slug = title
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, MAX_SLUG)
    .replace(/-+$/g, "");
  return slug || "chat";
}

/** `chat/<slug>`, unique to this chat for the rest of the run. */
export function chatMentionLabel(
  chat: Pick<ChatRef, "id" | "title" | "harness">,
) {
  namesOf.set(chat.id, { title: chat.title, harness: chat.harness });
  const owned = labelsOf.get(chat.id);
  if (owned) return owned;
  const base = `${CHAT_MENTION_PREFIX}${chatSlug(chatTitle(chat))}`;
  for (let n = 1; n < 1000; n++) {
    const label = n === 1 ? base : `${base}-${n}`;
    if (labelOwner.has(label)) continue;
    labelOwner.set(label, chat.id);
    labelsOf.set(chat.id, label);
    return label;
  }
  return `${CHAT_MENTION_PREFIX}${chat.id}`;
}

/** The chat a `chat/…` label was given to, if any. */
export function chatIdForLabel(label: string): string | undefined {
  return labelOwner.get(label);
}

export function chatsAsProjectFiles(chats: ChatRef[]): ProjectFile[] {
  return chats.map((chat) => ({
    name: chatTitle(chat),
    path: `${CHAT_PATH_PREFIX}${chat.id}`,
    relative: chatMentionLabel(chat),
  }));
}

/** A chat worth offering: not hidden, not the one asking, and not empty. */
export function chatRefFromSession(
  session: Session,
  recency: number,
): ChatRef | null {
  if (session.inboxAsk || session.orchestrationLeadId) return null;
  if (!session.blocks.some((block) => block.role === "user")) return null;
  return {
    id: session.id,
    title: session.title,
    harness: session.harness,
    cwd: session.cwd,
    recency,
  };
}

/**
 * Other chats, in this project first, then by recency. `sessions` are the
 * chats in memory (later is newer); `saved` adds this project's history.
 */
export function otherChats(
  sessions: readonly Session[],
  excludeId: string | undefined,
  cwd: string,
  saved: readonly ChatRef[] = [],
): ChatRef[] {
  const byId = new Map<string, ChatRef>();
  for (const chat of saved) {
    if (chat.id !== excludeId) byId.set(chat.id, chat);
  }
  const base = Date.now();
  sessions.forEach((session, index) => {
    if (session.id === excludeId) return;
    const ref = chatRefFromSession(session, base + index);
    if (ref) byId.set(ref.id, ref);
  });
  const here = (chat: ChatRef) =>
    looksLikeProject(cwd) && sameProjectPath(chat.cwd, cwd) ? 1 : 0;
  return [...byId.values()].sort(
    (a, b) => here(b) - here(a) || b.recency - a.recency,
  );
}

export function rankChatFiles(
  chats: ChatRef[],
  query: string,
  limit = MAX_CHAT_PICKER,
): RankedFile[] {
  const needle = query
    .replace(/^chat\/?/i, "")
    .replace(/\/+$/, "")
    .trim();
  if (!needle) {
    return chatsAsProjectFiles(chats.slice(0, MAX_CHAT_PICKER_EMPTY)).map(
      (file) => ({ ...file, score: 0, positions: [] }),
    );
  }
  const scored: { file: ProjectFile; score: number; positions: number[] }[] =
    [];
  for (const chat of chats) {
    const [file] = chatsAsProjectFiles([chat]);
    if (!file) continue;
    const titleHit = fuzzyMatch(needle, file.name);
    const slugHit = titleHit ? null : fuzzyMatch(needle, file.relative);
    const hit = titleHit ?? slugHit;
    if (!hit) continue;
    scored.push({
      file,
      score: (titleHit ? hit.score + 400 : hit.score) + chat.recency / 1e15,
      positions: titleHit ? hit.positions : [],
    });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit).map((row) => ({
    ...row.file,
    score: row.score,
    positions: row.positions,
  }));
}

const CHAT_TOKEN_RE = /(^|\s)@(chat\/[^\s@]+)/g;
const TRAILING = /[,;:!?)\]}"'.]+$/;

/** Chat ids named by `@chat/…` in `text`, first mention first. */
export function chatIdsInText(
  text: string,
  fallback?: (label: string) => string | undefined,
): string[] {
  const found: string[] = [];
  const seen = new Set<string>();
  CHAT_TOKEN_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = CHAT_TOKEN_RE.exec(text))) {
    let label = match[2] ?? "";
    let id = chatIdForLabel(label) ?? fallback?.(label);
    if (!id) {
      label = label.replace(TRAILING, "");
      id = chatIdForLabel(label) ?? fallback?.(label);
    }
    if (!id || seen.has(id)) continue;
    seen.add(id);
    found.push(id);
  }
  return found;
}

/** The recent conversation of `session`, short enough to pass along. */
export function chatReference(session: Session): string {
  const messages: string[] = [];
  for (const block of session.blocks) {
    if (block.role !== "user" && block.role !== "assistant") continue;
    const text = block.text.trim();
    if (!text) continue;
    const who = block.role === "user" ? "User" : "Assistant";
    messages.push(`${who}: ${limitSection(text, MESSAGE_LIMIT)}`);
  }
  const recent = messages.slice(-MAX_MESSAGES);
  const omitted = messages.length - recent.length;
  const body = [
    omitted > 0 ? `(${omitted} earlier messages omitted)` : "",
    ...recent,
  ]
    .filter(Boolean)
    .join("\n\n");
  return limitSection(body, REFERENCE_LIMIT);
}

export function injectChatReferences(
  text: string,
  sessions: Session[],
): string {
  if (sessions.length === 0) return text;
  const blocks = sessions.map((session) => {
    const title = chatTitle(session);
    const where = looksLikeProject(session.cwd)
      ? ` in ${projectName(session.cwd)}`
      : "";
    const body = chatReference(session) || "(This chat has no messages yet.)";
    return [
      `Referenced chat "${title}" (${HARNESS_TITLE[session.harness]}${where}). Its recent conversation:`,
      "",
      "<chat>",
      body,
      "</chat>",
    ].join("\n");
  });
  return [text.trimEnd(), "", "---", ...blocks].join("\n");
}

type ChatSource = {
  /** A chat in memory, with its latest transcript. */
  session(id: string): Session | undefined;
  /** Every chat in memory, to find a label written before a restart. */
  list(): readonly Session[];
  /** A saved chat that is not in memory. */
  load(id: string): Promise<Session | null>;
};

let source: ChatSource | null = null;

/** Where `applyChatsToTurn` reads chats from; the app sets it once. */
export function setChatReferenceSource(next: ChatSource | null) {
  source = next;
}

/**
 * Add each `@chat/…` the message names to the end of it. A label not handed
 * out in this run (written before a restart, or pasted) only finds a chat
 * the picker would offer, in this project when `cwd` is given, so stray text
 * never pulls in a hidden or unrelated conversation.
 */
export async function applyChatsToTurn(
  text: string,
  from: ChatSource | null = source,
  cwd?: string,
): Promise<string> {
  if (!from || !/(^|\s)@chat\//.test(text)) return text;
  const bySlug = (label: string) => {
    const slug = label.slice(CHAT_MENTION_PREFIX.length);
    for (const session of [...from.list()].reverse()) {
      if (!chatRefFromSession(session, 0)) continue;
      if (cwd !== undefined && session.cwd !== cwd) continue;
      if (chatSlug(chatTitle(session)) === slug) return session.id;
    }
    return undefined;
  };
  const ids = chatIdsInText(text, bySlug);
  if (ids.length === 0) return text;
  const sessions: Session[] = [];
  for (const id of ids) {
    const session = from.session(id) ?? (await from.load(id).catch(() => null));
    if (session) sessions.push(session);
  }
  return injectChatReferences(text, sessions);
}

export type MentionedChat = { id: string; title: string; harness: HarnessId };

/**
 * The chat a `chat/…` label names, with its current name: one labelled this
 * run, or one in memory whose name gives the label (a message from before a
 * restart).
 */
export function resolveChatLabel(label: string): MentionedChat | undefined {
  const live = (id: string) => source?.session(id);
  let id = chatIdForLabel(label);
  if (!id && source) {
    const slug = label.slice(CHAT_MENTION_PREFIX.length);
    id = [...source.list()]
      .reverse()
      .find((session) => chatSlug(chatTitle(session)) === slug)?.id;
  }
  if (!id) return undefined;
  const named = live(id) ?? namesOf.get(id);
  if (!named) return undefined;
  return { id, title: chatTitle(named), harness: named.harness };
}

/** A project's saved chats, as `@` and Forward list them. */
export function chatRefsFromSummaries(
  rows: readonly SessionSummary[],
): ChatRef[] {
  return rows
    .filter((row) => !row.archived && !row.orchestrationLeadId)
    .map((row) => ({
      id: row.id,
      title: row.title,
      harness: row.harness,
      cwd: row.cwd,
      recency: row.updatedAt,
    }));
}

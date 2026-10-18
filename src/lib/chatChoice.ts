import { timeAgo } from "./orchestrationSummary";
import { sessionDisplayTitle, type Session } from "./session";

/** Longest first-message name a picker row shows; the row truncates beyond. */
const FIRST_MESSAGE_MAX = 60;

const UNTITLED = "New session";

/**
 * A chat's name where you pick one (Discuss's partner, a race's reviewer):
 * its title, or, while it has none, its first message, or "Empty chat".
 * Several untitled chats never all read "New session".
 */
export function chatChoiceTitle(
  session: Pick<Session, "title" | "harness" | "blocks">,
): string {
  const title = sessionDisplayTitle(session.title, session.harness).trim();
  if (title && title !== UNTITLED) return title;
  const first = session.blocks
    .find((block) => block.role === "user" && block.text.trim())
    ?.text.trim()
    .split(/\r?\n/)[0]
    ?.trim();
  if (!first) return "Empty chat";
  return first.length > FIRST_MESSAGE_MAX
    ? `${first.slice(0, FIRST_MESSAGE_MAX - 1).trimEnd()}…`
    : first;
}

/** When a chat was last used: its latest turn's end, or start. */
export function chatLastUsedAt(
  session: Pick<Session, "blocks">,
): number | undefined {
  for (let index = session.blocks.length - 1; index >= 0; index--) {
    const block = session.blocks[index];
    if (block.role !== "user") continue;
    const started = block.startedAt;
    if (started === undefined || !Number.isFinite(started) || started <= 0)
      continue;
    const took = block.durationMs;
    return started + (took !== undefined && took > 0 ? took : 0);
  }
  return undefined;
}

/** "Aven · 2h ago": where a chat is and when it was last used. */
export function chatChoiceDetail(
  project: string | undefined,
  lastUsedAt: number | undefined,
  now: number,
): string {
  return [project, lastUsedAt === undefined ? "" : timeAgo(lastUsedAt, now)]
    .filter(Boolean)
    .join(" · ");
}

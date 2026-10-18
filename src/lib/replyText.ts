/**
 * A chat's last reply, and its first lines, for the places that show a
 * glimpse of how an agent ended: a race lane's column and the cheap model's
 * judge and summaries. Plain text only; it never reads further back than
 * the chat's latest turn.
 */
import { clip } from "./memoryKeeperSafety";
import type { Block } from "./session";

/** The last reply of a chat's latest turn, or "". */
export function finalReply(blocks: readonly Block[]): string {
  for (let index = blocks.length - 1; index >= 0; index--) {
    const block = blocks[index];
    if (block.role === "user" && !block.internal) break;
    if (block.role === "assistant" && block.text.trim())
      return block.text.trim();
  }
  return "";
}

/** The first lines of a reply, for a lane's column: at most `lines` and `chars`. */
export function replyOpening(text: string, lines = 3, chars = 280): string {
  const kept = text
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, lines)
    .join("\n");
  return clip(kept, chars);
}

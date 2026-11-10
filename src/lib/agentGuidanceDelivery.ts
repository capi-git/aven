import type { HarnessId } from "./session";

/**
 * The standing guidance Aven puts ahead of a chat's messages (the browser
 * and desktop tools, the iPhone pane, where files go, the Git preference)
 * is long and rarely changes. A provider keeps every message in its
 * conversation, so repeating it each turn piled up copies of it. Each block
 * now rides in full only when this chat's conversation does not hold that
 * exact text: the first message of a conversation, after the text changes,
 * and after the conversation is compacted, replaced or forgotten. Otherwise
 * a one-line reminder takes its place.
 *
 * `agentBrowser.ts` builds the blocks and offers them here with their
 * reminders; the harness registry passes every turn and steer through
 * `prepareGuidanceTurn`, so the decision is made once, just before the text
 * reaches the provider, whoever composed the message around the blocks.
 */

export type GuidanceKind = "browser" | "iphone" | "files" | "git";

export type GuidanceBlock = {
  kind: GuidanceKind;
  /** The full text, exactly as it appears in the message. */
  full: string;
  /** What replaces it once the conversation holds `full`. */
  reminder: string;
  /**
   * Said in full every time it applies, and still remembered, so the full
   * guidance it stands in for is sent again later ("browser unavailable").
   */
  repeat?: boolean;
};

/** Blocks Aven built recently, by their full text. */
const offered = new Map<string, GuidanceBlock>();
const MAX_OFFERED = 64;

/** Remember a block so a message carrying it can be shortened. */
export function offerGuidance(block: GuidanceBlock): string {
  offered.delete(block.full);
  offered.set(block.full, block);
  while (offered.size > MAX_OFFERED) {
    const oldest = offered.keys().next().value;
    if (oldest === undefined) break;
    offered.delete(oldest);
  }
  return block.full;
}

/** What each chat's conversation holds, for the provider and checkout. */
type Delivered = {
  harness: HarnessId;
  cwd: string;
  blocks: ReadonlyMap<GuidanceKind, string>;
};
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
 * Shorten the guidance this conversation already holds, and record what it
 * holds once this message is sent. The record is made at once, so a steer
 * sent while this turn runs does not repeat it; `rollback` undoes it when
 * the message never reached the provider or its turn was stopped.
 */
export function prepareGuidanceTurn(input: {
  harness: HarnessId;
  sessionId: string;
  cwd: string;
  text: string;
}): { text: string; rollback: () => void } {
  const unchanged = { text: input.text, rollback: () => {} };
  // Provider commands (`/compact`) must reach the CLI untouched.
  if (input.text.trimStart().startsWith("/")) return unchanged;
  const present = [...offered.values()].filter((block) =>
    input.text.includes(block.full),
  );
  if (!present.length) return unchanged;
  const previous = delivered.get(input.sessionId);
  const known =
    previous?.harness === input.harness && previous.cwd === input.cwd
      ? previous.blocks
      : new Map<GuidanceKind, string>();
  const blocks = new Map(known);
  let text = input.text;
  for (const block of present) {
    if (!block.repeat && known.get(block.kind) === block.full)
      text = text.split(block.full).join(block.reminder);
    blocks.set(block.kind, block.full);
  }
  const entry: Delivered = { harness: input.harness, cwd: input.cwd, blocks };
  remember(input.sessionId, entry);
  return {
    text,
    rollback: () => {
      if (delivered.get(input.sessionId) !== entry) return;
      if (previous) remember(input.sessionId, previous);
      else delivered.delete(input.sessionId);
    },
  };
}

/**
 * The conversation may no longer hold the guidance: it was compacted,
 * replaced by another provider conversation, or forgotten.
 */
export function resetGuidanceDelivery(sessionId: string): void {
  delivered.delete(sessionId);
  for (const listener of resetListeners) listener(sessionId);
}

const resetListeners = new Set<(sessionId: string) => void>();

/**
 * Hear when a chat's conversation may have lost what earlier messages told
 * it, for other standing text sent once per conversation (a crew's rules).
 */
export function onGuidanceReset(
  listener: (sessionId: string) => void,
): () => void {
  resetListeners.add(listener);
  return () => {
    resetListeners.delete(listener);
  };
}

/** Tests only. */
export function resetGuidanceDeliveryState(): void {
  delivered.clear();
  offered.clear();
}

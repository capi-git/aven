import type { HarnessId } from "../session";
import type { HarnessProjectMemory } from "./types";

/**
 * How a provider receives project memory.
 * - `system`: appended to the system prompt when the CLI starts.
 * - `developer`: the thread's developer instructions.
 * - `message`: a block ahead of the first message of each conversation, and
 *   ahead of the next message after the memory changes. Used where the CLI
 *   has no launch option Aven has verified.
 *
 * Launch options only reach a new conversation reliably (Claude Code keeps
 * the system prompt it recorded first), so a conversation that is already
 * under way receives a change the same way as `message`.
 */
export type ProjectMemoryChannel = "system" | "developer" | "message";

export const PROJECT_MEMORY_CHANNELS: Record<HarnessId, ProjectMemoryChannel> =
  {
    claude: "system",
    codex: "developer",
    cursor: "message",
    grok: "message",
    opencode: "message",
    pi: "message",
    omp: "message",
    fx: "message",
  };

export const PROJECT_MEMORY_CHANNEL_LABELS: Record<
  ProjectMemoryChannel,
  string
> = {
  system: "system prompt",
  developer: "developer instructions",
  message: "first message",
};

const CLEARED_NOTICE =
  "<aven-project-memory>\nThe project memory Aven gave earlier in this conversation was cleared. Disregard it.\n</aven-project-memory>";
const UPDATE_NOTE =
  "This replaces the project memory given earlier in this conversation.";
const BLOCK_OPEN = "<aven-project-memory>\n";

export type ProjectMemoryPlan = {
  /** Text to put ahead of this turn's message; empty for none. */
  prefix: string;
  /** Revision the conversation holds once the turn is sent. */
  deliver?: string;
};

/**
 * What this turn must carry so the conversation ends up with the current
 * memory. Pure, so every provider's behaviour is tested in one place.
 */
export function planProjectMemoryDelivery(input: {
  channel: ProjectMemoryChannel;
  /** Undefined when the caller could not read it: change nothing. */
  memory: HarnessProjectMemory | undefined;
  /** Revision this conversation already holds; "" after a cleared notice. */
  known: string | undefined;
  /** The provider already holds a conversation for this chat. */
  continuing: boolean;
  /** Raw provider commands (`/compact` …) must reach the CLI untouched. */
  command: boolean;
}): ProjectMemoryPlan {
  const { memory, known } = input;
  if (!memory || input.command) return { prefix: "" };
  if (!input.continuing && input.channel !== "message") {
    // The CLI starts a new conversation with the memory at launch.
    return memory.revision
      ? { prefix: "", deliver: memory.revision }
      : { prefix: "" };
  }
  if ((known ?? "") === memory.revision) return { prefix: "" };
  if (!memory.revision) return { prefix: CLEARED_NOTICE, deliver: "" };
  const text =
    known && memory.text.startsWith(BLOCK_OPEN)
      ? `${BLOCK_OPEN}${UPDATE_NOTE}\n${memory.text.slice(BLOCK_OPEN.length)}`
      : memory.text;
  return { prefix: text, deliver: memory.revision };
}

export function withProjectMemoryPrefix(prefix: string, text: string): string {
  return prefix ? `${prefix}\n\n${text}` : text;
}

/** Provider commands are typed as a slash command at the start of the turn. */
export function isProviderCommandText(text: string): boolean {
  return text.trimStart().startsWith("/");
}

const STORAGE_KEY = "aven.projectMemory.delivered";
const MAX_REMEMBERED = 400;

/** Revisions each provider conversation holds, keyed by provider session ID. */
let delivered: Map<string, string> | null = null;
/** The provider conversation each chat continues, and the folder it runs in. */
const conversations = new Map<
  string,
  { harness: HarnessId; providerSessionId: string; cwd: string }
>();

function deliveries(): Map<string, string> {
  if (delivered) return delivered;
  delivered = new Map();
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}");
    if (raw && typeof raw === "object" && !Array.isArray(raw)) {
      for (const [id, revision] of Object.entries(raw)) {
        if (typeof revision === "string") delivered.set(id, revision);
      }
    }
  } catch {
    // Without storage, a restored chat receives its memory once more.
  }
  return delivered;
}

function saveDeliveries(map: Map<string, string>) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(Object.fromEntries(map)));
  } catch {
    // Best effort: the only cost is repeating the memory once.
  }
}

function recordDelivery(providerSessionId: string, revision: string) {
  const map = deliveries();
  if (map.get(providerSessionId) === revision) return;
  // Most recent last, so the oldest conversations are forgotten first.
  map.delete(providerSessionId);
  map.set(providerSessionId, revision);
  while (map.size > MAX_REMEMBERED) {
    const oldest = map.keys().next().value;
    if (oldest === undefined) break;
    map.delete(oldest);
  }
  saveDeliveries(map);
}

/** A provider bound or resumed a conversation for this chat. */
export function noteProviderConversation(
  harness: HarnessId,
  sessionId: string,
  providerSessionId: string,
  cwd: string,
): void {
  const id = providerSessionId.trim();
  if (!id) return;
  conversations.set(sessionId, { harness, providerSessionId: id, cwd });
}

/** The chat's conversation with this provider was dropped (delete, switch). */
export function forgetProviderConversation(
  harness: HarnessId,
  sessionId: string,
): void {
  if (conversations.get(sessionId)?.harness === harness)
    conversations.delete(sessionId);
}

/** After compaction the summary may have dropped the memory; give it again. */
export function resetProjectMemoryDelivery(sessionId: string): void {
  const conversation = conversations.get(sessionId);
  if (!conversation) return;
  const map = deliveries();
  if (!map.delete(conversation.providerSessionId)) return;
  saveDeliveries(map);
}

/**
 * Plan this turn's memory and return the text to send, plus a commit to call
 * once the provider accepted the turn.
 */
export function prepareProjectMemoryTurn(input: {
  harness: HarnessId;
  sessionId: string;
  cwd: string;
  text: string;
  projectMemory?: HarnessProjectMemory;
}): { text: string; commit: () => void } {
  const conversation = conversations.get(input.sessionId);
  const continuing =
    conversation != null &&
    conversation.harness === input.harness &&
    conversation.cwd === input.cwd;
  const plan = planProjectMemoryDelivery({
    channel: PROJECT_MEMORY_CHANNELS[input.harness],
    memory: input.projectMemory,
    known:
      continuing && input.projectMemory
        ? deliveries().get(conversation.providerSessionId)
        : undefined,
    continuing,
    command: isProviderCommandText(input.text),
  });
  return {
    text: withProjectMemoryPrefix(plan.prefix, input.text),
    commit: () => {
      if (plan.deliver === undefined) return;
      const bound = conversations.get(input.sessionId);
      if (bound?.harness === input.harness && bound.cwd === input.cwd)
        recordDelivery(bound.providerSessionId, plan.deliver);
    },
  };
}

/** Test seam. */
export function resetProjectMemoryDeliveryState(): void {
  delivered = null;
  conversations.clear();
}

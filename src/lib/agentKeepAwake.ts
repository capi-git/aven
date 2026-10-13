import { invoke, isTauri } from "@tauri-apps/api/core";
import { IS_MAC } from "./platform";
import { sessionNeedsInput, type Session } from "./session";
import { activeSessionAgents } from "./sessionAgents";

// Keep the computer from idle sleep while agents work. On by default; the
// display can still sleep, the screen can still lock, and closing a Mac's lid
// or choosing Sleep still sleeps it. Shares one native hold with automations.

const DEVICE = IS_MAC ? "Mac" : "computer";
export const AGENT_KEEP_AWAKE_LABEL = `Keep the ${DEVICE} awake while agents work`;
export const AGENT_KEEP_AWAKE_DESCRIPTION = `Working agents keep going while you're away or the screen is locked. The display can still sleep, and closing the lid or choosing Sleep still sleeps the ${DEVICE}.`;

const KEY = "aven.agents.keepAwake";
const EVENT = "aven:agents-keep-awake-changed";
/** Matches the native expiry: a silent window's claim lapses after five minutes. */
export const AGENT_KEEP_AWAKE_HEARTBEAT_MS = 60_000;
const MAX_SESSIONS = 512;
const SESSION_ID = /^[A-Za-z0-9-]{1,80}$/;

export function loadAgentKeepAwake(): boolean {
  try {
    return localStorage.getItem(KEY) !== "0";
  } catch {
    return true;
  }
}

export function saveAgentKeepAwake(on: boolean) {
  try {
    if (on) localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, "0");
  } catch {
    // Storage unavailable: the switch keeps its default (on).
  }
  window.dispatchEvent(new Event(EVENT));
}

export function subscribeAgentKeepAwake(listener: () => void) {
  const onStorage = (storage: StorageEvent) => {
    if (!storage.key || storage.key === KEY) listener();
  };
  window.addEventListener(EVENT, listener);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(EVENT, listener);
    window.removeEventListener("storage", onStorage);
  };
}

/** Stable, bounded list of the working chats the host accepts. */
export function agentKeepAwakeSessions(ids: Iterable<string>): string[] {
  return [...new Set(ids)]
    .filter((id) => SESSION_ID.test(id))
    .sort()
    .slice(0, MAX_SESSIONS);
}

/**
 * Chats that are really working: a running turn or sub-agent. A chat waiting
 * for the user's approval or answer is not working, so it never holds the
 * computer awake while the user is away.
 */
export function agentKeepAwakeSessionIds(
  sessions: readonly Session[],
): Set<string> {
  const ids = new Set<string>();
  for (const session of sessions) {
    if (sessionNeedsInput(session)) continue;
    if (!session.busy && activeSessionAgents(session).length === 0) continue;
    ids.add(session.id);
    if (session.orchestrationLeadId) ids.add(session.orchestrationLeadId);
  }
  return ids;
}

/**
 * A short fingerprint that changes whenever a working chat shows progress:
 * new or growing output, a tool's status, or a sub-agent's status. The host
 * releases a hold whose chats show no progress for hours (a stuck turn).
 */
export function agentKeepAwakeProgress(
  sessions: readonly Session[],
  ids: ReadonlySet<string>,
): string {
  let hash = 0x811c9dc5;
  const mix = (text: string) => {
    for (let index = 0; index < text.length; index++) {
      hash ^= text.charCodeAt(index);
      hash = Math.imul(hash, 0x01000193);
    }
  };
  for (const session of sessions) {
    if (!ids.has(session.id)) continue;
    const last = session.blocks[session.blocks.length - 1];
    mix(
      [
        session.id,
        session.blocks.length,
        last?.id ?? "",
        last?.text.length ?? 0,
        last?.tool?.status ?? "",
        last?.tool?.detail?.length ?? 0,
        ...(session.liveAgents ?? []).map(
          (agent) => `${agent.id}:${agent.status}:${agent.detail?.length ?? 0}`,
        ),
      ].join("|"),
    );
    mix("\n");
  }
  return (hash >>> 0).toString(16);
}

export async function reportAgentKeepAwake(
  enabled: boolean,
  sessionIds: readonly string[],
  progress = "",
) {
  if (!isTauri()) return;
  try {
    await invoke("agent_keep_awake", { enabled, sessionIds, progress });
  } catch {
    // An older host without the command just sleeps as before.
  }
}

/**
 * A seam for Aven Dev's real-app check only: the next crew turn waits here,
 * prepared (its copy synced, its chat open) and before its last look and
 * send, until the check releases it. Nothing waits unless the check armed
 * it, so ordinary use never stops here.
 */

let armed: {
  reached: (sessionId: string) => void;
  released: Promise<void>;
} | null = null;

/** Hold the next crew turn before it is sent; resolves with its chat once it waits. */
export function holdNextCrewSend(): {
  reached: Promise<string>;
  release: () => void;
} {
  let reached!: (sessionId: string) => void;
  let release!: () => void;
  const reachedAt = new Promise<string>((resolve) => {
    reached = resolve;
  });
  const released = new Promise<void>((resolve) => {
    release = resolve;
  });
  armed = { reached, released };
  return {
    reached: reachedAt,
    release: () => {
      armed = null;
      release();
    },
  };
}

/** Where a prepared crew turn waits while the check holds it. */
export async function crewSendHold(sessionId: string): Promise<void> {
  const hold = armed;
  if (!hold) return;
  armed = null;
  hold.reached(sessionId);
  await hold.released;
}

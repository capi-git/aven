import { pathKey } from "./paths";

/**
 * "Ship it" pressed outside the Changes panel, for example on a finished
 * turn's changes in the chat. The workspace opens the panel; the panel for
 * that folder opens its Ship flow, even when it mounts after the request.
 */
export type ShipRequest = {
  cwd: string;
  /** The conversation whose latest turn the flow describes. */
  sessionId?: string;
  at: number;
};

const SHIP_REQUEST = "aven-ship-request";
/** A request nobody picked up within this long is stale. */
const SHIP_REQUEST_TTL_MS = 15_000;

let pending: ShipRequest | null = null;

export function requestShip(cwd: string, sessionId?: string): void {
  if (!cwd || cwd === "~") return;
  pending = { cwd, ...(sessionId ? { sessionId } : {}), at: Date.now() };
  window.dispatchEvent(
    new CustomEvent<ShipRequest>(SHIP_REQUEST, { detail: pending }),
  );
}

export function subscribeShipRequests(
  listener: (request: ShipRequest) => void,
): () => void {
  const handler = (event: Event) => {
    const detail = (event as CustomEvent<ShipRequest>).detail;
    if (detail) listener(detail);
  };
  window.addEventListener(SHIP_REQUEST, handler);
  return () => window.removeEventListener(SHIP_REQUEST, handler);
}

/** The waiting request for `cwd`, removed so it opens the flow only once. */
export function takeShipRequest(
  cwd: string,
  now = Date.now(),
): ShipRequest | null {
  const request = pending;
  if (!request) return null;
  if (now - request.at > SHIP_REQUEST_TTL_MS) {
    pending = null;
    return null;
  }
  if (pathKey(request.cwd) !== pathKey(cwd)) return null;
  pending = null;
  return request;
}

const OPEN_CHAT_REQUEST = "aven-open-chat-request";

/** Ask the workspace to open a conversation, e.g. the one working in another copy. */
export function requestOpenChat(sessionId: string): void {
  if (!sessionId) return;
  window.dispatchEvent(
    new CustomEvent<string>(OPEN_CHAT_REQUEST, { detail: sessionId }),
  );
}

export function subscribeOpenChatRequests(
  listener: (sessionId: string) => void,
): () => void {
  const handler = (event: Event) => {
    const id = (event as CustomEvent<string>).detail;
    if (typeof id === "string" && id) listener(id);
  };
  window.addEventListener(OPEN_CHAT_REQUEST, handler);
  return () => window.removeEventListener(OPEN_CHAT_REQUEST, handler);
}

/**
 * The bridge between a team's panel popped out into a window of its own and
 * the workspace window that owns the team.
 *
 * The pop-out owns nothing: it draws the `TeamWatchView` snapshots the owner
 * sends and sends each button press back as an action. The host passes
 * actions only from a pop-out to the page that opened it, and the owner
 * checks each one against the team before performing it (see
 * `parseTeamWatchAction`), then answers with an error or nothing.
 *
 * When the owning window closes, the pop-out says so instead of drawing a
 * team it can no longer act on. When the pop-out closes, the owner shows
 * the team as a pill again. While a pop-out has focus, its owner counts the
 * team's chats as on screen, so their Activity is read there and raises no
 * banner; while it does not, they are not on screen in the owner.
 */
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import type { UsagePanelSnapshot } from "./usagePanel";
import {
  readTeamWatchRequest,
  type TeamWatchAction,
  type TeamWatchRequest,
  type TeamWatchView,
} from "./teamWatch";

export const TEAM_WATCH_STATE_EVENT = "team-watch-state";
export const TEAM_WATCH_ACTION_EVENT = "team-watch-action";
export const TEAM_WATCH_CLOSED_EVENT = "team-watch-closed";
export const TEAM_WATCH_REPLY_EVENT = "team-watch-reply";
export const TEAM_WATCH_FOCUS_EVENT = "team-watch-focus";

/** How long a pop-out waits for its owner to answer an action. */
export const TEAM_WATCH_REPLY_MS = 15_000;

export const OWNER_CLOSED_TEXT =
  "The Aven window this ran in is gone, so it can't be shown here.";
/** The owning window was closed while its team still runs there. */
export const OWNER_HIDDEN_TEXT =
  "The Aven window this runs in is hidden. It's still running there.";
export const NO_ANSWER_TEXT =
  "Its Aven window didn't respond. Try again from that window.";

/** What the owner sends: the team's view and the workspace's colours. */
export type TeamWatchSnapshot = {
  view: TeamWatchView | null;
  theme: UsagePanelSnapshot["theme"];
};

/** What a pop-out reads from the host. */
export type TeamWatchWindowState = {
  team: string;
  snapshot: TeamWatchSnapshot;
  revision: number;
  /** The owning window closed: nothing here can act any more. */
  ownerClosed: boolean;
  /**
   * The owning window was closed while its chats still run, so it is only
   * hidden: actions still work there, and it can be brought back.
   */
  ownerHidden?: boolean;
};

/** Where the in-window panel sat, so the pop-out opens in its place. */
export type TeamWatchPlace = {
  x: number;
  y: number;
  width: number;
  height: number;
  dpr: number;
};

export type TeamWatchTransport = {
  invoke<T>(command: string, args?: Record<string, unknown>): Promise<T>;
  /** Events addressed to this page. */
  listen<T>(event: string, callback: (payload: T) => void): Promise<() => void>;
};

export const tauriTeamWatchTransport: TeamWatchTransport = {
  invoke: (command, args) => invoke(command, args),
  listen: (event, callback) =>
    getCurrentWebview().listen(event, ({ payload }) =>
      callback(payload as never),
    ),
};

// --- The owning window -------------------------------------------------------------

export type TeamWatchOwner = {
  open(
    team: string,
    title: string,
    snapshot: TeamWatchSnapshot,
    at: TeamWatchPlace,
  ): Promise<void>;
  update(team: string, snapshot: TeamWatchSnapshot): Promise<void>;
  /** Close a pop-out from here (the team came back, or is gone). */
  close(team: string): Promise<void>;
  /** A reload: close pop-outs an earlier page of this window left open. */
  reset(): Promise<void>;
  reply(team: string, requestId: string, error: string | null): Promise<void>;
  onAction(callback: (request: TeamWatchRequest) => void): Promise<() => void>;
  onClosed(callback: (team: string) => void): Promise<() => void>;
  /** A pop-out of this window gained or lost focus. */
  onFocus(
    callback: (team: string, focused: boolean) => void,
  ): Promise<() => void>;
};

export function teamWatchOwner(
  transport: TeamWatchTransport = tauriTeamWatchTransport,
): TeamWatchOwner {
  return {
    open: (team, title, snapshot, at) =>
      transport.invoke("team_watch_open", { team, title, snapshot, at }),
    update: (team, snapshot) =>
      transport.invoke("team_watch_update", { team, snapshot }),
    close: (team) => transport.invoke("team_watch_close", { team }),
    reset: () => transport.invoke("team_watch_reset"),
    reply: (team, requestId, error) =>
      transport.invoke("team_watch_reply", { team, requestId, error }),
    onAction: (callback) =>
      transport.listen<unknown>(TEAM_WATCH_ACTION_EVENT, (payload) => {
        const request = readTeamWatchRequest(payload);
        if (request) callback(request);
      }),
    onClosed: (callback) =>
      transport.listen<unknown>(TEAM_WATCH_CLOSED_EVENT, (payload) => {
        const team =
          payload && typeof payload === "object"
            ? (payload as { team?: unknown }).team
            : undefined;
        if (typeof team === "string") callback(team);
      }),
    onFocus: (callback) =>
      transport.listen<unknown>(TEAM_WATCH_FOCUS_EVENT, (payload) => {
        if (!payload || typeof payload !== "object") return;
        const { team, focused } = payload as {
          team?: unknown;
          focused?: unknown;
        };
        if (typeof team === "string" && typeof focused === "boolean")
          callback(team, focused);
      }),
  };
}

/**
 * The team whose pop-out has focus, as its owner heard last. Its chats are
 * on screen there, while the owner's own window is not focused.
 */
let focusedPopOut: string | null = null;
const focusListeners = new Set<() => void>();

export function focusedTeamPopOut(): string | null {
  return focusedPopOut;
}

export function subscribeFocusedTeamPopOut(listener: () => void) {
  focusListeners.add(listener);
  return () => {
    focusListeners.delete(listener);
  };
}

/** Focus moving between pop-outs can arrive in either order. */
export function noteTeamPopOutFocus(team: string, focused: boolean) {
  const next = focused ? team : focusedPopOut === team ? null : focusedPopOut;
  if (next === focusedPopOut) return;
  focusedPopOut = next;
  for (const listener of focusListeners) listener();
}

// --- The pop-out -------------------------------------------------------------------

export type TeamWatchWindow = {
  state(): Promise<TeamWatchWindowState>;
  ready(revision: number): Promise<void>;
  onState(callback: (state: TeamWatchWindowState) => void): Promise<() => void>;
  /**
   * Ask the owner to act; resolves with its refusal or null once it has.
   * Never rejects: a lost owner or a silent one is a refusal too.
   */
  send(action: TeamWatchAction): Promise<string | null>;
  /** Close this window; the team goes back to its owner as a pill. */
  dismiss(): Promise<void>;
  /** Bring back the owning window, closed while its team still runs. */
  showOwner(): Promise<void>;
  /** Stop listening for replies. */
  dispose(): void;
};

let requests = 0;

export function teamWatchWindow(
  transport: TeamWatchTransport = tauriTeamWatchTransport,
  { replyMs = TEAM_WATCH_REPLY_MS }: { replyMs?: number } = {},
): TeamWatchWindow {
  const waiting = new Map<string, (error: string | null) => void>();
  let ownerClosed = false;
  const settleAll = (error: string) => {
    for (const [id, settle] of waiting) {
      waiting.delete(id);
      settle(error);
    }
  };
  const replies = transport.listen<unknown>(
    TEAM_WATCH_REPLY_EVENT,
    (payload) => {
      if (!payload || typeof payload !== "object") return;
      const { requestId, error } = payload as Record<string, unknown>;
      if (typeof requestId !== "string") return;
      const settle = waiting.get(requestId);
      if (!settle) return;
      waiting.delete(requestId);
      settle(typeof error === "string" && error ? error : null);
    },
  );
  return {
    state: () => transport.invoke<TeamWatchWindowState>("team_watch_get_state"),
    ready: (revision) => transport.invoke("team_watch_ready", { revision }),
    onState: (callback) =>
      transport.listen<TeamWatchWindowState>(
        TEAM_WATCH_STATE_EVENT,
        (state) => {
          ownerClosed = !!state?.ownerClosed;
          if (ownerClosed) settleAll(OWNER_CLOSED_TEXT);
          callback(state);
        },
      ),
    send: (action) => {
      if (ownerClosed) return Promise.resolve(OWNER_CLOSED_TEXT);
      requests += 1;
      const requestId = `${Date.now().toString(36)}-${requests}`;
      return new Promise<string | null>((resolve) => {
        const timer = setTimeout(() => {
          if (waiting.delete(requestId)) resolve(NO_ANSWER_TEXT);
        }, replyMs);
        waiting.set(requestId, (error) => {
          clearTimeout(timer);
          resolve(error);
        });
        transport
          .invoke("team_watch_action", { requestId, action })
          .catch((error: unknown) => {
            if (!waiting.delete(requestId)) return;
            clearTimeout(timer);
            resolve(
              error instanceof Error
                ? error.message
                : typeof error === "string"
                  ? error
                  : NO_ANSWER_TEXT,
            );
          });
      });
    },
    dismiss: () => transport.invoke("team_watch_dismiss"),
    showOwner: () => transport.invoke("team_watch_show_owner"),
    dispose: () => {
      settleAll(NO_ANSWER_TEXT);
      void replies.then((stop) => stop());
    },
  };
}

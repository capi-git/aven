import { isTauri } from "@tauri-apps/api/core";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  BROWSER_ORB_ACTION_EVENT,
  findBrowserOrbAnchor,
  nativeBrowserOrb,
  sameAnchor,
  trimAnswer,
  type BrowserOrbAction,
  type BrowserOrbAnchor,
  type BrowserOrbSnapshot,
} from "../lib/browserOrb";
import { finalAssistantText } from "../lib/scheduledAgents";
import { HARNESS_TITLE, type Session } from "../lib/session";

/** How often the page position is checked; cheap layout reads only. */
export const BROWSER_ORB_TRACK_MS = 250;

type Asked = { id: string; sessionId: string; after: number };

/**
 * Show the Aven bubble over the visible browser page and route what is typed
 * there to the workspace's active chat. The answer shown is the chat's reply
 * to the latest question asked from the bubble.
 */
export function useBrowserOrb({
  enabled,
  session,
  tint = null,
  onSubmit,
  onStop,
  onOpenChat,
  findAnchor = findBrowserOrbAnchor,
  native = nativeBrowserOrb,
}: {
  enabled: boolean;
  session: Session | undefined;
  /** The bubble's glass colour, or null for the standard charcoal. */
  tint?: string | null;
  onSubmit: (sessionId: string, text: string) => void;
  onStop: (sessionId: string) => void;
  onOpenChat: (sessionId: string) => void;
  findAnchor?: () => BrowserOrbAnchor | null;
  native?: Pick<typeof nativeBrowserOrb, "set" | "close" | "listen">;
}) {
  const [asked, setAsked] = useState<Asked | null>(null);
  const live = enabled && (native !== nativeBrowserOrb || isTauri());

  const snapshot = useMemo<BrowserOrbSnapshot>(() => {
    let answer: BrowserOrbSnapshot["answer"] = null;
    if (
      session &&
      asked?.sessionId === session.id &&
      !session.busy &&
      session.blocks.length > asked.after
    ) {
      const text = finalAssistantText(session.blocks);
      if (text) answer = { id: asked.id, text: trimAnswer(text) };
    }
    return {
      chat: session
        ? {
            title: session.title?.trim() || "Chat",
            agent: HARNESS_TITLE[session.harness] ?? "Aven",
          }
        : null,
      busy: Boolean(session?.busy),
      answer,
      tint,
    };
  }, [session, asked, tint]);

  const latest = useRef({ session, onSubmit, onStop, onOpenChat, snapshot });
  latest.current = { session, onSubmit, onStop, onOpenChat, snapshot };

  // Keep the bubble over the page and up to date.
  useEffect(() => {
    if (!live) return;
    let sent: { anchor: BrowserOrbAnchor | null; snapshot: string } | null =
      null;
    let disposed = false;
    const sync = () => {
      if (disposed) return;
      const anchor = findAnchor();
      const current = JSON.stringify(latest.current.snapshot);
      if (sent && sameAnchor(sent.anchor, anchor) && sent.snapshot === current)
        return;
      sent = { anchor, snapshot: current };
      void native.set(anchor, latest.current.snapshot).catch(() => {
        // Try again on the next check.
        sent = null;
      });
    };
    sync();
    const timer = window.setInterval(sync, BROWSER_ORB_TRACK_MS);
    window.addEventListener("resize", sync);
    return () => {
      disposed = true;
      window.clearInterval(timer);
      window.removeEventListener("resize", sync);
      void native.set(null, latest.current.snapshot).catch(() => {});
    };
  }, [live, findAnchor, native]);

  // Push real changes straight away rather than on the next check. The chat
  // object changes with every streamed word; only its visible summary counts.
  const snapshotKey = JSON.stringify(snapshot);
  useEffect(() => {
    if (!live) return;
    const anchor = findAnchor();
    if (anchor)
      void native.set(anchor, latest.current.snapshot).catch(() => {});
  }, [live, snapshotKey, findAnchor, native]);

  useEffect(() => {
    if (!live) return;
    let disposed = false;
    let stop: (() => void) | undefined;
    void native
      .listen<BrowserOrbAction>(BROWSER_ORB_ACTION_EVENT, (request) => {
        const {
          session: target,
          onSubmit,
          onStop,
          onOpenChat,
        } = latest.current;
        if (!target) return;
        if (request.action === "submit") {
          const text = request.text?.trim();
          if (!text || target.busy) return;
          setAsked({
            id: crypto.randomUUID(),
            sessionId: target.id,
            after: target.blocks.length,
          });
          onSubmit(target.id, text);
        } else if (request.action === "dismiss") setAsked(null);
        else if (request.action === "stop") onStop(target.id);
        else if (request.action === "openChat") onOpenChat(target.id);
      })
      .then((unlisten) => {
        if (disposed) unlisten();
        else stop = unlisten;
      })
      .catch(() => {});
    return () => {
      disposed = true;
      stop?.();
    };
  }, [live, native]);

  useEffect(
    () => () => {
      if (native === nativeBrowserOrb && isTauri())
        void native.close().catch(() => {});
    },
    [native],
  );
}

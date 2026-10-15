import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import {
  BLOCKER_PHRASE,
  discussionBlocker,
  discussionReply,
  discussionStore,
  planDiscussions,
  relayBlockMeta,
  relayPrompt,
  sidebarDiscussions,
  type Discussion,
  type DiscussionBlocker,
  type DiscussionCandidate,
  type DiscussionHost,
  type DiscussionOutcome,
  type DiscussionParty,
  type DiscussionStore,
  type SidebarDiscussion,
} from "../lib/discussions";
import { errorText, logError } from "../lib/errors";
import { orchestrator } from "../lib/orchestration";
import { resolveModel } from "../lib/models";
import { sameProjectPath } from "../lib/recents";
import {
  sessionDisplayTitle,
  type Attachment,
  type DiscussionRelayMeta,
  type HarnessId,
  type Session,
} from "../lib/session";

/** The extra `onSubmit` options a relayed turn uses. */
export type DiscussionTurnOptions = {
  /** Shown in the receiving transcript instead of the framed prompt. */
  displayText: string;
  discussion: DiscussionRelayMeta;
  /** A relayed reply is another agent's text: its `/` and `@` stay as text. */
  verbatim: boolean;
  followUpBehavior: "queue";
  onSettled: (outcome: DiscussionOutcome) => void;
};

type Options = {
  /** Committed sessions; a change re-checks the discussions this window drives. */
  sessions: readonly Session[];
  sessionsRef: { readonly current: readonly Session[] };
  onSubmit: (
    sessionId: string,
    text: string,
    attachments: Attachment[],
    options: DiscussionTurnOptions,
  ) => void | boolean;
  /** Add a short notice to a chat's transcript. */
  postNote: (sessionId: string, text: string) => void;
  /** Open a new chat beside `sourceId`; returns its id. */
  openPartner: (
    sourceId: string,
    harness: HarnessId,
    model: string,
    title: string,
  ) => string | undefined;
  store?: DiscussionStore;
};

/** Development preview: how often the answering side changes. */
const PREVIEW_FLIP_MS = 3_500;

export function discussionParty(session: Session): DiscussionParty {
  return {
    sessionId: session.id,
    harness: session.harness,
    model: resolveModel(session.harness, session.model).name,
    title: sessionDisplayTitle(session.title, session.harness),
    cwd: session.cwd,
  };
}

/** Orchestration leads answer to their run, so they sit discussions out. */
function joinBlocker(
  session: Session,
  discussions: readonly Discussion[],
): DiscussionBlocker | null {
  const run = orchestrator.forSession(session.id);
  if (run && (run.status === "active" || run.status === "paused"))
    return "unsupported";
  return discussionBlocker(session, discussions);
}

/** A new partner chat is named after the topic's first line. */
export function discussionChatTitle(topic: string): string {
  const line = topic.trim().split(/\r?\n/)[0]?.trim() ?? "";
  const max = 60;
  const short = line.length > max ? `${line.slice(0, max - 1)}…` : line;
  return short ? `Discuss: ${short}` : "Discussion";
}

/**
 * Drives the discussions this window owns: sends each turn, relays each
 * finished reply to the other chat, pauses for approvals, questions and busy
 * chats, and posts the closing notes. Only reacts to discussion changes and
 * committed session changes; it never runs per streamed token.
 */
export function useDiscussionBroker({
  sessions,
  sessionsRef,
  onSubmit,
  postNote,
  openPartner,
  store: given,
}: Options): { host: DiscussionHost; sidebar: SidebarDiscussion[] } {
  const [store] = useState(() => given ?? discussionStore());
  const list = useSyncExternalStore(
    store.subscribe,
    store.snapshot,
    store.snapshot,
  );
  const latest = useRef({ sessionsRef, onSubmit, postNote, openPartner });
  latest.current = { sessionsRef, onSubmit, postNote, openPartner };
  /** Discussion id → the turn this window sent and is waiting on. */
  const inFlight = useRef(new Map<string, number>());

  const settle = useCallback(
    (
      id: string,
      turn: number,
      sessionId: string,
      outcome: DiscussionOutcome,
    ) => {
      if (inFlight.current.get(id) === turn) inFlight.current.delete(id);
      const discussion = store.get(id);
      if (!discussion || discussion.settled !== turn) return;
      let text = outcome.text;
      if (outcome.status === "completed") {
        // The final reply, not every message streamed during the turn.
        const speaker = latest.current.sessionsRef.current.find(
          (session) => session.id === sessionId,
        );
        const reply = speaker
          ? discussionReply(speaker.blocks, id, turn)
          : null;
        if (reply) text = reply;
      }
      store.settle(id, turn, { status: outcome.status, text });
    },
    [store],
  );

  const deliver = useCallback(
    (id: string, sessionId: string) => {
      const { sessionsRef, onSubmit } = latest.current;
      const a = sessionsRef.current.find(
        (session) => session.id === store.get(id)?.a.sessionId,
      );
      const b = sessionsRef.current.find(
        (session) => session.id === store.get(id)?.b.sessionId,
      );
      if (a && b)
        store.refreshParties(id, discussionParty(a), discussionParty(b));
      const discussion = store.get(id);
      if (!discussion || discussion.delivered) return;
      const turn = discussion.settled;
      inFlight.current.set(id, turn);
      // Marked first, so a re-run while onSubmit works never sends twice.
      store.markDelivered(id);
      let accepted: void | boolean = false;
      try {
        accepted = onSubmit(sessionId, relayPrompt(discussion), [], {
          displayText: discussion.relay,
          discussion: relayBlockMeta(discussion),
          // The topic is the user's own, so it keeps skills and @ references.
          verbatim: turn > 0,
          followUpBehavior: "queue",
          onSettled: (outcome) => settle(id, turn, sessionId, outcome),
        });
      } catch (error) {
        logError("Discussion relay", error);
      }
      if (accepted === false && inFlight.current.get(id) === turn) {
        inFlight.current.delete(id);
        const party =
          discussion.a.sessionId === sessionId ? discussion.a : discussion.b;
        store.redeliver(id);
        store.pause(
          id,
          `Couldn't send to “${party.title}”. Resume to try again.`,
        );
      }
    },
    [settle, store],
  );

  const run = useCallback(() => {
    const { sessionsRef, postNote } = latest.current;
    const actions = planDiscussions(
      store.snapshot(),
      store.owner,
      sessionsRef.current,
      new Set(inFlight.current.keys()),
    );
    for (const action of actions) {
      switch (action.kind) {
        case "deliver":
          deliver(action.id, action.sessionId);
          break;
        case "pause":
          store.pause(action.id, action.reason);
          break;
        case "note":
          if (action.sessionId) postNote(action.sessionId, action.text);
          store.notePosted(action.id, action.side);
          break;
        case "recover":
          store.settle(action.id, action.turn, {
            status: "completed",
            text: action.reply,
          });
          break;
        case "redeliver":
          store.redeliver(action.id);
          break;
      }
    }
  }, [deliver, store]);

  const driving = list.some(
    (discussion) => store.owns(discussion) && !discussion.preview,
  );
  useEffect(() => {
    if (driving) run();
  }, [driving, list, run, sessions]);

  // A closing or reloading window takes its turns in flight with it.
  useEffect(() => {
    const hide = () => store.pauseAll();
    window.addEventListener("pagehide", hide);
    return () => window.removeEventListener("pagehide", hide);
  }, [store]);

  // Development preview only: swap who answers so the pulse changes direction.
  const previewing = list.some(
    (discussion) => discussion.preview && store.owns(discussion),
  );
  useEffect(() => {
    if (!previewing) return;
    const timer = window.setInterval(
      () => store.flipPreviews(),
      PREVIEW_FLIP_MS,
    );
    return () => window.clearInterval(timer);
  }, [previewing, store]);

  const host = useMemo<DiscussionHost>(
    () => ({
      preview: import.meta.env.DEV,
      options(sessionId) {
        const sessions = latest.current.sessionsRef.current;
        const discussions = store.snapshot();
        const source = sessions.find((session) => session.id === sessionId);
        const blocked = source
          ? joinBlocker(source, discussions)
          : "unsupported";
        const candidates = sessions
          .filter(
            (session) =>
              session.id !== sessionId &&
              !session.inboxAsk &&
              !session.orchestrationLeadId,
          )
          .map((session): DiscussionCandidate => {
            const party = discussionParty(session);
            const reason = joinBlocker(session, discussions);
            return {
              sessionId: session.id,
              title: party.title,
              harness: party.harness,
              model: party.model,
              cwd: party.cwd,
              ...(reason ? { blocked: reason } : {}),
            };
          })
          .reverse()
          // The same project first, then the rest; newest first in each.
          .sort(
            (left, right) =>
              Number(!sameProjectPath(left.cwd, source?.cwd ?? "")) -
              Number(!sameProjectPath(right.cwd, source?.cwd ?? "")),
          );
        return {
          ...(blocked
            ? { blocked: `This chat ${BLOCKER_PHRASE[blocked]}.` }
            : {}),
          candidates,
        };
      },
      start(request) {
        const { sessionsRef, openPartner } = latest.current;
        const discussions = store.snapshot();
        const source = sessionsRef.current.find(
          (session) => session.id === request.sessionId,
        );
        if (!source) return "This chat is no longer open.";
        const sourceBlocked = joinBlocker(source, discussions);
        if (sourceBlocked) return `This chat ${BLOCKER_PHRASE[sourceBlocked]}.`;
        const topic = request.topic.trim();
        if (!topic) return "Add a topic to discuss.";
        let partner: Session | undefined;
        if (request.partner.kind === "chat") {
          const id = request.partner.sessionId;
          partner = sessionsRef.current.find((session) => session.id === id);
          if (!partner) return "That chat is no longer open.";
          const blocked = joinBlocker(partner, discussions);
          if (blocked)
            return `“${discussionParty(partner).title}” ${BLOCKER_PHRASE[blocked]}.`;
        } else {
          const id = openPartner(
            source.id,
            request.partner.harness,
            request.partner.model,
            discussionChatTitle(topic),
          );
          partner = id
            ? sessionsRef.current.find((session) => session.id === id)
            : undefined;
          if (!partner) return "Couldn't open a new chat.";
        }
        try {
          store.start({
            a: discussionParty(source),
            b: discussionParty(partner),
            topic,
            rounds: request.rounds,
            preview: Boolean(request.preview && import.meta.env.DEV),
          });
        } catch (error) {
          return errorText(error);
        }
        return null;
      },
    }),
    [store],
  );

  const sidebar = useMemo(() => sidebarDiscussions(list), [list]);
  return { host, sidebar };
}

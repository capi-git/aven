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
  capRelay,
  continuationRelay,
  discussionBlocker,
  discussionParty as partyOf,
  discussionReply,
  discussionStore,
  discussionWrapUpMeta,
  finalReplyMeta,
  planDiscussions,
  relayBlockMeta,
  relayDisplayText,
  relayPrompt,
  sidebarDiscussions,
  speakingSide,
  type Discussion,
  type DiscussionBlocker,
  type DiscussionCandidate,
  type DiscussionHost,
  type DiscussionOutcome,
  type DiscussionParty,
  type DiscussionStore,
  type DiscussionSummary,
  type SidebarDiscussion,
} from "../lib/discussions";
import type { DiscussionTranscripts } from "../lib/discussionThread";
import {
  discussionBuildMessage,
  runDiscussionWrapUp,
} from "../lib/discussionWrapUp";
import { errorText, logError } from "../lib/errors";
import { orchestrator } from "../lib/orchestration";
import { resolveModel } from "../lib/models";
import { sameProjectPath } from "../lib/recents";
import {
  sessionDisplayTitle,
  type Attachment,
  type DiscussionRelayMeta,
  type DiscussionWrapUpMeta,
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

/**
 * A message the user asked for (a wrap-up's build button): it goes through
 * the normal send path like one typed in the chat, queued behind a turn
 * already running.
 */
export type DiscussionMessageOptions = { followUpBehavior: "queue" };

type Options = {
  /** Committed sessions; a change re-checks the discussions this window drives. */
  sessions: readonly Session[];
  sessionsRef: { readonly current: readonly Session[] };
  onSubmit: (
    sessionId: string,
    text: string,
    attachments: Attachment[],
    options: DiscussionTurnOptions | DiscussionMessageOptions,
  ) => void | boolean;
  /** Show a chat in this window, as its sidebar row does. */
  focusChat?: (sessionId: string) => void;
  /** Sums up a finished discussion; tests replace the model call. */
  summarise?: (
    discussion: Discussion,
    transcripts: DiscussionTranscripts,
  ) => Promise<DiscussionSummary>;
  /**
   * Add a short notice to a chat's transcript. The closing note in the chat
   * that started a finished discussion carries `wrapUp`, so its transcript
   * shows where they landed; it is shown only, never sent to the agent.
   */
  postNote: (
    sessionId: string,
    text: string,
    wrapUp?: DiscussionWrapUpMeta,
  ) => void;
  /**
   * Where a discussion landed is written: copy it into the starting chat's
   * closing note for that ending, if the note is there yet.
   */
  recordWrapUp?: (sessionId: string, wrapUp: DiscussionWrapUpMeta) => void;
  /**
   * Show the other chat's last reply in the chat that started the
   * discussion, which never receives it as a relay. Shown only: the agent
   * is not sent it.
   */
  postReply?: (
    sessionId: string,
    text: string,
    meta: DiscussionRelayMeta,
  ) => void;
  /**
   * Start a new chat for `sourceId` to discuss with; returns its id. It is
   * not shown: the discussion plays out in `sourceId`.
   */
  openPartner: (
    sourceId: string,
    harness: HarnessId,
    model: string,
    title: string,
  ) => string | undefined;
  /**
   * Show a discussion's conversation page beside the chat that started it,
   * focused: the bar's and the wrap-up's Open discussion, and relay cards.
   */
  openView?: (id: string) => void;
  /** A discussion started here: open its panel, or a pill. */
  onStarted?: (id: string) => void;
  /** A discussion used up its rounds: where they landed is on its way. */
  onEnded?: (discussion: Discussion) => void;
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
  recordWrapUp,
  postReply,
  openPartner,
  openView,
  onStarted,
  onEnded,
  focusChat,
  summarise = runDiscussionWrapUp,
  store: given,
}: Options): { host: DiscussionHost; sidebar: SidebarDiscussion[] } {
  const [store] = useState(() => given ?? discussionStore());
  const list = useSyncExternalStore(
    store.subscribe,
    store.snapshot,
    store.snapshot,
  );
  const latest = useRef({
    sessionsRef,
    onSubmit,
    postNote,
    recordWrapUp,
    postReply,
    openPartner,
    openView,
    onStarted,
    onEnded,
    focusChat,
    summarise,
  });
  latest.current = {
    sessionsRef,
    onSubmit,
    postNote,
    recordWrapUp,
    postReply,
    openPartner,
    openView,
    onStarted,
    onEnded,
    focusChat,
    summarise,
  };
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
      // The other chat's last reply is never relayed to the chat that
      // started it, which shows the discussion: copy it in, shown only.
      const ended = store.get(id);
      if (
        turn % 2 === 1 &&
        ended?.status === "ended" &&
        ended.ended?.kind === "completed" &&
        ended.settled === turn + 1
      ) {
        const capped = capRelay(text);
        if (capped.text)
          latest.current.postReply?.(
            ended.a.sessionId,
            capped.text,
            finalReplyMeta(ended, capped.truncated, Date.now()),
          );
        latest.current.onEnded?.(ended);
      }
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
      const current = store.get(id);
      if (!current || current.delivered) return;
      // Continued after it ended: the reply to pass on is read back from
      // the chat that wrote it, as the page reads it.
      if (!current.relay && current.settled > 0) {
        const recovered = continuationRelay(current, sessionsRef.current);
        if (recovered?.text) store.recoverRelay(id, recovered);
      }
      const discussion = store.get(id);
      if (!discussion || discussion.delivered) return;
      const turn = discussion.settled;
      inFlight.current.set(id, turn);
      // Marked first, so a re-run while onSubmit works never sends twice.
      store.markDelivered(id);
      let accepted: void | boolean = false;
      // A continued discussion's last reply is already in the starting
      // chat, copied in when it ended: show only what the user added.
      const recipient = sessionsRef.current.find(
        (session) => session.id === sessionId,
      );
      const shown =
        speakingSide(discussion) === "a" &&
        !!recipient?.blocks.some(
          (block) =>
            block.discussionReply?.id === id &&
            block.discussionReply.turn === turn,
        );
      try {
        accepted = onSubmit(sessionId, relayPrompt(discussion), [], {
          displayText: shown ? "" : relayDisplayText(discussion),
          discussion: {
            ...relayBlockMeta(discussion),
            ...(shown ? { replyShown: true as const } : {}),
          },
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

  /**
   * Endings this window is summing up now, as `id:settled`: a discussion
   * continued and ended again while its last summary is still being
   * written is summed up for its new ending straight away.
   */
  const summarising = useRef(new Set<string>());
  const summariseOnce = useCallback(
    (id: string) => {
      const ending = `${id}:${store.get(id)?.settled}`;
      if (summarising.current.has(ending) || !store.claimSummary(id)) return;
      const discussion = store.get(id);
      if (!discussion) return;
      summarising.current.add(ending);
      const sessions = latest.current.sessionsRef.current;
      const blocks = (side: "a" | "b") =>
        sessions.find(
          (session) => session.id === partyOf(discussion, side).sessionId,
        )?.blocks;
      void latest.current
        .summarise(discussion, { a: blocks("a"), b: blocks("b") })
        .catch((): DiscussionSummary => ({ status: "failed" }))
        .then((summary) => {
          store.finishSummary(id, discussion.settled, summary);
          // Kept for this ending: the starting chat's note keeps the lists.
          const current = store.get(id);
          const wrapUp =
            current?.summary === summary
              ? discussionWrapUpMeta(current)
              : undefined;
          if (current && wrapUp?.agreed)
            latest.current.recordWrapUp?.(current.a.sessionId, wrapUp);
        })
        .finally(() => summarising.current.delete(ending));
    },
    [store],
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
          store.pause(action.id, action.reason, action.blockedBy);
          break;
        case "ready":
          store.ready(action.id);
          break;
        case "note":
          if (action.sessionId)
            postNote(action.sessionId, action.text, action.wrapUp);
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
        case "summarise":
          summariseOnce(action.id);
          break;
      }
    }
  }, [deliver, store, summariseOnce]);

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
        let started: Discussion;
        try {
          started = store.start({
            a: discussionParty(source),
            b: {
              ...discussionParty(partner),
              ...(request.role ? { role: request.role } : {}),
            },
            topic,
            rounds: request.rounds,
            preview: Boolean(request.preview && import.meta.env.DEV),
          });
        } catch (error) {
          return errorText(error);
        }
        // The card in this chat stands for it; its panel opens, or a pill.
        latest.current.onStarted?.(started.id);
        return null;
      },
      open(id) {
        if (store.get(id)) latest.current.openView?.(id);
      },
      show(id, side) {
        const discussion = store.get(id);
        if (discussion)
          latest.current.focusChat?.(partyOf(discussion, side).sessionId);
      },
      build(id, side) {
        const { sessionsRef, onSubmit, focusChat } = latest.current;
        const discussion = store.get(id);
        if (!discussion) return "This discussion is no longer available.";
        const party = partyOf(discussion, side);
        const session = sessionsRef.current.find(
          (entry) => entry.id === party.sessionId,
        );
        if (!session) return `“${party.title}” isn't open in this window.`;
        focusChat?.(session.id);
        let accepted: void | boolean = false;
        try {
          accepted = onSubmit(
            session.id,
            discussionBuildMessage(discussion, side),
            [],
            { followUpBehavior: "queue" },
          );
        } catch (error) {
          logError("Discussion build", error);
        }
        return accepted === false ? `Couldn't send to “${party.title}”.` : null;
      },
    }),
    [store],
  );

  const sidebar = useMemo(() => sidebarDiscussions(list), [list]);
  return { host, sidebar };
}

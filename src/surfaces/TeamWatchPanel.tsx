import {
  memo,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { DiscussionAvatar } from "../chrome/DiscussionAvatar";
import { OrchestrationActions } from "../chrome/OrchestrationActions";
import { STALLED_AFTER_MS } from "../chrome/TeamBar";
import { useDiscussionList } from "../hooks/useDiscussions";
import { useMotionOnChange } from "../hooks/useMotionOnChange";
import { useOrchestrationRun } from "../hooks/useOrchestrationRun";
import type { TeamWatchControls } from "../hooks/useTeamWatch";
import { useTeamRun, useTeamRuns } from "../hooks/useTeamRuns";
import {
  clampRect,
  defaultRect,
  resizeRect,
  type PanelEdge,
  type PanelRect,
  type Viewport,
} from "../lib/discussionPanel";
import {
  discussionStore,
  type Discussion,
  type DiscussionHost,
} from "../lib/discussions";
import {
  buildDiscussionThread,
  type DiscussionThreadItem,
} from "../lib/discussionThread";
import { logError } from "../lib/errors";
import { LAYER } from "../lib/layers";
import { LiveSessionsContext } from "../lib/liveSessions";
import { orchestrator, runWaitsOnLead } from "../lib/orchestration";
import { IS_MAC } from "../lib/platform";
import {
  getRace,
  raceWorkspace,
  subscribeRaces,
  useRaceWorkspace,
  type RaceSuggestion,
} from "../lib/race";
import { sessionWorkCwd, type Session } from "../lib/session";
import { reviewerChoices, type ReviewerChoice } from "../lib/raceReviewers";
import {
  askRaceReviewer,
  requestRaceSuggestion,
  reviewRunning,
  suggestionRunning,
  type ReviewSend,
} from "../lib/teamResult";
import { teamIdOf, teamKeyOf, teamKindOf, type TeamRun } from "../lib/teamRuns";
import {
  parseTeamWatchAction,
  popOutView,
  teamPillText,
  teamPills,
  teamGoneText,
  teamTone,
  teamWatchTitle,
  TEAM_KIND_NAME,
  TEAM_NOUN,
  type TeamWatchAct,
  type TeamWatchAction,
  type TeamWatchReview,
  type TeamWatchSuggestion,
  type TeamWatchView,
} from "../lib/teamWatch";
import {
  noteTeamPopOutFocus,
  teamWatchOwner,
  type TeamWatchOwner,
  type TeamWatchPlace,
  type TeamWatchSnapshot,
} from "../lib/teamWatchBridge";
import { teamWorkspace, useTeamWorkspace } from "../lib/teamWorkspace";
import { useUsagePanelTheme } from "../lib/usagePanel";
import {
  DiscussionPanelContent,
  performDiscussionAction,
} from "./DiscussionPanel";
import { useRaceStats } from "./RaceCard";
import { TeamPanelBar, type TeamPanelControls } from "./TeamPanelBar";
import {
  ACT_FAILED,
  TeamWatchPanelView,
  useTeamVoices,
} from "./TeamWatchBodies";
import "./DiscussionPanel.css";
import "./TeamWatchPanel.css";

/** A pointer that moves this far is dragging, not clicking. */
const DRAG_SLOP = 4;
const EDGES: readonly PanelEdge[] = [
  "n",
  "s",
  "e",
  "w",
  "ne",
  "nw",
  "se",
  "sw",
];
/** The most mascots on a pill. */
const PILL_FACES = 4;

/** A pop-out window's title: its team's, or its kind's while it loads. */
function popOutTitle(teamId: string, view: TeamWatchView | null): string {
  if (view) return teamWatchTitle(view.team);
  const kind = teamKindOf(teamId);
  return kind ? TEAM_KIND_NAME[kind] : "Aven";
}

/** The window's size, kept current. */
function useViewport(): Viewport {
  const read = () => ({ width: window.innerWidth, height: window.innerHeight });
  const [viewport, setViewport] = useState<Viewport>(read);
  useEffect(() => {
    const update = () => setViewport(read());
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);
  return viewport;
}

/**
 * Follows one pointer from `start` until it is released, as a drag of the
 * panel or one of its edges. `onMove` gets the distance moved; `onEnd`
 * whether it ever moved past the slop.
 */
function trackPointer(
  start: ReactPointerEvent,
  onMove: (dx: number, dy: number) => void,
  onEnd: (moved: boolean) => void,
) {
  const x = start.clientX;
  const y = start.clientY;
  let moved = false;
  const move = (event: PointerEvent) => {
    const dx = event.clientX - x;
    const dy = event.clientY - y;
    if (!moved && Math.hypot(dx, dy) < DRAG_SLOP) return;
    moved = true;
    onMove(dx, dy);
  };
  const end = () => {
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", end);
    window.removeEventListener("pointercancel", end);
    onEnd(moved);
  };
  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", end);
  window.addEventListener("pointercancel", end);
}

/** True once `on` has held for `ms`; false again as soon as it does not. */
function useHeld(on: boolean, ms: number): boolean {
  const [held, setHeld] = useState(false);
  useEffect(() => {
    if (!on) {
      setHeld(false);
      return;
    }
    const timer = window.setTimeout(() => setHeld(true), ms);
    return () => window.clearTimeout(timer);
  }, [on, ms]);
  return held && on;
}

// --- Doing what a panel asks ----------------------------------------------------------

export type TeamWatchPerform = (
  team: TeamRun,
  action: TeamWatchAction,
) => string | null | Promise<string | null>;

/**
 * What a team's panel asks, done in the window that owns the team: the
 * same for the panel here and for one popped out into a window of its own.
 */
export function useTeamWatchPerformer({
  panel,
  host,
  onStop,
}: {
  panel: Pick<TeamWatchControls, "popIn">;
  host?: DiscussionHost;
  onStop?: (sessionId: string) => void;
}): TeamWatchPerform {
  const orchestration = useContext(OrchestrationActions);
  const live = useContext(LiveSessionsContext);
  const deps = useRef({ panel, host, onStop, orchestration, live });
  deps.current = { panel, host, onStop, orchestration, live };
  return useCallback((team, action) => {
    const { panel, host, onStop, orchestration, live } = deps.current;
    const GONE = teamGoneText(team.kind);
    /** A slower action: its error is logged and said as `failed`. */
    const later = (work: () => Promise<unknown>, failed: string) =>
      work().then(
        () => null,
        (error: unknown) => {
          logError("Team panel", error);
          return failed;
        },
      );
    if (action.kind === "watch") {
      panel.popIn(team.id);
      return null;
    }
    if (action.kind === "open-chat" && team.kind !== "discuss") {
      const open = teamWorkspace()?.openChat ?? orchestration?.open;
      if (!open) return "This window can't open that chat.";
      open(action.sessionId);
      return null;
    }
    if (team.kind === "discuss") {
      const discussion = discussionStore().get(team.key);
      return discussion
        ? performDiscussionAction(discussion, host, action)
        : GONE;
    }
    if (team.kind === "race") {
      const race = getRace(team.key);
      const workspace = raceWorkspace();
      if (!race) return GONE;
      switch (action.kind) {
        case "compare":
          if (!workspace) return "This window can't compare the agents.";
          workspace.compare(race.id);
          return null;
        case "stop":
          workspace?.stop(
            team.members
              .filter(
                (member) =>
                  member.state === "working" || member.state === "needs-you",
              )
              .map((member) => member.sessionId),
          );
          return null;
        case "suggest":
          // Answered once it starts: the cheap model can take a couple of
          // minutes, and the race's own view shows it working, then its pick
          // (in a pop-out too, which would otherwise stop waiting first).
          if (
            suggestionRunning(race.suggestion) ||
            reviewRunning(
              race.review,
              Date.now(),
              live?.session(race.review?.sessionId ?? ""),
            )
          )
            return "A suggestion is already on its way.";
          void requestRaceSuggestion(
            race.id,
            (id) => live?.session(id),
            team.members.map((member) => member.stateLabel),
          ).catch((error: unknown) => logError("Race suggestion", error));
          return null;
        case "review": {
          // Checked again here: the chat must still be one that may review.
          const choice = live
            ? reviewerChoices(race, live).find(
                (entry) => entry.sessionId === action.sessionId,
              )
            : undefined;
          if (!choice) return "That chat can't review this race.";
          if (choice.busy)
            return `“${choice.title}” is busy now. Choose another chat.`;
          const send = teamWorkspace()?.send;
          if (!send) return "This window can't ask a reviewer.";
          return later(async () => {
            // A refusal is kept with the race, so this panel and the card
            // both say why.
            await askRaceReviewer(
              race.id,
              choice,
              (id) => live?.session(id),
              team.members.map((member) => member.stateLabel),
              send as ReviewSend,
            );
          }, "Couldn't ask that chat to review. Try again, or choose another chat.");
        }
        default:
          return null;
      }
    }
    const run = orchestrator.run(team.key);
    if (!run) return GONE;
    switch (action.kind) {
      case "stop":
        if (onStop) onStop(run.leadId);
        else
          return later(
            () => orchestrator.stopRun(run.leadId),
            "Couldn't stop the run. Try again.",
          );
        return null;
      case "resume":
        // A panel can be a moment behind: only a paused run resumes, never
        // one that finished or stopped meanwhile, which would start afresh.
        if (run.status !== "paused") return "This run isn't paused any more.";
        if (team.members[0]?.state === "working")
          return "Wait for the lead to finish its turn, then resume.";
        return later(
          () =>
            orchestrator.start(
              run.leadId,
              run.allowedHarnesses,
              run.maxWorkers,
            ),
          "Couldn't resume the run. Try again from the lead's chat.",
        );
      case "finish":
        return later(
          () => orchestrator.finishRun(run.leadId),
          "Couldn't finish the run. Try again, or stop it.",
        );
      case "open-agents":
        if (!orchestration?.openAgents || !run.tasks.length)
          return "This window can't open the agents.";
        orchestration.openAgents(
          run.tasks.map((task) => ({
            sessionId: task.sessionId,
            leadId: run.leadId,
            title: task.title,
            harness: task.harness,
          })),
        );
        return null;
      default:
        return null;
    }
  }, []);
}

// --- What a panel shows ----------------------------------------------------------------

function suggestionView(
  suggestion: RaceSuggestion | undefined,
): TeamWatchSuggestion | undefined {
  if (!suggestion) return undefined;
  if (suggestion.status === "done")
    return {
      status: "done",
      lane: suggestion.lane,
      why: suggestion.why,
      ...(suggestion.by === "reviewer" ? { by: suggestion.model } : {}),
    };
  if (suggestion.status === "failed") return { status: "failed" };
  return suggestionRunning(suggestion) ? { status: "running" } : undefined;
}

/**
 * A race's or a run's panel as data: the team with what its watchers show
 * (what each member does, waits for and last said), the race's suggested
 * and kept lane, and whether the run's lead stopped without finishing.
 * Re-renders only when that changes, never as a member streams.
 */
export function useTeamWatchView(teamId: string): TeamWatchView | null {
  const team = useTeamRun(teamId, { detail: true, previews: true });
  const raceActions = useRaceWorkspace();
  const teamActions = useTeamWorkspace();
  const kind = teamKindOf(teamId);
  const key = teamKeyOf(teamId);
  const race = useSyncExternalStore(
    subscribeRaces,
    () => (kind === "race" ? getRace(key) : undefined),
    () => undefined,
  );
  useRaceStats(race, kind === "race" ? team : null);
  const run = useOrchestrationRun(kind === "orchestrate" ? key : undefined);
  const lead = team?.members[0];
  const stalled = useHeld(
    !!run && runWaitsOnLead(run) && lead?.state === "queued",
    STALLED_AFTER_MS,
  );
  const orchestration = useContext(OrchestrationActions);
  const compare = !!raceActions;
  const openAgents = !!orchestration?.openAgents;
  const openChat = !!teamActions || !!orchestration;
  const suggestion = suggestionView(race?.suggestion);
  const suggestionKey = suggestion ? JSON.stringify(suggestion) : "";
  // The reviewer, and the chats that could be one once the race is ready.
  const live = useContext(LiveSessionsContext);
  const review: TeamWatchReview | undefined = race?.review
    ? {
        sessionId: race.review.sessionId,
        harness: race.review.harness,
        label: race.review.label,
        status: reviewRunning(
          race.review,
          Date.now(),
          live?.session(race.review.sessionId),
        )
          ? "running"
          : race.review.status === "running"
            ? "failed"
            : race.review.status,
        ...(race.review.error ? { error: race.review.error } : {}),
      }
    : undefined;
  const reviewers =
    race && live && team?.status === "ready" && suggestion?.status !== "done"
      ? reviewerChoices(race, live)
      : undefined;
  const reviewKey = JSON.stringify([review ?? null, reviewers ?? null]);
  const kept =
    race?.state === "kept" && race.outcome?.kind === "lane"
      ? race.outcome.lane
      : undefined;
  return useMemo(() => {
    if (!team || team.kind === "discuss") return null;
    const shown = suggestionKey
      ? (JSON.parse(suggestionKey) as TeamWatchSuggestion)
      : undefined;
    const [reviewer, choices] = JSON.parse(reviewKey) as [
      TeamWatchReview | null,
      ReviewerChoice[] | null,
    ];
    return {
      team,
      ...(team.kind === "race"
        ? {
            race: {
              ...(shown ? { suggestion: shown } : {}),
              ...(kept !== undefined ? { kept } : {}),
              ...(reviewer ? { review: reviewer } : {}),
              ...(choices ? { reviewers: choices } : {}),
            },
          }
        : { run: { stalled } }),
      can: { jumpIn: false, build: false, openChat, openAgents, compare },
    };
  }, [
    team,
    suggestionKey,
    reviewKey,
    kept,
    stalled,
    openChat,
    openAgents,
    compare,
  ]);
}

/**
 * A discussion's panel as data, for a window of its own: its record and
 * its thread as this window builds it from the two chats.
 */
function useDiscussionWatchView(
  teamId: string,
  sessions: readonly Session[],
  host: DiscussionHost | undefined,
): TeamWatchView | null {
  const team = useTeamRun(teamId, { previews: true });
  const key = teamKeyOf(teamId);
  const list = useDiscussionList();
  const discussion = useMemo<Discussion | undefined>(
    () => list.find((entry) => entry.id === key),
    [list, key],
  );
  const a = discussion
    ? sessions.find((session) => session.id === discussion.a.sessionId)
    : undefined;
  const b = discussion
    ? sessions.find((session) => session.id === discussion.b.sessionId)
    : undefined;
  const thread = useRef<readonly DiscussionThreadItem[]>([]);
  const blocksA = a?.blocks;
  const blocksB = b?.blocks;
  const items = useMemo(() => {
    if (!discussion) return thread.current;
    thread.current = buildDiscussionThread(
      discussion,
      { a: blocksA, b: blocksB },
      thread.current,
    );
    return thread.current;
  }, [discussion, blocksA, blocksB]);
  const cwdA = a ? sessionWorkCwd(a) : (discussion?.a.cwd ?? "");
  const cwdB = b ? sessionWorkCwd(b) : (discussion?.b.cwd ?? "");
  const jumpIn = !!host && !discussion?.preview;
  const build = !!host?.build;
  const openChat = !!host?.show;
  return useMemo(
    () =>
      team && discussion
        ? {
            team,
            discussion: {
              record: discussion,
              items,
              cwd: { a: cwdA, b: cwdB },
            },
            can: {
              jumpIn,
              build,
              openChat,
              openAgents: false,
              compare: false,
            },
          }
        : null,
    [team, discussion, items, cwdA, cwdB, jumpIn, build, openChat],
  );
}

// --- The panel and its pills -------------------------------------------------------------

export type TeamWatchFloatProps = {
  panel: TeamWatchControls;
  /** This window's chats: a discussion's two, and which teams started here. */
  sessions: readonly Session[];
  host?: DiscussionHost;
  onOpenFile?: (path: string) => void;
  /** Stops a chat's turn; for a lead, its whole run. */
  onStop?: (sessionId: string) => void;
  /**
   * Pops a team out into a window of its own; null where that is not
   * offered (outside macOS, or without the native host).
   */
  popOuts?: TeamWatchOwner | null;
};

const NATIVE_POP_OUTS: TeamWatchOwner | null = IS_MAC ? teamWatchOwner() : null;

/**
 * The window's teams over its workspace: the one being watched as a
 * floating panel, the others as stacked pills, and any popped out into
 * windows of their own. The panel is dragged by its header, resized from
 * its edges, kept inside the window and below its title bar, and
 * remembered for this window (see `useTeamWatch`). Both are cut out of a
 * native browser page beneath them, as menus are.
 */
export const TeamWatchFloat = memo(function TeamWatchFloat({
  panel,
  sessions,
  host,
  onOpenFile,
  onStop,
  popOuts = NATIVE_POP_OUTS,
}: TeamWatchFloatProps) {
  const viewport = useViewport();
  const { state } = panel;
  const saved = useMemo(
    () => clampRect(state.rect ?? defaultRect(viewport), viewport),
    [state.rect, viewport],
  );
  const [live, setLive] = useState<PanelRect | null>(null);
  const rect = live ?? saved;
  const expanded = state.expanded;
  const teams = useTeamRuns({ previews: true });
  const hereKey = sessions.map((session) => session.id).join("\n");
  const here = useMemo(
    () => new Set(hereKey ? hereKey.split("\n") : []),
    [hereKey],
  );
  const pills = useMemo(
    () => teamPills(state, teams, here),
    [state, teams, here],
  );
  const byId = useMemo(
    () => new Map(teams.map((team) => [team.id, team])),
    [teams],
  );
  const perform = useTeamWatchPerformer({ panel, host, onStop });

  const draggedPill = useRef(false);
  const moveFrom = useCallback(
    (
      event: ReactPointerEvent,
      start: PanelRect,
      clicked?: () => void,
      dragged?: () => void,
    ) => {
      let last = start;
      trackPointer(
        event,
        (dx, dy) => {
          last = clampRect(
            { ...start, x: start.x + dx, y: start.y + dy },
            viewport,
          );
          setLive(last);
        },
        (moved) => {
          setLive(null);
          if (moved) {
            panel.move(last);
            dragged?.();
          } else clicked?.();
        },
      );
    },
    [panel, viewport],
  );
  // One handler for every pill, unchanged across renders, so a pill redraws
  // only when its own team does.
  const pillRefs = useRef({ moveFrom, rect, panel });
  pillRefs.current = { moveFrom, rect, panel };
  const pillPointerDown = useCallback((event: ReactPointerEvent) => {
    if (event.button !== 0) return;
    const { moveFrom, rect } = pillRefs.current;
    moveFrom(event, rect, undefined, () => {
      draggedPill.current = true;
    });
  }, []);
  const restorePill = useCallback((id: string) => {
    // A drag ends with a click: it only moved the pills.
    if (draggedPill.current) {
      draggedPill.current = false;
      return;
    }
    pillRefs.current.panel.restore(id);
  }, []);

  const onPanelPointerDown = (event: ReactPointerEvent<HTMLElement>) => {
    if (event.button !== 0) return;
    const target = event.target as HTMLElement;
    const edge = target.closest<HTMLElement>("[data-edge]")?.dataset.edge as
      PanelEdge | undefined;
    if (edge) {
      event.preventDefault();
      const start = rect;
      let last = start;
      trackPointer(
        event,
        (dx, dy) => {
          last = resizeRect(start, edge, dx, dy, viewport);
          setLive(last);
        },
        (moved) => {
          setLive(null);
          if (moved) panel.move(last);
        },
      );
      return;
    }
    if (
      !target.closest("[data-discussion-drag]") ||
      target.closest("button, a, textarea, input")
    )
      return;
    event.preventDefault();
    moveFrom(event, rect);
  };

  // Pills stack at the panel's corner: above it while it is open, in its
  // place while it is shrunk.
  const pillAnchor: CSSProperties = {
    right: Math.max(8, viewport.width - (rect.x + rect.width)),
    bottom: expanded
      ? Math.max(8, viewport.height - rect.y + 8)
      : Math.max(8, viewport.height - (rect.y + rect.height)),
    zIndex: LAYER.floatingPanel,
  };

  const kind = expanded ? teamKindOf(expanded) : null;
  const shrink = panel.shrink;
  const close = panel.close;
  const popOut = panel.popOut;
  const controls = useMemo<TeamPanelControls | undefined>(
    () =>
      expanded
        ? {
            onShrink: shrink,
            onClose: () => close(expanded),
            ...(popOuts ? { onPopOut: () => popOut(expanded) } : {}),
          }
        : undefined,
    [close, expanded, popOut, popOuts, shrink],
  );
  const seenDiscussion = panel.seen;
  const onSeen = useCallback(
    (id: string, count: number) =>
      seenDiscussion(teamIdOf("discuss", id), count),
    [seenDiscussion],
  );
  const discussion =
    kind === "discuss" && expanded
      ? discussionStore().get(teamKeyOf(expanded))
      : undefined;
  const a = discussion
    ? sessions.find((session) => session.id === discussion.a.sessionId)
    : undefined;
  const b = discussion
    ? sessions.find((session) => session.id === discussion.b.sessionId)
    : undefined;

  return (
    <>
      {expanded && kind ? (
        <section
          className="discussion-float"
          data-team-panel={expanded}
          data-team-kind={kind}
          {...(kind === "discuss"
            ? { "data-discussion-panel": teamKeyOf(expanded) }
            : {})}
          data-native-browser-occluded="true"
          data-dragging={live ? "" : undefined}
          aria-label={TEAM_KIND_NAME[kind]}
          style={{
            left: rect.x,
            top: rect.y,
            width: rect.width,
            height: rect.height,
            zIndex: LAYER.floatingPanel,
          }}
          onPointerDown={onPanelPointerDown}
        >
          {EDGES.map((edge) => (
            <div
              key={edge}
              className="discussion-float-edge"
              data-edge={edge}
              aria-hidden
            />
          ))}
          {kind === "discuss" ? (
            <DiscussionPanelContent
              key={expanded}
              discussionId={teamKeyOf(expanded)}
              a={a}
              b={b}
              host={host}
              onOpenFile={onOpenFile}
              seen={state.seen[expanded]}
              onSeen={onSeen}
              controls={controls}
            />
          ) : (
            <OwnedTeamPanel
              key={expanded}
              teamId={expanded}
              perform={perform}
              controls={controls}
            />
          )}
        </section>
      ) : null}
      {pills.length ? (
        <div
          className="discussion-pills"
          data-discussion-pills
          data-team-pills
          style={pillAnchor}
        >
          {pills.map((id) => {
            const team = byId.get(id);
            return team ? (
              <TeamPill
                key={id}
                team={team}
                onPointerDown={pillPointerDown}
                onRestore={restorePill}
              />
            ) : null;
          })}
        </div>
      ) : null}
      {popOuts ? (
        <PopOuts
          panel={panel}
          bridge={popOuts}
          sessions={sessions}
          host={host}
          perform={perform}
          place={rect}
        />
      ) : null}
    </>
  );
});

/** A race's or a run's panel, here in the window that owns it. */
function OwnedTeamPanel({
  teamId,
  perform,
  controls,
}: {
  teamId: string;
  perform: TeamWatchPerform;
  controls?: TeamPanelControls;
}) {
  const view = useTeamWatchView(teamId);
  const team = view?.team;
  const kind = teamKindOf(teamId);
  const act = useCallback<TeamWatchAct>(
    (action) => (team ? perform(team, action) : teamGoneText(kind)),
    [kind, perform, team],
  );
  if (!view)
    return (
      <div className="team-watch-view" data-team-view={teamId}>
        <div className="discussion-float-head">
          <TeamPanelBar
            title={kind ? TEAM_KIND_NAME[kind] : "Panel"}
            kind={kind}
            controls={controls}
          />
        </div>
        <p className="px-6 py-10 text-center text-ui-label leading-5 text-content/45">
          {teamGoneText(kind)}
        </p>
      </div>
    );
  return <TeamWatchPanelView view={view} act={act} controls={controls} />;
}

/**
 * A shrunk team: its members' mascots, where it stands and what is
 * happening, in amber when it needs you. Pressing it opens the panel again;
 * dragging it moves where the panel and its pills sit.
 */
export const TeamPill = memo(function TeamPill({
  team,
  onPointerDown,
  onRestore,
}: {
  team: TeamRun;
  onPointerDown?: (event: ReactPointerEvent<HTMLButtonElement>) => void;
  /** Called with the team's id, so one handler serves every pill. */
  onRestore: (teamId: string) => void;
}) {
  const voices = useTeamVoices(team);
  const { progress, status } = teamPillText(team);
  const progressRef = useRef<HTMLSpanElement>(null);
  const statusRef = useRef<HTMLSpanElement>(null);
  useMotionOnChange(progressRef, progress);
  useMotionOnChange(statusRef, status);
  const active =
    team.members.find((member) => member.state === "working") ??
    team.members[0];
  const color = voices[team.members.indexOf(active)]?.color;
  return (
    <button
      type="button"
      className="discussion-pill"
      data-team-pill={team.id}
      data-team-kind={team.kind}
      {...(team.kind === "discuss" ? { "data-discussion-pill": team.key } : {})}
      data-state={teamTone(team)}
      data-native-browser-occluded="true"
      title={`Show the ${TEAM_NOUN[team.kind]}`}
      aria-label={`Show the ${TEAM_NOUN[team.kind]} “${team.title}”: ${progress}, ${status}`}
      style={
        color ? ({ "--discussion-voice": color } as CSSProperties) : undefined
      }
      onPointerDown={onPointerDown}
      onClick={() => onRestore(team.id)}
    >
      <span className="discussion-duo" aria-hidden>
        {voices.slice(0, PILL_FACES).map((voice, index) => (
          <DiscussionAvatar
            key={voice.sessionId}
            voice={voice}
            typing={team.members[index]?.state === "working"}
          />
        ))}
      </span>
      <span ref={progressRef} className="team-pill-progress">
        {progress}
      </span>
      <span ref={statusRef} className="discussion-pill-status">
        {status}
      </span>
    </button>
  );
});

// --- Popped out --------------------------------------------------------------------------

/**
 * The teams popped out into windows of their own: each gets this window's
 * view of it as it changes, and what each asks is checked against that
 * team and done here. A pop-out that closes leaves its team here as a pill.
 */
function PopOuts({
  panel,
  bridge,
  sessions,
  host,
  perform,
  place,
}: {
  panel: TeamWatchControls;
  bridge: TeamWatchOwner;
  sessions: readonly Session[];
  host?: DiscussionHost;
  perform: TeamWatchPerform;
  place: PanelRect;
}) {
  const popped = panel.state.popped;
  const theme = useUsagePanelTheme(popped.length > 0);
  /** Each popped-out team as last sent, to check its actions against. */
  const shown = useRef(new Map<string, TeamRun>());
  /** Pop-outs the user closed in their own window. */
  const closedThere = useRef(new Set<string>());
  const performRef = useRef(perform);
  performRef.current = perform;
  const panelRef = useRef(panel);
  panelRef.current = panel;
  useEffect(() => {
    // A reload leaves the windows an earlier page opened; close them.
    bridge.reset().catch((error: unknown) => logError("team pop-outs", error));
    const stops = [
      bridge.onAction((request) => {
        const team = shown.current.get(request.team) ?? null;
        const action = parseTeamWatchAction(request.action, team);
        const answer = (error: string | null) =>
          void bridge
            .reply(request.team, request.requestId, error)
            .catch(() => {});
        if (!team || !action) {
          answer(
            "That's no longer possible from here. Try again from the window it runs in.",
          );
          return;
        }
        let result: ReturnType<TeamWatchPerform>;
        try {
          result = performRef.current(team, action);
        } catch (error) {
          logError("Team panel", error);
          answer(ACT_FAILED);
          return;
        }
        if (result instanceof Promise) void result.then(answer);
        else answer(result);
      }),
      bridge.onClosed((team) => {
        closedThere.current.add(team);
        noteTeamPopOutFocus(team, false);
        panelRef.current.poppedBack(team);
      }),
      bridge.onFocus(noteTeamPopOutFocus),
    ];
    return () => {
      for (const stop of stops) void stop.then((unlisten) => unlisten());
    };
  }, [bridge]);
  const placeRef = useRef(place);
  placeRef.current = place;
  return (
    <>
      {popped.map((id) =>
        teamKindOf(id) === "discuss" ? (
          <DiscussionPopOut
            key={id}
            teamId={id}
            sessions={sessions}
            host={host}
            feed={{ bridge, theme, shown, closedThere, placeRef, panelRef }}
          />
        ) : (
          <TeamPopOut
            key={id}
            teamId={id}
            feed={{ bridge, theme, shown, closedThere, placeRef, panelRef }}
          />
        ),
      )}
    </>
  );
}

type Feed = {
  bridge: TeamWatchOwner;
  theme: TeamWatchSnapshot["theme"];
  shown: { current: Map<string, TeamRun> };
  closedThere: { current: Set<string> };
  placeRef: { current: PanelRect };
  panelRef: { current: TeamWatchControls };
};

function TeamPopOut({ teamId, feed }: { teamId: string; feed: Feed }) {
  usePopOutFeed(teamId, useTeamWatchView(teamId), feed);
  return null;
}

function DiscussionPopOut({
  teamId,
  sessions,
  host,
  feed,
}: {
  teamId: string;
  sessions: readonly Session[];
  host?: DiscussionHost;
  feed: Feed;
}) {
  usePopOutFeed(teamId, useDiscussionWatchView(teamId, sessions, host), feed);
  return null;
}

/**
 * Opens one team's pop-out and keeps it current: the first view opens the
 * window where the panel sat, each change after that is sent once, and
 * Watch brings the window forward. Changes made while the window is still
 * opening wait for it, and only the latest is sent: the host drops an
 * update for a window it has not made yet. Leaving (the team came back
 * here, or went) closes the window, unless the user already closed it there.
 */
function usePopOutFeed(teamId: string, view: TeamWatchView | null, feed: Feed) {
  const { bridge, theme, shown, closedThere, placeRef, panelRef } = feed;
  const sent = useRef<string | null>(null);
  const opened = useRef(false);
  const opening = useRef<Promise<unknown> | null>(null);
  const closing = useRef<number | undefined>(undefined);
  if (view) shown.current.set(teamId, view.team);
  else shown.current.delete(teamId);
  const raised = panelRef.current.state.raised;
  const raisedAt = raised?.id === teamId ? raised.at : 0;
  useEffect(() => {
    const snapshot: TeamWatchSnapshot = {
      view: view ? popOutView(view) : null,
      theme,
    };
    const json = JSON.stringify(snapshot);
    if (json === sent.current) return;
    sent.current = json;
    if (!opened.current) {
      opened.current = true;
      closedThere.current.delete(teamId);
      const rect = placeRef.current;
      const at: TeamWatchPlace = {
        ...rect,
        dpr: window.devicePixelRatio || 1,
      };
      const open = bridge
        .open(teamId, popOutTitle(teamId, view), snapshot, at)
        .catch((error: unknown) => {
          logError("team pop-out", error);
          // It could not open: show it here instead.
          panelRef.current.popIn(teamId);
        });
      opening.current = open;
      void open.finally(() => {
        if (opening.current === open) opening.current = null;
      });
      return;
    }
    const pending = opening.current;
    if (!pending) {
      bridge.update(teamId, snapshot).catch(() => {});
      return;
    }
    void pending.then(() => {
      // A later change has its own turn; only the newest goes out.
      if (sent.current === json)
        bridge.update(teamId, snapshot).catch(() => {});
    });
  }, [bridge, closedThere, panelRef, placeRef, teamId, theme, view]);
  // Watch while it is out: bring its window forward.
  useEffect(() => {
    if (!raisedAt || !opened.current || sent.current === null) return;
    const rect = placeRef.current;
    bridge
      .open(
        teamId,
        popOutTitle(teamId, view),
        JSON.parse(sent.current) as TeamWatchSnapshot,
        { ...rect, dpr: window.devicePixelRatio || 1 },
      )
      .catch(() => {});
    // Only a new request raises it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [raisedAt]);
  useEffect(() => {
    // A development remount runs this cleanup and the effect again at once;
    // close only when the feed really went.
    const pending = closing;
    const teams = shown.current;
    const closedByUser = closedThere.current;
    window.clearTimeout(pending.current);
    return () => {
      pending.current = window.setTimeout(() => {
        teams.delete(teamId);
        if (closedByUser.delete(teamId)) return;
        bridge.close(teamId).catch(() => {});
      }, 0);
    };
  }, [bridge, closedThere, shown, teamId]);
}

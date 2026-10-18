import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { ConfirmDialog } from "../chrome/ConfirmDialog";
import { HarnessIcon } from "../chrome/HarnessIcon";
import {
  AlertCircle,
  Check,
  LoaderCircle,
  RotateCcw,
  Square,
} from "../chrome/icons";
import { useActivity } from "../lib/activity";
import {
  getRace,
  finishRace,
  noteRaceStats,
  RaceRefusal,
  raceFileRows,
  raceHost,
  raceWorkspace,
  subscribeRaces,
  updateRace,
  type RaceDiff,
  type RaceKeep,
  type RaceRecord,
  type RaceSelection,
} from "../lib/race";
import {
  raceCombineQuestion,
  raceDiscardQuestion,
  raceKeepAsks,
  raceKeepQuestion,
  raceLaneActive,
  raceLaneCanRetry,
  raceLaneName,
  raceLaneSeconds,
  raceLaneState,
  raceOutcomeText,
  raceSuggestionText,
  type RaceLaneState,
  type RaceQuestion,
} from "../lib/raceLanes";
import { logError } from "../lib/errors";
import { raceFullName } from "../lib/raceNames";
import type { Session } from "../lib/session";
import {
  continueLane,
  finalReply,
  continueRace,
  replyOpening,
  requestRaceSuggestion,
  reviewRunning,
  suggestionRunning,
} from "../lib/teamResult";
import { teamWorkspace } from "../lib/teamWorkspace";
import { buildUnifiedFile } from "../lib/unifiedDiff";
import { possessive } from "../lib/words";
import { UnifiedDiffView, type UnifiedDiffFileModel } from "./UnifiedDiffView";

type Props = {
  raceId: string;
  sessions: readonly Session[];
  visible: boolean;
};

const REFRESH_WHILE_RUNNING_MS = 4000;

/** When the agents' changes could not be read; the overview tries again. */
const CHANGES_UNREAD =
  "Couldn't read the agents' changes. They'll be read again shortly.";

/** Compare the lanes of one race and keep a result. */
export function RaceView({ raceId, sessions, visible }: Props) {
  const race = useSyncExternalStore(
    subscribeRaces,
    () => getRace(raceId),
    () => undefined,
  );
  if (!race)
    return (
      <p className="grid h-full place-items-center text-ui-body text-content/45">
        This race is no longer available.
      </p>
    );
  return <RaceBody race={race} sessions={sessions} visible={visible} />;
}

function clock(seconds: number) {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

function LaneStatus({ state, now }: { state: RaceLaneState; now: number }) {
  const seconds = raceLaneSeconds(state, now);
  const Icon =
    state.kind === "working"
      ? LoaderCircle
      : state.kind === "done"
        ? Check
        : state.kind === "failed" || state.kind === "interrupted"
          ? AlertCircle
          : state.kind === "stopped"
            ? Square
            : null;
  const strong =
    state.kind === "done" ||
    state.kind === "failed" ||
    state.kind === "interrupted";
  // An agent that needs you reads in the one "Needs you" amber.
  return (
    <span
      data-lane-state={state.kind}
      className={`flex shrink-0 items-center gap-1 text-ui-label ${
        state.kind === "waiting"
          ? "font-medium text-[color:var(--aven-needs-you)]"
          : strong
            ? "text-content"
            : "text-content/55"
      }`}
    >
      {Icon ? (
        <Icon
          className={`size-3 ${state.kind === "working" ? "animate-spin" : ""}`}
        />
      ) : null}
      {state.label}
      {seconds != null ? ` · ${clock(seconds)}` : ""}
    </span>
  );
}

type Pending = {
  question: RaceQuestion;
  danger: boolean;
  run: () => void;
};

function RaceBody({
  race,
  sessions,
  visible,
}: {
  race: RaceRecord;
  sessions: readonly Session[];
  visible: boolean;
}) {
  const entries = useActivity();
  const lanes = race.lanes.map((lane, index) => {
    const session = sessions.find((entry) => entry.id === lane.sessionId);
    return {
      lane,
      session,
      state: raceLaneState(
        lane.sessionId,
        session,
        entries,
        race.ends?.[index],
      ),
    };
  });
  const states = lanes.map(({ state }) => state);
  const running = race.state === "running";
  const anyActive = states.some(raceLaneActive);
  const anyBusy = lanes.some(({ session }) => session?.busy);
  const stateKey = states.map((state) => state.kind).join(" ");
  const [diffs, setDiffs] = useState<(RaceDiff | undefined)[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selection, setSelection] = useState<RaceSelection>(
    () => race.picks ?? {},
  );
  const [focus, setFocus] = useState<{ path: string; lane: number } | null>(
    null,
  );
  const [working, setWorking] = useState<string | null>(null);
  const finishingRef = useRef(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [pending, setPending] = useState<Pending | null>(null);
  /** The agent whose Retry is on its way. */
  const [retrying, setRetrying] = useState<number | null>(null);

  // Saving picks rewrites the record; refreshes follow only the copies.
  const raceId = race.id;
  const base = race.base;
  const lanesKey = race.lanes.map((lane) => lane.path).join("\n");
  const refresh = useCallback(() => {
    if (getRace(raceId)?.state !== "running" || working || finishingRef.current)
      return;
    void Promise.all(
      lanesKey
        .split("\n")
        .map((path) => raceHost.diff(path, base).catch(() => undefined)),
    )
      .then((next) => {
        if (finishingRef.current || getRace(raceId)?.state !== "running")
          return;
        setDiffs(next);
        // The race's card in its chat shows the same numbers.
        noteRaceStats(raceId, next);
        setLoadError(next.every((diff) => !diff) ? CHANGES_UNREAD : null);
      })
      .catch((error: unknown) => {
        if (!finishingRef.current && getRace(raceId)?.state === "running") {
          logError("Race overview", error);
          setLoadError(CHANGES_UNREAD);
        }
      });
  }, [working, raceId, lanesKey, base]);

  // Reload when a lane starts or finishes, and periodically while one works.
  useEffect(() => {
    if (!visible || !running || working) return;
    refresh();
    if (!anyBusy) return;
    const timer = window.setInterval(() => {
      setNow(Date.now());
      refresh();
    }, REFRESH_WHILE_RUNNING_MS);
    return () => window.clearInterval(timer);
  }, [visible, running, working, stateKey, anyBusy, refresh]);

  const rows = useMemo(() => raceFileRows(diffs), [diffs]);
  const current =
    focus ?? (rows[0] ? { path: rows[0].path, lane: rows[0].lanes[0] } : null);
  // `current` is rebuilt every render; the diff follows only its file and lane.
  const currentPath = current?.path;
  const currentLane = current?.lane;
  const currentStats =
    currentLane === undefined
      ? undefined
      : diffs[currentLane]?.files.find((file) => file.path === currentPath);
  // A refresh rebuilds every list; fetch the file again only when it changed.
  const statsKey = currentStats
    ? `${currentStats.status}:${currentStats.additions}:${currentStats.deletions}:${currentStats.binary}`
    : "";
  const statsRef = useRef(currentStats);
  statsRef.current = currentStats;
  const lanePath =
    currentLane === undefined ? undefined : race.lanes[currentLane]?.path;

  const [fileModel, setFileModel] = useState<UnifiedDiffFileModel | null>(null);
  useEffect(() => {
    const stats = statsRef.current;
    if (
      currentPath === undefined ||
      currentLane === undefined ||
      !visible ||
      !running ||
      working ||
      finishingRef.current ||
      !lanePath ||
      !stats
    ) {
      setFileModel(null);
      return;
    }
    let cancelled = false;
    void raceHost
      .fileDiff(lanePath, base, currentPath)
      .then((result) => {
        if (
          cancelled ||
          finishingRef.current ||
          getRace(raceId)?.state !== "running"
        )
          return;
        const unreadable =
          stats.binary ||
          (result.original == null && stats.status !== "added") ||
          (result.current == null && stats.status !== "deleted");
        const unified = unreadable
          ? null
          : buildUnifiedFile(result.original ?? "", result.current ?? "");
        setFileModel({
          id: `${currentLane}:${currentPath}`,
          path: currentPath,
          label: currentPath,
          binary: stats.binary,
          emptyMessage: unreadable
            ? "No text preview for this file."
            : undefined,
          additions: unified?.additions ?? stats.additions,
          deletions: unified?.deletions ?? stats.deletions,
          blocks: unified?.blocks ?? [],
        });
      })
      .catch((error: unknown) => {
        if (
          !cancelled &&
          !finishingRef.current &&
          getRace(raceId)?.state === "running"
        ) {
          logError("Race overview", error);
          setFileModel({
            id: `${currentLane}:${currentPath}`,
            path: currentPath,
            label: currentPath,
            emptyMessage: "Couldn't show this file's changes.",
            additions: stats.additions,
            deletions: stats.deletions,
            blocks: [],
          });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [
    currentPath,
    currentLane,
    statsKey,
    lanePath,
    raceId,
    base,
    visible,
    running,
    working,
  ]);

  // Lane chats re-render the overview as they stream; the diff stays put.
  const diffFiles = useMemo(() => (fileModel ? [fileModel] : []), [fileModel]);

  const finish = async (label: string, keep: RaceKeep | null) => {
    if (finishingRef.current) return;
    finishingRef.current = true;
    setWorking(label);
    setActionError(null);
    try {
      await finishRace(race, keep);
    } catch (error) {
      if (error instanceof RaceRefusal) setActionError(error.message);
      else {
        logError("Race overview", error);
        setActionError(
          keep
            ? "Couldn't keep those changes. Try again."
            : "Couldn't discard the race. Try again.",
        );
      }
    } finally {
      finishingRef.current = false;
      setWorking(null);
    }
  };

  /** Ask first when the action can't be undone and agents would be cut off. */
  const confirm = (
    ask: boolean,
    question: RaceQuestion,
    danger: boolean,
    run: () => void,
  ) => {
    if (!ask) {
      run();
      return;
    }
    setPending({ question, danger, run });
  };

  // Picks are saved with the race, so reopening the overview keeps them.
  const pick = (path: string, lane: number) => {
    const next = { ...selection };
    if (next[path] === lane) delete next[path];
    else next[path] = lane;
    setSelection(next);
    updateRace(race.id, { picks: next });
  };

  // Picks for files no lane changes any more are not offered.
  const picked = Object.fromEntries(
    Object.entries(selection).filter(([path, lane]) =>
      rows.some((row) => row.path === path && row.lanes.includes(lane)),
    ),
  );
  const selectedCount = Object.keys(picked).length;
  const disabled = !running || !!working;
  const outcome = raceOutcomeText(race);
  // Winner and why: once no lane works, the cheap model can suggest one.
  const suggestion = race.suggestion;
  // One judge at a time: never while a reviewer compares them.
  const suggesting =
    suggestionRunning(suggestion) ||
    reviewRunning(
      race.review,
      Date.now(),
      sessions.find((entry) => entry.id === race.review?.sessionId),
    );
  const settled =
    running && !anyActive && states.some((state) => state.kind === "done");
  const suggested = suggestion?.status === "done" ? suggestion.lane : undefined;
  const suggest = () =>
    void requestRaceSuggestion(
      race.id,
      (id) => sessions.find((entry) => entry.id === id),
      states.map((state) => state.label),
    );
  const why = race.outcome?.kind === "lane" ? race.outcome.why : undefined;
  const continueAt = continueLane(race);
  const continueWith =
    continueAt !== undefined && race.lanes[continueAt]
      ? raceLaneName(race, continueAt)
      : undefined;
  const suggestedText = raceSuggestionText(race);

  return (
    <div
      className="flex h-full min-h-0 flex-col text-ui-body"
      data-race-view={race.id}
    >
      <header className="flex items-center gap-3 border-b border-content/10 px-4 py-2.5">
        <div className="min-w-0 flex-1">
          <div className="truncate text-content">{race.prompt}</div>
          <div className="truncate text-ui-label text-content/45">
            {race.state === "kept"
              ? race.error
                ? `Kept in your project. ${race.error}`
                : "Kept in your project. The other agents' work was cleared away."
              : race.state === "discarded"
                ? "Discarded. Your project didn't change."
                : [
                    `${lanes.length} agents`,
                    race.uncommitted
                      ? "started from your files as they are now"
                      : "started from your last commit",
                    race.untracked
                      ? "new files not yet added to Git weren't included"
                      : "",
                  ]
                    .filter(Boolean)
                    .join(" · ")}
          </div>
        </div>
        {settled && suggestion?.status !== "done" ? (
          <button
            type="button"
            data-race-suggest
            disabled={!!working || suggesting}
            title={
              suggesting && !suggestionRunning(suggestion)
                ? "Wait for the reviewer to finish first."
                : "Ask the cheapest model which result to keep, from the agents' last replies and changes"
            }
            onClick={suggest}
            className="rounded-md border border-content/15 px-2.5 py-1 text-content hover:bg-content/10 disabled:opacity-40"
          >
            {suggesting ? "Suggesting…" : "Suggest a winner"}
          </button>
        ) : null}
        {running && anyBusy ? (
          <button
            type="button"
            disabled={!!working}
            title="Stop every agent still working. You can still compare what they wrote."
            onClick={() =>
              raceWorkspace()?.stop(
                lanes
                  .filter(({ session }) => session?.busy)
                  .map(({ lane }) => lane.sessionId),
              )
            }
            className="rounded-md border border-content/15 px-2.5 py-1 text-content hover:bg-content/10 disabled:opacity-40"
          >
            Stop race
          </button>
        ) : null}
        {running ? (
          <button
            type="button"
            disabled={disabled}
            onClick={() =>
              confirm(
                true,
                raceDiscardQuestion(
                  race,
                  states,
                  diffs.map((diff) => diff?.files.length),
                ),
                true,
                () => void finish("Discarding…", null),
              )
            }
            className="rounded-md border border-content/15 px-2.5 py-1 text-content hover:bg-content/10 disabled:opacity-40"
          >
            Discard race
          </button>
        ) : null}
      </header>

      {running && suggestedText ? (
        <div
          className="flex items-start gap-2 border-b border-content/10 px-4 py-2 text-ui-label text-content/75"
          data-race-suggestion
        >
          <Check className="mt-0.5 size-3.5 shrink-0" />
          <span>{suggestedText}</span>
        </div>
      ) : running && suggestion?.status === "failed" && settled ? (
        <div className="border-b border-content/10 px-4 py-2 text-ui-label text-content/55">
          Couldn't suggest a winner. Compare the agents' changes to choose.
        </div>
      ) : null}

      {actionError || (running && (race.error || loadError)) ? (
        <div
          className="flex items-start gap-2 border-b border-content/10 bg-content/[0.04] px-4 py-2 text-ui-label text-content/75"
          role="alert"
        >
          <AlertCircle className="mt-0.5 size-3.5 shrink-0" />
          <span>{actionError ?? race.error ?? loadError}</span>
        </div>
      ) : null}

      <div
        className="grid border-b border-content/10"
        style={{
          gridTemplateColumns: `repeat(${lanes.length}, minmax(0, 1fr))`,
        }}
      >
        {lanes.map(({ lane, state, session }, index) => {
          const diff = diffs[index];
          // The first lines of its last reply, once it is not working.
          const opening =
            session && !raceLaneActive(state)
              ? replyOpening(finalReply(session.blocks))
              : "";
          return (
            <section
              key={lane.sessionId}
              data-race-lane={index}
              className="flex min-w-0 flex-col gap-1.5 border-r border-content/10 px-4 py-3 last:border-r-0"
            >
              <div className="flex min-w-0 items-center gap-2">
                <HarnessIcon
                  harness={lane.harness}
                  className="size-4 shrink-0"
                />
                <span
                  className="min-w-0 flex-1 truncate text-content"
                  title={raceFullName(lane)}
                >
                  {raceLaneName(race, index)}
                </span>
                {running ? <LaneStatus state={state} now={now} /> : null}
              </div>
              {suggested === index && running ? (
                <div
                  className="text-ui-caption font-medium text-content"
                  data-race-suggested
                >
                  Suggested winner
                </div>
              ) : null}
              {opening ? (
                <p
                  className="line-clamp-3 whitespace-pre-line text-ui-label text-content/60"
                  title={opening}
                  data-race-reply
                >
                  {opening}
                </p>
              ) : null}
              {running ? (
                <div className="text-ui-label text-content/55">
                  {diff ? (
                    <>
                      <span className="text-[color:var(--aven-git-add)]">
                        +{diff.additions}
                      </span>{" "}
                      <span className="text-[color:var(--aven-git-del)]">
                        −{diff.deletions}
                      </span>{" "}
                      · {diff.files.length}{" "}
                      {diff.files.length === 1 ? "file" : "files"}
                    </>
                  ) : (
                    "Reading changes…"
                  )}
                </div>
              ) : null}
              <div className="flex flex-wrap gap-1.5">
                <button
                  type="button"
                  onClick={() => raceWorkspace()?.openChat(lane.sessionId)}
                  className="rounded-md border border-content/15 px-2 py-0.5 text-ui-label text-content hover:bg-content/10"
                >
                  Open chat
                </button>
                {running && raceLaneCanRetry(state) ? (
                  <button
                    type="button"
                    disabled={disabled || retrying !== null}
                    title="Send the race's task to this agent again"
                    onClick={() => {
                      setRetrying(index);
                      setActionError(null);
                      void Promise.resolve(
                        raceWorkspace()?.retry(race, index),
                      ).then(
                        (reason) => {
                          setRetrying(null);
                          if (reason) setActionError(reason);
                        },
                        (error: unknown) => {
                          setRetrying(null);
                          logError("Race retry", error);
                          setActionError(
                            "Couldn't retry this agent. Try again.",
                          );
                        },
                      );
                    }}
                    className="flex items-center gap-1 rounded-md border border-content/15 px-2 py-0.5 text-ui-label text-content hover:bg-content/10 disabled:opacity-40"
                  >
                    <RotateCcw className="size-3" />
                    {retrying === index ? "Retrying…" : "Retry"}
                  </button>
                ) : null}
                {running ? (
                  <button
                    type="button"
                    disabled={disabled || !diff?.files.length}
                    title={
                      diff && !diff.files.length
                        ? "This agent didn't change any files."
                        : undefined
                    }
                    onClick={() => {
                      const changed = diffs.map((entry) => entry?.files.length);
                      confirm(
                        raceKeepAsks(race, index, states, changed),
                        raceKeepQuestion(race, index, states, changed),
                        false,
                        () => void finish("Keeping…", { lane: index }),
                      );
                    }}
                    className="rounded-md bg-content px-2 py-0.5 text-ui-label font-medium text-background-base hover:opacity-90 disabled:opacity-30"
                  >
                    Keep this
                  </button>
                ) : null}
              </div>
            </section>
          );
        })}
      </div>

      {running ? (
        <div
          className="grid min-h-0 flex-1"
          style={{ gridTemplateColumns: "minmax(200px, 280px) minmax(0, 1fr)" }}
        >
          <div className="flex min-h-0 flex-col border-r border-content/10">
            <div className="px-3 pb-1 pt-2 text-ui-caption text-content/40">
              Files · pick which agent's version to keep
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-1.5 pb-2">
              {rows.length === 0 ? (
                <p className="px-2 py-3 text-ui-label text-content/45">
                  {anyActive
                    ? "No changes yet."
                    : "No agent changed any files."}
                </p>
              ) : null}
              {rows.map((row) => (
                <div
                  key={row.path}
                  data-race-file={row.path}
                  onClick={() =>
                    setFocus({
                      path: row.path,
                      lane:
                        current?.path === row.path
                          ? current.lane
                          : row.lanes[0],
                    })
                  }
                  className={`flex cursor-default items-center gap-1.5 rounded-md px-2 py-1 ${current?.path === row.path ? "bg-content/10 text-content" : "text-content/70 hover:bg-content/5"}`}
                >
                  <span className="min-w-0 flex-1 truncate font-mono text-ui-label">
                    {row.path}
                  </span>
                  <span className="flex shrink-0 gap-0.5">
                    {race.lanes.map((lane, index) => {
                      const touched = row.lanes.includes(index);
                      const chosen = picked[row.path] === index;
                      return (
                        <button
                          key={lane.sessionId}
                          type="button"
                          disabled={!touched || disabled}
                          aria-pressed={chosen}
                          title={
                            touched
                              ? `Keep ${raceLaneName(race, index)}'s version`
                              : `${raceLaneName(race, index)} didn't change this file`
                          }
                          onClick={(event) => {
                            event.stopPropagation();
                            setFocus({ path: row.path, lane: index });
                            pick(row.path, index);
                          }}
                          className={`grid size-5 place-items-center rounded border ${chosen ? "border-content bg-content text-background-base" : "border-content/15"} ${touched ? "" : "opacity-25"}`}
                        >
                          <HarnessIcon
                            harness={lane.harness}
                            className="size-3"
                          />
                        </button>
                      );
                    })}
                  </span>
                </div>
              ))}
            </div>
            <div className="border-t border-content/10 p-2">
              <button
                type="button"
                disabled={disabled || selectedCount === 0}
                onClick={() =>
                  confirm(
                    anyActive,
                    raceCombineQuestion(race, selectedCount, states),
                    false,
                    () => void finish("Keeping…", { files: picked }),
                  )
                }
                className="w-full rounded-md bg-content px-2 py-1.5 text-ui-label font-medium text-background-base hover:opacity-90 disabled:opacity-30"
              >
                {working ??
                  (selectedCount
                    ? `Keep ${selectedCount} selected ${selectedCount === 1 ? "file" : "files"}`
                    : "Select files to combine")}
              </button>
            </div>
          </div>
          <div className="flex min-h-0 min-w-0 flex-col">
            {current ? (
              <div className="flex items-center gap-1 border-b border-content/10 px-2 py-1.5">
                {race.lanes.map((lane, index) =>
                  rows
                    .find((row) => row.path === current.path)
                    ?.lanes.includes(index) ? (
                    <button
                      key={lane.sessionId}
                      type="button"
                      onClick={() =>
                        setFocus({ path: current.path, lane: index })
                      }
                      className={`flex items-center gap-1.5 rounded-md px-2 py-0.5 text-ui-label ${current.lane === index ? "bg-content/10 text-content" : "text-content/55 hover:bg-content/5"}`}
                    >
                      <HarnessIcon
                        harness={lane.harness}
                        className="size-3.5"
                      />
                      {raceLaneName(race, index)}
                    </button>
                  ) : null,
                )}
              </div>
            ) : null}
            <div className="relative min-h-0 flex-1">
              {fileModel ? (
                <UnifiedDiffView files={diffFiles} fileLayout="cards" />
              ) : (
                <p className="grid h-full place-items-center text-ui-label text-content/40">
                  {rows.length ? "Loading changes…" : ""}
                </p>
              )}
            </div>
          </div>
        </div>
      ) : (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 px-6 py-8 text-center">
          <Check className="mb-1 size-5 text-content/60" />
          <p className="text-content">
            {race.state === "kept"
              ? "Kept in your project."
              : "Your project didn't change."}
          </p>
          {outcome ? (
            <p className="text-ui-label text-content/70" data-race-outcome>
              {outcome}
            </p>
          ) : null}
          {why ? (
            <p className="max-w-md text-ui-label text-content/60">Why: {why}</p>
          ) : null}
          <p className="break-all font-mono text-ui-label text-content/60">
            {race.project}
          </p>
          {race.state === "kept" ? (
            <div className="mt-1 flex flex-wrap justify-center gap-1.5">
              <button
                type="button"
                onClick={() => teamWorkspace()?.reviewChanges(race.project)}
                className="rounded-md border border-content/15 px-2.5 py-1 text-ui-label text-content hover:bg-content/10"
              >
                Review changes
              </button>
              {continueWith ? (
                <button
                  type="button"
                  data-race-continue
                  title={`Open ${possessive(continueWith)} chat. It learns which version you kept with your next message.`}
                  onClick={() =>
                    void continueRace(race.id, teamWorkspace(), (id) =>
                      sessions.find((entry) => entry.id === id),
                    ).then(setActionError)
                  }
                  className="rounded-md bg-content px-2.5 py-1 text-ui-label font-medium text-background-base hover:opacity-90 disabled:opacity-40"
                >
                  {`Continue with ${continueWith}`}
                </button>
              ) : null}
            </div>
          ) : null}
        </div>
      )}
      {pending && running ? (
        <ConfirmDialog
          title={pending.question.title}
          body={pending.question.body}
          confirmLabel={pending.question.confirm}
          danger={pending.danger}
          onCancel={() => setPending(null)}
          onConfirm={() => {
            const { run } = pending;
            setPending(null);
            run();
          }}
        />
      ) : null}
    </div>
  );
}

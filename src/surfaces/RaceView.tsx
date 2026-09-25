import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
} from "react";
import { HarnessIcon } from "../chrome/HarnessIcon";
import { AlertCircle, Check, LoaderCircle } from "../chrome/icons";
import {
  getRace,
  raceChoices,
  raceFileRows,
  raceHost,
  raceWorkspace,
  selectLane,
  subscribeRaces,
  updateRace,
  type RaceDiff,
  type RaceRecord,
  type RaceSelection,
} from "../lib/race";
import { sessionNeedsInput, type Session } from "../lib/session";
import { buildUnifiedFile } from "../lib/unifiedDiff";
import { UnifiedDiffView, type UnifiedDiffFileModel } from "./UnifiedDiffView";

type Props = {
  raceId: string;
  sessions: readonly Session[];
  visible: boolean;
};

const REFRESH_WHILE_RUNNING_MS = 4000;

/** Compare the lanes of one race and keep a result. */
export function RaceView({ raceId, sessions, visible }: Props) {
  const race = useSyncExternalStore(
    subscribeRaces,
    () => getRace(raceId),
    () => undefined,
  );
  if (!race)
    return (
      <p className="grid h-full place-items-center text-[13px] text-content/45">
        This race is no longer available.
      </p>
    );
  return <RaceBody race={race} sessions={sessions} visible={visible} />;
}

function laneStatus(session: Session | undefined) {
  if (!session) return { label: "Closed", tone: "muted" as const };
  if (sessionNeedsInput(session))
    return { label: "Needs you", tone: "warn" as const };
  if (session.busy) return { label: "Working", tone: "busy" as const };
  return { label: "Done", tone: "done" as const };
}

function laneSeconds(
  session: Session | undefined,
  race: RaceRecord,
  now: number,
) {
  const turn = session?.blocks.find((block) => block.role === "user");
  if (turn?.durationMs != null && !session?.busy)
    return Math.round(turn.durationMs / 1000);
  return Math.max(0, Math.round((now - race.createdAt) / 1000));
}

function clock(seconds: number) {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

function RaceBody({
  race,
  sessions,
  visible,
}: {
  race: RaceRecord;
  sessions: readonly Session[];
  visible: boolean;
}) {
  const lanes = race.lanes.map((lane) => ({
    lane,
    session: sessions.find((session) => session.id === lane.sessionId),
  }));
  const running = race.state === "running";
  const anyBusy = lanes.some(({ session }) => session?.busy);
  const busyKey = lanes.map(({ session }) => (session?.busy ? 1 : 0)).join("");
  const [diffs, setDiffs] = useState<(RaceDiff | undefined)[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selection, setSelection] = useState<RaceSelection>({});
  const [focus, setFocus] = useState<{ path: string; lane: number } | null>(
    null,
  );
  const [working, setWorking] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const refresh = useCallback(() => {
    if (race.state !== "running") return;
    void Promise.all(
      race.lanes.map((lane) =>
        raceHost.diff(lane.path, race.base).catch(() => undefined),
      ),
    )
      .then((next) => {
        setDiffs(next);
        setLoadError(
          next.every((diff) => !diff) ? "Couldn’t read the race copies." : null,
        );
      })
      .catch((error: unknown) => setLoadError(String(error)));
  }, [race]);

  // Reload when a lane starts or finishes, and periodically while one works.
  useEffect(() => {
    if (!visible) return;
    refresh();
    if (!anyBusy) return;
    const timer = window.setInterval(() => {
      setNow(Date.now());
      refresh();
    }, REFRESH_WHILE_RUNNING_MS);
    return () => window.clearInterval(timer);
  }, [visible, busyKey, anyBusy, refresh]);

  const rows = useMemo(() => raceFileRows(diffs), [diffs]);
  const current =
    focus ?? (rows[0] ? { path: rows[0].path, lane: rows[0].lanes[0] } : null);

  const [fileModel, setFileModel] = useState<UnifiedDiffFileModel | null>(null);
  useEffect(() => {
    if (!current || !visible) {
      setFileModel(null);
      return;
    }
    const lane = race.lanes[current.lane];
    const stats = diffs[current.lane]?.files.find(
      (file) => file.path === current.path,
    );
    if (!lane || !stats) {
      setFileModel(null);
      return;
    }
    let cancelled = false;
    void raceHost
      .fileDiff(lane.path, race.base, current.path)
      .then((result) => {
        if (cancelled) return;
        const unreadable =
          stats.binary ||
          (result.original == null && stats.status !== "added") ||
          (result.current == null && stats.status !== "deleted");
        const unified = unreadable
          ? null
          : buildUnifiedFile(result.original ?? "", result.current ?? "");
        setFileModel({
          id: `${current.lane}:${current.path}`,
          path: current.path,
          label: current.path,
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
        if (!cancelled)
          setFileModel({
            id: `${current.lane}:${current.path}`,
            path: current.path,
            label: current.path,
            emptyMessage: `Couldn’t load diff: ${String(error)}`,
            additions: stats.additions,
            deletions: stats.deletions,
            blocks: [],
          });
      });
    return () => {
      cancelled = true;
    };
  }, [current?.path, current?.lane, diffs, race, visible]);

  const finish = async (label: string, keep: RaceSelection | null) => {
    setWorking(label);
    setActionError(null);
    try {
      if (keep) {
        const choices = raceChoices(race, keep);
        if (!choices.length)
          throw new Error("Choose at least one file to keep.");
        await raceHost.apply(race.root, race.base, choices);
      }
      raceWorkspace()?.stop(race.lanes.map((lane) => lane.sessionId));
      await raceHost.cleanup(race.root, race.lanes).catch((error: unknown) => {
        updateRace(race.id, {
          error: `Copies were not all removed: ${String(error)}`,
        });
      });
      updateRace(race.id, { state: keep ? "kept" : "discarded" });
    } catch (error) {
      setActionError(error instanceof Error ? error.message : String(error));
    } finally {
      setWorking(null);
    }
  };

  const selectedCount = Object.keys(selection).length;
  const disabled = !running || !!working;

  return (
    <div className="flex h-full min-h-0 flex-col text-[13px]">
      <header className="flex items-center gap-3 border-b border-content/10 px-4 py-2.5">
        <div className="min-w-0 flex-1">
          <div className="truncate text-content">{race.prompt}</div>
          <div className="truncate text-[12px] text-content/45">
            {race.state === "kept"
              ? "Kept. The race copies were removed."
              : race.state === "discarded"
                ? "Discarded. Your project was not changed."
                : [
                    `${lanes.length} agents`,
                    race.uncommitted
                      ? "started from your uncommitted changes"
                      : "started from the last commit",
                    race.untracked ? "new untracked files were not copied" : "",
                  ]
                    .filter(Boolean)
                    .join(" · ")}
          </div>
        </div>
        {running && anyBusy ? (
          <button
            type="button"
            disabled={!!working}
            onClick={() =>
              raceWorkspace()?.stop(
                lanes
                  .filter(({ session }) => session?.busy)
                  .map(({ lane }) => lane.sessionId),
              )
            }
            className="rounded-md border border-content/15 px-2.5 py-1 text-content hover:bg-content/10 disabled:opacity-40"
          >
            Stop all
          </button>
        ) : null}
        {running ? (
          <button
            type="button"
            disabled={disabled}
            onClick={() => void finish("Discarding…", null)}
            className="rounded-md border border-content/15 px-2.5 py-1 text-content hover:bg-content/10 disabled:opacity-40"
          >
            Discard race
          </button>
        ) : null}
      </header>

      {actionError || race.error || loadError ? (
        <div className="flex items-start gap-2 border-b border-content/10 bg-content/[0.04] px-4 py-2 text-[12px] text-content/75">
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
        {lanes.map(({ lane, session }, index) => {
          const status = laneStatus(session);
          const diff = diffs[index];
          return (
            <section
              key={lane.sessionId}
              className="flex min-w-0 flex-col gap-1.5 border-r border-content/10 px-4 py-3 last:border-r-0"
            >
              <div className="flex min-w-0 items-center gap-2">
                <HarnessIcon
                  harness={lane.harness}
                  className="size-4 shrink-0"
                />
                <span className="min-w-0 flex-1 truncate text-content">
                  {lane.label}
                </span>
                <span
                  className={`flex shrink-0 items-center gap-1 text-[12px] ${status.tone === "done" ? "text-content" : status.tone === "warn" ? "text-content" : "text-content/55"}`}
                >
                  {status.tone === "busy" ? (
                    <LoaderCircle className="size-3 animate-spin" />
                  ) : status.tone === "done" ? (
                    <Check className="size-3" />
                  ) : null}
                  {status.label} · {clock(laneSeconds(session, race, now))}
                </span>
              </div>
              <div className="text-[12px] text-content/55">
                {diff ? (
                  <>
                    <span className="text-content">+{diff.additions}</span>{" "}
                    <span className="text-content">−{diff.deletions}</span> ·{" "}
                    {diff.files.length}{" "}
                    {diff.files.length === 1 ? "file" : "files"}
                  </>
                ) : running ? (
                  "Reading changes…"
                ) : (
                  "—"
                )}
              </div>
              <div className="flex gap-1.5">
                <button
                  type="button"
                  onClick={() => raceWorkspace()?.openChat(lane.sessionId)}
                  className="rounded-md border border-content/15 px-2 py-0.5 text-[12px] text-content hover:bg-content/10"
                >
                  Open chat
                </button>
                <button
                  type="button"
                  disabled={disabled || !diff?.files.length}
                  onClick={() =>
                    void finish("Keeping…", selectLane(diffs, index))
                  }
                  className="rounded-md bg-content px-2 py-0.5 text-[12px] font-medium text-background-base hover:opacity-90 disabled:opacity-30"
                >
                  Keep this
                </button>
              </div>
            </section>
          );
        })}
      </div>

      <div
        className="grid min-h-0 flex-1"
        style={{ gridTemplateColumns: "minmax(200px, 280px) minmax(0, 1fr)" }}
      >
        <div className="flex min-h-0 flex-col border-r border-content/10">
          <div className="px-3 pb-1 pt-2 text-[11px] text-content/40">
            Files · pick which agent’s version to keep
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-1.5 pb-2">
            {rows.length === 0 ? (
              <p className="px-2 py-3 text-[12px] text-content/45">
                {anyBusy ? "No changes yet." : "No agent changed any files."}
              </p>
            ) : null}
            {rows.map((row) => (
              <div
                key={row.path}
                onClick={() =>
                  setFocus({
                    path: row.path,
                    lane:
                      current?.path === row.path ? current.lane : row.lanes[0],
                  })
                }
                className={`flex cursor-default items-center gap-1.5 rounded-md px-2 py-1 ${current?.path === row.path ? "bg-content/10 text-content" : "text-content/70 hover:bg-content/5"}`}
              >
                <span className="min-w-0 flex-1 truncate font-mono text-[12px]">
                  {row.path}
                </span>
                <span className="flex shrink-0 gap-0.5">
                  {race.lanes.map((lane, index) => {
                    const touched = row.lanes.includes(index);
                    const chosen = selection[row.path] === index;
                    return (
                      <button
                        key={lane.sessionId}
                        type="button"
                        disabled={!touched || disabled}
                        aria-pressed={chosen}
                        title={
                          touched
                            ? `Keep ${lane.label}'s version`
                            : `${lane.label} did not change this file`
                        }
                        onClick={(event) => {
                          event.stopPropagation();
                          setFocus({ path: row.path, lane: index });
                          setSelection((previous) => {
                            const next = { ...previous };
                            if (next[row.path] === index) delete next[row.path];
                            else next[row.path] = index;
                            return next;
                          });
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
              onClick={() => void finish("Keeping…", selection)}
              className="w-full rounded-md bg-content px-2 py-1.5 text-[12px] font-medium text-background-base hover:opacity-90 disabled:opacity-30"
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
                    className={`flex items-center gap-1.5 rounded-md px-2 py-0.5 text-[12px] ${current.lane === index ? "bg-content/10 text-content" : "text-content/55 hover:bg-content/5"}`}
                  >
                    <HarnessIcon harness={lane.harness} className="size-3.5" />
                    {lane.label}
                  </button>
                ) : null,
              )}
            </div>
          ) : null}
          <div className="relative min-h-0 flex-1">
            {fileModel ? (
              <UnifiedDiffView files={[fileModel]} fileLayout="cards" />
            ) : (
              <p className="grid h-full place-items-center text-[12px] text-content/40">
                {rows.length ? "Loading diff…" : ""}
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

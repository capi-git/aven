import { ask } from "@tauri-apps/plugin-dialog";
import { useContext, useEffect, useRef, useState } from "react";
import { errorText, logError } from "../lib/errors";
import {
  gitStageAll,
  gitSync,
  type GitChangedFile,
  type GitDiffIndex,
  type GitPr,
} from "../lib/fs";
import { generateCommitMessage } from "../lib/harness";
import { LiveSessionsContext } from "../lib/liveSessions";
import { MOD } from "../lib/platform";
import type { HarnessId } from "../lib/session";
import { recordShip } from "../lib/shippedChats";
import {
  defaultShipScope,
  onDefaultBranch,
  runShip,
  SHIP_STEP_LABEL,
  shipErrorText,
  shipOptions,
  shipSummary,
  type ShipStep,
} from "../lib/shipFlow";
import { GitBranch, Loader, MoreHorizontal, WandSparkles } from "./icons";

type Props = {
  cwd: string;
  index: GitDiffIndex;
  files: GitChangedFile[];
  pr: GitPr | null;
  textHarness?: HarnessId;
  /** The chat in front: a commit made here marks its chat Shipped. */
  sessionId?: string;
  /** Staged and unstaged shown apart: a staged subset commits alone. */
  stagingShown: boolean;
  message: string;
  onMessageChange: (message: string) => void;
  /** Something else is changing the copy (a row's action). */
  locked: boolean;
  onBusyChange: (busy: boolean) => void;
  onMutated: () => void;
  onPrChanged: () => void;
  onOpenBranchPicker?: (anchor: HTMLButtonElement) => void;
  /** Opens the full Ship card: commit only, push, or open a pull request. */
  onMore: () => void;
};

type Phase =
  | { kind: "idle" }
  | { kind: "writing" }
  | { kind: "running"; step: ShipStep | "publish" }
  | { kind: "error"; text: string };

/** "↑2 to push", "↓1 to pull", "↓1 ↑2", or nothing when in step. */
export function commitBoxSyncLabel(index: GitDiffIndex): string {
  if (!index.remote || !index.branch) return "";
  if (!index.upstream) return "Not published";
  const { ahead, behind } = index;
  if (ahead > 0 && behind > 0) return `↓${behind} ↑${ahead}`;
  if (ahead > 0) return `↑${ahead} to push`;
  if (behind > 0) return `↓${behind} to pull`;
  return "";
}

/**
 * The foot of Changes: the branch and what waits to be pushed, a commit
 * message, and Commit and push. More ways to ship open the Ship card.
 */
export function CommitBox({
  cwd,
  index,
  files,
  pr,
  textHarness,
  sessionId,
  stagingShown,
  message,
  onMessageChange,
  locked,
  onBusyChange,
  onMutated,
  onPrChanged,
  onOpenBranchPicker,
  onMore,
}: Props) {
  const live = useContext(LiveSessionsContext);
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const field = useRef<HTMLTextAreaElement>(null);
  const busy = phase.kind === "writing" || phase.kind === "running";
  const hasFiles = files.length > 0;
  const push = shipOptions(index, pr, true).find(
    (option) => option.mode === "push",
  );
  const pushes = !!push?.available;
  const scope = defaultShipScope(files, stagingShown);
  const summary = shipSummary(files, scope);
  const sync = commitBoxSyncLabel(index);
  const canSync = !!sync && !busy && !locked;

  useEffect(() => {
    onBusyChange(busy);
  }, [busy, onBusyChange]);
  useEffect(() => () => onBusyChange(false), [onBusyChange]);
  // The field grows with the message, up to a few lines.
  useEffect(() => {
    const el = field.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
  }, [message]);

  const write = async (): Promise<string> => {
    setPhase({ kind: "writing" });
    if (summary.toStage > 0) {
      await gitStageAll(cwd);
      onMutated();
    }
    const text = (await generateCommitMessage(cwd, textHarness)).trim();
    if (!text) throw new Error("Couldn't write the commit message.");
    onMessageChange(text);
    return text;
  };

  const commit = async () => {
    if (!hasFiles || busy || locked) return;
    const mode = pushes && index.upstream ? "push" : "commit";
    if (
      pushes &&
      onDefaultBranch(index) &&
      !(await ask(`Push to default branch "${index.branch}"?`, {
        title: "Aven",
        kind: "warning",
      }))
    )
      return;
    try {
      // An empty field: the message is written from the changes first.
      const text = message.trim() || (await write());
      const result = await runShip(
        {
          cwd,
          message: text,
          mode,
          scope,
          textHarness,
          openPr: pr,
        },
        { onStep: (step) => setPhase({ kind: "running", step }) },
      );
      // A branch not on the remote yet is published after the commit.
      if (pushes && !index.upstream) {
        setPhase({ kind: "running", step: "publish" });
        await gitSync(cwd);
        result.pushed = true;
      }
      onMessageChange("");
      setPhase({ kind: "idle" });
      void recordShip({
        cwd,
        requestedId: sessionId,
        result,
        sessions: live?.list() ?? [],
      }).catch((error) => logError("record ship", error));
    } catch (error) {
      logError("commit box", error);
      setPhase({ kind: "error", text: shipErrorText(error) });
    } finally {
      onMutated();
      onPrChanged();
    }
  };

  const generate = async () => {
    if (busy) return;
    try {
      await write();
      setPhase({ kind: "idle" });
    } catch (error) {
      logError("commit message", error);
      setPhase({ kind: "error", text: errorText(error) });
    }
  };

  const syncNow = async () => {
    if (!canSync) return;
    setPhase({ kind: "running", step: "push" });
    try {
      await gitSync(cwd);
      setPhase({ kind: "idle" });
    } catch (error) {
      logError("commit box sync", error);
      setPhase({ kind: "error", text: errorText(error) });
    } finally {
      onMutated();
      onPrChanged();
    }
  };

  const label =
    phase.kind === "writing"
      ? "Writing message…"
      : phase.kind === "running"
        ? phase.step === "publish"
          ? "Publishing…"
          : SHIP_STEP_LABEL[phase.step]
        : pushes
          ? "Commit and push"
          : "Commit";
  const syncTitle = !index.upstream
    ? `Publish ${index.branch ?? "this branch"} to ${index.remote ?? "the remote"}`
    : `Pull and push between ${index.branch} and ${index.upstream}`;

  return (
    <footer className="git-commit-box" aria-label="Commit">
      <div className="git-commit-line">
        {index.branch ? (
          <button
            type="button"
            className="git-commit-branch"
            disabled={!onOpenBranchPicker}
            title={
              onOpenBranchPicker
                ? `Switch branch: ${index.branch}`
                : index.branch
            }
            aria-label={
              onOpenBranchPicker
                ? `Switch branch: ${index.branch}`
                : `Branch: ${index.branch}`
            }
            aria-haspopup={onOpenBranchPicker ? "dialog" : undefined}
            onClick={(event) => onOpenBranchPicker?.(event.currentTarget)}
          >
            <GitBranch className="size-3 shrink-0" strokeWidth={1.75} />
            <span className="truncate">{index.branch}</span>
          </button>
        ) : (
          <span className="git-commit-branch">No branch</span>
        )}
        {sync ? (
          <>
            <span className="git-commit-dot" aria-hidden>
              ·
            </span>
            <button
              type="button"
              className="git-commit-sync"
              title={syncTitle}
              disabled={!canSync}
              onClick={() => void syncNow()}
            >
              {sync}
            </button>
          </>
        ) : null}
        <button
          type="button"
          className="git-commit-more"
          aria-label="More ways to ship"
          title="Commit only, push, or open a pull request"
          disabled={busy}
          onClick={onMore}
        >
          <MoreHorizontal className="size-3.5" strokeWidth={1.75} />
        </button>
      </div>
      <div className="git-commit-field">
        <textarea
          ref={field}
          rows={1}
          value={message}
          placeholder="Commit message"
          aria-label="Commit message"
          disabled={busy}
          onChange={(event) => {
            if (phase.kind === "error") setPhase({ kind: "idle" });
            onMessageChange(event.target.value);
          }}
          onKeyDown={(event) => {
            if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
              event.preventDefault();
              void commit();
            }
          }}
        />
        {hasFiles ? (
          <button
            type="button"
            className="git-commit-write"
            aria-label="Write the commit message"
            title="Write a message from the changes"
            disabled={busy}
            onClick={() => void generate()}
          >
            {phase.kind === "writing" ? (
              <Loader className="size-3.5 animate-spin" strokeWidth={1.75} />
            ) : (
              <WandSparkles className="size-3.5" strokeWidth={1.25} />
            )}
          </button>
        ) : null}
      </div>
      {phase.kind === "error" ? (
        <p className="git-commit-error" role="alert">
          {phase.text}
        </p>
      ) : null}
      <button
        type="button"
        className="git-ship-button git-commit-primary"
        disabled={!hasFiles || busy || locked}
        title={
          !hasFiles
            ? "Nothing to commit"
            : message.trim()
              ? `${MOD}↩`
              : "Writes a message from the changes first"
        }
        onClick={() => void commit()}
      >
        {label}
      </button>
    </footer>
  );
}

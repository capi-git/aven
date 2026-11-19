import { ask } from "@tauri-apps/plugin-dialog";
import { memo, useEffect, useState } from "react";
import { useMergeLine } from "../hooks/useMergeLine";
import { errorText, logError } from "../lib/errors";
import { notifyGitChanged } from "../lib/fs";
import { gitPrSquashMerge } from "../lib/gitHousekeeping";
import { githubWorkItemThread } from "../lib/githubTasks";
import { openInAppUrl } from "../lib/inAppLinks";
import { runMergeGitStep } from "../lib/mergeActions";
import {
  MERGE_LINE_WORKING_LABEL,
  mergeLineInstruction,
  mergeLineState,
  type MergeLineAction,
  type MergeLineAgentAction,
} from "../lib/mergeLine";
import type { HarnessId } from "../lib/session";
import { DotSpinner } from "./DotSpinner";
import {
  CloudUpload,
  ArrowUpRight,
  GitMerge,
  GitPullRequest,
  WandSparkles,
} from "./icons";
import "./MergeLine.css";

type Props = {
  cwd: string;
  /** Reads only while the chat is on screen. */
  enabled: boolean;
  /** The chat's agent is working: an agent action would only queue. */
  busy: boolean;
  textHarness?: HarnessId;
  /** Sends a message to this chat's agent, as if typed. */
  onSendToAgent: (text: string) => void;
};

const ICON_PROPS = {
  "aria-hidden": true,
  className: "size-3.5",
  strokeWidth: 1.75,
} as const;

function ActionIcon({ action }: { action: MergeLineAction }) {
  if (action.kind === "agent") return <WandSparkles {...ICON_PROPS} />;
  if (action.id === "merge") return <GitMerge {...ICON_PROPS} />;
  if (action.id === "create-pr") return <GitPullRequest {...ICON_PROPS} />;
  return <CloudUpload {...ICON_PROPS} />;
}

const BUSY_LABEL: Partial<Record<string, string>> = {
  merge: "Merging…",
  "commit-push": "Committing…",
  commit: "Committing…",
  push: "Pushing…",
  publish: "Publishing…",
  "create-pr": "Creating…",
};

/**
 * The step a copy's agent was asked to do from the line, and the state it
 * was asked in. Kept per copy so a chat opened again still shows "Fixing".
 */
type Asked = { id: MergeLineAgentAction; key: string; started: boolean };
const asked = new Map<string, Asked>();

/** For tests: forget every step the line asked an agent to do. */
export function clearMergeLineAsked() {
  asked.clear();
}

/** An agent that never starts on what it was sent has not taken it on. */
const START_WAIT_MS = 15_000;

/**
 * One line under the message box: where the chat's branch stands on its way
 * to a merge, and the one next step. Hidden when nothing applies.
 */
export const MergeLine = memo(function MergeLine({
  cwd,
  enabled,
  busy,
  textHarness,
  onSendToAgent,
}: Props) {
  const { index, pr, details, refresh, reserve, stale } = useMergeLine(
    cwd,
    enabled,
  );
  const [running, setRunning] = useState<string | null>(null);
  // A failed step's error belongs to the state it failed in: once the branch
  // moves on (pushed elsewhere, merged on GitHub), the old error goes.
  const [failure, setFailure] = useState<{ text: string; key: string } | null>(
    null,
  );
  const state = mergeLineState(index, pr, details);
  const stateKey = state
    ? `${state.tone}|${state.action?.id ?? ""}|${pr?.number ?? ""}|${pr?.state ?? ""}`
    : "";
  const failureText = failure?.key === stateKey ? failure.text : null;
  const [askedStep, setAsked] = useState<Asked | null>(
    () => asked.get(cwd) ?? null,
  );
  const remember = (next: Asked | null) => {
    if (next) asked.set(cwd, next);
    else asked.delete(cwd);
    setAsked(next);
  };
  useEffect(() => setAsked(asked.get(cwd) ?? null), [cwd]);
  // The agent took the step on, then finished it: the line shows what is
  // true now. One that never starts drops it after a short wait.
  useEffect(() => {
    if (!askedStep) return;
    if (busy && !askedStep.started) {
      const next = { ...askedStep, started: true };
      asked.set(cwd, next);
      setAsked(next);
      return;
    }
    if (!busy && askedStep.started) {
      asked.delete(cwd);
      setAsked(null);
      return;
    }
    if (busy || askedStep.started) return;
    const timer = window.setTimeout(() => {
      asked.delete(cwd);
      setAsked(null);
    }, START_WAIT_MS);
    return () => window.clearTimeout(timer);
  }, [askedStep, busy, cwd]);
  if (!enabled) return null;
  // Local Git already says the line applies: hold its height while GitHub is
  // read, so the message box above never jumps.
  if (reserve && !state)
    return <div className="merge-line" data-merge-line aria-hidden />;
  if (!index || !state) return null;
  const openPr =
    pr && (pr.state === "open" || pr.state === "merged") ? pr : null;

  const run = async (action: MergeLineAction) => {
    if (running) return;
    if (action.kind === "agent") {
      let comments;
      if (action.id === "fix-review" && openPr) {
        setRunning(action.id);
        comments = await githubWorkItemThread(cwd, "pr", openPr.number, {
          force: true,
        })
          .then((thread) => thread.comments)
          .catch((cause) => {
            logError("merge line: review threads", cause);
            return [];
          });
        setRunning(null);
      }
      remember({ id: action.id, key: stateKey, started: false });
      onSendToAgent(
        mergeLineInstruction(action.id, {
          index,
          pr,
          checks: details?.checks ?? null,
          comments,
        }),
      );
      return;
    }
    if (action.id === "merge") {
      if (!openPr) return;
      const base =
        details?.checks?.baseRefName ||
        index.defaultBranch ||
        "the default branch";
      const ok = await ask(
        `Squash and merge PR #${openPr.number} into ${base}? Its commits become one commit, and GitHub deletes the branch afterwards.`,
        { title: "Aven", kind: "warning", okLabel: "Squash and merge" },
      );
      if (!ok) return;
    }
    setRunning(action.id);
    setFailure(null);
    try {
      if (action.id === "merge") await gitPrSquashMerge(cwd, openPr!.number);
      else await runMergeGitStep(action.id, cwd, index, textHarness);
    } catch (cause) {
      logError(`Merge line: ${action.id}`, cause);
      setFailure({ text: errorText(cause), key: stateKey });
    } finally {
      setRunning(null);
      notifyGitChanged(cwd);
      refresh();
    }
  };

  const action = state.action;
  // The agent is doing what the line asked, and the branch has not moved on.
  const working =
    action?.kind === "agent" &&
    askedStep?.id === action.id &&
    askedStep.key === stateKey
      ? MERGE_LINE_WORKING_LABEL[action.id]
      : null;
  // While the agent works, sending it more would only queue behind it.
  const showAction = action && !working && !(action.kind === "agent" && busy);
  return (
    <div className="merge-line" data-merge-line data-tone={state.tone}>
      <div className="merge-line-status">
        {failureText ? (
          <span
            className="merge-line-word"
            data-tone="danger"
            title={failureText}
            role="alert"
          >
            {failureText}
          </span>
        ) : state.status ? (
          <span className="merge-line-word" data-tone={state.tone}>
            {state.status}
          </span>
        ) : null}
        {openPr?.url ? (
          <button
            type="button"
            className="merge-line-pr"
            title={openPr.title || openPr.url}
            onClick={() => void openInAppUrl(openPr.url)}
          >
            #{openPr.number}
            <ArrowUpRight aria-hidden className="size-3" strokeWidth={1.75} />
          </button>
        ) : null}
      </div>
      {working ? (
        <span
          className="merge-line-working"
          data-merge-working={action?.id}
          role="status"
        >
          <DotSpinner size={12} />
          {working}
        </span>
      ) : null}
      {showAction && action ? (
        <button
          type="button"
          className="merge-line-action"
          data-tone={state.tone === "success" ? "success" : undefined}
          data-merge-action={action.id}
          disabled={!!running || stale}
          title={
            action.kind === "agent"
              ? "Ask this chat's agent to do it"
              : undefined
          }
          onClick={() => void run(action)}
        >
          {running === action.id ? (
            <DotSpinner size={12} />
          ) : (
            <ActionIcon action={action} />
          )}
          {running === action.id && action.kind === "git"
            ? (BUSY_LABEL[action.id] ?? action.label)
            : action.label}
        </button>
      ) : null}
    </div>
  );
});

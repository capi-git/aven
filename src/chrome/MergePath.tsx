import { useState } from "react";
import { useMergePath } from "../hooks/useMergePath";
import { usePrChecks } from "../hooks/usePrChecks";
import { errorText, logError } from "../lib/errors";
import {
  gitPrCreate,
  gitPush,
  gitSync,
  notifyGitChanged,
  type GitDiffIndex,
} from "../lib/fs";
import { generateCommitMessage, generatePrContent } from "../lib/harness";
import { openInAppUrl } from "../lib/inAppLinks";
import {
  checkDuration,
  MERGE_ACTION_LABEL,
  mergeSteps,
  type MergeAction,
  type MergeStep,
} from "../lib/mergePath";
import type { PrCheck } from "../lib/prChecks";
import type { HarnessId } from "../lib/session";
import { runShip } from "../lib/shipFlow";
import { DotSpinner } from "./DotSpinner";
import { ArrowUp, Check, X } from "./icons";
import "./MergePath.css";

type Props = {
  cwd: string;
  enabled: boolean;
  textHarness?: HarnessId;
};

function StepMark({ state }: { state: MergeStep["state"] }) {
  if (state === "done")
    return (
      <span className="merge-path-mark" data-state="done">
        <Check className="size-2.5" strokeWidth={2.5} aria-hidden />
      </span>
    );
  if (state === "failed")
    return (
      <span className="merge-path-mark" data-state="failed">
        <X className="size-2.5" strokeWidth={2.5} aria-hidden />
      </span>
    );
  if (state === "active")
    return (
      <span className="merge-path-mark" data-state="active">
        <DotSpinner size={14} />
      </span>
    );
  return <span className="merge-path-mark" data-state={state} aria-hidden />;
}

function CheckLine({ check }: { check: PrCheck }) {
  const time = checkDuration(check.startedAt, check.completedAt);
  const mark =
    check.state === "pass" ? (
      <Check className="size-3" strokeWidth={2.25} />
    ) : check.state === "fail" ? (
      <X className="size-3" strokeWidth={2.25} />
    ) : check.state === "skipped" ? (
      <span className="merge-path-check-skip" />
    ) : (
      <DotSpinner size={11} />
    );
  return (
    <li data-state={check.state}>
      <span className="merge-path-check-mark" aria-hidden>
        {mark}
      </span>
      {check.url ? (
        <button
          type="button"
          className="merge-path-check-name merge-path-link"
          title={check.url}
          onClick={() => void openInAppUrl(check.url)}
        >
          {check.name}
        </button>
      ) : (
        <span className="merge-path-check-name">{check.name}</span>
      )}
      {time ? <span className="merge-path-check-time">{time}</span> : null}
    </li>
  );
}

async function runAction(
  action: MergeAction | "pull",
  cwd: string,
  index: GitDiffIndex,
  textHarness?: HarnessId,
) {
  if (action === "pull" || action === "publish") return gitSync(cwd);
  if (action === "push") return gitPush(cwd);
  if (action === "commit-push") {
    const message = (await generateCommitMessage(cwd, textHarness)).trim();
    if (!message) throw new Error("Couldn't write the commit message.");
    // A branch with no upstream yet is published after the commit.
    await runShip({
      cwd,
      message,
      mode: index.upstream ? "push" : "commit",
      scope: "all",
      textHarness,
      openPr: null,
    });
    if (!index.upstream) await gitSync(cwd);
    return;
  }
  const content = await generatePrContent(cwd, textHarness);
  if (!content) throw new Error("Couldn't prepare the pull request text.");
  const url = await gitPrCreate(
    cwd,
    content.title,
    content.body,
    content.base,
    content.head,
  );
  if (url.trim()) void openInAppUrl(url.trim());
}

/** The Checks tab: where this copy stands on its way to a merge. */
export function MergePath({ cwd, enabled, textHarness }: Props) {
  const { index, pr, error, nextIn, loading, refresh } = useMergePath(
    cwd,
    enabled,
  );
  const openPr = pr?.state === "open" ? pr : null;
  const checks = usePrChecks(cwd, openPr?.number ?? null, enabled);
  const [busy, setBusy] = useState<MergeAction | "pull" | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  if (!index)
    return (
      <p className="workspace-inspector-placeholder" role="status">
        {error ? "This project has no Git history." : "Loading…"}
      </p>
    );

  const act = async (action: MergeAction | "pull") => {
    if (busy) return;
    setBusy(action);
    setFailure(null);
    try {
      await runAction(action, cwd, index, textHarness);
    } catch (cause) {
      logError(`Checks tab: ${action}`, cause);
      setFailure(errorText(cause));
    } finally {
      setBusy(null);
      notifyGitChanged(cwd);
      refresh();
    }
  };

  const steps = mergeSteps(index, pr, checks.summary, !!checks.error);
  const list = checks.checks?.checks ?? [];
  const behind = index.behind;
  return (
    <div className="merge-path">
      <div className="merge-path-body">
        <h3 className="merge-path-heading">Path to merge</h3>
        <ol className="merge-path-steps">
          {steps.map((step) => (
            <li key={step.id} data-state={step.state}>
              <div className="merge-path-row">
                <StepMark
                  state={busy && step.action === busy ? "active" : step.state}
                />
                <div className="merge-path-text">
                  {step.id === "pr" && pr?.url && step.state === "done" ? (
                    <button
                      type="button"
                      className="merge-path-label merge-path-link"
                      title={pr.title || pr.url}
                      onClick={() => void openInAppUrl(pr.url)}
                    >
                      {step.label}
                    </button>
                  ) : (
                    <span className="merge-path-label" title={step.label}>
                      {step.label}
                    </span>
                  )}
                  {step.detail ? (
                    <span className="merge-path-detail">{step.detail}</span>
                  ) : null}
                </div>
                {step.action ? (
                  <button
                    type="button"
                    className="merge-path-action"
                    disabled={!!busy}
                    onClick={() => void act(step.action!)}
                  >
                    {MERGE_ACTION_LABEL[step.action]}
                  </button>
                ) : null}
              </div>
              {step.id === "checks" && openPr && list.length > 0 ? (
                <ul className="merge-path-checks">
                  {list.map((check, i) => (
                    <CheckLine key={`${check.name}:${i}`} check={check} />
                  ))}
                </ul>
              ) : null}
            </li>
          ))}
        </ol>
        {failure ? (
          <p className="merge-path-failure" role="alert">
            {failure}
          </p>
        ) : null}
        {behind > 0 && index.upstream ? (
          <div className="merge-path-behind">
            <ArrowUp
              className="size-3.5 shrink-0 rotate-180"
              strokeWidth={1.75}
              aria-hidden
            />
            <span className="merge-path-label">
              {behind} {behind === 1 ? "commit" : "commits"} behind{" "}
              {index.upstream}
            </span>
            <button
              type="button"
              className="merge-path-action"
              disabled={!!busy}
              onClick={() => void act("pull")}
            >
              {busy === "pull" ? "Pulling…" : "Pull"}
            </button>
          </div>
        ) : null}
      </div>
      <button
        type="button"
        className="merge-path-footer"
        title="Refresh now"
        disabled={loading}
        onClick={() => {
          refresh();
          checks.refresh();
        }}
      >
        {loading || nextIn === null
          ? "Refreshing…"
          : `Refreshing in ${nextIn}s`}
      </button>
    </div>
  );
}

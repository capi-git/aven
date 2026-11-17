import { useMergePath } from "../hooks/useMergePath";
import { usePrChecks } from "../hooks/usePrChecks";
import { openInAppUrl } from "../lib/inAppLinks";
import { mergeSteps, type MergeStep } from "../lib/mergePath";
import { DotSpinner } from "./DotSpinner";
import { Check, X } from "./icons";
import { CheckRow } from "./ShipFlow";
import "./ShipFlow.css";
import "./MergePath.css";

type Props = {
  cwd: string;
  enabled: boolean;
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

/** The Checks tab: where this copy stands on its way to a merge. */
export function MergePath({ cwd, enabled }: Props) {
  const { index, pr, error, nextIn, loading, refresh } = useMergePath(
    cwd,
    enabled,
  );
  const openPr = pr?.state === "open" ? pr : null;
  const checks = usePrChecks(cwd, openPr?.number ?? null, enabled);

  if (!index)
    return (
      <p className="workspace-inspector-placeholder" role="status">
        {error ? "This project has no Git history." : "Loading…"}
      </p>
    );

  const steps = mergeSteps(index, pr, checks.summary, !!checks.error);
  const list = checks.checks?.checks ?? [];
  return (
    <div className="merge-path">
      <div className="merge-path-body">
        <h3 className="merge-path-heading">Path to merge</h3>
        <ol className="merge-path-steps">
          {steps.map((step) => (
            <li key={step.id} data-state={step.state}>
              <StepMark state={step.state} />
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
                <span className="merge-path-label">{step.label}</span>
              )}
            </li>
          ))}
        </ol>
        {openPr && list.length > 0 ? (
          <ul className="ship-flow-check-list merge-path-checks">
            {list.map((check, i) => (
              <CheckRow key={`${check.name}:${i}`} check={check} />
            ))}
          </ul>
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

import { ask } from "@tauri-apps/plugin-dialog";
import {
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import { usePrChecks } from "../hooks/usePrChecks";
import { errorText, logError } from "../lib/errors";
import {
  gitStageAll,
  type GitChangedFile,
  type GitDiffIndex,
  type GitPr,
} from "../lib/fs";
import { filesLabel } from "../lib/gitChangesView";
import { generateCommitMessage, textModelLabel } from "../lib/harness";
import { openInAppUrl } from "../lib/inAppLinks";
import { LiveSessionsContext } from "../lib/liveSessions";
import { MOD } from "../lib/platform";
import type { PrCheck } from "../lib/prChecks";
import type { HarnessId } from "../lib/session";
import { recordShip } from "../lib/shippedChats";
import {
  defaultShipScope,
  loadShipMode,
  onDefaultBranch,
  preferredShipMode,
  runShip,
  saveShipMode,
  SHIP_STEP_LABEL,
  shipErrorText,
  shipOptions,
  shipSteps,
  shipSummary,
  ShipError,
  type ShipMode,
  type ShipOption,
  type ShipResult,
  type ShipScope,
  type ShipStep,
  type ShipSummary,
} from "../lib/shipFlow";
import {
  describeTurnTests,
  latestTurnTests,
  sessionForShip,
} from "../lib/turnTests";
import {
  ArrowUp,
  Check,
  ChevronDown,
  ChevronRight,
  CircleAlert,
  ExternalLink,
  GitPullRequest,
  Loader,
  RefreshCw,
  WandSparkles,
  X,
} from "./icons";
import "./ShipFlow.css";

type Phase =
  | { kind: "compose" }
  | { kind: "running"; step: ShipStep; done: ShipStep[] }
  | { kind: "done"; result: ShipResult }
  | { kind: "error"; error: ShipError | Error; done: ShipStep[] };

type Props = {
  cwd: string;
  index: GitDiffIndex;
  files: GitChangedFile[];
  /** The branch's latest pull request, if any. */
  pr: GitPr | null;
  /** Panel visible: CI checks are only watched while it is. */
  enabled: boolean;
  textHarness?: HarnessId;
  /** Conversation the request came from; otherwise the folder's latest. */
  sessionId?: string;
  /**
   * The Changes panel shows Staged and Changes apart. When it doesn't, the
   * files ship all together by default, even if some are staged.
   */
  stagingShown?: boolean;
  message: string;
  onMessageChange: (message: string) => void;
  onBusyChange: (busy: boolean) => void;
  /** Git state changed here: reload the index and tell other views. */
  onMutated: () => void;
  onPrChanged: () => void;
  onClose: () => void;
};

const MODE_SHORT: Record<ShipMode, string> = {
  commit: "Commit",
  push: "Push",
  pr: "Open PR",
};

/** Commit, push and open a pull request from one compact card in the panel. */
export function ShipFlow({
  cwd,
  index,
  files,
  pr,
  enabled,
  textHarness,
  sessionId,
  stagingShown = true,
  message,
  onMessageChange,
  onBusyChange,
  onMutated,
  onPrChanged,
  onClose,
}: Props) {
  const live = useContext(LiveSessionsContext);
  // With nothing uncommitted, a Ship pushes the branch and can open a PR.
  const hasFiles = files.length > 0;
  const options = useMemo(
    () => shipOptions(index, pr, hasFiles),
    [index, pr, hasFiles],
  );
  const [mode, setMode] = useState<ShipMode>(() =>
    preferredShipMode(options, loadShipMode()),
  );
  const [scope, setScope] = useState<ShipScope>(() =>
    defaultShipScope(files, stagingShown),
  );
  const [phase, setPhase] = useState<Phase>({ kind: "compose" });
  const [generating, setGenerating] = useState(false);
  // Who is writing the message, named while it does: "Claude Haiku 4.5".
  const [writer, setWriter] = useState("");
  const [generateError, setGenerateError] = useState<string | null>(null);
  const [shipped, setShipped] = useState<ShipSummary | null>(null);
  const generateAbort = useRef<AbortController | null>(null);
  const messageRef = useRef<HTMLTextAreaElement>(null);
  const running = phase.kind === "running";

  // Read once per change of the file list, not on every streamed token.
  const tests = useMemo(() => {
    const session = sessionForShip(live?.list() ?? [], cwd, sessionId);
    return session
      ? {
          info: describeTurnTests(latestTurnTests(session.blocks)),
          busy: !!session.busy,
        }
      : { info: describeTurnTests(null), busy: false };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [live, cwd, sessionId, files]);

  const staged = files.some((file) => file.staged);
  const unstaged = files.some((file) => file.unstaged);
  const summary = shipSummary(files, scope);
  const option = options.find((candidate) => candidate.mode === mode);
  const usable = option?.available ? mode : preferredShipMode(options, null);
  const canShip =
    phase.kind === "compose" &&
    !generating &&
    !!options.find((candidate) => candidate.mode === usable)?.available &&
    (!hasFiles || (message.trim().length > 0 && summary.files > 0));

  useEffect(() => {
    onBusyChange(running || generating);
  }, [running, generating, onBusyChange]);
  useEffect(() => () => onBusyChange(false), [onBusyChange]);
  // Abandon a generation when the flow closes, so it cannot land later.
  useEffect(
    () => () => {
      generateAbort.current?.abort();
      generateAbort.current = null;
    },
    [],
  );
  useEffect(() => {
    if (!enabled || phase.kind !== "compose") return;
    const el = messageRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 140)}px`;
  }, [message, enabled, phase.kind]);

  const stopGenerating = () => {
    generateAbort.current?.abort();
    generateAbort.current = null;
    setGenerating(false);
  };

  const generate = async () => {
    if (generateAbort.current) {
      stopGenerating();
      return;
    }
    const controller = new AbortController();
    generateAbort.current = controller;
    setWriter(textModelLabel(textHarness));
    setGenerating(true);
    setGenerateError(null);
    try {
      // The message is written from what is staged.
      if (summary.toStage > 0) {
        await gitStageAll(cwd);
        onMutated();
      }
      const next = await generateCommitMessage(
        cwd,
        textHarness,
        controller.signal,
      );
      if (!controller.signal.aborted) onMessageChange(next);
    } catch (error) {
      if (!controller.signal.aborted) {
        logError("ship commit message", error);
        setGenerateError(errorText(error));
      }
    } finally {
      if (generateAbort.current === controller) {
        generateAbort.current = null;
        setGenerating(false);
      }
    }
  };

  const ship = async (done: ShipStep[] = []) => {
    if (phase.kind === "running") return;
    const shipMode = usable;
    if (
      done.length === 0 &&
      shipMode !== "commit" &&
      onDefaultBranch(index) &&
      !(await ask(`Push to default branch "${index.branch}"?`, {
        title: "Aven",
        kind: "warning",
      }))
    )
      return;
    if (done.length === 0) {
      setShipped(summary);
      saveShipMode(shipMode);
    }
    const plan = {
      cwd,
      message,
      mode: shipMode,
      scope,
      textHarness,
      openPr: pr,
      commit: hasFiles,
    };
    const steps = shipSteps(plan);
    setPhase({
      kind: "running",
      step: steps.find((step) => !done.includes(step)) ?? "commit",
      done,
    });
    try {
      const result = await runShip(plan, {
        done,
        onStep: (step) =>
          setPhase({
            kind: "running",
            step,
            done: steps.slice(0, steps.indexOf(step)),
          }),
      });
      onMessageChange("");
      setPhase({ kind: "done", result });
      // The chats it carried read Shipped, with this commit or pull request.
      void recordShip({
        cwd,
        requestedId: sessionId,
        result,
        sessions: live?.list() ?? [],
      }).catch((error) => logError("record ship", error));
    } catch (error) {
      logError("ship", error);
      setPhase({
        kind: "error",
        error: error instanceof Error ? error : new Error(errorText(error)),
        done: error instanceof ShipError ? error.done : done,
      });
    } finally {
      onMutated();
      onPrChanged();
    }
  };

  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === "Escape" && !running) {
      event.preventDefault();
      onClose();
    }
  };

  return (
    <section
      className="ship-flow"
      aria-label="Ship it"
      data-phase={phase.kind}
      onKeyDown={onKeyDown}
    >
      <header className="ship-flow-head">
        <ArrowUp className="size-3.5 shrink-0" strokeWidth={2} />
        <span className="ship-flow-title">
          {phase.kind === "done" ? "Shipped" : "Ship it"}
        </span>
        {phase.kind === "done" || phase.kind === "error" ? null : (
          <span className="ship-flow-count">
            {hasFiles ? (
              <>
                {filesLabel(summary.files)}
                <span className="ship-flow-add">+{summary.additions}</span>
                <span className="ship-flow-del">−{summary.deletions}</span>
              </>
            ) : (
              commitsNotInBase(index)
            )}
          </span>
        )}
        <button
          type="button"
          className="ship-flow-close"
          aria-label="Close Ship it"
          title="Close"
          disabled={running}
          onClick={onClose}
        >
          <X className="size-3.5" strokeWidth={1.75} />
        </button>
      </header>

      {phase.kind === "compose" || phase.kind === "running" ? (
        <>
          {staged && unstaged && phase.kind === "compose" ? (
            <div
              className="ship-flow-scope"
              role="radiogroup"
              aria-label="Files to ship"
            >
              {(["all", "staged"] as const).map((value) => {
                const count = shipSummary(files, value).files;
                return (
                  <button
                    key={value}
                    type="button"
                    role="radio"
                    aria-checked={scope === value}
                    onClick={() => setScope(value)}
                  >
                    {value === "all" ? `All ${count}` : `Staged ${count}`}
                  </button>
                );
              })}
            </div>
          ) : null}
          <TestsLine info={tests.info} agentBusy={tests.busy} />
          <div className="ship-flow-message" hidden={!hasFiles}>
            <textarea
              ref={messageRef}
              rows={2}
              value={message}
              placeholder={
                generating
                  ? "Or type your own message"
                  : `Commit message (${MOD}↩ to ship)`
              }
              aria-label="Commit message"
              disabled={running}
              onChange={(event) => {
                // Typing over it takes the message back; what was being
                // written is dropped.
                if (generating) stopGenerating();
                onMessageChange(event.target.value);
              }}
              onKeyDown={(event) => {
                if (
                  (event.metaKey || event.ctrlKey) &&
                  event.key === "Enter" &&
                  canShip
                ) {
                  event.preventDefault();
                  void ship();
                }
              }}
            />
            <button
              type="button"
              className="ship-flow-generate"
              aria-label={
                generating
                  ? `Writing with ${writer}. Cancel`
                  : "Write the commit message"
              }
              title={
                generating
                  ? `Writing with ${writer}. Press to cancel, or type your own.`
                  : summary.toStage > 0
                    ? `Stage all ${summary.files} files and write a message`
                    : "Write a message from the changes"
              }
              disabled={running || summary.files === 0}
              onClick={() => void generate()}
            >
              {generating ? (
                <Loader className="size-3.5 animate-spin" strokeWidth={1.75} />
              ) : (
                <WandSparkles className="size-3.5" strokeWidth={1.25} />
              )}
              <span className="ship-flow-generate-label">
                {generating ? `Writing with ${writer}…` : "Write"}
              </span>
            </button>
          </div>
          {generateError ? (
            <p className="ship-flow-error" role="alert">
              {generateError}
            </p>
          ) : null}
          <div
            className="ship-flow-modes"
            role="radiogroup"
            aria-label="How far to ship"
          >
            {options.map((candidate) => (
              <button
                key={candidate.mode}
                type="button"
                role="radio"
                aria-checked={usable === candidate.mode}
                disabled={!candidate.available || running}
                title={candidate.hint ?? candidate.label}
                onClick={() => setMode(candidate.mode)}
              >
                {MODE_SHORT[candidate.mode]}
              </button>
            ))}
          </div>
          <p className="ship-flow-hint">
            {modeDescription(
              usable,
              index,
              options.find((o) => o.mode === usable),
              hasFiles,
            )}
          </p>
          {phase.kind === "running" ? (
            <ShipProgress
              steps={shipSteps({ mode: usable, scope, commit: hasFiles })}
              current={phase.step}
              done={phase.done}
            />
          ) : (
            <button
              type="button"
              className="ship-flow-primary"
              disabled={!canShip}
              title={`${MOD}↩`}
              onClick={() => void ship()}
            >
              {usable === "pr" ? (
                <GitPullRequest className="size-3.5" strokeWidth={1.75} />
              ) : (
                <Check className="size-3.5" strokeWidth={2} />
              )}
              {options.find((o) => o.mode === usable)?.label ?? "Commit"}
            </button>
          )}
        </>
      ) : null}

      {phase.kind === "error" ? (
        <div className="ship-flow-failed">
          <p className="ship-flow-error" role="alert">
            <CircleAlert className="size-3.5 shrink-0" strokeWidth={1.75} />
            <span>{shipErrorText(phase.error)}</span>
          </p>
          <div className="ship-flow-actions">
            <button
              type="button"
              className="ship-flow-secondary"
              onClick={() => void ship(phase.done)}
            >
              <RefreshCw className="size-3" strokeWidth={1.75} />
              Try again
            </button>
            {phase.done.includes("commit") ? (
              <button
                type="button"
                className="ship-flow-link"
                onClick={onClose}
              >
                Close
              </button>
            ) : (
              <button
                type="button"
                className="ship-flow-link"
                onClick={() => setPhase({ kind: "compose" })}
              >
                Back
              </button>
            )}
          </div>
        </div>
      ) : null}

      {phase.kind === "done" ? (
        <ShipDone
          cwd={cwd}
          index={index}
          result={phase.result}
          shipped={shipped}
          enabled={enabled}
          onClose={onClose}
        />
      ) : null}
    </section>
  );
}

/** "3 commits not in main yet", for a branch with nothing uncommitted. */
function commitsNotInBase(index: GitDiffIndex): string {
  const count = index.aheadOfDefault;
  const base = index.defaultBranch ?? "the default branch";
  return count > 0
    ? `${count} ${count === 1 ? "commit" : "commits"} not in ${base}`
    : `Nothing new for ${base}`;
}

function modeDescription(
  mode: ShipMode,
  index: GitDiffIndex,
  option: ShipOption | undefined,
  hasFiles: boolean,
): string {
  // Nothing can be shipped: say why.
  if (option && !option.available) return option.hint ?? "";
  const hint = option?.hint;
  const where = index.upstream ?? `${index.remote ?? "origin"}/${index.branch}`;
  const base = index.defaultBranch ?? "the default branch";
  if (mode === "commit") return `Commits on ${index.branch ?? "this branch"}.`;
  if (mode === "push")
    return `${hasFiles ? "Commits and pushes" : "Pushes"} to ${where}.${hint ? ` ${hint}` : ""}`;
  return `${hasFiles ? "Commits, pushes" : "Pushes"} and opens a pull request into ${base}.`;
}

function TestsLine({
  info,
  agentBusy,
}: {
  info: ReturnType<typeof describeTurnTests>;
  agentBusy: boolean;
}) {
  return (
    <div className="ship-flow-tests" data-tone={info.tone}>
      <span className="ship-flow-tests-mark" aria-hidden>
        {info.tone === "ok"
          ? "✓"
          : info.tone === "warn"
            ? "!"
            : info.tone === "busy"
              ? "…"
              : "–"}
      </span>
      <div className="min-w-0">
        <p className="ship-flow-tests-title">{info.title}</p>
        <p className="ship-flow-tests-detail" title={info.detail}>
          {agentBusy ? "The agent is still working. " : ""}
          {info.detail}
        </p>
      </div>
    </div>
  );
}

function ShipProgress({
  steps,
  current,
  done,
}: {
  steps: ShipStep[];
  current: ShipStep;
  done: ShipStep[];
}) {
  return (
    <ol className="ship-flow-progress" aria-live="polite">
      {steps.map((step) => {
        const state = done.includes(step)
          ? "done"
          : step === current
            ? "active"
            : "waiting";
        return (
          <li key={step} data-state={state}>
            {state === "done" ? (
              <Check className="size-3" strokeWidth={2} />
            ) : state === "active" ? (
              <Loader className="size-3 animate-spin" strokeWidth={2} />
            ) : (
              <span className="ship-flow-progress-dot" aria-hidden />
            )}
            {SHIP_STEP_LABEL[step].replace("…", "")}
          </li>
        );
      })}
    </ol>
  );
}

function ShipDone({
  cwd,
  index,
  result,
  shipped,
  enabled,
  onClose,
}: {
  cwd: string;
  index: GitDiffIndex;
  result: ShipResult;
  shipped: ShipSummary | null;
  enabled: boolean;
  onClose: () => void;
}) {
  const pr = result.pr;
  const { checks, summary, error, loading, refresh } = usePrChecks(
    cwd,
    pr?.number ?? null,
    enabled,
  );
  const [listOpen, setListOpen] = useState(false);
  const where = result.pushed
    ? `pushed to ${index.upstream ?? `${index.remote ?? "origin"}/${index.branch}`}`
    : `on ${index.branch ?? "this copy"}`;
  return (
    <div className="ship-flow-done" role="status">
      <p className="ship-flow-done-line">
        <Check className="size-3.5 shrink-0" strokeWidth={2} />
        <span>
          {result.committed
            ? `Committed ${shipped ? filesLabel(shipped.files) : "changes"} · ${where}`
            : result.pushed
              ? `Pushed to ${index.upstream ?? `${index.remote ?? "origin"}/${index.branch}`}`
              : "Nothing needed shipping"}
        </span>
      </p>
      {pr ? (
        <div className="ship-flow-pr">
          <button
            type="button"
            className="ship-flow-pr-link"
            title={pr.url}
            onClick={() => void openInAppUrl(pr.url)}
          >
            <GitPullRequest className="size-3.5 shrink-0" strokeWidth={1.75} />
            <span className="truncate">
              {pr.created ? "Opened" : "Updated"} PR #{pr.number}
            </span>
            <ExternalLink className="size-3 shrink-0" strokeWidth={1.75} />
          </button>
          <div className="ship-flow-checks" data-state={summary?.state}>
            <button
              type="button"
              className="ship-flow-checks-head"
              aria-expanded={listOpen}
              disabled={!checks?.checks.length}
              onClick={() => setListOpen(!listOpen)}
            >
              <span className="ship-flow-checks-dot" aria-hidden />
              <span className="min-w-0 flex-1 truncate">
                {error
                  ? "Couldn't read the checks"
                  : summary
                    ? summary.label
                    : "Looking for checks…"}
              </span>
              {checks?.checks.length ? (
                listOpen ? (
                  <ChevronDown className="size-3 shrink-0" strokeWidth={1.75} />
                ) : (
                  <ChevronRight
                    className="size-3 shrink-0"
                    strokeWidth={1.75}
                  />
                )
              ) : null}
            </button>
            <button
              type="button"
              className="ship-flow-checks-refresh"
              aria-label="Check again"
              title={error ?? "Check again"}
              disabled={loading}
              onClick={refresh}
            >
              <RefreshCw
                className={`size-3 ${loading ? "animate-spin" : ""}`}
                strokeWidth={1.75}
              />
            </button>
          </div>
          {listOpen && checks?.checks.length ? (
            <ul className="ship-flow-check-list">
              {checks.checks.map((check, i) => (
                <CheckRow key={`${check.name}:${i}`} check={check} />
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
      <div className="ship-flow-actions">
        <button type="button" className="ship-flow-secondary" onClick={onClose}>
          Done
        </button>
      </div>
    </div>
  );
}

const CHECK_STATE_LABEL: Record<string, string> = {
  pass: "Passed",
  fail: "Failed",
  pending: "Running",
  skipped: "Skipped",
};

function CheckRow({ check }: { check: PrCheck }) {
  return (
    <li data-state={check.state}>
      <span className="ship-flow-checks-dot" aria-hidden />
      {check.url ? (
        <button
          type="button"
          className="min-w-0 flex-1 truncate text-left hover:underline"
          title={check.url}
          onClick={() => void openInAppUrl(check.url)}
        >
          {check.name}
        </button>
      ) : (
        <span className="min-w-0 flex-1 truncate">{check.name}</span>
      )}
      <span className="ship-flow-check-state">
        {CHECK_STATE_LABEL[check.state] ?? check.state}
      </span>
    </li>
  );
}

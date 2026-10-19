import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Check } from "../chrome/icons";
import { focusableWithin } from "../chrome/Modal";
import { ProjectMascot } from "../chrome/ProjectMascot";
import { useLockOverscroll } from "../hooks/useLockOverscroll";
import { failureText } from "../lib/errors";
import { LAYER } from "../lib/layers";
import type { HarnessId } from "../lib/session";
import { TAB_GROUP_COLORS } from "../lib/tabGroups";
import {
  WALKTHROUGH_STEPS,
  WALKTHROUGH_STEP_LABEL,
  type WalkthroughAction,
  type WalkthroughStep,
} from "../lib/walkthrough";
import { ProviderSetup } from "./ProviderSetup";
import "./Walkthrough.css";

/** The welcome's cast: five of the mascots in the project palette. */
const CAST = [
  { name: "fox", color: TAB_GROUP_COLORS[2] },
  { name: "whale", color: TAB_GROUP_COLORS[1] },
  { name: "owl", color: TAB_GROUP_COLORS[4] },
  { name: "sprout", color: TAB_GROUP_COLORS[3] },
  { name: "jelly", color: TAB_GROUP_COLORS[6] },
] as const;

const FEATURES = [
  {
    title: "Many agents",
    text: "Claude, Codex and more, each in its own chat.",
  },
  {
    title: "Work together",
    text: "Race them, let them discuss, or split a job.",
  },
  {
    title: "See and ship",
    text: "Live preview, mark it up, review, Ship it.",
  },
];

export type WalkthroughProjectChoice = "folder" | "sample";

export type WalkthroughProps = {
  /** Welcome, Agents or Project; the tour runs over the app itself. */
  step: Exclude<WalkthroughStep, "tour">;
  done: readonly WalkthroughStep[];
  onAction: (action: WalkthroughAction) => void;
  /** Agents is done: start the first chat with this provider, if any. */
  onAgentsDone: (harness?: HarnessId) => void;
  /**
   * Add a project: the folder picker (false when cancelled) or the sample.
   * A failure rejects with what went wrong.
   */
  onProject: (choice: WalkthroughProjectChoice) => Promise<boolean>;
};

/** The step strip: where you are, with ✓ on finished steps. */
function Steps({
  step,
  done,
}: {
  step: WalkthroughStep;
  done: readonly WalkthroughStep[];
}) {
  return (
    <ol className="walkthrough-steps" aria-label="Setup steps">
      {WALKTHROUGH_STEPS.map((each) => (
        <li
          key={each}
          aria-current={each === step ? "step" : undefined}
          data-done={done.includes(each) ? "" : undefined}
        >
          {WALKTHROUGH_STEP_LABEL[each]}
          {done.includes(each) ? (
            <>
              <Check className="size-3" aria-hidden />
              <span className="sr-only"> (done)</span>
            </>
          ) : null}
        </li>
      ))}
    </ol>
  );
}

/**
 * The first-run walkthrough's dialog: Welcome, Agents and Project. Closing
 * it is never a click away by accident; Skip setup is always there.
 */
export function Walkthrough({
  step,
  done,
  onAction,
  onAgentsDone,
  onProject,
}: WalkthroughProps) {
  const ids = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const lockOverscroll = useLockOverscroll<HTMLDivElement>();

  // Each step starts with its main button focused, so Enter goes on.
  useEffect(() => {
    const panel = panelRef.current;
    if (!panel) return;
    const primary = panel.querySelector<HTMLElement>(
      "[data-walkthrough-primary]",
    );
    (primary ?? focusableWithin([panel])[0])?.focus({ preventScroll: true });
  }, [step]);

  // Keep Tab inside the dialog.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Tab" || event.defaultPrevented) return;
      const panel = panelRef.current;
      if (!panel) return;
      const focusable = focusableWithin([panel]);
      if (!focusable.length) return;
      const index = focusable.indexOf(document.activeElement as HTMLElement);
      const next =
        index < 0
          ? event.shiftKey
            ? focusable.length - 1
            : 0
          : (index + (event.shiftKey ? -1 : 1) + focusable.length) %
            focusable.length;
      event.preventDefault();
      focusable[next].focus({ preventScroll: true });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  let body: ReactNode;
  if (step === "welcome") {
    body = (
      <>
        <div className="walkthrough-cast" aria-hidden>
          {CAST.map((mascot) => (
            <ProjectMascot
              key={mascot.name}
              project={mascot.name}
              name={mascot.name}
              color={mascot.color}
              className="size-10 shrink-0"
            />
          ))}
        </div>
        <h2 id={`${ids}-title`} className="walkthrough-title" data-centred="">
          Welcome to Aven
        </h2>
        <p className="walkthrough-lead" data-centred="">
          Your coding agents, side by side. Ask, watch them build, preview the
          result and ship it, all in one window.
        </p>
        <ul className="walkthrough-cards" role="list">
          {FEATURES.map((feature) => (
            <li key={feature.title} className="walkthrough-card">
              <strong>{feature.title}</strong>
              {feature.text}
            </li>
          ))}
        </ul>
        <footer className="walkthrough-footer">
          <button
            type="button"
            className="walkthrough-quiet"
            onClick={() => onAction({ type: "skip" })}
          >
            Skip setup
          </button>
          <button
            type="button"
            className="walkthrough-primary"
            data-walkthrough-primary=""
            onClick={() => onAction({ type: "next" })}
          >
            Get started
          </button>
        </footer>
      </>
    );
  } else if (step === "agents") {
    body = (
      <>
        <h2 id={`${ids}-title`} className="sr-only">
          Connect your agents
        </h2>
        <ProviderSetup
          embedded={{
            onBack: () => onAction({ type: "back" }),
            onContinue: (harness) => {
              onAgentsDone(harness);
              onAction({ type: "next" });
            },
          }}
        />
      </>
    );
  } else {
    body = (
      <ProjectStep
        titleId={`${ids}-title`}
        onProject={onProject}
        onAction={onAction}
      />
    );
  }

  return createPortal(
    <div className="fixed inset-0" style={{ zIndex: LAYER.dialog }}>
      <div className="modal-backdrop absolute inset-0 bg-black/40" />
      <div className="walkthrough-frame">
        <div
          ref={panelRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby={`${ids}-title`}
          className="modal-panel walkthrough-panel"
          data-step={step}
        >
          <div ref={lockOverscroll} className="walkthrough-body">
            <div className="walkthrough-top">
              <Steps step={step} done={done} />
              {step !== "welcome" ? (
                <button
                  type="button"
                  className="walkthrough-quiet walkthrough-skip-setup"
                  onClick={() => onAction({ type: "skip" })}
                >
                  Skip setup
                </button>
              ) : null}
            </div>
            {body}
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}

function ProjectStep({
  titleId,
  onProject,
  onAction,
}: {
  titleId: string;
  onProject: WalkthroughProps["onProject"];
  onAction: WalkthroughProps["onAction"];
}) {
  const [choice, setChoice] = useState<WalkthroughProjectChoice>("sample");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const mounted = useRef(true);
  useEffect(
    () => () => {
      mounted.current = false;
    },
    [],
  );
  const go = async () => {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const added = await onProject(choice);
      if (!mounted.current) return;
      if (added) onAction({ type: "next" });
    } catch (failure) {
      if (!mounted.current) return;
      setError(
        failureText(
          failure,
          choice === "sample"
            ? "The sample couldn’t be made."
            : "That folder couldn’t be added.",
        ),
      );
    } finally {
      if (mounted.current) setBusy(false);
    }
  };
  const options: {
    id: WalkthroughProjectChoice;
    title: string;
    text: string;
  }[] = [
    {
      id: "folder",
      title: "Open a folder",
      text: "Use a project you already have on this computer.",
    },
    {
      id: "sample",
      title: "Try a sample",
      text: "A tiny website to play with. Nothing else on your computer is touched.",
    },
  ];
  return (
    <>
      <h2 id={titleId} className="walkthrough-title">
        Pick something to work on
      </h2>
      <p className="walkthrough-lead">
        A project is a folder your agents work in. You can add more any time.
      </p>
      <div
        className="walkthrough-cards walkthrough-choices"
        role="radiogroup"
        aria-label="Project"
      >
        {options.map((option) => (
          <button
            key={option.id}
            type="button"
            role="radio"
            aria-checked={choice === option.id}
            className="walkthrough-card walkthrough-choice"
            disabled={busy}
            onClick={() => setChoice(option.id)}
            onDoubleClick={() => void go()}
          >
            <strong>{option.title}</strong>
            {option.text}
          </button>
        ))}
      </div>
      {error ? (
        <p role="alert" className="walkthrough-error">
          {error}
        </p>
      ) : null}
      <footer className="walkthrough-footer">
        <div className="walkthrough-actions">
          <button
            type="button"
            className="walkthrough-secondary"
            disabled={busy}
            onClick={() => onAction({ type: "back" })}
          >
            Back
          </button>
          <button
            type="button"
            className="walkthrough-quiet"
            disabled={busy}
            onClick={() => onAction({ type: "skipStep" })}
          >
            Skip
          </button>
        </div>
        <button
          type="button"
          className="walkthrough-primary"
          data-walkthrough-primary=""
          disabled={busy}
          onClick={() => void go()}
        >
          {busy
            ? choice === "sample"
              ? "Making the sample…"
              : "Choosing…"
            : "Continue"}
        </button>
      </footer>
    </>
  );
}

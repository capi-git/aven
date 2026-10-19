import { useId } from "react";
import { Check, X } from "../chrome/icons";
import type {
  GettingStartedCard as Card,
  GettingStartedStepId,
} from "../lib/gettingStarted";
import "./GettingStarted.css";

const COUNT = ["None", "One", "Two", "Three", "Four", "Five"];

type Props = {
  card: Card;
  /** Do the next step: open setup, the folder picker, a chat, Changes. */
  onStart: (step: GettingStartedStepId) => void;
  /** Hide it for good. */
  onHide: () => void;
};

/**
 * Home's compact "Getting started" card: five first steps that tick
 * themselves, with Start on the next one. Once all five are done it says so
 * until hidden.
 */
export function GettingStartedCard({ card, onStart, onHide }: Props) {
  const ids = useId();
  const total = card.steps.length;
  return (
    <section
      className="getting-started"
      aria-labelledby={`${ids}-title`}
      data-done={card.allDone ? "" : undefined}
    >
      <header className="getting-started-header">
        <div>
          <h2 id={`${ids}-title`}>
            {card.allDone ? "You’re all set" : "Getting started"}
          </h2>
          <p>
            {card.allDone
              ? "All five done. This card won’t show again."
              : "About five minutes · hide this any time"}
          </p>
        </div>
        <button
          type="button"
          className="getting-started-hide"
          aria-label={
            card.allDone ? "Close Getting started" : "Hide Getting started"
          }
          title={card.allDone ? "Close" : "Hide"}
          onClick={onHide}
        >
          <X size={14} />
        </button>
      </header>
      <div
        className="getting-started-bar"
        role="progressbar"
        aria-label="Getting started progress"
        aria-valuemin={0}
        aria-valuemax={total}
        aria-valuenow={card.doneCount}
        aria-valuetext={`${COUNT[card.doneCount] ?? card.doneCount} of ${total} done`}
      >
        <span style={{ transform: `scaleX(${card.doneCount / total})` }} />
      </div>
      <ol className="getting-started-steps" role="list">
        {card.steps.map((step) => (
          <li
            key={step.id}
            data-step={step.id}
            data-done={step.done ? "" : undefined}
          >
            <span className="getting-started-check" aria-hidden>
              {step.done ? <Check size={11} strokeWidth={2.5} /> : null}
            </span>
            <span className="getting-started-text">
              <span className="getting-started-title">
                {step.title}
                {step.done ? <span className="sr-only"> (done)</span> : null}
              </span>
              <small>{step.detail}</small>
            </span>
            {step.id === card.next ? (
              <button
                type="button"
                className="getting-started-start"
                aria-label={`Start: ${step.title}`}
                onClick={() => onStart(step.id)}
              >
                Start
              </button>
            ) : null}
          </li>
        ))}
      </ol>
    </section>
  );
}

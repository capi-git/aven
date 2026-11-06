import type { DictationState } from "../hooks/useDictation";
import type { BriefAction } from "../hooks/useSpokenBrief";
import { DICTATION_KEYS, type DictationProblem } from "../lib/dictation";
import { Mic, Undo2, WandSparkles, X } from "./icons";
import "./ComposerSpeech.css";

/**
 * The microphone after Send. Pressed, it listens and the words appear in
 * the message box as they are heard; pressed again (or ⇧⌘M), it stops.
 */
export function MicButton({
  state,
  onToggle,
}: {
  state: DictationState;
  onToggle: () => void;
}) {
  const on = state !== "idle";
  const label = on ? "Stop listening" : "Dictate";
  return (
    <button
      type="button"
      className="helm-mic"
      aria-label={label}
      aria-pressed={on}
      aria-keyshortcuts="Meta+Shift+M"
      title={`${label} (${DICTATION_KEYS})`}
      data-helm-mic={state}
      // The caret stays in the message, where the words will go.
      onMouseDown={(event) => event.preventDefault()}
      onClick={onToggle}
    >
      <Mic aria-hidden className="helm-mic-art" />
    </button>
  );
}

/** Why listening was refused, and the one place that fixes it. */
export function DictationNotice({
  problem,
  onOpenSettings,
  onDismiss,
}: {
  problem: DictationProblem;
  onOpenSettings: () => void;
  onDismiss: () => void;
}) {
  return (
    <div className="composer-speech-row" role="alert" data-dictation-problem>
      <span className="composer-speech-text">{problem.text}</span>
      {problem.settings ? (
        <button
          type="button"
          className="composer-speech-action"
          onClick={onOpenSettings}
        >
          Open System Settings
        </button>
      ) : null}
      <button
        type="button"
        className="composer-speech-close"
        aria-label="Dismiss"
        onClick={onDismiss}
      >
        <X aria-hidden className="composer-speech-icon" />
      </button>
    </div>
  );
}

/**
 * Under spoken words: tidy them into a brief, or go back and forth between
 * the brief and the words it came from.
 */
export function BriefRow({
  action,
  error,
  onTidy,
  onCancel,
  onShowWords,
  onShowBrief,
}: {
  action: BriefAction;
  error: string | null;
  onTidy: () => void;
  onCancel: () => void;
  onShowWords: () => void;
  onShowBrief: () => void;
}) {
  return (
    <div className="composer-speech-row" data-brief-row={action}>
      {action === "tidying" ? (
        <>
          <span className="composer-speech-text" role="status">
            Tidying into a brief…
          </span>
          <button
            type="button"
            className="composer-speech-action"
            onClick={onCancel}
          >
            Cancel
          </button>
        </>
      ) : action === "words" ? (
        <button
          type="button"
          className="composer-speech-action"
          title="Put back what you said; the brief stays one press away"
          onClick={onShowWords}
        >
          <Undo2 aria-hidden className="composer-speech-icon" />
          Back to my words
        </button>
      ) : action === "brief" ? (
        <button
          type="button"
          className="composer-speech-action"
          onClick={onShowBrief}
        >
          <WandSparkles aria-hidden className="composer-speech-icon" />
          Use the brief
        </button>
      ) : (
        <button
          type="button"
          className="composer-speech-action"
          title="Rewrite what you said as a goal, details and what done looks like"
          onClick={onTidy}
        >
          <WandSparkles aria-hidden className="composer-speech-icon" />
          Tidy into a brief
        </button>
      )}
      {error && action === "tidy" ? (
        <span className="composer-speech-text" role="alert">
          {error}
        </span>
      ) : null}
    </div>
  );
}

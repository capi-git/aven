import { createPortal } from "react-dom";
import { LAYER } from "../lib/layers";
import { dismissSaveProblem, useSaveProblem } from "../lib/saveProblems";
import { CircleAlert, X } from "./icons";

/**
 * One notice when something can't be saved: what, and why. It stays until
 * dismissed or the save works again; changes hold while the window is open.
 */
export function SaveProblemNotice() {
  const problem = useSaveProblem();
  if (!problem) return null;
  return createPortal(
    <div
      aria-live="polite"
      style={{ zIndex: LAYER.toast }}
      className="pointer-events-none fixed bottom-3 left-1/2 flex w-[min(420px,calc(100vw-24px))] -translate-x-1/2 flex-col"
    >
      <article
        role="status"
        data-save-problem={problem.key}
        className="pointer-events-auto flex items-center gap-2.5 aven-glass-overlay [--aven-radius-overlay:var(--aven-radius-bubble)] py-2 pr-2 pl-3.5"
      >
        <CircleAlert className="size-4 shrink-0 text-content/70" />
        <p className="min-w-0 flex-1 text-ui-label leading-4 text-content/75">
          <span className="text-content">
            Aven can't save changes to {problem.what}
          </span>
          : {problem.why} They hold until this window closes.
        </p>
        <button
          type="button"
          aria-label="Dismiss"
          onClick={dismissSaveProblem}
          className="grid size-6 shrink-0 place-items-center rounded-md text-content/50 hover:bg-content/10 hover:text-content"
        >
          <X className="size-3.5" />
        </button>
      </article>
    </div>,
    document.body,
  );
}

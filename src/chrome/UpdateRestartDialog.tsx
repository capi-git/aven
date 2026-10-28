import { useSyncExternalStore } from "react";
import {
  answerRestartDecision,
  describeRestartWork,
  getRestartDecision,
  subscribeRestartDecision,
} from "../lib/updateRestartWork";
import { Modal } from "./Modal";

const SECONDARY =
  "rounded-md px-3 py-1.5 text-ui-label text-content/80 hover:bg-(--aven-control-bg) focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--aven-focus-ring)";
const PRIMARY =
  "rounded-md bg-content px-3 py-1.5 text-ui-label font-medium text-background-base hover:bg-(--aven-inverse-hover) focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--aven-focus-ring) focus-visible:ring-offset-1";
const STOP =
  "rounded-md px-3 py-1.5 text-ui-label font-medium bg-(--aven-danger-fill) text-(--aven-danger-text) hover:bg-(--aven-danger-fill-hover) focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 dark:text-red-400";

/** The one question a restart to update asks: what to do about running work. */
export function UpdateRestartDialog() {
  const decision = useSyncExternalStore(
    subscribeRestartDecision,
    getRestartDecision,
    () => null,
  );
  if (!decision) return null;
  const { work, now } = decision;
  const lines = describeRestartWork(work);
  const onlyFiles = !work.agents.length && !work.terminals.length;
  const cancel = () => answerRestartDecision("cancel");
  return (
    <Modal
      size="sm"
      title={
        now
          ? onlyFiles
            ? "Restart without saving?"
            : "Stop this work and restart?"
          : "Some work isn't finished"
      }
      onClose={cancel}
    >
      <div className="px-5 pb-4">
        <ul className="flex flex-col gap-1.5 text-ui-label leading-relaxed text-content/85">
          {lines.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
        <p className="mt-3 text-ui-label leading-relaxed text-content/60">
          {now
            ? "Restarting now stops it."
            : onlyFiles
              ? "Aven can restart by itself once your changes are saved."
              : "Aven can restart by itself as soon as it finishes."}
          {work.files.length
            ? " Unsaved changes are lost if you restart now."
            : ""}{" "}
          The update stays downloaded either way.
        </p>
        <div className="mt-5 flex flex-wrap justify-end gap-2">
          <button
            type="button"
            className={SECONDARY}
            autoFocus={now}
            onClick={cancel}
          >
            {now ? "Keep waiting" : "Cancel"}
          </button>
          <button
            type="button"
            className={STOP}
            onClick={() => answerRestartDecision("stop")}
          >
            {onlyFiles
              ? "Restart now without saving"
              : "Stop them and restart now"}
          </button>
          {now ? null : (
            <button
              type="button"
              className={PRIMARY}
              autoFocus
              onClick={() => answerRestartDecision("wait")}
            >
              {onlyFiles ? "Restart when saved" : "Restart when they finish"}
            </button>
          )}
        </div>
      </div>
    </Modal>
  );
}

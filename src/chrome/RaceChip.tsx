import { useRef, type KeyboardEvent } from "react";
import { isImeComposition, moveMenuFocus } from "../lib/keyboard";
import type { ComposerFit } from "../lib/composerFit";
import {
  raceChipFitLabel,
  raceChipLabel,
  raceFullName,
} from "../lib/raceNames";
import { ChevronDown, Race, X } from "./icons";
import { Popover } from "./Popover";
import { RaceOptions, type RaceProps } from "./RaceOptions";

type Props = RaceProps & {
  /** Why sending would not start the race, or the last refusal. */
  reason: string | null;
  /** `reason` is a send that just failed: said aloud, not only shown. */
  failed?: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onTurnOff: () => void;
  /** Return the keyboard to the message box. */
  onDone: () => void;
  /** How much room the message box gives the chip's words. */
  fit?: ComposerFit;
};

/**
 * The composer's Race mode chip: which agents the next message races, as
 * "Race · Claude · Codex", with a dropdown to choose two to four of them,
 * any app and model. Sending the message starts the race.
 */
export function RaceChip({
  available,
  lanes,
  onFirstModelChange,
  reason,
  failed = false,
  open,
  onOpenChange,
  onTurnOff,
  onDone,
  fit = "full",
}: Props) {
  const anchor = useRef<HTMLButtonElement>(null);
  const full = raceChipLabel(lanes);
  const label = raceChipFitLabel(lanes, fit);
  const names = lanes.map(raceFullName).join(", ");
  // On the surface itself: it holds the keyboard when the dropdown opens,
  // so the arrow keys move through it from the start.
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (isImeComposition(event.nativeEvent)) return;
    moveMenuFocus(event);
  };
  return (
    <div
      className="flex h-6.5 min-w-0 shrink items-center rounded-md bg-content/10 text-ui-caption text-content"
      data-race-chip
      data-full-label={full}
    >
      <button
        ref={anchor}
        type="button"
        title={
          !names
            ? "Choose the agents to race"
            : label === full
              ? names
              : `${full} (${names})`
        }
        aria-haspopup="dialog"
        aria-expanded={open}
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => onOpenChange(!open)}
        className="flex h-full min-w-0 items-center gap-1 rounded-l-md pl-1.5 pr-1 hover:bg-content/15"
      >
        <Race className="size-3.5 shrink-0" strokeWidth={1.75} />
        <span className="min-w-0 truncate" data-race-chip-label>
          {label}
        </span>
        <ChevronDown className="size-3 shrink-0" />
      </button>
      <button
        type="button"
        title="Turn off Race"
        aria-label="Turn off Race"
        onMouseDown={(event) => event.preventDefault()}
        onClick={onTurnOff}
        className="grid h-full shrink-0 place-items-center rounded-r-md px-1 hover:bg-content/15"
      >
        <X className="size-3" />
      </button>
      {open ? (
        <Popover
          anchor={anchor}
          side="top"
          align="start"
          width={300}
          autoFocus
          tabIndex={-1}
          role="dialog"
          aria-label="Race this message"
          onKeyDown={onKeyDown}
          onDismiss={(dismissed) => {
            onOpenChange(false);
            if (dismissed === "escape") onDone();
          }}
          data-race-menu
          className="outline-none"
        >
          <div>
            <RaceOptions
              available={available}
              lanes={lanes}
              onFirstModelChange={onFirstModelChange}
            />
            <div className="flex min-h-9 items-center border-t border-content/10 px-2.5 py-1.5">
              <p
                role={failed ? "alert" : undefined}
                data-race-reason
                className={`min-w-0 flex-1 text-ui-caption leading-4 ${
                  reason ? "text-content/80" : "text-content/45"
                }`}
              >
                {reason ??
                  "Send your message to start. Each agent works separately. Your project doesn't change until you keep one."}
              </p>
            </div>
          </div>
        </Popover>
      ) : null}
    </div>
  );
}

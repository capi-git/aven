import { useRef, useState } from "react";
import { HarnessIcon } from "../chrome/HarnessIcon";
import { Popover } from "../chrome/Popover";
import { TeamCardButton } from "../chrome/TeamCard";
import { moveMenuFocus } from "../lib/keyboard";
import { timeAgo } from "../lib/orchestrationSummary";
import type { ReviewerChoice } from "../lib/raceReviewers";

/**
 * Ask a reviewer: the one picker of chats that could compare a race's
 * agents as a Reviewer, the same on the race's card and in its floating
 * panel (here or popped out). It lists the chats `choices` gives when it
 * opens, the chat you raced from first, and hands the one you pick to
 * `onPick`: the card asks it at once, a panel asks the window that owns
 * the race, which checks the chat again before it does.
 */
export function RaceReviewerPicker({
  choices,
  originId,
  disabled,
  reviewing = false,
  side = "bottom",
  align = "start",
  onPick,
}: {
  /** The chats that could review it now, read when the picker opens. */
  choices: () => readonly ReviewerChoice[];
  /** The chat the race was sent from, named as such. */
  originId?: string;
  disabled: boolean;
  /** A reviewer is comparing the agents now. */
  reviewing?: boolean;
  /** Where the list opens: below the card's button, above a footer's. */
  side?: "top" | "bottom";
  align?: "start" | "end";
  onPick: (choice: ReviewerChoice) => void;
}) {
  const anchor = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const shown = open ? choices() : [];
  // Ages are worked out when the list opens; nothing ticks.
  const now = Date.now();
  return (
    <>
      <TeamCardButton
        ref={anchor}
        data-race-review-ask
        aria-haspopup="dialog"
        aria-expanded={open}
        disabled={disabled}
        title={
          reviewing
            ? "A reviewer is comparing the agents' work."
            : "Send the agents' results to a chat of your choice, to compare them as a Reviewer"
        }
        onClick={() => setOpen((value) => !value)}
      >
        {reviewing ? "Reviewing…" : "Ask a reviewer"}
      </TeamCardButton>
      {open ? (
        <Popover
          anchor={anchor}
          side={side}
          align={align}
          width={280}
          autoFocus
          tabIndex={-1}
          role="dialog"
          aria-label="Ask a reviewer"
          onKeyDown={moveMenuFocus}
          onDismiss={(reason) => {
            setOpen(false);
            // The keyboard goes back where it came from.
            if (reason === "escape") anchor.current?.focus();
          }}
          data-race-reviewers
          className="p-1 outline-none"
        >
          <p className="px-2 pb-1 pt-1.5 text-ui-caption leading-4 text-content/50">
            The chat you pick gets the agents' last replies and changes, with a
            Reviewer's instruction, and suggests one to keep.
          </p>
          {shown.length ? (
            shown.map((choice) => (
              <button
                key={choice.sessionId}
                type="button"
                data-race-reviewer={choice.sessionId}
                disabled={!!choice.busy}
                title={
                  choice.busy
                    ? `“${choice.title}”: ${choice.busy}`
                    : `“${choice.title}” · ${choice.fullName}`
                }
                onClick={() => {
                  setOpen(false);
                  anchor.current?.focus();
                  onPick(choice);
                }}
                className="flex h-8 w-full min-w-0 items-center gap-2 rounded-md px-2 text-left text-ui-body text-content/85 hover:bg-content/5 hover:text-content focus-visible:outline-2 focus-visible:outline-[color:var(--aven-focus-ring)] disabled:cursor-not-allowed disabled:opacity-45 disabled:hover:bg-transparent"
              >
                <HarnessIcon
                  harness={choice.harness}
                  className="size-3.5 shrink-0"
                />
                <span className="min-w-0 flex-1 truncate">
                  {choice.sessionId === originId
                    ? "The chat you raced from"
                    : choice.title}
                </span>
                <span
                  className="max-w-[50%] shrink-0 truncate text-ui-caption text-content/45"
                  data-race-reviewer-detail
                >
                  {choice.busy ??
                    [
                      choice.label,
                      choice.lastUsedAt === undefined
                        ? ""
                        : timeAgo(choice.lastUsedAt, now),
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                </span>
              </button>
            ))
          ) : (
            <p className="px-2 py-2 text-ui-label text-content/45">
              No other chat in this project can review it.
            </p>
          )}
        </Popover>
      ) : null}
    </>
  );
}

import { useRef, useState } from "react";
import { HarnessIcon } from "../chrome/HarnessIcon";
import "../chrome/Menu.css";
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
          className="aven-menu"
        >
          <p className="aven-menu-note aven-menu-description">
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
                className="aven-menu-item"
              >
                <span aria-hidden="true" className="aven-menu-icon">
                  <HarnessIcon
                    harness={choice.harness}
                    className="size-3.5 shrink-0"
                  />
                </span>
                <span className="aven-menu-label">
                  {choice.sessionId === originId
                    ? "The chat you raced from"
                    : choice.title}
                </span>
                <span
                  className="aven-menu-detail max-w-[50%]"
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
            <p className="aven-menu-note">
              No other chat in this project can review it.
            </p>
          )}
        </Popover>
      ) : null}
    </>
  );
}

import { createContext, useContext, useState, type KeyboardEvent } from "react";
import { MessageSquare } from "../chrome/icons";
import type { ApprovalDecision } from "../lib/harness";
import type { Block } from "../lib/session";

/** Answers an approval; `note` tells the agent why it was denied. */
export type ApprovalHandler = (
  requestId: number,
  decision: ApprovalDecision,
  note?: string,
) => void;

/** What a request's buttons say: a bot asks to be allowed once. */
export type ApprovalWording = { allow: string; deny: string };
export const PLAIN_APPROVAL: ApprovalWording = { allow: "Allow", deny: "Deny" };
export const BOT_APPROVAL: ApprovalWording = {
  allow: "Allow once",
  deny: "Don't allow",
};
export const ApprovalWords = createContext<ApprovalWording>(PLAIN_APPROVAL);

const NOTE_MAX = 500;

/**
 * A waiting approval's answers: Allow, Always allow (when the provider can
 * keep the choice for this chat) and Deny. A note for the agent opens from
 * the small button after Deny, which shows while the card is pointed at or
 * focused. Focused, the card takes Enter (Allow), Option-Enter or A
 * (Always), Esc or D (Deny) and N (a note); typing elsewhere is untouched.
 */
export function ApprovalControls({
  block,
  onApproval,
}: {
  block: Block;
  onApproval?: ApprovalHandler;
}) {
  const approval = block.approval;
  const words = useContext(ApprovalWords);
  const [noting, setNoting] = useState(false);
  const [note, setNote] = useState("");
  if (!approval || approval.decided) return null;
  const always = approval.always;
  const decide = (decision: ApprovalDecision, text?: string) => {
    const reason = text?.trim();
    if (reason) onApproval?.(approval.requestId, decision, reason);
    else onApproval?.(approval.requestId, decision);
  };

  if (noting)
    return (
      <div
        className="personal-tool-approval mt-1.5 flex min-w-0 gap-2"
        data-approval-pending
      >
        <input
          autoFocus
          value={note}
          maxLength={NOTE_MAX}
          aria-label="Tell the agent why"
          placeholder="Tell the agent why…"
          onChange={(event) => setNote(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.nativeEvent.isComposing) {
              event.preventDefault();
              decide("deny", note);
            } else if (event.key === "Escape") {
              // Back to the answers; the chat's Escape must not stop the turn.
              event.preventDefault();
              event.stopPropagation();
              setNoting(false);
            }
          }}
          className="min-w-0 max-w-80 flex-1 rounded-md bg-(--aven-control-bg) px-2.5 py-0.5 text-ui-caption text-content outline-none placeholder:text-content/40"
        />
        <button
          type="button"
          className="rounded-md bg-(--aven-control-bg) px-2.5 py-0.5 text-ui-caption text-content/70 hover:bg-(--aven-control-hover) active:bg-(--aven-control-pressed)"
          onClick={() => decide("deny", note)}
        >
          {words.deny}
        </button>
      </div>
    );

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.metaKey || event.ctrlKey || event.nativeEvent.isComposing) return;
    const key = event.key;
    const onCard = event.target === event.currentTarget;
    let handled = true;
    if (key === "Enter" && event.altKey && always) decide("allowAlways");
    // A focused button answers Enter itself.
    else if (key === "Enter" && !event.altKey && !event.shiftKey && onCard)
      decide("allow");
    else if (event.altKey || event.shiftKey) handled = false;
    else if ((key === "a" || key === "A") && always) decide("allowAlways");
    else if (key === "Escape" || key === "d" || key === "D") decide("deny");
    else if (key === "n" || key === "N") setNoting(true);
    else handled = false;
    if (!handled) return;
    event.preventDefault();
    event.stopPropagation();
  };

  return (
    <div
      role="group"
      tabIndex={0}
      aria-label={`Approval: ${block.text || block.tool?.title || "request"}`}
      aria-keyshortcuts={
        always ? "Enter Alt+Enter A Escape D N" : "Enter Escape D N"
      }
      onKeyDown={onKeyDown}
      className="personal-tool-approval mt-1.5 flex min-w-0 flex-wrap gap-2 rounded-md outline-none focus-visible:ring-1 focus-visible:ring-content/30"
      data-approval-pending
    >
      <button
        type="button"
        className="rounded-md bg-content px-2.5 py-0.5 text-ui-caption text-background-base hover:bg-(--aven-inverse-hover)"
        onClick={() => decide("allow")}
      >
        {words.allow}
      </button>
      {always ? (
        <button
          type="button"
          data-approval-always
          title={`Allow ${always} for the rest of this chat`}
          className="flex min-w-0 max-w-full items-center gap-1 rounded-md bg-(--aven-control-bg) px-2.5 py-0.5 text-ui-caption text-content/70 hover:bg-(--aven-control-hover) active:bg-(--aven-control-pressed)"
          onClick={() => decide("allowAlways")}
        >
          <span className="shrink-0">Always allow</span>
          <span className="min-w-0 truncate font-mono text-content/55">
            {always}
          </span>
        </button>
      ) : null}
      <button
        type="button"
        className="rounded-md bg-(--aven-control-bg) px-2.5 py-0.5 text-ui-caption text-content/70 hover:bg-(--aven-control-hover) active:bg-(--aven-control-pressed)"
        onClick={() => decide("deny")}
      >
        {words.deny}
      </button>
      <button
        type="button"
        data-approval-note
        aria-label={`${words.deny} with a note`}
        title={`${words.deny} and tell the agent why`}
        className="flex items-center rounded-md text-content/50 hover:bg-(--aven-hover) hover:text-content/80"
        onClick={() => setNoting(true)}
      >
        <MessageSquare className="size-3.5" strokeWidth={1.75} />
      </button>
    </div>
  );
}

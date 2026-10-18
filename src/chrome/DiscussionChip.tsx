import { useRef, useState, type KeyboardEvent } from "react";
import { agentRole, type AgentRoleId } from "../lib/agentRoles";
import {
  BLOCKER_LABEL,
  DISCUSSION_MAX_ROUNDS,
  DISCUSSION_MIN_ROUNDS,
  type DiscussionCandidate,
  type DiscussionHost,
  type DiscussionPartnerChoice,
} from "../lib/discussions";
import type { ComposerFit } from "../lib/composerFit";
import { providerShortName } from "../lib/discussionVoices";
import { isImeComposition, moveMenuFocus } from "../lib/keyboard";

/** ↑, ↓, Home and End through a dropdown's buttons, never mid-composition. */
const menuKeys = (event: KeyboardEvent<HTMLDivElement>) => {
  if (isImeComposition(event.nativeEvent)) return;
  moveMenuFocus(event);
};
import { resolveModel } from "../lib/models";
import type { HarnessId } from "../lib/session";
import { RolePicker } from "./AgentRoles";
import { HarnessIcon } from "./HarnessIcon";
import { Check, ChevronDown, MessageMultiple, Plus, X } from "./icons";
import { Popover } from "./Popover";
import { ProjectMark } from "./ProjectMark";
import { plural } from "../lib/words";
import { SecondOpinionButton } from "./SecondOpinionButton";

/** Who the composer's Discuss mode talks to, with what its chip shows. */
export type DiscussionPick =
  | {
      kind: "chat";
      sessionId: string;
      harness: HarnessId;
      /** Model display name. */
      model: string;
      title: string;
    }
  | {
      kind: "new";
      harness: HarnessId;
      /** Model id for the new chat. */
      model: string;
    };

export function partnerChoice(pick: DiscussionPick): DiscussionPartnerChoice {
  return pick.kind === "chat"
    ? { kind: "chat", sessionId: pick.sessionId }
    : { kind: "new", harness: pick.harness, model: pick.model };
}

function chatPick(candidate: DiscussionCandidate): DiscussionPick {
  return {
    kind: "chat",
    sessionId: candidate.sessionId,
    harness: candidate.harness,
    model: candidate.model,
    title: candidate.title,
  };
}

/**
 * The partner Discuss mode starts with: the chat already picked while it can
 * still join, else the first open chat that can (same project first).
 */
export function defaultDiscussionPick(
  host: DiscussionHost,
  sessionId: string,
  current: DiscussionPick | null,
): DiscussionPick | null {
  const { candidates } = host.options(sessionId);
  if (current?.kind === "new") return current;
  if (current?.kind === "chat") {
    const still = candidates.find(
      (candidate) =>
        candidate.sessionId === current.sessionId && !candidate.blocked,
    );
    if (still) return chatPick(still);
  }
  const open = candidates.find((candidate) => !candidate.blocked);
  return open ? chatPick(open) : null;
}

/** "Discuss with Codex · 3 rounds", or "Discuss with Codex as Skeptic · 3 rounds". */
export function discussionChipLabel(
  pick: DiscussionPick | null,
  rounds: number,
  role?: AgentRoleId,
): string {
  const who = !pick
    ? "…"
    : pick.kind === "chat"
      ? providerShortName(pick.harness)
      : `new ${providerShortName(pick.harness)} chat`;
  const as = role ? ` as ${agentRole(role).name}` : "";
  return `Discuss with ${who}${as} · ${plural(rounds, "round")}`;
}

/**
 * The chip's words for the room it has: the full label, or "Discuss ·
 * Codex · 3" when space is short. The tooltip keeps the full text.
 */
export function discussionChipFitLabel(
  pick: DiscussionPick | null,
  rounds: number,
  role: AgentRoleId | undefined,
  fit: ComposerFit,
): string {
  if (fit === "full") return discussionChipLabel(pick, rounds, role);
  const who = pick ? providerShortName(pick.harness) : "…";
  return `Discuss · ${who} · ${rounds}`;
}

function pickTooltip(pick: DiscussionPick | null): string {
  if (!pick) return "Choose who this chat discusses with";
  if (pick.kind === "new")
    return `A new chat with ${resolveModel(pick.harness, pick.model).name}`;
  return `${pick.model} in “${pick.title}”`;
}

const ROUNDS = Array.from(
  { length: DISCUSSION_MAX_ROUNDS - DISCUSSION_MIN_ROUNDS + 1 },
  (_, index) => DISCUSSION_MIN_ROUNDS + index,
);

/** Menus of the new-chat model picker live outside this dropdown. */
const PROVIDER_MENUS = "[data-provider-target]";

type Props = {
  host: DiscussionHost;
  sessionId: string;
  /** This chat's provider and model, where the new-chat menu starts. */
  harness: HarnessId;
  model: string;
  pick: DiscussionPick | null;
  rounds: number;
  /** The other chat's role for this discussion, if any. */
  role?: AgentRoleId;
  /** Why sending would not start it yet, or the last refusal. */
  reason: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onPick: (pick: DiscussionPick) => void;
  onRoundsChange: (rounds: number) => void;
  onRoleChange: (role: AgentRoleId | undefined) => void;
  onTurnOff: () => void;
  /** Development builds: show it without sending anything. */
  onPreview?: () => void;
  /** Return the keyboard to the message box. */
  onDone: () => void;
  /** How much room the message box gives the chip's words. */
  fit?: ComposerFit;
};

/**
 * The composer's Discuss mode chip: who this chat discusses with and for how
 * many rounds, and a dropdown to change either. Sending the message starts
 * the discussion with the message as its topic.
 */
export function DiscussionChip({
  host,
  sessionId,
  harness,
  model,
  pick,
  rounds,
  role,
  reason,
  open,
  onOpenChange,
  onPick,
  onRoundsChange,
  onRoleChange,
  onTurnOff,
  onPreview,
  onDone,
  fit = "full",
}: Props) {
  const anchor = useRef<HTMLButtonElement>(null);
  const full = discussionChipLabel(pick, rounds, role);
  const label = discussionChipFitLabel(pick, rounds, role, fit);
  return (
    <div
      className="flex h-6.5 min-w-0 shrink items-center rounded-md bg-accent/10 text-ui-caption text-accent"
      data-discussion-chip
      data-full-label={full}
    >
      <button
        ref={anchor}
        type="button"
        title={
          label === full ? pickTooltip(pick) : `${full}: ${pickTooltip(pick)}`
        }
        aria-haspopup="dialog"
        aria-expanded={open}
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => onOpenChange(!open)}
        className="flex h-full min-w-0 items-center gap-1 rounded-l-md pl-1.5 pr-1 hover:bg-accent/15"
      >
        <MessageMultiple className="size-3.5 shrink-0" />
        <span className="min-w-0 truncate" data-discussion-chip-label>
          {label}
        </span>
        <ChevronDown className="size-3 shrink-0" />
      </button>
      <button
        type="button"
        title="Turn off Discuss mode"
        aria-label="Turn off Discuss mode"
        onMouseDown={(event) => event.preventDefault()}
        onClick={onTurnOff}
        className="grid h-full shrink-0 place-items-center rounded-r-md px-1 hover:bg-accent/15"
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
          ignore={PROVIDER_MENUS}
          aria-label="Discuss with another chat"
          // On the surface itself: it holds the keyboard when the dropdown
          // opens, so the arrow keys move through it from the start.
          onKeyDown={menuKeys}
          onDismiss={(dismissed) => {
            onOpenChange(false);
            if (dismissed === "escape") onDone();
          }}
          data-discussion-menu
          className="outline-none"
        >
          <DiscussionMenu
            host={host}
            sessionId={sessionId}
            harness={harness}
            model={model}
            pick={pick}
            rounds={rounds}
            role={role}
            reason={reason}
            onPick={onPick}
            onRoundsChange={onRoundsChange}
            onRoleChange={onRoleChange}
            onPreview={onPreview}
          />
        </Popover>
      ) : null}
    </div>
  );
}

/**
 * The dropdown. Other chats are listed as they were when it opened; sending
 * checks them again.
 */
function DiscussionMenu({
  host,
  sessionId,
  harness,
  model,
  pick,
  rounds,
  role,
  reason,
  onPick,
  onRoundsChange,
  onRoleChange,
  onPreview,
}: Pick<
  Props,
  | "host"
  | "sessionId"
  | "harness"
  | "model"
  | "pick"
  | "rounds"
  | "role"
  | "reason"
  | "onPick"
  | "onRoundsChange"
  | "onRoleChange"
  | "onPreview"
>) {
  const [{ blocked, candidates }] = useState(() => host.options(sessionId));
  const notice = blocked ?? reason;
  const newChat = pick?.kind === "new" ? pick : null;
  const rowClass = (selected: boolean) =>
    `flex h-8 w-full min-w-0 items-center gap-2 rounded-md px-2 text-left text-ui-body ${
      selected
        ? "bg-content/10 text-content"
        : "text-content/85 hover:bg-content/5 hover:text-content"
    }`;
  return (
    <div>
      <p className="px-2.5 pb-1 pt-2 text-ui-micro font-medium uppercase tracking-wide text-content/40">
        Discuss with
      </p>
      <div
        role="radiogroup"
        aria-label="Chat to discuss with"
        className="max-h-[min(176px,30vh)] overflow-y-auto overscroll-none px-1 pb-1"
      >
        {candidates.map((candidate) => {
          const selected =
            pick?.kind === "chat" && pick.sessionId === candidate.sessionId;
          return (
            <button
              key={candidate.sessionId}
              type="button"
              role="radio"
              aria-checked={selected}
              disabled={!!candidate.blocked}
              data-discussion-candidate={candidate.sessionId}
              title={
                candidate.blocked
                  ? `${candidate.title}: ${BLOCKER_LABEL[candidate.blocked]}`
                  : `${candidate.title} · ${candidate.model}`
              }
              onClick={() => onPick(chatPick(candidate))}
              className={`${rowClass(selected)} disabled:cursor-not-allowed disabled:opacity-45 disabled:hover:bg-transparent`}
            >
              <ProjectMark path={candidate.cwd} />
              <HarnessIcon
                harness={candidate.harness}
                className="size-3.5 shrink-0"
              />
              <span className="min-w-0 flex-1 truncate">{candidate.title}</span>
              <span className="max-w-[40%] shrink-0 truncate text-ui-caption text-content/45">
                {candidate.blocked
                  ? BLOCKER_LABEL[candidate.blocked]
                  : candidate.model}
              </span>
              <Check
                className={`size-3.5 shrink-0 text-accent ${selected ? "" : "invisible"}`}
              />
            </button>
          );
        })}
        <SecondOpinionButton
          from={harness}
          fromModel={model}
          includeCurrent
          icon={Plus}
          title="New chat with…"
          disabledTitle="No agents are installed for a new chat"
          description="Start a new chat with the model you choose. It talks in the background, listed in the sidebar, without a tab of its own."
          menuLabel="Choose the model for the new chat"
          onPick={(pickedHarness, pickedModel) =>
            onPick({ kind: "new", harness: pickedHarness, model: pickedModel })
          }
          triggerClassName={`${rowClass(!!newChat)} disabled:opacity-45`}
          label={
            <>
              <span className="min-w-0 flex-1 truncate">New chat with…</span>
              {newChat ? (
                <>
                  <HarnessIcon
                    harness={newChat.harness}
                    className="size-3.5 shrink-0"
                  />
                  <span className="max-w-[40%] shrink-0 truncate text-ui-caption text-content/60">
                    {resolveModel(newChat.harness, newChat.model).name}
                  </span>
                </>
              ) : null}
              <Check
                className={`size-3.5 shrink-0 text-accent ${newChat ? "" : "invisible"}`}
              />
            </>
          }
        />
      </div>
      <div className="flex items-center gap-2 border-t border-content/10 px-2.5 py-2">
        <span
          id={`${sessionId}-discussion-rounds`}
          className="text-ui-caption text-content/50"
        >
          Rounds
        </span>
        <div
          role="radiogroup"
          aria-labelledby={`${sessionId}-discussion-rounds`}
          className="flex gap-0.5"
        >
          {ROUNDS.map((count) => (
            <button
              key={count}
              type="button"
              role="radio"
              aria-checked={rounds === count}
              data-discussion-rounds={count}
              onClick={() => onRoundsChange(count)}
              className={`grid size-6 place-items-center rounded-md text-ui-label tabular-nums ${
                rounds === count
                  ? "bg-content/15 text-content"
                  : "text-content/55 hover:bg-content/10 hover:text-content"
              }`}
            >
              {count}
            </button>
          ))}
        </div>
      </div>
      <div className="flex items-start gap-2 border-t border-content/10 px-2.5 py-2">
        <span
          id={`${sessionId}-discussion-role`}
          className="mt-1 text-ui-caption text-content/50"
          title="Added once to the other chat's first message, for this discussion only"
        >
          Role
        </span>
        <RolePicker
          label="The other chat's role"
          value={role}
          onChange={onRoleChange}
          className="min-w-0 flex-1"
        />
      </div>
      <div className="flex min-h-9 items-center gap-1 border-t border-content/10 py-1 pl-2.5 pr-1">
        <p
          role={notice ? "alert" : undefined}
          data-discussion-reason
          className={`min-w-0 flex-1 text-ui-caption leading-4 ${
            notice ? "text-content/80" : "text-content/45"
          }`}
        >
          {notice ??
            "Send your message to start. Each round is one reply from each chat."}
        </p>
        {host.preview && pick && onPreview ? (
          <button
            type="button"
            title="Development builds: show the discussion without sending anything"
            onClick={onPreview}
            className="shrink-0 rounded-md px-2 py-1 text-ui-label text-content/45 hover:bg-content/10 hover:text-content"
          >
            Preview
          </button>
        ) : null}
      </div>
    </div>
  );
}
